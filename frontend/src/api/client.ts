import type { Question, Session } from '../types';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return data as T;
}

// ── Sessions ────────────────────────────────────────────────────────────────

export function createSession(name: string): Promise<{ sessionId: string; hostToken: string }> {
  return request('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export function getSession(sessionId: string): Promise<Session> {
  return request(`/api/sessions/${sessionId}`);
}

export function updateSessionName(
  sessionId: string,
  hostToken: string,
  name: string,
): Promise<{ sessionId: string; name: string }> {
  return request(`/api/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hostToken}`,
    },
    body: JSON.stringify({ name }),
  });
}

export function resetSessionAnswers(
  sessionId: string,
  hostToken: string,
): Promise<{ success: boolean; clearedQuestions: number }> {
  return request(`/api/sessions/${sessionId}/reset-answers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hostToken}`,
    },
  });
}

// ── Questions ────────────────────────────────────────────────────────────────

export function listQuestions(
  sessionId: string,
  hostToken: string,
): Promise<{ questions: Question[] }> {
  return request(`/api/sessions/${sessionId}/questions`, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hostToken}`,
    },
  });
}

export function createQuestion(
  sessionId: string,
  hostToken: string,
  payload: { type: string; title: string; options?: string[]; displayScene?: string },
): Promise<Question> {
  return request(`/api/sessions/${sessionId}/questions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hostToken}`,
    },
    body: JSON.stringify(payload),
  });
}

export function updateQuestion(
  sessionId: string,
  hostToken: string,
  questionId: string,
  payload: {
    title?: string;
    displayScene?: string;
    optionLabels?: Record<string, string>;
    optionCounts?: Record<string, number>;
    wordCloudRefreshIntervalSec?: number;
    wordCloudRefreshPaused?: boolean;
    wordCloudRefreshNonce?: number;
    spotlightSloganText?: string;
    spotlightSloganVisible?: boolean;
  },
): Promise<{ questionId: string; updated: boolean }> {
  return request(`/api/sessions/${sessionId}/questions/${questionId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hostToken}`,
    },
    body: JSON.stringify(payload),
  });
}

export function updateQuestionStatus(
  sessionId: string,
  hostToken: string,
  questionId: string,
  status: string,
): Promise<{ questionId: string; status: string }> {
  return request(`/api/sessions/${sessionId}/questions/${questionId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hostToken}`,
    },
    body: JSON.stringify({ status }),
  });
}

export function deleteQuestion(
  sessionId: string,
  hostToken: string,
  questionId: string,
): Promise<{ success: boolean; questionId: string }> {
  return request(`/api/sessions/${sessionId}/questions/${questionId}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hostToken}`,
    },
  });
}

export function clearQuestionAnswers(
  sessionId: string,
  questionId: string,
  hostToken: string,
): Promise<{ success: boolean }> {
  return request(`/api/sessions/${sessionId}/questions/${questionId}/reset-answers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hostToken}`,
    },
  });
}

export function setDisplayMode(
  sessionId: string,
  hostToken: string,
  displayMode: 'question' | 'results',
): Promise<{ sessionId: string; displayMode: string }> {
  return request(`/api/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hostToken}`,
    },
    body: JSON.stringify({ displayMode }),
  });
}

export function getCurrentQuestion(sessionId: string): Promise<Question> {
  return request(`/api/sessions/${sessionId}/questions/current`);
}

// ── Answers ──────────────────────────────────────────────────────────────────

interface AnswerPayload {
  respondentId: string;
  optionId?: string;
  optionIds?: string[];
  textValue?: string;
}

export function submitAnswer(
  sessionId: string,
  questionId: string,
  payload: AnswerPayload,
): Promise<{ success: boolean }> {
  return request(`/api/sessions/${sessionId}/questions/${questionId}/answers`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function seedAnswers(
  sessionId: string,
  questionId: string,
  hostToken: string,
  payload: { textAnswers?: string[]; optionCounts?: Record<string, number> },
): Promise<{ success: boolean; inserted: number }> {
  return request(`/api/sessions/${sessionId}/questions/${questionId}/seed`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hostToken}`,
    },
    body: JSON.stringify(payload),
  });
}

export function runQuestionLoadTest(
  sessionId: string,
  questionId: string,
  hostToken: string,
): Promise<{ success: boolean; inserted: number }> {
  return request(`/api/sessions/${sessionId}/questions/${questionId}/load-test`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hostToken}`,
    },
  });
}
