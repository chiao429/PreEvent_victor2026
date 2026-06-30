import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { listQuestions, createQuestion, updateQuestion, updateQuestionStatus, getSession, seedAnswers, deleteQuestion, clearQuestionAnswers, resetSessionAnswers, updateSessionName, setDisplayMode, runQuestionLoadTest } from '../api/client';
import { QuestionEditor } from '../components/QuestionEditor';
import { ResultChart } from '../components/ResultChart';
import { updateStoredSessionName } from './HomePage';
import type { DisplayScene, Question, QuestionType, Session } from '../types';

const STATUS_LABEL: Record<string, string> = {
  DRAFT: '草稿',
  OPEN: '作答中',
  CLOSED: '已關閉',
};

const SCENE_LABEL: Record<string, string> = {
  default: '標準長條圖',
  'text-wall': '文字牆',
  spotlight: '聚光燈文字',
  'word-cloud': '魔幻星空 Word Cloud',
  'map3d-hud': '3D 地圖 HUD',
};

const STATUS_COLOR: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-600',
  OPEN: 'bg-green-100 text-green-700',
  CLOSED: 'bg-red-100 text-red-600',
};

const RANDOM_CHURCH_PREFIXES = ['台北', '新北', '桃園', '台中', '彰化', '嘉義', '台南', '高雄', '屏東', '宜蘭', '花蓮', '台東', '香港', '新加坡', '洛杉磯'];
const RANDOM_CHURCH_SUFFIXES = ['和平教會', '真理堂', '福氣教會', '靈糧堂', '行道會', '信友堂', '生命堂', '基督之家', '豐收教會'];
const RANDOM_TRAITS = ['愛笑', '熱情', '會唱歌', '很細心', '超專注', '樂於助人', '領袖力', '藝術魂', '體育咖', '愛禱告', '超有創意', '溫柔細膩', '超會講笑話', '行動派', '策略腦'];

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function buildRandomChurchName() {
  const prefix = RANDOM_CHURCH_PREFIXES[Math.floor(Math.random() * RANDOM_CHURCH_PREFIXES.length)];
  const suffix = RANDOM_CHURCH_SUFFIXES[Math.floor(Math.random() * RANDOM_CHURCH_SUFFIXES.length)];
  return `${prefix}${suffix}`;
}

function buildRandomTraitWord() {
  return RANDOM_TRAITS[Math.floor(Math.random() * RANDOM_TRAITS.length)];
}

