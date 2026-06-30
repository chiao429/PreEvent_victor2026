import type { QuestionType } from '../types';

type SimulationCommand = {
  type: 'seed_answers' | 'load_test_answers';
  questionId: string;
  questionType: QuestionType;
  textAnswers?: string[];
  optionCounts?: Record<string, number>;
  options?: { id: string; label: string }[];
};

function buildSimulationWsUrl(sessionId: string, role: 'host' | 'display', hostToken?: string) {
  const apiBase = import.meta.env.VITE_API_URL as string | undefined;
  const base = apiBase ? new URL(apiBase) : new URL(window.location.origin);
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  base.pathname = `/api/ws/sessions/${encodeURIComponent(sessionId)}/simulation`;
  base.search = '';
  base.searchParams.set('role', role);
  if (hostToken) {
    base.searchParams.set('token', hostToken);
  }
  return base.toString();
}

export function getDisplaySimulationWsUrl(sessionId: string) {
  return buildSimulationWsUrl(sessionId, 'display');
}

export function sendSimulationCommand(
  sessionId: string,
  hostToken: string,
  command: SimulationCommand,
): Promise<{ inserted: number }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(buildSimulationWsUrl(sessionId, 'host', hostToken));
    const timeout = window.setTimeout(() => {
      socket.close();
      reject(new Error('WebSocket timeout'));
    }, 10000);

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify(command));
    });

    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data as string) as {
        type: 'ack' | 'error';
        inserted?: number;
        error?: string;
      };
      if (message.type === 'error') {
        window.clearTimeout(timeout);
        socket.close();
        reject(new Error(message.error ?? 'WebSocket command failed'));
        return;
      }
      if (message.type === 'ack') {
        window.clearTimeout(timeout);
        socket.close();
        resolve({ inserted: message.inserted ?? 0 });
      }
    });

    socket.addEventListener('error', () => {
      window.clearTimeout(timeout);
      reject(new Error('WebSocket connection failed'));
    });
  });
}
