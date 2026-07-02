import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useLiveQuestion } from '../hooks/useLiveQuestion';
import { ResultChart } from '../components/ResultChart';
import { TextAnswerWall } from '../components/TextAnswerWall';
import { ThreeMapScene } from '../components/ThreeMapScene';
import { ThreeMapSceneHUD } from '../components/ThreeMapSceneHUD';
import { SpotlightScene } from '../components/SpotlightScene';
import { MagicWordCloudScene } from '../components/MagicWordCloudScene';

export function DisplayPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [searchParams] = useSearchParams();
  const { question, loading, error, connected } = useLiveQuestion(sessionId ?? '');
  const [projectorMode, setProjectorMode] = useState(searchParams.get('mode') === 'projector');
  const [revealedCounts, setRevealedCounts] = useState<Record<string, number>>({});
  const [revealedTotalResponses, setRevealedTotalResponses] = useState(0);
  const [revealedTextCount, setRevealedTextCount] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const joinUrl = sessionId ? `${window.location.origin}/join/${sessionId}` : '';

  const handleFullscreenChange = useCallback(() => {
    const fullscreenElement = document.fullscreenElement;
    if (!fullscreenElement) {
      setProjectorMode(false);
    }
  }, []);

  useEffect(() => {
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [handleFullscreenChange]);

  const enterProjectorMode = async () => {
    setProjectorMode(true);
    if (!document.fullscreenElement) {
      try {
        await containerRef.current?.requestFullscreen();
      } catch (err) {
        console.warn('Fullscreen request rejected', err);
      }
    }
  };

  const exitProjectorMode = async () => {
    setProjectorMode(false);
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    }
  };

  const derivedScene = (() => {
    const forced = searchParams.get('scene');
    if (forced) {
      return forced === 'map-church' ? 'text-wall' : forced;
    }
    if (question?.displayScene) {
      return question.displayScene;
    }
    if (question?.type === 'TEXT') {
      return 'text-wall';
    }
    return 'default';
  })();
  const isSpotlightScene = question?.type === 'TEXT' && derivedScene === 'spotlight';
  const isWordCloudScene = question?.type === 'TEXT' && derivedScene === 'word-cloud';
  const isMapScene = question?.type !== 'TEXT' && derivedScene === 'map3d';
  const isMapHudScene = question?.type !== 'TEXT' && derivedScene === 'map3d-hud';
  const showAnswers = question?.displayMode === 'results';
  const textRevealStep = isWordCloudScene ? 12 : 1;
  const revealTargetSignature = useMemo(() => {
    if (!question || !showAnswers) return '';
    return JSON.stringify({
      id: question.id,
      options: question.options.map((option) => [option.id, option.count]),
      recentTexts: question.recentTexts.length,
      totalResponses: question.totalResponses,
    });
  }, [question, showAnswers]);
  const displayedOptions = useMemo(() => (
    question?.options.map((option) => ({
      ...option,
      count: showAnswers ? (revealedCounts[option.id] ?? 0) : 0,
    })) ?? []
  ), [question?.options, revealedCounts, showAnswers]);
  const displayedRecentTexts = useMemo(() => (
    showAnswers ? (question?.recentTexts ?? []).slice(0, revealedTextCount) : []
  ), [question?.recentTexts, revealedTextCount, showAnswers]);
  const displayedTotalResponses = showAnswers ? revealedTotalResponses : 0;
  const showQuestionQr = Boolean(question && !showAnswers);
  const hideHeaderChrome = projectorMode;
  const projectorHeaderQuestion = projectorMode ? question : null;
  const qrCodeUrl = joinUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=360x360&data=${encodeURIComponent(joinUrl)}`
    : '';

  useEffect(() => {
    if (!question || !showAnswers) {
      setRevealedCounts({});
      setRevealedTotalResponses(0);
      setRevealedTextCount(0);
      return undefined;
    }

    setRevealedCounts((current) => {
      const next: Record<string, number> = {};
      question.options.forEach((option) => {
        next[option.id] = Math.min(current[option.id] ?? 0, option.count);
      });
      return next;
    });
    setRevealedTotalResponses((current) => Math.min(current, question.totalResponses));
    setRevealedTextCount((current) => Math.min(current, question.recentTexts.length));

    const interval = window.setInterval(() => {
      setRevealedCounts((current) => {
        const next = { ...current };
        const target = question.options.find((option) => (next[option.id] ?? 0) < option.count);
        if (target) {
          next[target.id] = (next[target.id] ?? 0) + 1;
        }
        return next;
      });
      setRevealedTotalResponses((current) => Math.min(current + 1, question.totalResponses));
      setRevealedTextCount((current) => Math.min(current + textRevealStep, question.recentTexts.length));
    }, 180);

    return () => window.clearInterval(interval);
  }, [question, revealTargetSignature, showAnswers, textRevealStep]);

  return (
    <div
      ref={containerRef}
      className={`relative min-h-screen bg-gray-950 text-white flex flex-col transition-colors ${projectorMode ? 'projector-mode' : ''}`}
    >
      {!showQuestionQr && (
        <div
          className={`grid grid-cols-[minmax(190px,24vw)_minmax(0,1fr)_minmax(190px,24vw)] items-center gap-4 px-6 sm:px-8 border-b border-gray-800 transition-all duration-300 ${
            projectorHeaderQuestion ? 'min-h-[132px] py-4' : 'min-h-[72px] py-3'
          }`}
        >
          <div className="flex min-w-0 items-center gap-3 justify-self-start">
            {projectorHeaderQuestion && qrCodeUrl && (
              <div className="flex shrink-0 items-center gap-3">
                <div className="bg-white rounded-xl p-2 shadow-2xl">
                  <img
                    src={qrCodeUrl}
                    alt="填寫答案 QR Code"
                    className="w-[88px] h-[88px] object-contain"
                  />
                </div>
                <div className="hidden xl:block text-left">
                  <p className="text-xs uppercase tracking-[0.3em] text-green-300/80">填寫答案</p>
                </div>
              </div>
            )}
            <div className={`flex min-w-0 items-center gap-3 ${hideHeaderChrome ? 'opacity-0 pointer-events-none' : ''}`}>
              <span className="hidden xl:inline text-gray-400 text-sm font-medium">PreEvent Live</span>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 shrink-0 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
                <span className="truncate text-xs text-gray-500">{connected ? '即時連線中' : '連線中斷'}</span>
              </div>
            </div>
          </div>
          <div className="min-w-0 text-center overflow-hidden">
            {projectorHeaderQuestion ? (
              <h2 className="mx-auto max-w-[920px] text-2xl md:text-3xl font-semibold text-white leading-tight text-center">
                {projectorHeaderQuestion.title}
              </h2>
            ) : !question ? (
              <span className="text-sm text-gray-500">PreEvent Live</span>
            ) : null}
          </div>
          <div className="flex min-w-0 flex-col items-end gap-2 justify-self-end text-right">
            {projectorHeaderQuestion && (
              <div className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-green-300/80">
                <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                掃描 QR CODE 作答
              </div>
            )}
            <div className={`flex max-w-full items-center gap-3 ${hideHeaderChrome ? 'opacity-0 pointer-events-none' : ''}`}>
              <span className="truncate text-gray-500 text-xs font-mono">{sessionId}</span>
              {!projectorMode ? (
                <button
                  onClick={enterProjectorMode}
                  className="shrink-0 px-3 py-1.5 text-xs uppercase tracking-widest border border-white/20 rounded-full text-white/70 hover:text-white"
                >
                  投影模式
                </button>
              ) : (
                <button
                  onClick={exitProjectorMode}
                  className="shrink-0 px-3 py-1.5 text-xs uppercase tracking-widest border border-white/20 rounded-full text-white/70 hover:text-white"
                >
                  離開投影
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {showQuestionQr && (
        <div className={`absolute right-8 top-6 z-20 flex items-center gap-3 ${hideHeaderChrome ? 'opacity-0 pointer-events-none' : ''}`}>
          <span className="text-gray-500 text-xs font-mono">{sessionId}</span>
          {!projectorMode ? (
            <button
              onClick={enterProjectorMode}
              className="px-3 py-1.5 text-xs uppercase tracking-widest border border-white/20 rounded-full text-white/70 hover:text-white"
            >
              投影模式
            </button>
          ) : (
            <button
              onClick={exitProjectorMode}
              className="px-3 py-1.5 text-xs uppercase tracking-widest border border-white/20 rounded-full text-white/70 hover:text-white"
            >
              離開投影
            </button>
          )}
        </div>
      )}

      {/* Main content */}
      <div className={`flex-1 ${showAnswers && (isSpotlightScene || isWordCloudScene || isMapScene || isMapHudScene) ? 'relative overflow-hidden' : 'flex items-center justify-center px-8 py-12'}`}>
        {loading && (
          <div className="text-center text-gray-500">
            <div className="w-12 h-12 border-4 border-gray-700 border-t-indigo-500 rounded-full animate-spin mx-auto mb-4" />
            <p>連線中...</p>
          </div>
        )}

        {!loading && error && (
          <div className="text-center text-red-400">
            <p className="text-5xl mb-4">⚠️</p>
            <p className="text-xl font-medium">連線發生錯誤</p>
            <p className="text-sm text-red-500 mt-2">{error.message}</p>
            <p className="text-xs text-gray-600 mt-4">Firebase SDK 將自動重新連線</p>
          </div>
        )}

        {!loading && !error && !question && (
          <div className="text-center text-gray-200">
            <p className="text-4xl md:text-5xl font-bold text-white">待主持人開啟題目</p>
          </div>
        )}

        {!loading && !error && question && !showAnswers && (
          <div className="text-center text-gray-200">
            <p className="text-sm uppercase tracking-[0.35em] text-green-300/80 mb-5">開始作答</p>
            <h1 className="text-4xl md:text-6xl font-black text-white leading-tight max-w-5xl">
              {question.title}
            </h1>
            <p className="mt-5 text-lg text-gray-500">掃描 QR Code 填寫答案</p>
            <div className="mt-10 inline-flex flex-col items-center bg-white/5 border border-white/10 rounded-3xl p-6 shadow-lg">
              <div className="bg-white rounded-2xl p-4 shadow-2xl">
                <img
                  src={qrCodeUrl}
                  alt="填寫答案 QR Code"
                  className="w-[280px] h-[280px] md:w-[340px] md:h-[340px] object-contain"
                />
              </div>
            </div>
          </div>
        )}

        {!loading && !error && question && showAnswers && (
          isSpotlightScene ? (
            <div className="absolute inset-0">
              <SpotlightScene
                questionId={question.id}
                fallbackTexts={question.recentTexts}
                sloganText={question.spotlightSloganText}
                sloganVisible={question.spotlightSloganVisible}
              />
            </div>
          ) : isWordCloudScene ? (
            <div className="absolute inset-0">
              <MagicWordCloudScene
                texts={displayedRecentTexts}
                totalResponses={displayedTotalResponses}
                refreshIntervalSec={question.wordCloudRefreshIntervalSec}
                refreshPaused={question.wordCloudRefreshPaused}
                refreshNonce={question.wordCloudRefreshNonce}
              />
            </div>
          ) : isMapScene ? (
            <div className="absolute inset-0">
              <ThreeMapScene options={displayedOptions} />
            </div>
          ) : isMapHudScene ? (
            <div className="absolute inset-0">
              <ThreeMapSceneHUD options={displayedOptions} />
            </div>
          ) : (
            <div className="w-full max-w-4xl">
            {/* ── Results view: show chart / scene ── */}
            {question.type !== 'TEXT' ? (
              <div className="bg-gray-900 rounded-3xl p-8 border border-gray-800">
                {displayedTotalResponses === 0 ? (
                  <div className="text-center py-8 text-gray-600">
                    <p className="text-lg">等待第一份答案...</p>
                  </div>
                ) : (
                  <ResultChart
                    options={displayedOptions}
                    totalResponses={displayedTotalResponses}
                  />
                )}
              </div>
            ) : (
              <div className="bg-gray-900 rounded-3xl p-8 border border-gray-800">
                <TextAnswerWall
                  texts={displayedRecentTexts}
                  totalResponses={displayedTotalResponses}
                />
              </div>
            )}

            {/* Stats footer */}
            <div className="mt-4 text-center text-gray-600 text-sm">
              {question.type !== 'TEXT' ? (
                <p>
                  {question.type === 'SINGLE_CHOICE' ? '單選題' : '多選題'} · 共 {displayedTotalResponses} 人作答
                </p>
              ) : derivedScene !== 'spotlight' && (
                <p>文字題 · 共 {displayedTotalResponses} 人作答</p>
              )}
            </div>
          </div>
          )
        )}
      </div>
    </div>
  );
}
