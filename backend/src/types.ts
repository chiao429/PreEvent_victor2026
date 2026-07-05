export type QuestionType = 'SINGLE_CHOICE' | 'MULTI_CHOICE' | 'TEXT';
export type QuestionStatus = 'DRAFT' | 'OPEN' | 'CLOSED';

export type DisplayScene = 'default' | 'map3d' | 'map3d-hud' | 'text-wall' | 'spotlight' | 'word-cloud';

export interface QuestionOption {
  id: string;
  label: string;
}

export interface QuestionDocument {
  type: QuestionType;
  title: string;
  status: QuestionStatus;
  order: number;
  options: QuestionOption[];
  optionCounts: Record<string, number>;
  totalResponses: number;
  displayScene?: DisplayScene;
}

export interface AnswerDocument {
  optionId?: string;
  optionIds?: string[];
  textValue?: string;
}

export interface SessionDocument {
  name: string;
  hostToken: string;
  displayMode?: 'question' | 'results';
  resultsQrEnabled?: boolean;
  resultsQrRefreshEnabled?: boolean;
  resultsQrRefreshIntervalSec?: number;
}
