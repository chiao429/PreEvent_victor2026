import { useEffect, useState } from 'react';
import type { DisplayScene, QuestionType } from '../types';

interface Props {
  onSubmit: (data: { type: QuestionType; title: string; options?: string[]; displayScene: DisplayScene }) => Promise<void>;
  onCancel: () => void;
}

const TYPE_LABELS: Record<QuestionType, string> = {
  SINGLE_CHOICE: '單選題',
  MULTI_CHOICE: '多選題',
  TEXT: '文字題',
};

const SCENE_OPTIONS: Record<QuestionType, { value: DisplayScene; label: string; description: string }[]> = {
  SINGLE_CHOICE: [
    { value: 'default', label: '標準長條圖', description: '以數據視覺呈現結果，適合一般 poll' },
    { value: 'map3d-hud', label: '3D 地圖 HUD', description: '衛星 HUD 科技風格，適合戰術/科技氛圍' },
  ],
  MULTI_CHOICE: [
    { value: 'default', label: '標準長條圖', description: '顯示多選統計，支援複選' },
    { value: 'map3d-hud', label: '3D 地圖 HUD', description: '衛星 HUD 科技風格，適合戰術/科技氛圍' },
  ],
  TEXT: [
    { value: 'text-wall', label: '文字牆', description: '瀑布式卡片顯示文字答案' },
    { value: 'spotlight', label: '聚光燈文字', description: '舞台聚光燈＋滿版教會名稱文字雲' },
    { value: 'word-cloud', label: '魔幻星空 Word Cloud', description: '深夜星空中以金白發光文字呈現美好特質' },
  ],
};

const TYPE_SELECTED_CLASS: Record<QuestionType, string> = {
  SINGLE_CHOICE: 'border-[#2563EB] bg-[#2563EB] text-white shadow-sm',
  MULTI_CHOICE: 'border-[#7C3AED] bg-[#7C3AED] text-white shadow-sm',
  TEXT: 'border-[#0F766E] bg-[#0F766E] text-white shadow-sm',
};

export function QuestionEditor({ onSubmit, onCancel }: Props) {
  const [type, setType] = useState<QuestionType>('SINGLE_CHOICE');
  const [title, setTitle] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [displayScene, setDisplayScene] = useState<DisplayScene>(SCENE_OPTIONS['SINGLE_CHOICE'][0].value);

  useEffect(() => {
    setDisplayScene((prev) => {
      const allowed = SCENE_OPTIONS[type].map((opt) => opt.value);
      return allowed.includes(prev) ? prev : SCENE_OPTIONS[type][0].value;
    });
  }, [type]);

  function addOption() {
    setOptions((prev) => [...prev, '']);
  }

  function removeOption(index: number) {
    setOptions((prev) => prev.filter((_, i) => i !== index));
  }

  function updateOption(index: number, value: string) {
    setOptions((prev) => prev.map((opt, i) => (i === index ? value : opt)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError('請輸入題目標題');
      return;
    }

    if (type !== 'TEXT') {
      const validOptions = options.filter((o) => o.trim());
      if (validOptions.length < 2) {
        setError('選擇題至少需要 2 個選項');
        return;
      }
    }

    setSubmitting(true);
    try {
      const payload =
        type !== 'TEXT'
          ? { type, title: title.trim(), options: options.filter((o) => o.trim()), displayScene }
          : { type, title: title.trim(), displayScene };
      await onSubmit(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : '建立失敗，請重試');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <h3 className="mb-4 text-lg font-semibold text-gray-950">新增題目</h3>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Type selector */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">題目類型</label>
          <div className="flex gap-2">
            {(Object.keys(TYPE_LABELS) as QuestionType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-colors
                  ${type === t
                    ? TYPE_SELECTED_CLASS[t]
                    : 'border-gray-200 bg-white text-gray-600 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700'
                  }`}
              >
                {TYPE_LABELS[t]}
              </button>
            ))}
          </div>
        </div>

        {/* Scene selection */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">投影場景</label>
          <div className="grid gap-3 md:grid-cols-2">
            {SCENE_OPTIONS[type].map((scene) => (
              <button
                type="button"
                key={scene.value}
                onClick={() => setDisplayScene(scene.value)}
                className={`text-left rounded-2xl border p-3 transition-all ${
                  displayScene === scene.value
                    ? 'border-[#4F46E5] bg-indigo-50 shadow-sm ring-1 ring-indigo-100'
                    : 'border-gray-200 bg-white hover:border-indigo-200 hover:bg-indigo-50/60'
                }`}
              >
                <p className={`font-semibold ${displayScene === scene.value ? 'text-[#4338CA]' : 'text-gray-950'}`}>
                  {scene.label}
                </p>
                <p className="text-xs text-gray-500 mt-1 leading-relaxed">{scene.description}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Title */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">題目標題</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="請輸入題目..."
            maxLength={500}
            className="w-full rounded-md border border-gray-200 px-3 py-2 transition-colors focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-100"
          />
        </div>

        {/* Options */}
        {type !== 'TEXT' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">選項</label>
            <div className="space-y-2">
              {options.map((opt, idx) => (
                <div key={idx} className="flex gap-2">
                  <input
                    type="text"
                    value={opt}
                    onChange={(e) => updateOption(idx, e.target.value)}
                    placeholder={`選項 ${idx + 1}`}
                    maxLength={200}
                    className="flex-1 rounded-md border border-gray-200 px-3 py-2 transition-colors focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-100"
                  />
                  {options.length > 2 && (
                    <button
                      type="button"
                      onClick={() => removeOption(idx)}
                      className="px-3 py-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={addOption}
                className="text-sm font-medium text-[#4F46E5] hover:text-[#4338CA]"
              >
                + 新增選項
              </button>
            </div>
          </div>
        )}

        {error && <p className="text-red-500 text-sm">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="flex-1 rounded-md border border-gray-200 px-4 py-2 font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 rounded-md bg-[#4F46E5] px-4 py-2 font-semibold text-white transition-colors hover:bg-[#4338CA] disabled:bg-indigo-300"
          >
            {submitting ? '建立中...' : '建立題目'}
          </button>
        </div>
      </form>
    </div>
  );
}
