import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { db, FieldValue } from '../lib/firebaseAdmin';
import { answerRateLimiter } from '../middleware/rateLimiter';
import { requireHostToken } from '../middleware/auth';

export const answerRouter = Router();

const submitAnswerSchema = z.object({
  respondentId: z.string().uuid(),
  optionId: z.string().min(1).optional(),
  optionIds: z.array(z.string().min(1)).optional(),
  textValue: z.string().min(1).max(1000).optional(),
});

const seedAnswersSchema = z.object({
  textAnswers: z.array(z.string().min(1).max(1000)).min(1).max(50).optional(),
  optionCounts: z
    .record(z.string().min(1), z.number().int().min(1).max(500))
    .optional(),
});

const LOAD_TEST_ANSWER_COUNT = 500;

type PendingQuestionStats = {
  sessionId: string;
  questionId: string;
  totalResponses: number;
  optionCounts: Record<string, number>;
  recentTexts: string[];
};

const pendingQuestionStats = new Map<string, PendingQuestionStats>();
let flushTimer: NodeJS.Timeout | null = null;

function getStatsKey(sessionId: string, questionId: string) {
  return `${sessionId}/${questionId}`;
}

function enqueueQuestionStats(
  sessionId: string,
  questionId: string,
  payload: { optionIds?: string[]; textValue?: string },
) {
  const key = getStatsKey(sessionId, questionId);
  const pending = pendingQuestionStats.get(key) ?? {
    sessionId,
    questionId,
    totalResponses: 0,
    optionCounts: {},
    recentTexts: [],
  };

  pending.totalResponses += 1;
  payload.optionIds?.forEach((id) => {
    pending.optionCounts[id] = (pending.optionCounts[id] ?? 0) + 1;
  });
  if (payload.textValue) {
    pending.recentTexts.push(payload.textValue);
  }

  pendingQuestionStats.set(key, pending);
}

async function flushQuestionStats() {
  if (pendingQuestionStats.size === 0) return;

  const entries = [...pendingQuestionStats.entries()];
  pendingQuestionStats.clear();

  await Promise.all(entries.map(async ([key, pending]) => {
    const questionRef = db
      .collection('sessions').doc(pending.sessionId)
      .collection('questions').doc(pending.questionId);

    try {
      await db.runTransaction(async (tx) => {
        const questionSnap = await tx.get(questionRef);
        if (!questionSnap.exists) return;

        const updates: Record<string, unknown> = {
          totalResponses: FieldValue.increment(pending.totalResponses),
        };
        Object.entries(pending.optionCounts).forEach(([optionId, count]) => {
          updates[`optionCounts.${optionId}`] = FieldValue.increment(count);
        });

        if (pending.recentTexts.length > 0) {
          const currentTexts: string[] = questionSnap.data()?.recentTexts ?? [];
          updates.recentTexts = [...currentTexts, ...pending.recentTexts].slice(-20);
        }

        tx.update(questionRef, updates);
      });
    } catch (err) {
      console.error('[answers] stats flush error:', err);
      const current = pendingQuestionStats.get(key) ?? {
        sessionId: pending.sessionId,
        questionId: pending.questionId,
        totalResponses: 0,
        optionCounts: {},
        recentTexts: [],
      };
      current.totalResponses += pending.totalResponses;
      Object.entries(pending.optionCounts).forEach(([optionId, count]) => {
        current.optionCounts[optionId] = (current.optionCounts[optionId] ?? 0) + count;
      });
      current.recentTexts.push(...pending.recentTexts);
      pendingQuestionStats.set(key, current);
    }
  }));
}

function ensureStatsFlushTimer() {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    flushQuestionStats().catch((err) => console.error('[answers] stats flush loop error:', err));
  }, 1000);
}

ensureStatsFlushTimer();

