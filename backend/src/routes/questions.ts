import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { db, FieldValue } from '../lib/firebaseAdmin';
import { requireHostToken } from '../middleware/auth';
import type { DisplayScene, QuestionOption, QuestionType } from '../types';
import { resetQuestionAnswers } from '../utils/resetAnswers';

export const questionRouter = Router();

const DISPLAY_SCENE_VALUES = ['default', 'map3d', 'map3d-hud', 'text-wall', 'spotlight', 'word-cloud'] as const;
const TEXT_SCENES: DisplayScene[] = ['text-wall', 'spotlight', 'word-cloud'];
const CHOICE_SCENES: DisplayScene[] = ['default', 'map3d', 'map3d-hud'];

const createQuestionSchema = z.object({
  type: z.enum(['SINGLE_CHOICE', 'MULTI_CHOICE', 'TEXT']),
  title: z.string().min(1).max(500),
  options: z.array(z.string().min(1).max(200)).optional(),
  displayScene: z.enum(DISPLAY_SCENE_VALUES).optional(),
});

const patchQuestionSchema = z.object({
  status: z.enum(['OPEN', 'CLOSED']),
});

function mergeOptions(
  options: QuestionOption[],
  optionCounts: Record<string, number>,
) {
  return options.map((opt) => ({
    id: opt.id,
    label: opt.label,
    count: optionCounts?.[opt.id] ?? 0,
  }));
}

function isSceneAllowed(type: QuestionType, scene: DisplayScene): boolean {
  return (type === 'TEXT' ? TEXT_SCENES : CHOICE_SCENES).includes(scene);
}

function normalizeScene(type: QuestionType, scene?: string | null): DisplayScene {
  const fallback: DisplayScene = type === 'TEXT' ? 'text-wall' : 'default';
  if (!scene) return fallback;
  const sanitized = scene === 'map-church' ? 'text-wall' : scene;
  if ((DISPLAY_SCENE_VALUES as readonly string[]).includes(sanitized)) {
    const casted = sanitized as DisplayScene;
    return isSceneAllowed(type, casted) ? casted : fallback;
  }
  return fallback;
}

