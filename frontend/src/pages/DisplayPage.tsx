import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useLiveQuestion } from '../hooks/useLiveQuestion';
import { ResultChart } from '../components/ResultChart';
import { TextAnswerWall } from '../components/TextAnswerWall';
import { ThreeMapScene } from '../components/ThreeMapScene';
import { ThreeMapSceneHUD } from '../components/ThreeMapSceneHUD';
import { SpotlightScene } from '../components/SpotlightScene';
import { MagicWordCloudScene } from '../components/MagicWordCloudScene';
import { useSessionControl } from '../hooks/useSessionControl';

export function DisplayPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [searchParams] = useSearchParams();
  const { question, loading, error, connected } = useLiveQuestion(sessionId ?? '');
  const {
    resultsQrEnabled,
    resultsQrRefreshEnabled,
    resultsQrRefreshIntervalSec,
  } = useSessionControl(sessionId ?? '');
  const [projectorMode, setProjectorMode] = useState(searchParams.get('mode') === 'projector');
  const [resultsQrVisible, setResultsQrVisible] = useState(true);
  const [resultsQrRefreshNonce, setResultsQrRefreshNonce] = useState(0);
  const [revealedCounts, setRevealedCounts] = useState<Record<string, number>>({});
  const [revealedTotalResponses, setRevealedTotalResponses] = useState(0);
  const [revealedTextCount, setRevealedTextCount] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const revealTargetsRef = useRef({
    optionCounts: {} as Record<string, number>,
    totalResponses: 0,
    recentTextCount: 0,
  });
  const latestOptionsRef = useRef(question?.options ?? []);
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
  const showResultsQr = Boolean(showAnswers && resultsQrEnabled);
  const hideHeaderChrome = projectorMode;
  const projectorHeaderQuestion = projectorMode ? question : null;
  const qrCodeUrl = joinUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=1000x1000&data=${encodeURIComponent(joinUrl)}${showResultsQr && resultsQrRefreshEnabled ? `&cb=${resultsQrRefreshNonce}` : ''}`
    : '';

  useEffect(() => {
    if (!showResultsQr || !resultsQrRefreshEnabled) {
      setResultsQrVisible(true);
      setResultsQrRefreshNonce(0);
      return undefined;
    }

    const intervalMs = Math.max(1, resultsQrRefreshIntervalSec) * 1000;
    const interval = window.setInterval(() => {
      setResultsQrVisible((currentVisible) => {
        const nextVisible = !currentVisible;
        if (nextVisible) {
          setResultsQrRefreshNonce((current) => current + 1);
        }
        return nextVisible;
      });
    }, intervalMs);

    return () => {
      window.clearInterval(interval);
    };
  }, [resultsQrRefreshEnabled, resultsQrRefreshIntervalSec, showResultsQr]);

  useEffect(() => {
    if (!question || !showAnswers) {
      revealTargetsRef.current = {
        optionCounts: {},
        totalResponses: 0,
        recentTextCount: 0,
      };
      latestOptionsRef.current = [];
      setRevealedCounts({});
      setRevealedTotalResponses(0);
      setRevealedTextCount(0);
      return;
    }

    latestOptionsRef.current = question.options;
    revealTargetsRef.current = {
      optionCounts: Object.fromEntries(question.options.map((option) => [option.id, option.count])),
      totalResponses: question.totalResponses,
      recentTextCount: question.recentTexts.length,
    };

    setRevealedCounts((current) => {
      const next: Record<string, number> = {};
      question.options.forEach((option) => {
        next[option.id] = Math.min(current[option.id] ?? 0, option.count);
      });
      return next;
    });
    setRevealedTotalResponses((current) => Math.min(current, question.totalResponses));
    setRevealedTextCount((current) => Math.min(current, question.recentTexts.length));
  }, [question, showAnswers]);

  useEffect(() => {
    if (!question || !showAnswers) return undefined;

    const interval = window.setInterval(() => {
      const targets = revealTargetsRef.current;
      const currentOptions = latestOptionsRef.current;

      setRevealedCounts((current) => {
        const next = { ...current };
        const target = currentOptions.find((option) => (next[option.id] ?? 0) < (targets.optionCounts[option.id] ?? 0));
        if (target) {
          next[target.id] = (next[target.id] ?? 0) + 1;
        }
        return next;
      });
      setRevealedTotalResponses((current) => Math.min(current + 1, targets.totalResponses));
      setRevealedTextCount((current) => Math.min(current + textRevealStep, targets.recentTextCount));
    }, 180);

    return () => window.clearInterval(interval);
  }, [question?.id, showAnswers, textRevealStep]);

  return (
    <div
      ref={containerRef}
      className={`relative min-h-screen bg-gray-950 text-white flex flex-col transition-colors ${projectorMode ? 'projector-mode' : ''}`}
    >
      {!showQuestionQr && (
        <div
          className={`grid grid-cols-[minmax(190px,24vw)_minmax(0,1fr)_minmax(190px,24vw)] items-center gap-4 px-6 sm:px-8 border-b border-gray-800 transition-all duration-300 ${
            projectorHeaderQuestion ? 'min-h-[116px] py-3' : 'min-h-[72px] py-3'
          }`}
        >
          <div className="flex min-w-0 items-center gap-3 justify-self-start">
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
              <h2 className="mx-auto max-w-[1100px] text-[clamp(2.5rem,4.2vw,5rem)] font-black leading-[1.02] text-white text-center">
                {projectorHeaderQuestion.title}
              </h2>
            ) : !question ? (
              <span className="text-sm text-gray-500">PreEvent Live</span>
            ) : null}
          </div>
          <div className="flex min-w-0 flex-col items-end gap-2 justify-self-end text-right">
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
      {showResultsQr && qrCodeUrl && (
        <div
          aria-hidden={!resultsQrVisible}
          className={`fixed bottom-6 right-6 z-50 rounded-xl bg-white p-2 transition-[opacity,transform] duration-700 ease-in-out ${
            resultsQrVisible ? 'opacity-100 scale-100' : 'pointer-events-none opacity-0 scale-95'
          }`}
        >
          <img
            src={qrCodeUrl}
            alt="填寫答案 QR Code"
            className="w-[min(12vw,176px)] h-[min(12vw,176px)] object-contain"
          />
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
          <div className="flex w-[86vw] max-w-[1700px] flex-col items-center text-center text-gray-200">
            <p className="mb-6 text-3xl font-bold uppercase tracking-[0.34em] text-green-300/85 md:text-5xl">開始作答</p>
            <h1 className="max-w-[88vw] text-[clamp(4rem,8.5vw,10rem)] font-black leading-[0.98] text-white">
              {question.title}
            </h1>
            <p className="mt-7 text-5xl font-bold text-gray-300 md:text-7xl">掃描 QR Code 填寫答案</p>
            <div className="mt-8 inline-flex flex-col items-center rounded-[2rem] border border-white/10 bg-white/5 p-4 shadow-lg md:p-5">
              <div className="rounded-[1.5rem] bg-white p-4 shadow-2xl">
                <img
                  src={qrCodeUrl}
                  alt="填寫答案 QR Code"
                  className="h-[min(54vw,42vh)] w-[min(54vw,42vh)] object-contain"
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
