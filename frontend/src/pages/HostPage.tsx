import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { listQuestions, createQuestion, updateQuestion, updateQuestionStatus, getSession, seedAnswers, deleteQuestion, clearQuestionAnswers, resetSessionAnswers, updateSessionName, setDisplayMode, setProjectionResultsQrEnabled, setProjectionResultsQrRefreshSettings, runQuestionLoadTest } from '../api/client';
import { QuestionEditor } from '../components/QuestionEditor';
import { ResultChart } from '../components/ResultChart';
import { updateStoredSessionName } from './HomePage';
import type { DisplayScene, Question, QuestionType, Session } from '../types';

const TYPE_LABEL: Record<QuestionType, string> = {
  SINGLE_CHOICE: '單選',
  MULTI_CHOICE: '多選',
  TEXT: '文字',
};

const SCENE_LABEL: Record<string, string> = {
  default: '標準長條圖',
  map3d: 'map3d',
  'text-wall': '文字牆',
  spotlight: '聚光燈文字',
  'word-cloud': '魔幻星空 Word Cloud',
  'map3d-hud': '3D 地圖 HUD',
};

const TYPE_BADGE_CLASS: Record<QuestionType, string> = {
  SINGLE_CHOICE: 'bg-[#2563EB] text-white',
  MULTI_CHOICE: 'bg-[#7C3AED] text-white',
  TEXT: 'bg-[#0F766E] text-white',
};

const SCENE_BADGE_CLASS: Record<string, string> = {
  default: 'border-[#2563EB] bg-blue-50 text-[#1D4ED8]',
  map3d: 'border-[#16A34A] bg-green-50 text-[#15803D]',
  'map3d-hud': 'border-[#0891B2] bg-cyan-50 text-[#0E7490]',
  'text-wall': 'border-[#EA580C] bg-orange-50 text-[#C2410C]',
  spotlight: 'border-[#F59E0B] bg-amber-50 text-[#B45309]',
  'word-cloud': 'border-[#9333EA] bg-purple-50 text-[#7E22CE]',
};