// GET /api/sessions/:id/questions — 取得所有題目（主持人用）
questionRouter.get('/:id/questions', requireHostToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const snapshot = await db
      .collection('sessions').doc(req.params.id)
      .collection('questions')
      .orderBy('order')
      .get();

    const questions = snapshot.docs.map((doc) => {
      const data = doc.data();
      const displayScene = normalizeScene(data.type, data.displayScene as string | undefined);
      return {
        questionId: doc.id,
        type: data.type,
        title: data.title,
        status: data.status,
        order: data.order,
        options: mergeOptions(data.options || [], data.optionCounts || {}),
        totalResponses: data.totalResponses,
        displayScene,
        displayMode: (data.displayMode as 'question' | 'results' | undefined) ?? 'question',
        wordCloudRefreshIntervalSec: (data.wordCloudRefreshIntervalSec as number | undefined) ?? 3,
        wordCloudRefreshPaused: (data.wordCloudRefreshPaused as boolean | undefined) ?? false,
        wordCloudRefreshNonce: (data.wordCloudRefreshNonce as number | undefined) ?? 0,
        spotlightSloganText: (data.spotlightSloganText as string | undefined) ?? 'We Are One',
        spotlightSloganVisible: (data.spotlightSloganVisible as boolean | undefined) ?? false,
      };
    });

    res.json({ questions });
  } catch (err) {
    console.error('[questions] list error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/sessions/:id/questions/current — 取得目前 OPEN 的題目（觀眾用）
// 必須定義在 /:id/questions/:qid 之前，避免 'current' 被視為 qid
questionRouter.get('/:id/questions/current', async (req: Request, res: Response): Promise<void> => {
  try {
    const snapshot = await db
      .collection('sessions').doc(req.params.id)
      .collection('questions')
      .where('status', '==', 'OPEN')
      .limit(1)
      .get();

    if (snapshot.empty) {
      res.status(404).json({ error: 'No open question found' });
      return;
    }

    const doc = snapshot.docs[0];
    const data = doc.data();
    const displayScene = normalizeScene(data.type, data.displayScene as string | undefined);

    res.json({
      questionId: doc.id,
      type: data.type,
      title: data.title,
      status: data.status,
      order: data.order,
      options: mergeOptions(data.options || [], data.optionCounts || {}),
      totalResponses: data.totalResponses,
      displayScene,
      displayMode: (data.displayMode as 'question' | 'results' | undefined) ?? 'question',
      wordCloudRefreshIntervalSec: (data.wordCloudRefreshIntervalSec as number | undefined) ?? 3,
      wordCloudRefreshPaused: (data.wordCloudRefreshPaused as boolean | undefined) ?? false,
      wordCloudRefreshNonce: (data.wordCloudRefreshNonce as number | undefined) ?? 0,
      spotlightSloganText: (data.spotlightSloganText as string | undefined) ?? 'We Are One',
      spotlightSloganVisible: (data.spotlightSloganVisible as boolean | undefined) ?? false,
    });
  } catch (err) {
    console.error('[questions] current error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/sessions/:id/questions/:qid/results — 主持人取得統計結果
questionRouter.get('/:id/questions/:qid/results', requireHostToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const doc = await db
      .collection('sessions').doc(req.params.id)
      .collection('questions').doc(req.params.qid)
      .get();

    if (!doc.exists) {
      res.status(404).json({ error: 'Question not found' });
      return;
    }

    const data = doc.data()!;
    const displayScene = normalizeScene(data.type, data.displayScene as string | undefined);
    res.json({
      questionId: doc.id,
      type: data.type,
      title: data.title,
      status: data.status,
      options: mergeOptions(data.options || [], data.optionCounts || {}),
      totalResponses: data.totalResponses,
      displayScene,
      displayMode: (data.displayMode as 'question' | 'results' | undefined) ?? 'question',
      wordCloudRefreshIntervalSec: (data.wordCloudRefreshIntervalSec as number | undefined) ?? 3,
      wordCloudRefreshPaused: (data.wordCloudRefreshPaused as boolean | undefined) ?? false,
      wordCloudRefreshNonce: (data.wordCloudRefreshNonce as number | undefined) ?? 0,
      spotlightSloganText: (data.spotlightSloganText as string | undefined) ?? 'We Are One',
      spotlightSloganVisible: (data.spotlightSloganVisible as boolean | undefined) ?? false,
    });
  } catch (err) {
    console.error('[questions] results error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/sessions/:id/questions — 主持人建立新題目
questionRouter.post('/:id/questions', requireHostToken, async (req: Request, res: Response): Promise<void> => {
  const parsed = createQuestionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { type, title, options: rawOptions, displayScene: requestedScene } = parsed.data;

  if (type !== 'TEXT' && (!rawOptions || rawOptions.length < 2)) {
    res.status(400).json({ error: 'Choice questions require at least 2 options' });
    return;
  }

  const desiredScene: DisplayScene = requestedScene ?? (type === 'TEXT' ? 'text-wall' : 'default');
  if (!isSceneAllowed(type, desiredScene)) {
    res.status(400).json({ error: 'Selected display scene is not compatible with this question type' });
    return;
  }

  try {
    const questionsRef = db
      .collection('sessions').doc(req.params.id)
      .collection('questions');

    const existingSnap = await questionsRef.get();
    const order = existingSnap.size;
    const questionId = uuidv4();

    const options: QuestionOption[] = type !== 'TEXT'
      ? (rawOptions ?? []).map((label, idx) => ({
          id: `opt_${idx}_${uuidv4().slice(0, 8)}`,
          label,
        }))
      : [];

    const optionCounts: Record<string, number> = {};
    options.forEach((opt) => { optionCounts[opt.id] = 0; });

    await questionsRef.doc(questionId).set({
      type,
      title,
      status: 'CLOSED',
      order,
      options,
      optionCounts,
      totalResponses: 0,
      createdAt: FieldValue.serverTimestamp(),
      displayScene: desiredScene,
      wordCloudRefreshIntervalSec: 3,
      wordCloudRefreshPaused: false,
      wordCloudRefreshNonce: 0,
      spotlightSloganText: 'We Are One',
      spotlightSloganVisible: false,
    });

    res.status(201).json({
      questionId,
      type,
      title,
      status: 'CLOSED',
      order,
      options: options.map((opt) => ({ ...opt, count: 0 })),
      totalResponses: 0,
      displayScene: desiredScene,
      wordCloudRefreshIntervalSec: 3,
      wordCloudRefreshPaused: false,
      wordCloudRefreshNonce: 0,
      spotlightSloganText: 'We Are One',
      spotlightSloganVisible: false,
    });
  } catch (err) {
    console.error('[questions] create error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const updateQuestionBodySchema = z.object({
  title: z.string().min(1).max(500).optional(),
  displayScene: z.enum(DISPLAY_SCENE_VALUES).optional(),
  optionLabels: z.record(z.string().min(1).max(200)).optional(),
  optionCounts: z.record(z.number().int().min(0)).optional(),
  wordCloudRefreshIntervalSec: z.number().int().min(1).max(60).optional(),
  wordCloudRefreshPaused: z.boolean().optional(),
  wordCloudRefreshNonce: z.number().int().min(0).optional(),
  spotlightSloganText: z.string().trim().min(1).max(80).optional(),
  spotlightSloganVisible: z.boolean().optional(),
});

// PUT /api/sessions/:id/questions/:qid — 主持人編輯已關閉題目的內容
questionRouter.put('/:id/questions/:qid', requireHostToken, async (req: Request, res: Response): Promise<void> => {
  const parsed = updateQuestionBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const questionRef = db
      .collection('sessions').doc(req.params.id)
      .collection('questions').doc(req.params.qid);

    const docSnap = await questionRef.get();
    if (!docSnap.exists) {
      res.status(404).json({ error: 'Question not found' });
      return;
    }

    const data = docSnap.data()!;
    const {
      title,
      displayScene,
      optionLabels,
      optionCounts,
      wordCloudRefreshIntervalSec,
      wordCloudRefreshPaused,
      wordCloudRefreshNonce,
      spotlightSloganText,
      spotlightSloganVisible,
    } = parsed.data;
    const hasContentUpdates = title !== undefined
      || displayScene !== undefined
      || optionLabels !== undefined
      || optionCounts !== undefined;
    const hasWordCloudUpdates = wordCloudRefreshIntervalSec !== undefined
      || wordCloudRefreshPaused !== undefined
      || wordCloudRefreshNonce !== undefined;
    const hasSpotlightSloganUpdates = spotlightSloganText !== undefined
      || spotlightSloganVisible !== undefined;

    if (data.status === 'OPEN' && hasContentUpdates) {
      res.status(409).json({ error: 'Cannot edit a question while it is OPEN' });
      return;
    }

    const updates: Record<string, unknown> = {};

    if (title !== undefined) updates.title = title;

    if (displayScene !== undefined) {
      if (!isSceneAllowed(data.type as QuestionType, displayScene)) {
        res.status(400).json({ error: 'Display scene not compatible with question type' });
        return;
      }
      updates.displayScene = displayScene;
    }

    if (optionLabels && data.type !== 'TEXT') {
      updates.options = (data.options as QuestionOption[]).map((opt) => ({
        id: opt.id,
        label: optionLabels[opt.id] ?? opt.label,
      }));
    }

    if (optionCounts && data.type !== 'TEXT') {
      const merged: Record<string, number> = { ...(data.optionCounts as Record<string, number> ?? {}) };
      Object.entries(optionCounts).forEach(([id, count]) => { merged[id] = count; });
      updates.optionCounts = merged;
      updates.totalResponses = Object.values(merged).reduce((s, c) => s + c, 0);
    }

    if (hasWordCloudUpdates) {
      if (data.type !== 'TEXT' || normalizeScene(data.type as QuestionType, data.displayScene as string | undefined) !== 'word-cloud') {
        res.status(400).json({ error: 'Word Cloud refresh controls are only available for Word Cloud text questions' });
        return;
      }
      if (wordCloudRefreshIntervalSec !== undefined) {
        updates.wordCloudRefreshIntervalSec = wordCloudRefreshIntervalSec;
      }
      if (wordCloudRefreshPaused !== undefined) {
        updates.wordCloudRefreshPaused = wordCloudRefreshPaused;
      }
      if (wordCloudRefreshNonce !== undefined) {
        updates.wordCloudRefreshNonce = wordCloudRefreshNonce;
      }
    }

    if (hasSpotlightSloganUpdates) {
      if (data.type !== 'TEXT' || normalizeScene(data.type as QuestionType, data.displayScene as string | undefined) !== 'spotlight') {
        res.status(400).json({ error: 'Spotlight slogan controls are only available for Spotlight text questions' });
        return;
      }
      if (spotlightSloganText !== undefined) {
        updates.spotlightSloganText = spotlightSloganText;
      }
      if (spotlightSloganVisible !== undefined) {
        updates.spotlightSloganVisible = spotlightSloganVisible;
      }
    }

    await questionRef.update(updates);
    res.json({ questionId: req.params.qid, updated: true });
  } catch (err) {
    console.error('[questions] update error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/sessions/:id/questions/:qid — 主持人刪除題目與其作答資料
questionRouter.delete('/:id/questions/:qid', requireHostToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const questionRef = db
      .collection('sessions').doc(req.params.id)
      .collection('questions').doc(req.params.qid);

    const docSnap = await questionRef.get();
    if (!docSnap.exists) {
      res.status(404).json({ error: 'Question not found' });
      return;
    }

    const answersSnap = await questionRef.collection('answers').get();
    let batch = db.batch();
    let pendingWrites = 0;

    for (const answerDoc of answersSnap.docs) {
      batch.delete(answerDoc.ref);
      pendingWrites += 1;
      if (pendingWrites >= 450) {
        await batch.commit();
        batch = db.batch();
        pendingWrites = 0;
      }
    }

    batch.delete(questionRef);
    await batch.commit();
    res.json({ success: true, questionId: req.params.qid, deletedAnswers: answersSnap.size });
  } catch (err) {
    console.error('[questions] delete error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/sessions/:id/questions/:qid/reset-answers — 清空單題作答資料
questionRouter.post('/:id/questions/:qid/reset-answers', requireHostToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const questionRef = db
      .collection('sessions').doc(req.params.id)
      .collection('questions').doc(req.params.qid);

    const docSnap = await questionRef.get();
    if (!docSnap.exists) {
      res.status(404).json({ error: 'Question not found' });
      return;
    }

    const data = docSnap.data()!;
    const options = (data.options as QuestionOption[] | undefined) ?? [];
    await resetQuestionAnswers(questionRef, options);

    res.json({ success: true });
  } catch (err) {
    console.error('[questions] reset answers error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/sessions/:id/questions/:qid — 主持人修改題目狀態
questionRouter.patch('/:id/questions/:qid', requireHostToken, async (req: Request, res: Response): Promise<void> => {
  const parsed = patchQuestionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { status } = parsed.data;

  try {
    const sessionRef = db.collection('sessions').doc(req.params.id);
    const questionRef = sessionRef.collection('questions').doc(req.params.qid);

    const questionDoc = await questionRef.get();
    if (!questionDoc.exists) {
      res.status(404).json({ error: 'Question not found' });
      return;
    }
    const data = questionDoc.data()!;

    if (status === 'OPEN') {
      // 先關閉其他已開啟的題目，確保同時只有一題是 OPEN
      const openSnap = await sessionRef
        .collection('questions')
        .where('status', '==', 'OPEN')
        .get();

      const batch = db.batch();
      openSnap.docs.forEach((doc) => {
        if (doc.id !== req.params.qid) {
          batch.update(doc.ref, { status: 'CLOSED' });
        }
      });
      const updates: Record<string, unknown> = { status, displayMode: 'question' };
      if (normalizeScene(data.type as QuestionType, data.displayScene as string | undefined) === 'word-cloud') {
        updates.wordCloudRefreshPaused = false;
      }
      batch.update(questionRef, updates);
      batch.set(sessionRef.collection('_ctrl').doc('display'), { displayMode: 'question' }, { merge: true });
      batch.update(sessionRef, { displayMode: 'question' });
      await batch.commit();
    } else {
      await questionRef.update({ status });
    }

    res.json({ questionId: req.params.qid, status });
  } catch (err) {
    console.error('[questions] patch error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
