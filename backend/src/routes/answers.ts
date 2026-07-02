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
const MAX_RECENT_TEXTS = 400;

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

        const isNew = !answerSnap.exists;
        const type: string = questionData.type;

        if (type === 'TEXT') {
          if (!textValue) {
            throw Object.assign(new Error('textValue required for TEXT question'), { code: 400 });
          }
          tx.set(answerRef, { textValue, createdAt: FieldValue.serverTimestamp() });

          const currentTexts: string[] = questionData.recentTexts ?? [];
          const newTexts = [...currentTexts, textValue].slice(-MAX_RECENT_TEXTS);

          if (isNew) {
            tx.update(questionRef, {
              totalResponses: FieldValue.increment(1),
              recentTexts: newTexts,
            });
          } else {
            tx.update(questionRef, { recentTexts: newTexts });
          }
          return;
        }

        if (type === 'SINGLE_CHOICE') {
          if (!optionId) {
            throw Object.assign(new Error('optionId required for SINGLE_CHOICE'), { code: 400 });
          }

          if (isNew) {
            tx.update(questionRef, {
              [`optionCounts.${optionId}`]: FieldValue.increment(1),
              totalResponses: FieldValue.increment(1),
            });
            tx.set(answerRef, { optionId, createdAt: FieldValue.serverTimestamp() });
          } else {
            const prevOptionId: string | undefined = answerSnap.data()?.optionId;
            if (prevOptionId === optionId) return;
            const updates: Record<string, unknown> = {
              [`optionCounts.${optionId}`]: FieldValue.increment(1),
            };
            if (prevOptionId) {
              updates[`optionCounts.${prevOptionId}`] = FieldValue.increment(-1);
            }
            tx.update(questionRef, updates);
            tx.set(answerRef, { optionId, createdAt: FieldValue.serverTimestamp() });
          }
          return;
        }

        if (type === 'MULTI_CHOICE') {
          if (!optionIds || optionIds.length === 0) {
            throw Object.assign(new Error('optionIds required for MULTI_CHOICE'), { code: 400 });
          }

          if (isNew) {
            const updates: Record<string, unknown> = {
              totalResponses: FieldValue.increment(1),
            };
            optionIds.forEach((id) => {
              updates[`optionCounts.${id}`] = FieldValue.increment(1);
            });
            tx.update(questionRef, updates);
            tx.set(answerRef, { optionIds, createdAt: FieldValue.serverTimestamp() });
          } else {
            const prevOptionIds: string[] = answerSnap.data()?.optionIds ?? [];
            const isSame =
              prevOptionIds.length === optionIds.length &&
              prevOptionIds.every((id) => optionIds.includes(id));
            if (isSame) return;

            const updates: Record<string, unknown> = {};
            prevOptionIds
              .filter((id) => !optionIds.includes(id))
              .forEach((id) => { updates[`optionCounts.${id}`] = FieldValue.increment(-1); });
            optionIds
              .filter((id) => !prevOptionIds.includes(id))
              .forEach((id) => { updates[`optionCounts.${id}`] = FieldValue.increment(1); });

            if (Object.keys(updates).length > 0) {
              tx.update(questionRef, updates);
            }
            tx.set(answerRef, { optionIds, createdAt: FieldValue.serverTimestamp() });
          }
          return;
        }

        throw Object.assign(new Error('Unknown question type'), { code: 400 });
      });

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
      const optionCounts: Record<string, number> = {};
      const recentTexts: string[] = [];

      for (let index = 0; index < LOAD_TEST_ANSWER_COUNT; index += 1) {
        const answerRef = questionRef.collection('answers').doc(uuidv4());
        if (type === 'TEXT') {
          const textValue = `壓測回答 ${index + 1}`;
          batch.set(answerRef, {
            textValue,
            createdAt: FieldValue.serverTimestamp(),
            loadTest: true,
          });
          recentTexts.push(textValue);
        } else if (type === 'SINGLE_CHOICE') {
          const option = options[index % options.length];
          batch.set(answerRef, {
            optionId: option.id,
            createdAt: FieldValue.serverTimestamp(),
            loadTest: true,
          });
          optionCounts[option.id] = (optionCounts[option.id] ?? 0) + 1;
        } else if (type === 'MULTI_CHOICE') {
          const shuffled = [...options].sort(() => Math.random() - 0.5);
          const selected = shuffled.slice(0, Math.min(options.length, 1 + (index % 3))).map((option) => option.id);
          batch.set(answerRef, {
            optionIds: selected,
            createdAt: FieldValue.serverTimestamp(),
            loadTest: true,
          });
          selected.forEach((optionId) => {
            optionCounts[optionId] = (optionCounts[optionId] ?? 0) + 1;
          });
        } else {
          res.status(400).json({ error: 'Unknown question type' });
          return;
        }
      }

      await batch.commit();

      const updates: Record<string, unknown> = {
        totalResponses: FieldValue.increment(LOAD_TEST_ANSWER_COUNT),
      };
      Object.entries(optionCounts).forEach(([optionId, count]) => {
        updates[`optionCounts.${optionId}`] = FieldValue.increment(count);
      });
      if (recentTexts.length > 0) {
        const existingTexts = (questionData.recentTexts ?? []) as string[];
        updates.recentTexts = [...existingTexts, ...recentTexts].slice(-MAX_RECENT_TEXTS);
      }
      await questionRef.update(updates);

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
          const nextTexts = [...existingTexts, ...textAnswers].slice(-MAX_RECENT_TEXTS);

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