// POST /api/sessions/:id/questions/:qid/answers — 觀眾送出答案
answerRouter.post(
  '/:id/questions/:qid/answers',
  answerRateLimiter,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = submitAnswerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const { respondentId, optionId, optionIds, textValue } = parsed.data;
    const { id: sessionId, qid: questionId } = req.params;

    const questionRef = db
      .collection('sessions').doc(sessionId)
      .collection('questions').doc(questionId);

    const answerRef = questionRef
      .collection('answers').doc(respondentId);

    try {
      let statsPayload: { optionIds?: string[]; textValue?: string } | null = null;

      await db.runTransaction(async (tx) => {
        const [answerSnap, questionSnap] = await Promise.all([
          tx.get(answerRef),
          tx.get(questionRef),
        ]);

        if (!questionSnap.exists) {
          throw Object.assign(new Error('Question not found'), { code: 404 });
        }

        const questionData = questionSnap.data()!;

        if (questionData.status !== 'OPEN') {
          throw Object.assign(new Error('Question is not open'), { code: 409 });
        }

        if (answerSnap.exists) {
          throw Object.assign(new Error('Already answered'), { code: 409 });
        }

        const type: string = questionData.type;

        if (type === 'TEXT') {
          if (!textValue) {
            throw Object.assign(new Error('textValue required for TEXT question'), { code: 400 });
          }
          tx.set(answerRef, { textValue, createdAt: FieldValue.serverTimestamp() });
          statsPayload = { textValue };
          return;
        }

        if (type === 'SINGLE_CHOICE') {
          if (!optionId) {
            throw Object.assign(new Error('optionId required for SINGLE_CHOICE'), { code: 400 });
          }

          tx.set(answerRef, { optionId, createdAt: FieldValue.serverTimestamp() });
          statsPayload = { optionIds: [optionId] };
          return;
        }

        if (type === 'MULTI_CHOICE') {
          if (!optionIds || optionIds.length === 0) {
            throw Object.assign(new Error('optionIds required for MULTI_CHOICE'), { code: 400 });
          }

          tx.set(answerRef, { optionIds, createdAt: FieldValue.serverTimestamp() });
          statsPayload = { optionIds };
          return;
        }

        throw Object.assign(new Error('Unknown question type'), { code: 400 });
      });

      if (statsPayload) {
        enqueueQuestionStats(sessionId, questionId, statsPayload);
      }

      res.status(201).json({ success: true });
    } catch (err: unknown) {
      const code = (err as { code?: number }).code;
      if (code === 404) {
        res.status(404).json({ error: (err as Error).message });
      } else if (code === 409) {
        res.status(409).json({ error: (err as Error).message });
      } else if (code === 400) {
        res.status(400).json({ error: (err as Error).message });
      } else {
        console.error('[answers] submit error:', err);
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  },
);

// POST /api/sessions/:id/questions/:qid/load-test — Host-only utility to simulate concurrent answers
answerRouter.post(
  '/:id/questions/:qid/load-test',
  requireHostToken,
  async (req: Request, res: Response): Promise<void> => {
    const { id: sessionId, qid: questionId } = req.params;
    const questionRef = db
      .collection('sessions').doc(sessionId)
      .collection('questions').doc(questionId);

    try {
      const questionSnap = await questionRef.get();
      if (!questionSnap.exists) {
        res.status(404).json({ error: 'Question not found' });
        return;
      }

      const questionData = questionSnap.data()!;
      const type: string = questionData.type;
      const options = (questionData.options ?? []) as { id: string; label: string }[];
      if (type !== 'TEXT' && options.length === 0) {
        res.status(400).json({ error: 'No options available for load test' });
        return;
      }

      const batch = db.batch();
      const statsPayloads: { optionIds?: string[]; textValue?: string }[] = [];

      for (let index = 0; index < LOAD_TEST_ANSWER_COUNT; index += 1) {
        const answerRef = questionRef.collection('answers').doc(uuidv4());
        if (type === 'TEXT') {
          const textValue = `壓測回答 ${index + 1}`;
          batch.set(answerRef, {
            textValue,
            createdAt: FieldValue.serverTimestamp(),
            loadTest: true,
          });
          statsPayloads.push({ textValue });
        } else if (type === 'SINGLE_CHOICE') {
          const option = options[index % options.length];
          batch.set(answerRef, {
            optionId: option.id,
            createdAt: FieldValue.serverTimestamp(),
            loadTest: true,
          });
          statsPayloads.push({ optionIds: [option.id] });
        } else if (type === 'MULTI_CHOICE') {
          const shuffled = [...options].sort(() => Math.random() - 0.5);
          const selected = shuffled.slice(0, Math.min(options.length, 1 + (index % 3))).map((option) => option.id);
          batch.set(answerRef, {
            optionIds: selected,
            createdAt: FieldValue.serverTimestamp(),
            loadTest: true,
          });
          statsPayloads.push({ optionIds: selected });
        } else {
          res.status(400).json({ error: 'Unknown question type' });
          return;
        }
      }

      await batch.commit();
      statsPayloads.forEach((payload) => enqueueQuestionStats(sessionId, questionId, payload));

      res.json({ success: true, inserted: LOAD_TEST_ANSWER_COUNT });
    } catch (err) {
      console.error('[answers] load test error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// POST /api/sessions/:id/questions/:qid/seed — Host-only utility to insert text answers for display testing
answerRouter.post(
  '/:id/questions/:qid/seed',
  requireHostToken,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = seedAnswersSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const { textAnswers, optionCounts } = parsed.data;
    const { id: sessionId, qid: questionId } = req.params;
    const questionRef = db
      .collection('sessions').doc(sessionId)
      .collection('questions').doc(questionId);

    try {
      await db.runTransaction(async (tx) => {
        const questionSnap = await tx.get(questionRef);
        if (!questionSnap.exists) {
          throw Object.assign(new Error('Question not found'), { code: 404 });
        }

        const questionData = questionSnap.data()!;

        if (questionData.type === 'TEXT') {
          if (!textAnswers || textAnswers.length === 0) {
            throw Object.assign(new Error('textAnswers required for TEXT question'), { code: 400 });
          }

          const existingTexts: string[] = questionData.recentTexts ?? [];
          const nextTexts = [...existingTexts, ...textAnswers].slice(-200);

          textAnswers.forEach((text) => {
            const answerRef = questionRef.collection('answers').doc(uuidv4());
            tx.set(answerRef, {
              textValue: text,
              createdAt: FieldValue.serverTimestamp(),
              seeded: true,
            });
          });

          tx.update(questionRef, {
            totalResponses: FieldValue.increment(textAnswers.length),
            recentTexts: nextTexts,
          });
          return textAnswers.length;
        }

        if (!optionCounts || Object.keys(optionCounts).length === 0) {
          throw Object.assign(new Error('optionCounts required for choice question'), { code: 400 });
        }

        const validOptionIds: string[] = (questionData.options ?? []).map((opt: { id: string }) => opt.id);
        const updates: Record<string, unknown> = {};
        let totalInserted = 0;

        Object.entries(optionCounts).forEach(([optionId, count]) => {
          if (!validOptionIds.includes(optionId) || count <= 0) return;
          updates[`optionCounts.${optionId}`] = FieldValue.increment(count);
          totalInserted += count;
          for (let i = 0; i < count; i += 1) {
            const answerRef = questionRef.collection('answers').doc(uuidv4());
            if (questionData.type === 'SINGLE_CHOICE') {
              tx.set(answerRef, {
                optionId,
                createdAt: FieldValue.serverTimestamp(),
                seeded: true,
              });
            } else {
              tx.set(answerRef, {
                optionIds: [optionId],
                createdAt: FieldValue.serverTimestamp(),
                seeded: true,
              });
            }
          }
        });

        if (totalInserted === 0) {
          throw Object.assign(new Error('No valid option counts provided'), { code: 400 });
        }

        tx.update(questionRef, {
          totalResponses: FieldValue.increment(totalInserted),
          ...updates,
        });

        return totalInserted;
      });

      res.json({ success: true, inserted: textAnswers?.length ?? Object.values(optionCounts ?? {}).reduce((sum, val) => sum + val, 0) });
    } catch (err: unknown) {
      const code = (err as { code?: number }).code;
      if (code === 404) {
        res.status(404).json({ error: (err as Error).message });
      } else if (code === 400) {
        res.status(400).json({ error: (err as Error).message });
      } else {
        console.error('[answers] seed error:', err);
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  },
);
