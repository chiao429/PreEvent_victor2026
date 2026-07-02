import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createSession } from '../api/client';

interface SessionRecord {
  sessionId: string;
  name: string;
  createdAt: string;
}

export const SESSION_RECORDS_STORAGE_KEY = 'preevent_sessions';

export function loadSessionRecords(): SessionRecord[] {
  try {
    return JSON.parse(localStorage.getItem(SESSION_RECORDS_STORAGE_KEY) ?? '[]') as SessionRecord[];
  } catch {
    return [];
  }
}

export function saveSessionRecords(list: SessionRecord[]) {
  localStorage.setItem(SESSION_RECORDS_STORAGE_KEY, JSON.stringify(list));
}

export function updateStoredSessionName(sessionId: string, name: string) {
  const sessions = loadSessionRecords();
  const updated = sessions.map((session) => (
    session.sessionId === sessionId ? { ...session, name } : session
  ));
  saveSessionRecords(updated);
}

export function HomePage() {
  const navigate = useNavigate();

  const [sessionName, setSessionName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionRecord[]>(loadSessionRecords);

  async function handleCreateSession(e: React.FormEvent) {
    e.preventDefault();
    if (!sessionName.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const { sessionId, hostToken } = await createSession(sessionName.trim());
      localStorage.setItem(`hostToken_${sessionId}`, hostToken);
      const record: SessionRecord = {
        sessionId,
        name: sessionName.trim(),
        createdAt: new Date().toISOString(),
      };
      const updated = [record, ...loadSessionRecords()];
      saveSessionRecords(updated);
      setSessions(updated);
      navigate(`/host/${sessionId}`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : '建立失敗');
    } finally {
      setCreating(false);
    }
  }

  function handleRemoveSession(sessionId: string) {
    const updated = loadSessionRecords().filter((s) => s.sessionId !== sessionId);
    saveSessionRecords(updated);
    setSessions(updated);
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center p-4">
      <div className="w-full max-w-5xl">
        <div className="text-center mb-6">
          <h1 className="text-4xl font-bold text-indigo-700 mb-2">PreEvent</h1>
          <p className="text-gray-500">即時互動系統</p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:items-start">
          <aside className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 lg:sticky lg:top-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">我的場次記錄</h2>
            {sessions.length > 0 ? (
              <>
                <ul className="space-y-3">
                  {sessions.map((s) => (
                    <li
                      key={s.sessionId}
                      className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:border-indigo-200 hover:bg-indigo-50/40 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 truncate">{s.name}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {new Date(s.createdAt).toLocaleString('zh-TW', {
                            year: 'numeric', month: '2-digit', day: '2-digit',
                            hour: '2-digit', minute: '2-digit',
                          })}
                        </p>
                      </div>
                      <button
                        onClick={() => navigate(`/host/${s.sessionId}`)}
                        className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors whitespace-nowrap"
                      >
                        進入後台
                      </button>
                      <button
                        onClick={() => handleRemoveSession(s.sessionId)}
                        className="px-2 py-1.5 text-xs text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        title="移除記錄"
                      >
                        x
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-gray-400 mt-3">
                  記錄儲存於此裝置瀏覽器，清除後需重新輸入場次 ID。
                </p>
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-gray-200 p-5 text-sm text-gray-400">
                尚未建立任何場次。
              </div>
            )}
          </aside>

          <div className="space-y-6">
            {/* Create session */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">主持人：建立新場次</h2>
              <form onSubmit={handleCreateSession} className="space-y-3">
                <input
                  type="text"
                  value={sessionName}
                  onChange={(e) => setSessionName(e.target.value)}
                  placeholder="場次名稱，例如：2026 新春年會"
                  maxLength={200}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-500 transition-colors"
                />
                {createError && <p className="text-red-500 text-sm">{createError}</p>}
                <button
                  type="submit"
                  disabled={creating || !sessionName.trim()}
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-semibold rounded-xl transition-colors"
                >
                  {creating ? '建立中...' : '建立場次'}
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
