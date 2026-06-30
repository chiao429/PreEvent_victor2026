import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebaseClient';

export type DisplayMode = 'question' | 'results';

export function useSessionControl(sessionId: string): { displayMode: DisplayMode } {
  const [displayMode, setDisplayMode] = useState<DisplayMode>('results');

  useEffect(() => {
    if (!sessionId) return;

    const unsubscribe = onSnapshot(
      doc(db, 'sessions', sessionId, '_ctrl', 'display'),
      (snap) => {
        if (snap.exists()) {
          setDisplayMode(((snap.data()?.displayMode as DisplayMode) ?? 'results'));
        }
      },
      (err) => {
        console.error('[useSessionControl] Firestore error:', err);
      },
    );

    return () => unsubscribe();
  }, [sessionId]);

  return { displayMode };
}
