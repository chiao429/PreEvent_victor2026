import { useEffect, useState } from 'react';
import { getDisplaySimulationWsUrl } from '../api/simulationWs';

export type SimulationOverlay = {
  questionId: string;
  optionCounts: Record<string, number>;
  recentTexts: string[];
  totalResponses: number;
};

export function useSimulationOverlay(sessionId: string): Record<string, SimulationOverlay> {
  const [overlays, setOverlays] = useState<Record<string, SimulationOverlay>>({});

  useEffect(() => {
    if (!sessionId) return undefined;

    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let closed = false;

    const connect = () => {
      socket = new WebSocket(getDisplaySimulationWsUrl(sessionId));

      socket.addEventListener('message', (event) => {
        try {
          const message = JSON.parse(event.data as string) as { type?: string } & SimulationOverlay;
          if (message.type !== 'simulation_overlay' || !message.questionId) return;
          setOverlays((current) => ({
            ...current,
            [message.questionId]: {
              questionId: message.questionId,
              optionCounts: message.optionCounts ?? {},
              recentTexts: message.recentTexts ?? [],
              totalResponses: message.totalResponses ?? 0,
            },
          }));
        } catch (err) {
          console.warn('[useSimulationOverlay] invalid websocket message', err);
        }
      });

      socket.addEventListener('close', () => {
        if (closed) return;
        reconnectTimer = window.setTimeout(connect, 1500);
      });

      socket.addEventListener('error', () => {
        socket?.close();
      });
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      socket?.close();
    };
  }, [sessionId]);

  return overlays;
}
