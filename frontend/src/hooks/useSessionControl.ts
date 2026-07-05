import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebaseClient';

export type DisplayMode = 'question' | 'results';

export function useSessionControl(sessionId: string): {
  displayMode: DisplayMode;
  resultsQrEnabled: boolean;
  resultsQrRefreshEnabled: boolean;
  resultsQrRefreshIntervalSec: number;
} {
  const [displayMode, setDisplayMode] = useState<DisplayMode>('results');
  const [resultsQrEnabled, setResultsQrEnabled] = useState(true);
  const [resultsQrRefreshEnabled, setResultsQrRefreshEnabled] = useState(true);
  const [resultsQrRefreshIntervalSec, setResultsQrRefreshIntervalSec] = useState(5);

  useEffect(() => {
    if (!sessionId) return;

    const unsubscribe = onSnapshot(
      doc(db, 'sessions', sessionId, '_ctrl', 'display'),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setDisplayMode(((data?.displayMode as DisplayMode) ?? 'results'));
          setResultsQrEnabled((data?.resultsQrEnabled as boolean | undefined) ?? true);
          setResultsQrRefreshEnabled((data?.resultsQrRefreshEnabled as boolean | undefined) ?? true);
          setResultsQrRefreshIntervalSec((data?.resultsQrRefreshIntervalSec as number | undefined) ?? 5);
        }
      },
      (err) => {
        console.error('[useSessionControl] Firestore error:', err);
      },
    );

    return () => unsubscribe();
  }, [sessionId]);

  return {
    displayMode,
    resultsQrEnabled,
    resultsQrRefreshEnabled,
    resultsQrRefreshIntervalSec,
  };
}
