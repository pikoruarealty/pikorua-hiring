export type QuestionType = "MCQ" | "TEXT" | "CODING";
export type QuestionDifficulty = "EASY" | "MEDIUM" | "HARD";

export interface QuestionListItem {
  id: string;
  type: QuestionType;
  title: string;
  difficulty: QuestionDifficulty | null;
  tags: string[];
  defaultPoints: string;
  isArchived: boolean;
  createdAt: string;
  contestCount: number;
}

export interface QuestionListResponse {
  questions: QuestionListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface OptionRow {
  id?: string;
  text: string;
  score: number;
  order: number;
  isCorrect: boolean;
}

export interface TestCaseRow {
  id?: string;
  input: string;
  expectedOutput: string;
  isSample: boolean;
  score: number;
  order: number;
}

export interface CodingConfigForm {
  timeLimitSeconds: number;
  memoryLimitMb: number;
  allowedLanguages: string[];
  defaultHardLockSeconds?: number;
}

export interface QuestionDetail {
  id: string;
  type: QuestionType;
  title: string;
  body: string;
  difficulty: QuestionDifficulty | null;
  tags: string[];
  defaultPoints: string;
  isArchived: boolean;
  allowMultipleAnswers: boolean;
  options: OptionRow[];
  textAnswerConfig: { correctAnswer: string } | null;
  codingConfig:
    | (CodingConfigForm & { id: string; testCases: TestCaseRow[] })
    | null;
  _count: { contestQuestions: number };
}
