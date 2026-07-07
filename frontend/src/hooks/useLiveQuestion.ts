import { useState, useEffect, useRef } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../firebaseClient';
import type { LiveQuestion, QuestionOption } from '../types';

interface UseLiveQuestionResult {
  question: LiveQuestion | null;
  loading: boolean;
  error: Error | null;
  connected: boolean;
}

export function useLiveQuestion(sessionId: string): UseLiveQuestionResult {
  const [question, setQuestion] = useState<LiveQuestion | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [connected, setConnected] = useState(false);
  const pendingQuestionRef = useRef<LiveQuestion | null>(null);
  const flushTimerRef = useRef<number | null>(null);

  function scheduleQuestionUpdate(nextQuestion: LiveQuestion | null) {
    pendingQuestionRef.current = nextQuestion;
    if (flushTimerRef.current !== null) return;

    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null;
      setQuestion(pendingQuestionRef.current);
    }, 120);
  }

  useEffect(() => {
    if (!sessionId) return;

    const q = query(
      collection(db, 'sessions', sessionId, 'questions'),
      where('status', '==', 'OPEN'),
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setConnected(true);
        setLoading(false);
        setError(null);

        if (snapshot.empty) {
          scheduleQuestionUpdate(null);
          return;
        }

        const doc = snapshot.docs[0];
        const data = doc.data();
        const rawOptions = (data['options'] as { id: string; label: string }[]) ?? [];
        const optionCounts = (data['optionCounts'] as Record<string, number>) ?? {};

        const options: QuestionOption[] = rawOptions.map((opt) => ({
          id: opt.id,
          label: opt.label,
          count: optionCounts[opt.id] ?? 0,
        }));

        const rawScene = (data['displayScene'] as string | undefined) ?? undefined;
        const sanitizedScene = rawScene === 'map-church'
          ? 'text-wall'
          : (rawScene as LiveQuestion['displayScene']);

        scheduleQuestionUpdate({
          id: doc.id,
          type: data['type'] as LiveQuestion['type'],
          title: data['title'] as string,
          status: data['status'] as LiveQuestion['status'],
          options,
          totalResponses: (data['totalResponses'] as number) ?? 0,
          recentTexts: (data['recentTexts'] as string[]) ?? [],
          displayScene: sanitizedScene,
          displayMode: ((data['displayMode'] as 'question' | 'results') ?? 'question'),
          wordCloudRefreshIntervalSec: (data['wordCloudRefreshIntervalSec'] as number | undefined) ?? 3,
          wordCloudRefreshPaused: (data['wordCloudRefreshPaused'] as boolean | undefined) ?? false,
          wordCloudRefreshNonce: (data['wordCloudRefreshNonce'] as number | undefined) ?? 0,
          spotlightSloganText: (data['spotlightSloganText'] as string | undefined) ?? 'We Are One',
          spotlightSloganVisible: (data['spotlightSloganVisible'] as boolean | undefined) ?? false,
        });
      },
      (err) => {
        console.error('[useLiveQuestion] Firestore subscription error:', err);
        setError(err);
        setConnected(false);
        setLoading(false);
      },
    );

    return () => {
      unsubscribe();
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      setConnected(false);
    };
  }, [sessionId]);

  return { question, loading, error, connected };
}