const MAX_TEXT_SEED_COUNT = 500;
const TEXT_SEED_BATCH_SIZE = 50;

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffleArray<T>(items: T[]): T[] {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function HostPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();

  const hostToken = sessionId ? localStorage.getItem(`hostToken_${sessionId}`) : null;

  const [session, setSession] = useState<Session | null>(null);
  const [editingSessionName, setEditingSessionName] = useState(false);
  const [sessionNameDraft, setSessionNameDraft] = useState('');
  const [savingSessionName, setSavingSessionName] = useState(false);
  const [sessionNameError, setSessionNameError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [showEditor, setShowEditor] = useState(false);
  const [seedTarget, setSeedTarget] = useState<Question | null>(null);
  const [seedTextCount, setSeedTextCount] = useState(50);
  const [seedCounts, setSeedCounts] = useState<Record<string, number>>({});
  const [seedLoading, setSeedLoading] = useState(false);
  const [seedError, setSeedError] = useState<string | null>(null);
  const [seedProgress, setSeedProgress] = useState({ done: 0, total: 0 });
  const [editTarget, setEditTarget] = useState<Question | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editScene, setEditScene] = useState<DisplayScene>('default');
  const [editOptionLabels, setEditOptionLabels] = useState<Record<string, string>>({});
  const [editOptionCounts, setEditOptionCounts] = useState<Record<string, number>>({});
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clearingQuestionId, setClearingQuestionId] = useState<string | null>(null);
  const [deletingQuestionId, setDeletingQuestionId] = useState<string | null>(null);
  const [resettingSession, setResettingSession] = useState(false);
  const [displayModeUpdating, setDisplayModeUpdating] = useState(false);
  const [resultsQrUpdating, setResultsQrUpdating] = useState(false);
  const [resultsQrRefreshUpdating, setResultsQrRefreshUpdating] = useState(false);
  const [resultsQrRefreshIntervalDraft, setResultsQrRefreshIntervalDraft] = useState('5');
  const [loadTestingQuestionId, setLoadTestingQuestionId] = useState<string | null>(null);
  const [statusUpdatingQuestionId, setStatusUpdatingQuestionId] = useState<string | null>(null);
  const [isHostMenuOpen, setIsHostMenuOpen] = useState(false);
  const [openQuestionMenuId, setOpenQuestionMenuId] = useState<string | null>(null);
  const [wordCloudIntervalDrafts, setWordCloudIntervalDrafts] = useState<Record<string, string>>({});
  const [wordCloudUpdatingQuestionId, setWordCloudUpdatingQuestionId] = useState<string | null>(null);
  const [spotlightSloganDrafts, setSpotlightSloganDrafts] = useState<Record<string, string>>({});
  const [spotlightSloganUpdatingQuestionId, setSpotlightSloganUpdatingQuestionId] = useState<string | null>(null);

  useEffect(() => {
    if (!hostToken) {
      navigate('/');
    }
  }, [hostToken, navigate]);

  const fetchQuestions = useCallback(async () => {
    if (!sessionId || !hostToken) return;
    try {
      const [sessionData, questionsData] = await Promise.all([
        getSession(sessionId),
        listQuestions(sessionId, hostToken),
      ]);
      setSession(sessionData);
      updateStoredSessionName(sessionId, sessionData.name);
      setResultsQrRefreshIntervalDraft(String(sessionData.resultsQrRefreshIntervalSec ?? 5));
      setQuestions(questionsData.questions);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '載入失敗');
    } finally {
      setLoading(false);
    }
  }, [sessionId, hostToken]);

  useEffect(() => {
    fetchQuestions();
    const interval = setInterval(fetchQuestions, 3000);
    return () => clearInterval(interval);
  }, [fetchQuestions]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-host-menu], [data-question-menu]')) return;
      setIsHostMenuOpen(false);
      setOpenQuestionMenuId(null);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsHostMenuOpen(false);
        setOpenQuestionMenuId(null);
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  async function handleCreateQuestion(data: { type: QuestionType; title: string; options?: string[]; displayScene: DisplayScene }) {
    if (!sessionId || !hostToken) return;
    await createQuestion(sessionId, hostToken, data);
    setShowEditor(false);
    await fetchQuestions();
  }

  function startEditingSessionName() {
    setSessionNameDraft(session?.name ?? '');
    setSessionNameError(null);
    setEditingSessionName(true);
  }

  async function handleSessionNameSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!sessionId || !hostToken) return;

    const nextName = sessionNameDraft.trim();
    if (!nextName) {
      setSessionNameError('請輸入場次名稱');
      return;
    }

    setSavingSessionName(true);
    setSessionNameError(null);
    try {
      const updated = await updateSessionName(sessionId, hostToken, nextName);
      setSession((prev) => (prev ? { ...prev, name: updated.name } : prev));
      updateStoredSessionName(sessionId, updated.name);
      setEditingSessionName(false);
      await fetchQuestions();
    } catch (err) {
      setSessionNameError(err instanceof Error ? err.message : '更新場次名稱失敗');
    } finally {
      setSavingSessionName(false);
    }
  }

  function openEditModal(q: Question) {
    setEditTarget(q);
    setEditTitle(q.title);
    setEditScene((q.displayScene ?? 'default') as DisplayScene);
    const labels: Record<string, string> = {};
    const counts: Record<string, number> = {};
    q.options.forEach((opt) => {
      labels[opt.id] = opt.label;
      counts[opt.id] = opt.count;
    });
    setEditOptionLabels(labels);
    setEditOptionCounts(counts);
    setEditError(null);
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!sessionId || !hostToken || !editTarget) return;
    setEditLoading(true);
    setEditError(null);
    try {
      const payload: Parameters<typeof updateQuestion>[3] = { title: editTitle.trim(), displayScene: editScene };
      if (editTarget.type !== 'TEXT') {
        payload.optionLabels = editOptionLabels;
        payload.optionCounts = editOptionCounts;
      }
      await updateQuestion(sessionId, hostToken, editTarget.questionId, payload);
      setEditTarget(null);
      await fetchQuestions();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : '儲存失敗');
    } finally {
      setEditLoading(false);
    }
  }

  async function handleDeleteQuestion(question: Question) {
    if (!sessionId || !hostToken) return;
    const message = question.totalResponses > 0
      ? `確定要刪除「${question.title}」嗎？\n\n這會一併刪除 ${question.totalResponses} 筆作答資料，無法復原。`
      : `確定要刪除「${question.title}」嗎？`;
    if (!window.confirm(message)) return;
    setDeletingQuestionId(question.questionId);
    try {
      await deleteQuestion(sessionId, hostToken, question.questionId);
      await fetchQuestions();
    } catch (err) {
      alert(err instanceof Error ? err.message : '刪除失敗');
    } finally {
      setDeletingQuestionId(null);
    }
  }

  async function handleToggleStatus(question: Question) {
    if (!sessionId || !hostToken) return;
    const nextStatus = question.status === 'OPEN' ? 'CLOSED' : 'OPEN';
    setStatusUpdatingQuestionId(question.questionId);
    try {
      await updateQuestionStatus(sessionId, hostToken, question.questionId, nextStatus);
      await fetchQuestions();
    } catch (err) {
      alert(err instanceof Error ? err.message : '操作失敗');
    } finally {
      setStatusUpdatingQuestionId(null);
    }
  }

  async function handleSetProjectionDisplayMode(displayMode: 'question' | 'results') {
    if (!sessionId || !hostToken) return;
    setDisplayModeUpdating(true);
    try {
      await setDisplayMode(sessionId, hostToken, displayMode);
      await fetchQuestions();
    } catch (err) {
      alert(err instanceof Error ? err.message : '切換投影顯示失敗');
    } finally {
      setDisplayModeUpdating(false);
    }
  }

  async function handleSetProjectionResultsQrEnabled(resultsQrEnabled: boolean) {
    if (!sessionId || !hostToken) return;
    setResultsQrUpdating(true);
    try {
      await setProjectionResultsQrEnabled(sessionId, hostToken, resultsQrEnabled);
      await fetchQuestions();
    } catch (err) {
      alert(err instanceof Error ? err.message : '切換結果頁 QR 顯示失敗');
    } finally {
      setResultsQrUpdating(false);
    }
  }

  async function handleSetProjectionResultsQrRefreshEnabled(resultsQrRefreshEnabled: boolean) {
    if (!sessionId || !hostToken) return;
    setResultsQrRefreshUpdating(true);
    try {
      await setProjectionResultsQrRefreshSettings(sessionId, hostToken, { resultsQrRefreshEnabled });
      await fetchQuestions();
    } catch (err) {
      alert(err instanceof Error ? err.message : '切換刷新失敗');
    } finally {
      setResultsQrRefreshUpdating(false);
    }
  }

  async function handleSaveProjectionResultsQrRefreshInterval() {
    if (!sessionId || !hostToken) return;
    const rawValue = Number(resultsQrRefreshIntervalDraft);
    const nextInterval = Math.max(1, Math.min(60, Number.isFinite(rawValue) ? Math.round(rawValue) : 5));
    setResultsQrRefreshUpdating(true);
    try {
      await setProjectionResultsQrRefreshSettings(sessionId, hostToken, { resultsQrRefreshIntervalSec: nextInterval });
      setResultsQrRefreshIntervalDraft(String(nextInterval));
      await fetchQuestions();
    } catch (err) {
      alert(err instanceof Error ? err.message : '更新刷新秒數失敗');
    } finally {
      setResultsQrRefreshUpdating(false);
    }
  }

  async function handleQuestionLoadTest(question: Question) {
    if (!sessionId || !hostToken) return;
    if (!window.confirm(`確定要對「${question.title}」模擬 500 人同秒作答嗎？`)) return;
    setLoadTestingQuestionId(question.questionId);
    try {
      const result = await runQuestionLoadTest(sessionId, question.questionId, hostToken);
      alert(`已送入 ${result.inserted} 筆壓測作答`);
      await fetchQuestions();
    } catch (err) {
      alert(err instanceof Error ? err.message : '壓測失敗');
    } finally {
      setLoadTestingQuestionId(null);
    }
  }

  function getWordCloudIntervalValue(question: Question) {
    return wordCloudIntervalDrafts[question.questionId] ?? String(question.wordCloudRefreshIntervalSec ?? 3);
  }

  async function handleSaveWordCloudInterval(question: Question) {
    if (!sessionId || !hostToken) return;
    const rawValue = Number(getWordCloudIntervalValue(question));
    const nextInterval = Math.max(1, Math.min(60, Number.isFinite(rawValue) ? Math.round(rawValue) : 3));
    setWordCloudUpdatingQuestionId(question.questionId);
    try {
      await updateQuestion(sessionId, hostToken, question.questionId, {
        wordCloudRefreshIntervalSec: nextInterval,
      });
      setWordCloudIntervalDrafts((prev) => ({ ...prev, [question.questionId]: String(nextInterval) }));
      await fetchQuestions();
    } catch (err) {
      alert(err instanceof Error ? err.message : '更新 Word Cloud 秒數失敗');
    } finally {
      setWordCloudUpdatingQuestionId(null);
    }
  }

  async function handleRefreshWordCloudNow(question: Question) {
    if (!sessionId || !hostToken) return;
    setWordCloudUpdatingQuestionId(question.questionId);
    try {
      await updateQuestion(sessionId, hostToken, question.questionId, {
        wordCloudRefreshNonce: (question.wordCloudRefreshNonce ?? 0) + 1,
      });
      await fetchQuestions();
    } catch (err) {
      alert(err instanceof Error ? err.message : '立即重新整理失敗');
    } finally {
      setWordCloudUpdatingQuestionId(null);
    }
  }

  async function handleToggleWordCloudRefresh(question: Question) {
    if (!sessionId || !hostToken) return;
    setWordCloudUpdatingQuestionId(question.questionId);
    try {
      await updateQuestion(sessionId, hostToken, question.questionId, {
        wordCloudRefreshPaused: !(question.wordCloudRefreshPaused ?? false),
      });
      await fetchQuestions();
    } catch (err) {
      alert(err instanceof Error ? err.message : '切換自動重新整理失敗');
    } finally {
      setWordCloudUpdatingQuestionId(null);
    }
  }

  function getSpotlightSloganValue(question: Question) {
    return spotlightSloganDrafts[question.questionId] ?? question.spotlightSloganText ?? 'We Are One';
  }

  async function handleToggleSpotlightSlogan(question: Question) {
    if (!sessionId || !hostToken) return;
    const nextVisible = !(question.spotlightSloganVisible ?? false);
    const nextText = getSpotlightSloganValue(question).trim() || 'We Are One';
    setSpotlightSloganUpdatingQuestionId(question.questionId);
    try {
      await updateQuestion(sessionId, hostToken, question.questionId, {
        spotlightSloganText: nextText,
        spotlightSloganVisible: nextVisible,
      });
      setSpotlightSloganDrafts((prev) => ({ ...prev, [question.questionId]: nextText }));
      await fetchQuestions();
    } catch (err) {
      alert(err instanceof Error ? err.message : '切換標語失敗');
    } finally {
      setSpotlightSloganUpdatingQuestionId(null);
    }
  }

  async function handleResetQuestion(question: Question) {
    if (!sessionId || !hostToken) return;
    if (!window.confirm(`確定要清除「${question.title}」的全部作答資料嗎？`)) return;
    setClearingQuestionId(question.questionId);
    try {
      await clearQuestionAnswers(sessionId, question.questionId, hostToken);
      await fetchQuestions();
    } catch (err) {
      alert(err instanceof Error ? err.message : '清除失敗');
    } finally {
      setClearingQuestionId(null);
    }
  }

  async function handleResetSession() {
    if (!sessionId || !hostToken) return;
    if (!window.confirm('確定要清除整個活動內所有題目的作答資料嗎？')) return;
    setResettingSession(true);
    try {
      await resetSessionAnswers(sessionId, hostToken);
      await fetchQuestions();
    } catch (err) {
      alert(err instanceof Error ? err.message : '清除失敗，請稍後再試');
    } finally {
      setResettingSession(false);
    }
  }

  function buildSeedPayloads(): { payloads: { textAnswers?: string[]; optionCounts?: Record<string, number> }[]; error?: string } {
    if (!seedTarget) return { payloads: [] };
    if (seedTarget.type === 'TEXT') {
      const count = Math.round(Number(seedTextCount) || 0);
      if (count <= 0) {
        return { payloads: [], error: '請輸入至少 1 筆資料' };
      }
      if (count > MAX_TEXT_SEED_COUNT) {
        return { payloads: [], error: `一次最多 ${MAX_TEXT_SEED_COUNT} 筆文字測試資料` };
      }
      const textAnswers = Array.from({ length: count }, (_, index) => `資料${index + 1}`);
      const payloads: { textAnswers: string[] }[] = [];
      for (let index = 0; index < textAnswers.length; index += TEXT_SEED_BATCH_SIZE) {
        payloads.push({ textAnswers: textAnswers.slice(index, index + TEXT_SEED_BATCH_SIZE) });
      }
      return { payloads };
    }

    const payloads: { optionCounts: Record<string, number> }[] = [];
    Object.entries(seedCounts).forEach(([optionId, raw]) => {
      const count = Number(raw) || 0;
      for (let i = 0; i < Math.min(500, count); i += 1) {
        payloads.push({ optionCounts: { [optionId]: 1 } });
      }
    });

    if (payloads.length === 0) {
      return { payloads: [], error: '請輸入至少一個選項的測試筆數' };
    }
    if (payloads.length > 200) {
      return { payloads: [], error: '一次最多 200 筆模擬作答，請分批灌入' };
    }
    return { payloads: shuffleArray(payloads) };
  }

  function handleRandomSeed() {
    if (!seedTarget) return;
    const total = randomInt(20, 50);
    if (seedTarget.type === 'TEXT') {
      setSeedTextCount(total);
      return;
    }

    const optionCount = seedTarget.options.length;
    if (optionCount === 0) return;
    let remaining = total;
    const counts: Record<string, number> = {};
    seedTarget.options.forEach((opt, idx) => {
      if (idx === optionCount - 1) {
        counts[opt.id] = remaining;
        return;
      }
      const maxForThis = Math.max(0, remaining - (optionCount - idx - 1));
      const value = randomInt(0, maxForThis);
      counts[opt.id] = value;
      remaining -= value;
    });
    setSeedCounts(counts);
  }

  function wait(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function handleSeedSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!sessionId || !hostToken || !seedTarget) return;
    const { payloads, error: payloadError } = buildSeedPayloads();
    if (payloadError) {
      setSeedError(payloadError);
      return;
    }
    setSeedLoading(true);
    setSeedError(null);
    setSeedProgress({ done: 0, total: payloads.length });
    try {
      for (let i = 0; i < payloads.length; i += 1) {
        await seedAnswers(sessionId, seedTarget.questionId, hostToken, payloads[i]);
        setSeedProgress({ done: i + 1, total: payloads.length });
        await wait(300);
      }
      setSeedTarget(null);
      setSeedTextCount(50);
      setSeedCounts({});
      await fetchQuestions();
    } catch (err) {
      setSeedError(err instanceof Error ? err.message : '灌入失敗');
    } finally {
      setSeedLoading(false);
      setSeedProgress({ done: 0, total: 0 });
    }
  }

  function handleGoBack() {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate('/');
  }

  const joinUrl = `${window.location.origin}/join/${sessionId}`;
  const displayUrl = `${window.location.origin}/display/${sessionId}`;
  const openQuestion = questions.find((q) => q.status === 'OPEN') ?? null;
  const projectionDisplayMode = session?.displayMode ?? openQuestion?.displayMode ?? 'question';
  const projectionResultsQrEnabled = session?.resultsQrEnabled ?? false;
  const projectionResultsQrRefreshEnabled = session?.resultsQrRefreshEnabled ?? true;

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">載入中...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-950">
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white/95 px-4 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-col gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <button
              type="button"
              onClick={handleGoBack}
              className="mt-1 flex-shrink-0 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
            >
              ← 上一頁
            </button>
            <div className="min-w-0 flex-1">
              {editingSessionName ? (
                <form onSubmit={handleSessionNameSubmit} className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={sessionNameDraft}
                    onChange={(e) => setSessionNameDraft(e.target.value)}
                    maxLength={200}
                    autoFocus
                    className="min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-3 py-2 text-xl font-semibold text-gray-950 shadow-sm focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-100"
                  />
                  <button
                    type="submit"
                    disabled={savingSessionName || !sessionNameDraft.trim()}
                    className="rounded-md bg-[#4F46E5] px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#4338CA] disabled:bg-indigo-300"
                  >
                    {savingSessionName ? '儲存中' : '儲存'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingSessionName(false);
                      setSessionNameError(null);
                    }}
                    disabled={savingSessionName}
                    className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50"
                  >
                    取消
                  </button>
                  {sessionNameError && <p className="basis-full text-xs text-red-500">{sessionNameError}</p>}
                </form>
              ) : (
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <h1 className="truncate text-2xl font-semibold tracking-tight text-gray-950">
                      {session?.name ?? '主持人後台'}
                    </h1>
                    <button
                      type="button"
                      onClick={startEditingSessionName}
                      className="flex-shrink-0 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-600 shadow-sm hover:bg-gray-50"
                    >
                      編輯
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex rounded-md shadow-sm">
                      <a
                        href={joinUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center rounded-l-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                      >
                        觀眾連結
                      </a>
                      <div className="relative -ml-px" data-host-menu>
                        <button
                          type="button"
                          onClick={() => {
                            setIsHostMenuOpen((current) => !current);
                            setOpenQuestionMenuId(null);
                          }}
                          aria-expanded={isHostMenuOpen}
                          className="rounded-r-md border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
                        >
                          ...
                        </button>
                        {isHostMenuOpen && (
                        <div className="absolute right-0 z-20 mt-2 w-44 overflow-hidden rounded-md border border-gray-200 bg-white p-1 shadow-lg">
                          <button
                            type="button"
                            onClick={() => {
                              setIsHostMenuOpen(false);
                              handleResetSession();
                            }}
                            disabled={resettingSession || questions.length === 0}
                            className="block w-full rounded-sm px-3 py-2 text-left text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-40"
                          >
                            {resettingSession ? '清除中...' : '清空整場作答'}
                          </button>
                        </div>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const width = Math.min(window.screen.availWidth || 1440, 1440);
                        const height = Math.min(window.screen.availHeight || 900, 900);
                        const left = Math.max(0, ((window.screen.availWidth || width) - width) / 2);
                        const top = Math.max(0, ((window.screen.availHeight || height) - height) / 2);
                        window.open(
                          displayUrl,
                          'preevent-display-window',
                          `popup=yes,width=${width},height=${height},left=${left},top=${top},noopener,noreferrer`,
                        );
                      }}
                      className="inline-flex items-center rounded-md border border-[#1E40AF] bg-[#1E40AF] px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:border-[#1D4ED8] hover:bg-[#1D4ED8]"
                    >
                      投影 ↗
                    </button>
                  </div>
                </div>
              )}
              <p className="mt-1 truncate text-sm text-gray-500">場次 ID：{sessionId}</p>
              <section className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                <h2 className="shrink-0 font-semibold text-gray-700">目前投影狀態：</h2>
                  <fieldset
                    className="flex flex-wrap items-center gap-2"
                    disabled={displayModeUpdating}
                  >
                    <legend className="sr-only">投影顯示模式</legend>
                    <label className="flex cursor-pointer items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
                      <input
                        type="radio"
                        name="projection-display-mode"
                        value="question"
                        checked={projectionDisplayMode === 'question'}
                        onChange={() => handleSetProjectionDisplayMode('question')}
                        className="h-5 w-5 border-gray-300 text-gray-900 focus:ring-gray-900"
                      />
                      題目
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
                      <input
                        type="radio"
                        name="projection-display-mode"
                        value="results"
                        checked={projectionDisplayMode === 'results'}
                        onChange={() => handleSetProjectionDisplayMode('results')}
                        className="h-5 w-5 border-gray-300 text-gray-900 focus:ring-gray-900"
                      />
                      顯示答案
                    </label>
                  </fieldset>
                  <label className="flex cursor-pointer items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
                    <input
                      type="checkbox"
                      checked={projectionResultsQrEnabled}
                      onChange={(e) => handleSetProjectionResultsQrEnabled(e.target.checked)}
                      disabled={resultsQrUpdating}
                      className="h-5 w-5 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
                    />
                    是否開啟右下角 QR Code
                  </label>
                  {projectionResultsQrEnabled && (
                    <div className="flex flex-wrap items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm font-medium text-gray-700">
                      <label className="inline-flex cursor-pointer items-center gap-2 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
                        <input
                          type="checkbox"
                          checked={projectionResultsQrRefreshEnabled}
                          onChange={(e) => handleSetProjectionResultsQrRefreshEnabled(e.target.checked)}
                          disabled={resultsQrRefreshUpdating}
                          className="h-5 w-5 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
                        />
                        是否開啟刷新
                      </label>
                      {projectionResultsQrRefreshEnabled && (
                        <>
                          <span className="text-gray-500">每</span>
                          <input
                            type="number"
                            min={1}
                            max={60}
                            value={resultsQrRefreshIntervalDraft}
                            onChange={(e) => setResultsQrRefreshIntervalDraft(e.target.value)}
                            onBlur={handleSaveProjectionResultsQrRefreshInterval}
                            disabled={resultsQrRefreshUpdating}
                            className="h-9 w-20 rounded-md border border-gray-300 bg-white px-2 text-right text-sm text-gray-900 shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                          />
                          <span className="text-gray-500">秒刷新</span>
                        </>
                      )}
                    </div>
                  )}
              </section>
            </div>
          </div>

        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-4 px-4 py-6">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
            {error}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-2">
            <h2 className="text-base font-semibold text-gray-950">題目列表</h2>
            <span className="text-sm text-gray-500">{questions.length} 題</span>
          </div>
          {!showEditor && (
            <button
              type="button"
              onClick={() => setShowEditor(true)}
              className="inline-flex items-center gap-2 rounded-md bg-[#4F46E5] px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#4338CA] focus:outline-none focus:ring-2 focus:ring-[#4F46E5]/30"
            >
              <span aria-hidden="true" className="text-base leading-none">+</span>
              新增題目
            </button>
          )}
        </div>

        {showEditor && (
          <QuestionEditor
            onSubmit={handleCreateQuestion}
            onCancel={() => setShowEditor(false)}
          />
        )}

        {questions.length === 0 && !showEditor && (
          <div className="text-center py-12 text-gray-400">
            <p className="text-4xl mb-3">📋</p>
            <p>尚未建立任何題目</p>
          </div>
        )}

        {questions.map((q) => {
          const isOpen = q.status === 'OPEN';
          const isStatusUpdating = statusUpdatingQuestionId === q.questionId;
          const sceneLabel = q.displayScene ? (SCENE_LABEL[q.displayScene] ?? q.displayScene) : null;
          const sceneBadgeClass = q.displayScene ? (SCENE_BADGE_CLASS[q.displayScene] ?? 'border-gray-300 bg-white text-gray-700') : '';

          return (
            <div
              key={q.questionId}
              className={`overflow-visible rounded-lg border transition-colors ${
                isOpen
                  ? 'border-indigo-300 bg-indigo-50/60 shadow-md shadow-indigo-100/70 ring-1 ring-indigo-100'
                  : 'border-gray-200 bg-white shadow-sm'
              }`}
            >
              <div className="p-5">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-gray-500">
                      <span className={`inline-flex h-6 items-center rounded-full px-2.5 text-xs font-semibold ${TYPE_BADGE_CLASS[q.type]}`}>
                        {TYPE_LABEL[q.type]}
                      </span>
                      {sceneLabel && (
                        <span className={`inline-flex h-6 items-center rounded-full border px-2.5 text-xs font-semibold ${sceneBadgeClass}`}>
                          {sceneLabel}
                        </span>
                      )}
                    </div>
                    <h3 className="text-lg font-semibold leading-7 text-gray-950">{q.title}</h3>
                    <p className="mt-1 text-sm text-gray-500">{q.totalResponses} 人作答</p>
                  </div>

                  <label className="inline-flex shrink-0 cursor-pointer items-center gap-3 text-base font-semibold text-gray-800 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
                    <input
                      type="checkbox"
                      className="peer sr-only"
                      checked={isOpen}
                      disabled={isStatusUpdating}
                      onChange={() => handleToggleStatus(q)}
                      aria-label={isOpen ? '切換為已關閉' : '切換為作答中'}
                    />
                    <span className="relative inline-flex h-7 w-12 shrink-0 rounded-full bg-[#9CA3AF] transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-6 after:w-6 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:bg-[#16A34A] peer-checked:after:translate-x-5 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-gray-900" />
                    <span>{isOpen ? '作答中' : '已關閉'}</span>
                  </label>
                </div>

              {q.type !== 'TEXT' && q.totalResponses > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <ResultChart
                    options={q.options}
                    totalResponses={q.totalResponses}
                    compact
                  />
                </div>
              )}

              {q.type !== 'TEXT' && q.totalResponses === 0 && (
                <div className="mt-4">
                  <div className="flex flex-wrap gap-1">
                    {q.options.map((opt) => (
                      <span key={opt.id} className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600">
                        {opt.label}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {q.type === 'TEXT' && (
                <div className="mt-4 space-y-3">
                  {q.displayScene === 'word-cloud' && (
                    <div className="rounded-lg border border-indigo-200 bg-indigo-50/30 px-3 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                          自動刷新秒數
                          <input
                            type="number"
                            min={1}
                            max={60}
                            value={getWordCloudIntervalValue(q)}
                            onChange={(e) => setWordCloudIntervalDrafts((prev) => ({
                              ...prev,
                              [q.questionId]: e.target.value,
                            }))}
                            className="h-9 w-20 rounded-md border border-gray-300 bg-white px-2 text-right text-sm text-gray-900 shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                          />
                          秒
                        </label>
                        <button
                          type="button"
                          onClick={() => handleSaveWordCloudInterval(q)}
                          disabled={wordCloudUpdatingQuestionId === q.questionId}
                          className="h-9 rounded-md bg-[#4F46E5] px-3 text-sm font-semibold text-white shadow-sm hover:bg-[#4338CA] disabled:bg-indigo-300"
                        >
                          套用
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRefreshWordCloudNow(q)}
                          disabled={wordCloudUpdatingQuestionId === q.questionId}
                          className="h-9 rounded-md border border-sky-200 bg-sky-50 px-3 text-sm font-semibold text-sky-700 shadow-sm hover:bg-sky-100 disabled:opacity-50"
                        >
                          立即重新整理
                        </button>
                        <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-700 shadow-sm has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
                          <input
                            type="checkbox"
                            className="peer sr-only"
                            checked={!(q.wordCloudRefreshPaused ?? false)}
                            disabled={wordCloudUpdatingQuestionId === q.questionId}
                            onChange={() => handleToggleWordCloudRefresh(q)}
                            aria-label={q.wordCloudRefreshPaused ? '開啟自動重新整理' : '停止自動重新整理'}
                          />
                          <span className="relative inline-flex h-5 w-9 shrink-0 rounded-full bg-[#9CA3AF] transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:bg-[#16A34A] peer-checked:after:translate-x-4 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-gray-900" />
                          {q.wordCloudRefreshPaused ? '關閉' : '開啟'}
                        </label>
                        <span className="text-xs text-gray-400">
                          {q.wordCloudRefreshPaused ? '目前已停止自動刷新' : `目前每 ${q.wordCloudRefreshIntervalSec ?? 3} 秒刷新`}
                        </span>
                      </div>
                    </div>
                  )}
                  {q.displayScene === 'spotlight' && (
                    <div className="rounded-lg border border-indigo-200 bg-indigo-50/30 px-3 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="flex min-w-[260px] flex-1 items-center gap-2 text-sm font-semibold text-gray-700">
                          顯示標語
                          <input
                            type="text"
                            value={getSpotlightSloganValue(q)}
                            onChange={(e) => setSpotlightSloganDrafts((prev) => ({
                              ...prev,
                              [q.questionId]: e.target.value,
                            }))}
                            maxLength={80}
                            className="h-9 min-w-[180px] flex-1 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                            placeholder="We Are One"
                          />
                        </label>
                        <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-700 shadow-sm has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
                          <input
                            type="checkbox"
                            className="peer sr-only"
                            checked={q.spotlightSloganVisible ?? false}
                            disabled={spotlightSloganUpdatingQuestionId === q.questionId}
                            onChange={() => handleToggleSpotlightSlogan(q)}
                            aria-label={q.spotlightSloganVisible ? '隱藏標語' : '顯示標語'}
                          />
                          <span className="relative inline-flex h-5 w-9 shrink-0 rounded-full bg-[#9CA3AF] transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:bg-[#16A34A] peer-checked:after:translate-x-4 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-gray-900" />
                          <span>
                            {spotlightSloganUpdatingQuestionId === q.questionId
                              ? '更新中...'
                              : q.spotlightSloganVisible
                                ? '顯示中'
                                : '已關閉'}
                          </span>
                        </label>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSeedTarget(q)}
                    className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    灌入測試資料
                  </button>
                </div>
                <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                    {q.status !== 'OPEN' && (
                      <button
                        onClick={() => openEditModal(q)}
                        className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-medium text-sky-700 shadow-sm transition-colors hover:border-sky-300 hover:bg-sky-100"
                      >
                        編輯
                      </button>
                    )}
                    <div className="relative" data-question-menu>
                      <button
                        type="button"
                        onClick={() => setOpenQuestionMenuId((current) => (current === q.questionId ? null : q.questionId))}
                        aria-expanded={openQuestionMenuId === q.questionId}
                        className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
                      >
                        ...
                      </button>
	                      {openQuestionMenuId === q.questionId && (
	                        <div className="absolute right-0 z-20 mt-2 w-44 overflow-hidden rounded-md border border-gray-200 bg-white p-1 shadow-lg">
	                          <button
	                            type="button"
	                            onClick={() => {
	                              setOpenQuestionMenuId(null);
	                              handleQuestionLoadTest(q);
	                            }}
	                            disabled={loadTestingQuestionId === q.questionId}
	                            className="block w-full rounded-sm px-3 py-2 text-left text-sm font-medium text-gray-900 hover:bg-gray-50 disabled:opacity-40"
	                          >
	                            {loadTestingQuestionId === q.questionId ? '壓測中...' : '500人壓測'}
	                          </button>
	                          <button
	                            type="button"
	                            onClick={() => {
	                              setOpenQuestionMenuId(null);
	                              handleResetQuestion(q);
	                            }}
	                            disabled={clearingQuestionId === q.questionId}
	                            className="block w-full rounded-sm px-3 py-2 text-left text-sm font-medium text-gray-900 hover:bg-gray-50 disabled:opacity-40"
	                          >
	                            {clearingQuestionId === q.questionId ? '清除中...' : '清空此題作答'}
	                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setOpenQuestionMenuId(null);
                              handleDeleteQuestion(q);
                            }}
                            disabled={deletingQuestionId === q.questionId}
                            className="block w-full rounded-sm px-3 py-2 text-left text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-40"
                          >
                            {deletingQuestionId === q.questionId ? '刪除中...' : '刪除'}
                          </button>
	                        </div>
	                      )}
                    </div>
                  </div>
                </div>
            </div>
          </div>
          );
        })}
      </main>

      {editTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-xl font-semibold text-gray-900">編輯題目</h4>
              <button onClick={() => setEditTarget(null)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
            </div>
            <form onSubmit={handleEditSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">題目標題</label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  maxLength={500}
                  className="w-full rounded-md border border-gray-200 px-3 py-2 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-100"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">投影場景</label>
                <div className="grid grid-cols-2 gap-2">
                  {(editTarget.type === 'TEXT'
                    ? [
                        { value: 'text-wall', label: '文字牆' },
                        { value: 'spotlight', label: '聚光燈文字' },
                        { value: 'word-cloud', label: '魔幻星空 Word Cloud' },
                      ]
                    : [
                        { value: 'default', label: '標準長條圖' },
                        { value: 'map3d-hud', label: '3D 地圖 HUD' },
                      ]
                  ).map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() => setEditScene(s.value as DisplayScene)}
                      className={`py-2 px-3 rounded-xl border text-sm font-medium transition-colors ${
                        editScene === s.value
                          ? 'border-[#4F46E5] bg-indigo-50 text-[#4338CA] shadow-sm ring-1 ring-indigo-100'
                          : 'border-gray-200 bg-white text-gray-600 hover:border-indigo-200 hover:bg-indigo-50/60 hover:text-indigo-700'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
              {editTarget.type !== 'TEXT' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">選項與票數</label>
                  <div className="space-y-2">
                    {editTarget.options.map((opt) => (
                      <div key={opt.id} className="flex gap-2 items-center">
                        <input
                          type="text"
                          value={editOptionLabels[opt.id] ?? opt.label}
                          onChange={(e) => setEditOptionLabels((prev) => ({ ...prev, [opt.id]: e.target.value }))}
                          maxLength={200}
                          className="flex-1 rounded-md border border-gray-200 px-3 py-1.5 text-sm focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-100"
                          placeholder="選項名稱"
                        />
                        <input
                          type="number"
                          min={0}
                          max={99999}
                          value={editOptionCounts[opt.id] ?? 0}
                          onChange={(e) => setEditOptionCounts((prev) => ({ ...prev, [opt.id]: Number(e.target.value) }))}
                          className="w-24 rounded-md border border-gray-200 px-3 py-1.5 text-right text-sm focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-100"
                        />
                        <span className="text-xs text-gray-400 w-6">票</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-gray-400 mt-1">直接輸入最終票數，儲存後立即反映。</p>
                </div>
              )}
              {editError && <p className="text-red-500 text-sm">{editError}</p>}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setEditTarget(null)}
                  className="flex-1 rounded-md border border-gray-200 py-3 font-medium text-gray-700 hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={editLoading || !editTitle.trim()}
                  className="flex-1 rounded-md bg-[#4F46E5] py-3 font-semibold text-white hover:bg-[#4338CA] disabled:bg-indigo-300"
                >
                  {editLoading ? '儲存中...' : '儲存變更'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {seedTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-xs uppercase tracking-widest text-gray-400">Display 測試工具</p>
                <h4 className="text-xl font-semibold text-gray-900">
                  {seedTarget.type === 'TEXT' ? '灌入測試資料' : '灌入測試票數'}
                </h4>
                <p className="text-sm text-gray-500 mt-1">題目：{seedTarget.title}</p>
              </div>
              <button
                onClick={() => setSeedTarget(null)}
                className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
              >
                ×
              </button>
            </div>
            <form onSubmit={handleSeedSubmit} className="space-y-4">
              {seedTarget.type === 'TEXT' ? (
                <>
                  <label className="block">
                    <span className="block text-sm font-medium text-gray-700 mb-1">測試資料筆數</span>
                    <input
                      type="number"
                      min={1}
                      max={MAX_TEXT_SEED_COUNT}
                      value={seedTextCount}
                      onChange={(e) => setSeedTextCount(Number(e.target.value))}
                      className="w-full rounded-md border border-gray-200 px-3 py-2 text-right focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-100"
                    />
                  </label>
                  <div className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-2 text-sm text-gray-500">
                    會灌入 <span className="font-semibold text-gray-700">資料1</span>
                    {seedTextCount > 1 && (
                      <>
                        {' '}到 <span className="font-semibold text-gray-700">資料{Math.max(1, Math.round(Number(seedTextCount) || 1))}</span>
                      </>
                    )}
                    ，最多 {MAX_TEXT_SEED_COUNT} 筆。
                  </div>
                  <button
                    type="button"
                    onClick={handleRandomSeed}
                    className="w-full rounded-md border border-gray-200 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                  >
                    隨機 20-50 筆
                  </button>
                </>
              ) : (
                <div className="space-y-2">
                  {seedTarget.options.map((opt) => (
                    <label key={opt.id} className="flex items-center justify-between border border-gray-200 rounded-xl px-4 py-2">
                      <span className="text-gray-700 font-medium">{opt.label}</span>
                      <input
                        type="number"
                        min={0}
                        max={500}
                        value={seedCounts[opt.id] ?? ''}
                        onChange={(e) => setSeedCounts((prev) => ({ ...prev, [opt.id]: Number(e.target.value) }))}
                        placeholder="0"
                        className="w-24 border border-gray-200 rounded-lg px-2 py-1 text-right"
                      />
                    </label>
                  ))}
                  <p className="text-xs text-gray-400">可為每個選項填入測試票數（最多 500），會同步更新統計圖。</p>
                  <button
                    type="button"
                    onClick={handleRandomSeed}
                    className="w-full rounded-md border border-gray-200 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                  >
                    隨機 20-50 筆
                  </button>
                </div>
              )}
              {seedError && <p className="text-red-500 text-sm">{seedError}</p>}
              {seedLoading && seedProgress.total > 0 && (
                <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
                  模擬灌入中... {seedProgress.done}/{seedProgress.total}
                </div>
              )}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setSeedTarget(null)}
                  className="flex-1 rounded-md border border-gray-200 py-3 font-medium text-gray-700 hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={seedLoading}
                  className="flex-1 rounded-md bg-[#4F46E5] py-3 font-semibold text-white hover:bg-[#4338CA] disabled:bg-indigo-300"
                >
                  {seedLoading ? '灌入中...' : '灌入資料'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
