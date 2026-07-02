import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { db, FieldValue } from '../lib/firebaseAdmin';
import { requireHostToken } from '../middleware/auth';
import type { DisplayScene, QuestionOption, QuestionType } from '../types';
import { resetQuestionAnswers } from '../utils/resetAnswers';

export const sessionRouter = Router();

const createSessionSchema = z.object({
  name: z.string().min(1).max(200),
});

sessionRouter.post('/:id/reset-answers', requireHostToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const sessionRef = db.collection('sessions').doc(req.params.id);
    const questionsSnap = await sessionRef.collection('questions').get();

    for (const questionDoc of questionsSnap.docs) {
      const data = questionDoc.data();
      const options = (data.options as QuestionOption[] | undefined) ?? [];
      await resetQuestionAnswers(questionDoc.ref, options);
    }

    res.json({ success: true, clearedQuestions: questionsSnap.size });
  } catch (err) {
    console.error('[sessions] reset answers error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

type DefaultQuestionSeed = {
  type: QuestionType;
  title: string;
  options?: string[];
  displayScene: DisplayScene;
};

const DEFAULT_QUESTION_SEEDS: DefaultQuestionSeed[] = [
  {
    type: 'SINGLE_CHOICE',
    title: '請問你從哪裡來？',
    options: ['北', '中', '南', '東', '海外'],
    displayScene: 'map3d',
  },
  {
    type: 'TEXT',
    title: '你來自哪間教會？',
    displayScene: 'spotlight',
  },
  {
    type: 'TEXT',
    title: '請用一個詞形容神創造你「最特別之處」？',
    displayScene: 'word-cloud',
  },
];

async function seedDefaultQuestions(sessionId: string): Promise<void> {
  const questionsRef = db.collection('sessions').doc(sessionId).collection('questions');

  const batch = db.batch();
  DEFAULT_QUESTION_SEEDS.forEach((seed, index) => {
    const questionId = uuidv4();
    const options = (seed.options ?? []).map((label, optIdx) => ({
      id: `opt_${optIdx}_${uuidv4().slice(0, 8)}`,
      label,
    }));
    const optionCounts: Record<string, number> = {};
    options.forEach((opt) => { optionCounts[opt.id] = 0; });

    batch.set(questionsRef.doc(questionId), {
      type: seed.type,
      title: seed.title,
      status: 'DRAFT',
      order: index,
      options,
      optionCounts,
      totalResponses: 0,
      recentTexts: [],
      displayScene: seed.displayScene,
      wordCloudRefreshIntervalSec: 3,
      wordCloudRefreshPaused: false,
      wordCloudRefreshNonce: 0,
      spotlightSloganText: 'We Are One',
      spotlightSloganVisible: false,
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  await batch.commit();
}

sessionRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  const parsed = createSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const sessionId = uuidv4();
  const hostToken = uuidv4();

  try {
    await db.collection('sessions').doc(sessionId).set({
      name: parsed.data.name,
      hostToken,
      createdAt: FieldValue.serverTimestamp(),
    });

    await seedDefaultQuestions(sessionId);

    res.status(201).json({ sessionId, hostToken });
  } catch (err) {
    console.error('[sessions] create error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

sessionRouter.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const doc = await db.collection('sessions').doc(req.params.id).get();
    if (!doc.exists) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const data = doc.data()!;
    res.json({
      sessionId: req.params.id,
      name: data.name,
      createdAt: data.createdAt,
      displayMode: (data.displayMode as string) ?? 'results',
    });
  } catch (err) {
    console.error('[sessions] get error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const patchSessionSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  displayMode: z.enum(['question', 'results']).optional(),
}).refine((data) => data.name !== undefined || data.displayMode !== undefined, {
  message: 'At least one field is required',
});

// PATCH /api/sessions/:id — 主持人更新場次設定
sessionRouter.patch('/:id', requireHostToken, async (req: Request, res: Response): Promise<void> => {
  const parsed = patchSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const sessionRef = db.collection('sessions').doc(req.params.id);
    const updates: Record<string, unknown> = {};

    if (parsed.data.name !== undefined) {
      updates.name = parsed.data.name;
    }

    if (Object.keys(updates).length > 0) {
      await sessionRef.update(updates);
    }

    if (parsed.data.displayMode !== undefined) {
      await sessionRef.update({ displayMode: parsed.data.displayMode });

      // Write to _ctrl/display (works once rules are deployed)
      await sessionRef
        .collection('_ctrl').doc('display')
        .set({ displayMode: parsed.data.displayMode }, { merge: true });

      // Also write to every OPEN question document (questions subcollection is
      // already allow read: if true, so DisplayPage picks this up immediately)
      const openSnap = await sessionRef
        .collection('questions')
        .where('status', '==', 'OPEN')
        .get();
      const batch = db.batch();
      openSnap.docs.forEach((doc) => {
        batch.update(doc.ref, { displayMode: parsed.data.displayMode });
      });
      await batch.commit();
    }

    res.json({
      sessionId: req.params.id,
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.displayMode !== undefined ? { displayMode: parsed.data.displayMode } : {}),
    });
  } catch (err) {
    console.error('[sessions] patch error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