function shuffleArray<T>(items: T[]): T[] {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function isChurchQuestion(title: string) {
  return /教會|Church/i.test(title);
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
  const [seedText, setSeedText] = useState('');
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
  const [resettingSession, setResettingSession] = useState(false);
  const [displayModeUpdatingQuestionId, setDisplayModeUpdatingQuestionId] = useState<string | null>(null);
  const [loadTestingQuestionId, setLoadTestingQuestionId] = useState<string | null>(null);
  const [reopeningQuestionId, setReopeningQuestionId] = useState<string | null>(null);
  const [startingQuestionId, setStartingQuestionId] = useState<string | null>(null);

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
    if (question.totalResponses > 0) {
      alert('已有作答的題目無法刪除');
      return;
    }
    if (!window.confirm('確定要刪除這題嗎？')) return;
    try {
      await deleteQuestion(sessionId, hostToken, question.questionId);
      await fetchQuestions();
    } catch (err) {
      alert(err instanceof Error ? err.message : '刪除失敗');
    }
  }

  async function handleToggleStatus(question: Question) {
    if (!sessionId || !hostToken) return;
    const nextStatus = question.status === 'OPEN' ? 'CLOSED' : 'OPEN';
    try {
      await updateQuestionStatus(sessionId, hostToken, question.questionId, nextStatus);
      await fetchQuestions();
    } catch (err) {
      alert(err instanceof Error ? err.message : '操作失敗');
    }
  }

  async function handleToggleDisplayAnswers(question: Question) {
    if (!sessionId || !hostToken) return;
    const nextMode = question.displayMode === 'results' ? 'question' : 'results';
    setDisplayModeUpdatingQuestionId(question.questionId);
    try {
      await setDisplayMode(sessionId, hostToken, nextMode);
      await fetchQuestions();
    } catch (err) {
      alert(err instanceof Error ? err.message : '切換投影顯示失敗');
    } finally {
      setDisplayModeUpdatingQuestionId(null);
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
      const textAnswers = seedText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      if (textAnswers.length === 0) {
        return { payloads: [], error: '請輸入至少一行文字' };
      }
      if (textAnswers.length > 50) {
        return { payloads: [], error: '一次最多 50 筆文字' };
      }
      return { payloads: shuffleArray(textAnswers.map((text) => ({ textAnswers: [text] }))) };
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
      const generator = isChurchQuestion(seedTarget.title) ? buildRandomChurchName : buildRandomTraitWord;
      const lines = Array.from({ length: total }, generator);
      setSeedText(lines.join('\n'));
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
      setSeedText('');
      setSeedCounts({});
      await fetchQuestions();
    } catch (err) {
      setSeedError(err instanceof Error ? err.message : '灌入失敗');
    } finally {
      setSeedLoading(false);
      setSeedProgress({ done: 0, total: 0 });
    }
  }

  async function handleCloseDraft(question: Question) {
    if (!sessionId || !hostToken) return;
    setStartingQuestionId(question.questionId);
    try {
      await updateQuestionStatus(sessionId, hostToken, question.questionId, 'OPEN');
      await fetchQuestions();
    } catch (err) {
      alert(err instanceof Error ? err.message : '操作失敗');
    } finally {
      setStartingQuestionId(null);
    }
  }

  async function handleReopenAsDraft(question: Question) {
    if (!sessionId || !hostToken) return;
    setReopeningQuestionId(question.questionId);
    try {
      await updateQuestionStatus(sessionId, hostToken, question.questionId, 'DRAFT');
      await fetchQuestions();
    } catch (err) {
      alert(err instanceof Error ? err.message : '操作失敗');
    } finally {
      setReopeningQuestionId(null);
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

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">載入中...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-4 py-4 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={handleGoBack}
                className="flex-shrink-0 px-3 py-1.5 bg-gray-100 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors"
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
                      className="min-w-0 flex-1 rounded-lg border border-indigo-200 px-3 py-1.5 text-xl font-bold text-gray-900 focus:border-indigo-500 focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={savingSessionName || !sessionNameDraft.trim()}
                      className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:bg-indigo-300"
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
                      className="rounded-lg bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-200 disabled:opacity-50"
                    >
                      取消
                    </button>
                    {sessionNameError && <p className="basis-full text-xs text-red-500">{sessionNameError}</p>}
                  </form>
                ) : (
                  <div className="flex items-center gap-2 min-w-0">
                    <h1 className="text-xl font-bold text-gray-900 truncate">
                      {session?.name ?? '主持人後台'}
                    </h1>
                    <button
                      type="button"
                      onClick={startEditingSessionName}
                      className="flex-shrink-0 rounded-lg bg-gray-100 px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-200 hover:text-gray-700"
                    >
                      改名
                    </button>
                  </div>
                )}
                <p className="text-xs text-gray-400 mt-0.5 truncate">場次 ID：{sessionId}</p>
              </div>
            </div>
            <span className="text-xs bg-indigo-100 text-indigo-700 px-3 py-1 rounded-full font-medium">
              主持人模式
            </span>
          </div>

          <div className="flex gap-2 flex-wrap text-xs">
            <a
              href={joinUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg border border-emerald-200 hover:bg-emerald-100 transition-colors"
            >
              觀眾連結 ↗
            </a>
            <button
              onClick={() => {
                navigator.clipboard.writeText(joinUrl);
                alert('觀眾連結已複製！');
              }}
              className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors"
            >
              複製連結
            </button>
            <a
              href={displayUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-gray-800 text-white rounded-lg hover:bg-gray-900 transition-colors"
            >
              大螢幕 ↗
            </a>
            <button
              onClick={handleResetSession}
              disabled={resettingSession || questions.length === 0}
              className="px-3 py-1.5 bg-rose-50 text-rose-600 rounded-lg border border-rose-200 hover:bg-rose-100 disabled:opacity-40 transition-colors"
            >
              {resettingSession ? '清除中...' : '清空整場作答'}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
            {error}
          </div>
        )}

        {showEditor ? (
          <QuestionEditor
            onSubmit={handleCreateQuestion}
            onCancel={() => setShowEditor(false)}
          />
        ) : (
          <button
            onClick={() => setShowEditor(true)}
            className="w-full py-3 border-2 border-dashed border-indigo-300 text-indigo-600 font-medium rounded-2xl hover:border-indigo-400 hover:bg-indigo-50 transition-colors"
          >
            + 新增題目
          </button>
        )}

        {questions.length === 0 && !showEditor && (
          <div className="text-center py-12 text-gray-400">
            <p className="text-4xl mb-3">📋</p>
            <p>尚未建立任何題目</p>
          </div>
        )}

        {questions.map((q) => (
          <div key={q.questionId} className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="p-4">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[q.status]}`}>
                      {STATUS_LABEL[q.status]}
                    </span>
                    <span className="text-xs text-gray-400">
                      {q.type === 'SINGLE_CHOICE' ? '單選' : q.type === 'MULTI_CHOICE' ? '多選' : '文字'}
                    </span>
                    {q.displayScene && (
                      <span className="text-xs text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-full">
                        {SCENE_LABEL[q.displayScene] ?? q.displayScene}
                      </span>
                    )}
                  </div>
                  <p className="font-semibold text-gray-900">{q.title}</p>
                </div>

                <div className="flex gap-2 flex-shrink-0">
                  {q.status === 'DRAFT' && (
                    <>
                      <button
                        onClick={() => openEditModal(q)}
                        className="px-3 py-1.5 bg-amber-50 text-amber-700 text-sm font-medium rounded-lg border border-amber-200 hover:bg-amber-100 transition-colors"
                      >
                        編輯
                      </button>
                      <button
                        onClick={() => handleCloseDraft(q)}
                        disabled={startingQuestionId === q.questionId}
                        className="px-3 py-1.5 bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white text-sm font-medium rounded-lg transition-colors"
                      >
                        {startingQuestionId === q.questionId ? '開始中...' : '開始作答'}
                      </button>
                      <button
                        onClick={() => handleDeleteQuestion(q)}
                        className="px-3 py-1.5 bg-gray-100 hover:bg-red-600 hover:text-white text-gray-600 text-sm font-medium rounded-lg transition-colors"
                      >
                        刪除
                      </button>
                    </>
                  )}
                  {q.status === 'OPEN' && (
                    <>
                      <button
                        onClick={() => handleToggleDisplayAnswers(q)}
                        disabled={displayModeUpdatingQuestionId === q.questionId}
                        className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors disabled:opacity-60 ${
                          q.displayMode === 'results'
                            ? 'bg-gray-800 hover:bg-gray-900 text-white'
                            : 'bg-blue-600 hover:bg-blue-700 text-white'
                        }`}
                      >
                        {displayModeUpdatingQuestionId === q.questionId
                          ? '切換中...'
                          : q.displayMode === 'results'
                            ? '顯示 QR CODE'
                            : '顯示答案'}
                      </button>
                      <button
                        onClick={() => handleToggleStatus(q)}
                        className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded-lg transition-colors"
                      >
                        關閉作答
                      </button>
                    </>
                  )}
                  {q.status === 'CLOSED' && (
                    <>
                      <button
                        onClick={() => openEditModal(q)}
                        className="px-3 py-1.5 bg-amber-50 text-amber-700 text-sm font-medium rounded-lg border border-amber-200 hover:bg-amber-100 transition-colors"
                      >
                        編輯
                      </button>
                      <button
                        onClick={() => handleReopenAsDraft(q)}
                        disabled={reopeningQuestionId === q.questionId}
                        className="px-3 py-1.5 bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white text-sm font-medium rounded-lg transition-colors"
                      >
                        {reopeningQuestionId === q.questionId ? '開啟中...' : '重新開啟'}
                      </button>
                    </>
                  )}
                  {q.type === 'TEXT' && (
                    <button
                      onClick={() => setSeedTarget(q)}
                      className="px-3 py-1.5 bg-indigo-50 text-indigo-600 text-sm font-medium rounded-lg border border-indigo-200 hover:bg-indigo-100 transition-colors"
                    >
                      灌入測試資料
                    </button>
                  )}
                  {q.type !== 'TEXT' && (
                    <button
                      onClick={() => setSeedTarget(q)}
                      className="px-3 py-1.5 bg-indigo-50 text-indigo-600 text-sm font-medium rounded-lg border border-indigo-200 hover:bg-indigo-100 transition-colors"
                    >
                      灌入測試資料
                    </button>
                  )}
                  <button
                    onClick={() => handleQuestionLoadTest(q)}
                    disabled={loadTestingQuestionId === q.questionId}
                    className="px-3 py-1.5 bg-orange-50 text-orange-700 text-sm font-medium rounded-lg border border-orange-200 hover:bg-orange-100 disabled:opacity-40 transition-colors"
                  >
                    {loadTestingQuestionId === q.questionId ? '壓測中...' : '500人壓測'}
                  </button>
                  <button
                    onClick={() => handleResetQuestion(q)}
                    disabled={clearingQuestionId === q.questionId}
                    className="px-3 py-1.5 bg-rose-50 text-rose-600 text-sm font-medium rounded-lg border border-rose-200 hover:bg-rose-100 disabled:opacity-40 transition-colors"
                  >
                    {clearingQuestionId === q.questionId ? '清除中...' : '清空此題作答'}
                  </button>
                </div>
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
                <div className="mt-2">
                  <div className="flex flex-wrap gap-1">
                    {q.options.map((opt) => (
                      <span key={opt.id} className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-md">
                        {opt.label}
                      </span>
                    ))}
                  </div>
                  <p className="text-xs text-gray-400 mt-2">尚無作答</p>
                </div>
              )}

              {q.type === 'TEXT' && (
                <p className="text-xs text-gray-400 mt-1">
                  文字題・{q.totalResponses} 人作答
                </p>
              )}
            </div>
          </div>
        ))}
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
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-indigo-500"
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
                          ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
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
                          className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-indigo-500"
                          placeholder="選項名稱"
                        />
                        <input
                          type="number"
                          min={0}
                          max={99999}
                          value={editOptionCounts[opt.id] ?? 0}
                          onChange={(e) => setEditOptionCounts((prev) => ({ ...prev, [opt.id]: Number(e.target.value) }))}
                          className="w-24 px-3 py-1.5 border border-gray-200 rounded-lg text-sm text-right focus:outline-none focus:border-indigo-500"
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
                  className="flex-1 py-3 border border-gray-200 rounded-xl text-gray-600 font-medium"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={editLoading || !editTitle.trim()}
                  className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold disabled:bg-indigo-300"
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
                  {seedTarget.type === 'TEXT'
                    ? isChurchQuestion(seedTarget.title)
                      ? '灌入教會名稱'
                      : '灌入文字答案'
                    : '灌入測試票數'}
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
                  <textarea
                    value={seedText}
                    onChange={(e) => setSeedText(e.target.value)}
                    rows={8}
                    className="w-full border border-gray-200 rounded-xl p-3 focus:outline-none focus:border-indigo-500"
                    placeholder={
                      isChurchQuestion(seedTarget.title)
                        ? '每行一個文字答案，例如:\n台北真理堂\n高雄福氣教會\n...'
                        : '每行一個文字答案，例如:\n愛笑\n溫柔細膩\n超有創意\n...'
                    }
                  />
                  <div className="flex items-center justify-between text-sm text-gray-500">
                    <span>一次最多 50 筆，會即時顯示在 Display</span>
                    <span>{seedText.split('\n').filter((l) => l.trim()).length} 筆</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleRandomSeed}
                    className="w-full py-2 text-sm font-semibold rounded-xl border border-indigo-200 text-indigo-600 hover:bg-indigo-50"
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
                    className="w-full py-2 text-sm font-semibold rounded-xl border border-indigo-200 text-indigo-600 hover:bg-indigo-50"
                  >
                    隨機 20-50 筆
                  </button>
                </div>
              )}
              {seedError && <p className="text-red-500 text-sm">{seedError}</p>}
              {seedLoading && seedProgress.total > 0 && (
                <div className="text-sm text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-xl px-3 py-2">
                  模擬灌入中... {seedProgress.done}/{seedProgress.total}
                </div>
              )}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setSeedTarget(null)}
                  className="flex-1 py-3 border border-gray-200 rounded-xl text-gray-600 font-medium"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={seedLoading}
                  className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold disabled:bg-indigo-300"
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
