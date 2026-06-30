export type QuestionType = 'SINGLE_CHOICE' | 'MULTI_CHOICE' | 'TEXT';
export type QuestionStatus = 'DRAFT' | 'OPEN' | 'CLOSED';

export type DisplayScene = 'default' | 'map3d' | 'map3d-hud' | 'text-wall' | 'spotlight' | 'word-cloud';

export interface QuestionOption {
  id: string;
  label: string;
  count: number;
}

export interface Question {
  questionId: string;
  type: QuestionType;
  title: string;
  status: QuestionStatus;
  order: number;
  options: QuestionOption[];
  totalResponses: number;
  displayScene?: DisplayScene;
  displayMode?: 'question' | 'results';
}

export interface Session {
  sessionId: string;
  name: string;
}

export interface LiveQuestion {
  id: string;
  type: QuestionType;
  title: string;
  status: QuestionStatus;
  options: QuestionOption[];
  totalResponses: number;
  recentTexts: string[];
  displayScene?: DisplayScene;
  displayMode: 'question' | 'results';
}
