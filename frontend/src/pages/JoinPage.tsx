import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { getCurrentQuestion, submitAnswer, getSession } from '../api/client';
import { AnswerForm } from '../components/AnswerForm';
import type { Question, Session } from '../types';

function getRespondentId(): string {
  const key = 'respondentId';
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

export function JoinPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const respondentId = getRespondentId();

  const [session, setSession] = useState<Session | null>(null);
  const [question, setQuestion] = useState<Question | null>(null);
  const [answeredQuestionId, setAnsweredQuestionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch session info once
  useEffect(() => {
    if (!sessionId) return;
    getSession(sessionId).then(setSession).catch(console.error);
  }, [sessionId]);

  const fetchCurrentQuestion = useCallback(async () => {
    if (!sessionId) return;
    try {
      const q = await getCurrentQuestion(sessionId);
      setQuestion(q);
    } catch {
      setQuestion(null);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  // Poll for current question every 2 seconds
  useEffect(() => {
    fetchCurrentQuestion();
    const interval = setInterval(fetchCurrentQuestion, 2000);
    return () => clearInterval(interval);
  }, [fetchCurrentQuestion]);

  // Reset answered state when question changes
  useEffect(() => {
    if (question && question.questionId !== answeredQuestionId) {
      // New question came up; keep answered state if same question
    }
  }, [question, answeredQuestionId]);

  const hasAnswered = answeredQuestionId === question?.questionId;

  async function handleSubmit(answer: {
    optionId?: string;
    optionIds?: string[];
    textValue?: string;
  }) {
    if (!sessionId || !question) return;
    await submitAnswer(sessionId, question.questionId, {
      respondentId,
      ...answer,
    });
    setAnsweredQuestionId(question.questionId);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-indigo-600 text-white px-4 py-4 text-center">
        <p className="text-xs text-indigo-200 mb-0.5">
          {session?.name ?? '活動投票'}
        </p>
        <h1 className="text-lg font-bold">即時問答</h1>
      </header>

      <main className="max-w-md mx-auto px-4 py-6">
        {loading && (
          <div className="text-center py-16 text-gray-400">
            <p className="text-4xl mb-3">⏳</p>
            <p>連線中...</p>
          </div>
        )}

        {!loading && !question && (
          <div className="text-center py-16 text-gray-400">
            <p className="text-5xl mb-4">🎙️</p>
            <p className="text-lg font-medium text-gray-600">等待主持人開題中</p>
            <p className="text-sm mt-2">請稍候，題目出現時將自動顯示</p>
          </div>
        )}

        {!loading && question && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-xs text-green-600 font-medium">作答開放中</span>
                <span className="text-xs text-gray-400 ml-auto">
                  {question.type === 'SINGLE_CHOICE' ? '單選' : question.type === 'MULTI_CHOICE' ? '多選' : '文字'}
                </span>
              </div>
              <h2 className="text-lg font-semibold text-gray-900">{question.title}</h2>
            </div>

            {hasAnswered ? (
              <div className="bg-green-50 border border-green-200 rounded-2xl p-6 text-center">
                <p className="text-3xl mb-2">✅</p>
                <p className="text-green-700 font-semibold">答案已送出！</p>
                <p className="text-green-600 text-sm mt-1">感謝您的參與</p>
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
                <AnswerForm question={question} onSubmit={handleSubmit} />
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
