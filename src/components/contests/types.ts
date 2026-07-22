export type ContestVisibility = "INVITE_ONLY" | "OPEN";
export type ContestStatus = "DRAFT" | "SCHEDULED" | "LIVE" | "ENDED" | "ARCHIVED";

export interface ContestListItem {
  id: string;
  title: string;
  visibility: ContestVisibility;
  status: ContestStatus;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  createdAt: string;
  questionCount: number;
  participantCount: number;
}

export interface ContestListResponse {
  contests: ContestListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ContestQuestionRow {
  id: string;
  order: number;
  pointsOverride: string | null;
  hardLockSecondsOverride: number | null;
  sectionLabel: string | null;
  question: { id: string; type: string; title: string; defaultPoints: string };
}

export interface ContestDetail {
  id: string;
  title: string;
  description: string | null;
  instructions: string | null;
  visibility: ContestVisibility;
  status: ContestStatus;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  resultsVisibleToParticipants: boolean;
  contestQuestions: ContestQuestionRow[];
  _count: { participants: number };
  locked: boolean;
}

export interface RosterEntry {
  id: string;
  status: string;
  invitedAt: string;
  user: { id: string; username: string; fullName: string | null; email: string | null };
}

export interface LeaderboardRow {
  contestParticipantId: string;
  rank: number;
  user: { id: string; username: string; fullName: string | null };
  status: string;
  totalScore: number;
  tieBreakExecutionTimeMs: number | null;
  contestSubmittedAt: string | null;
}

export interface DrilldownTestCaseResult {
  testCaseId: string;
  isSample: boolean;
  passed: boolean;
  actualOutput: string;
  executionTimeMs: number;
  timedOut: boolean;
  error: string | null;
}

export interface DrilldownQuestion {
  contestQuestionId: string;
  order: number;
  sectionLabel: string | null;
  question: {
    id: string;
    type: "MCQ" | "TEXT" | "CODING";
    title: string;
    body: string;
    options: { id: string; text: string; score: number; isCorrect: boolean }[];
    correctAnswer: string | null;
  };
  submit: {
    status: string;
    language: string | null;
    code: string | null;
    testCaseResults: DrilldownTestCaseResult[] | null;
    totalExecutionTimeMs: number | null;
    selectedOptionIds: string[];
    textAnswer: string | null;
    score: number | null;
    maxPossibleScore: number | null;
    submittedAt: string | null;
  } | null;
  run: {
    status: string;
    language: string | null;
    code: string | null;
    testCaseResults: DrilldownTestCaseResult[] | null;
    totalExecutionTimeMs: number | null;
  } | null;
}

export interface DrilldownProctoringEvent {
  id: string;
  eventType: string;
  occurredAt: string;
  cumulativeCountAtEvent: number;
  actionTaken: string;
  metadata: unknown;
}

export interface ParticipantDrilldown {
  participant: {
    id: string;
    status: string;
    totalScore: number;
    tieBreakExecutionTimeMs: number | null;
    contestStartedAt: string | null;
    contestSubmittedAt: string | null;
    autoSubmittedReason: string | null;
    user: { id: string; username: string; fullName: string | null; email: string | null };
  };
  questions: DrilldownQuestion[];
  proctoringEvents: DrilldownProctoringEvent[];
}
