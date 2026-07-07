import { useRef, useState } from 'react';
import type { Question } from '../types';

interface Props {
  question: Question;
  onSubmit: (answer: {
    optionId?: string;
    optionIds?: string[];
    textValue?: string;
  }) => Promise<void>;
  disabled?: boolean;
}

export function AnswerForm({ question, onSubmit, disabled = false }: Props) {
  const [selectedOption, setSelectedOption] = useState<string>('');
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [textValue, setTextValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitLockRef = useRef(false);

  function toggleMultiOption(optionId: string) {
    setSelectedOptions((prev) =>
      prev.includes(optionId) ? prev.filter((id) => id !== optionId) : [...prev, optionId],
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitLockRef.current) return;

    setError(null);

    if (question.type === 'SINGLE_CHOICE' && !selectedOption) {
      setError('請選擇一個選項');
      return;
    }
    if (question.type === 'MULTI_CHOICE' && selectedOptions.length === 0) {
      setError('請至少選擇一個選項');
      return;
    }
    if (question.type === 'TEXT' && !textValue.trim()) {
      setError('請填寫答案');
      return;
    }

    submitLockRef.current = true;
    setSubmitting(true);
    try {
      if (question.type === 'SINGLE_CHOICE') {
        await onSubmit({ optionId: selectedOption });
      } else if (question.type === 'MULTI_CHOICE') {
        await onSubmit({ optionIds: selectedOptions });
      } else {
        await onSubmit({ textValue: textValue.trim() });
      }
    } catch (err) {
      if (err instanceof Error && err.message === 'Too many requests, please try again later.') {
        console.log('Too many requests, please try again later.');
      }
      setError(err instanceof Error ? err.message : '送出失敗，請重試');
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  }

  const isDisabled = disabled || submitting;

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {question.type === 'SINGLE_CHOICE' && (
        <div className="space-y-2">
          {question.options.map((opt) => (
            <label
              key={opt.id}
              className={`flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all
                ${selectedOption === opt.id
                  ? 'border-indigo-500 bg-indigo-50'
                  : 'border-gray-200 bg-white hover:border-indigo-300'
                }
                ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}
              `}
            >
              <input
                type="radio"
                name="option"
                value={opt.id}
                checked={selectedOption === opt.id}
                onChange={() => setSelectedOption(opt.id)}
                disabled={isDisabled}
                className="sr-only"
              />
              <span
                className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center
                  ${selectedOption === opt.id ? 'border-indigo-500' : 'border-gray-300'}`}
              >
                {selectedOption === opt.id && (
                  <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
                )}
              </span>
              <span className="text-gray-800 font-medium">{opt.label}</span>
            </label>
          ))}
        </div>
      )}

      {question.type === 'MULTI_CHOICE' && (
        <div className="space-y-2">
          {question.options.map((opt) => {
            const checked = selectedOptions.includes(opt.id);
            return (
              <label
                key={opt.id}
                className={`flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all
                  ${checked ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 bg-white hover:border-indigo-300'}
                  ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}
                `}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleMultiOption(opt.id)}
                  disabled={isDisabled}
                  className="sr-only"
                />
                <span
                  className={`w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center
                    ${checked ? 'border-indigo-500 bg-indigo-500' : 'border-gray-300'}`}
                >
                  {checked && (
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </span>
                <span className="text-gray-800 font-medium">{opt.label}</span>
              </label>
            );
          })}
        </div>
      )}

      {question.type === 'TEXT' && (
        <textarea
          value={textValue}
          onChange={(e) => setTextValue(e.target.value)}
          disabled={isDisabled}
          placeholder="請輸入您的答案..."
          rows={4}
          maxLength={1000}
          className="w-full p-3 border-2 border-gray-200 rounded-xl resize-none focus:outline-none focus:border-indigo-500 transition-colors disabled:opacity-50"
        />
      )}

      {error && (
        <p className="text-red-500 text-sm">{error}</p>
      )}

      <button
        type="submit"
        disabled={isDisabled}
        className="w-full py-3 px-6 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-semibold rounded-xl transition-colors"
      >
        {submitting ? '送出中...' : '送出答案'}
      </button>
    </form>
  );
}
