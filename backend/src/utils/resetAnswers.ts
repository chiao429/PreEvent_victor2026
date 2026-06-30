import type { DocumentReference } from 'firebase-admin/firestore';
import { db } from '../lib/firebaseAdmin';
import type { QuestionOption } from '../types';

const BATCH_LIMIT = 500;

async function deleteAnswersSubcollection(questionRef: DocumentReference): Promise<void> {
  while (true) {
    const snapshot = await questionRef.collection('answers').limit(BATCH_LIMIT).get();
    if (snapshot.empty) break;
    const batch = db.batch();
    snapshot.docs.forEach((answerDoc) => {
      batch.delete(answerDoc.ref);
    });
    await batch.commit();
  }
}

function buildZeroCounts(options: QuestionOption[] | undefined): Record<string, number> {
  const counts: Record<string, number> = {};
  (options ?? []).forEach((opt) => {
    counts[opt.id] = 0;
  });
  return counts;
}

export async function resetQuestionAnswers(
  questionRef: DocumentReference,
  options: QuestionOption[] | undefined,
): Promise<void> {
  await deleteAnswersSubcollection(questionRef);
  await questionRef.update({
    totalResponses: 0,
    recentTexts: [],
    optionCounts: buildZeroCounts(options),
  });
}
