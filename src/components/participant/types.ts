export type ContestPhase = "UPCOMING" | "ACTIVE" | "ENDED";

export interface ContestListItem {
  id: string;
  title: string;
  description: string | null;
  visibility: "INVITE_ONLY" | "OPEN";
  startAt: string;
  endAt: string;
  durationMinutes: number;
  phase: ContestPhase;
  participantStatus: string | null;
}

export interface ParticipantQuestion {
  id: string; // contestQuestionId
  order: number;
  sectionLabel: string | null;
  points: number;
  question: {
    id: string;
    type: "MCQ" | "TEXT" | "CODING";
    title: string;
    body: string;
    allowMultipleAnswers: boolean;
    options: { id: string; text: string }[];
    coding: {
      timeLimitSeconds: number;
      memoryLimitMb: number;
      allowedLanguages: string[];
      starterCode: Record<string, string> | null;
      sampleTestCases: { id: string; input: string; expectedOutput: string }[];
      hardLockSeconds: number | null;
      hardLockDeadline: string | null;
      questionStartedAt: string | null;
    } | null;
  };
}

export type TestCaseResultView = {
  testCaseId: string;
  isSample: boolean;
  passed: boolean;
  executionTimeMs: number;
  timedOut: boolean;
  actualOutput?: string;
  error?: string | null;
};

export interface CodingRunState {
  language: string;
  code: string | null;
  status: string;
  totalExecutionTimeMs: number | null;
  results: TestCaseResultView[];
}

export interface CodingSubmitState extends CodingRunState {
  score: number | null;
  maxScore: number | null;
}

export interface AnswerState {
  selectedOptionIds: string[];
  textAnswer: string | null;
  visited: boolean;
  markedForReview: boolean;
  questionStartedAt?: string | null;
  coding?: { 
    run: CodingRunState | null; 
    submit: CodingSubmitState | null;
    localCode?: string;
  } | null;
}

export interface ContestStateResponse {
  contest: {
    id: string;
    title: string;
    description: string | null;
    instructions: string | null;
    visibility: "INVITE_ONLY" | "OPEN";
    startAt: string;
    endAt: string;
    durationMinutes: number;
    phase: ContestPhase;
    resultsVisibleToParticipants: boolean;
  };
  participant: {
    status: string;
    contestStartedAt: string | null;
    totalScore?: number | null;
  } | null;
  questions: ParticipantQuestion[] | null;
  answers: Record<string, AnswerState> | null;
  remainingSeconds: number | null;
}

export type PaletteStatus =
  | "NOT_VISITED"
  | "NOT_ANSWERED"
  | "ANSWERED"
  | "MARKED"
  | "ANSWERED_MARKED";

export function hasAnswer(a: AnswerState | undefined): boolean {
  if (!a) return false;
  return (
    a.selectedOptionIds.length > 0 ||
    !!a.textAnswer?.trim() ||
    !!a.coding?.submit?.code?.trim()
  );
}

export function paletteStatus(a: AnswerState | undefined): PaletteStatus {
  if (!a?.visited) return "NOT_VISITED";
  const answered = hasAnswer(a);
  if (a.markedForReview) return answered ? "ANSWERED_MARKED" : "MARKED";
  return answered ? "ANSWERED" : "NOT_ANSWERED";
}
