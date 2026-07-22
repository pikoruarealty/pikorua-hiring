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
    options: { id: string; text: string }[];
    coding: {
      timeLimitSeconds: number;
      memoryLimitMb: number;
      allowedLanguages: string[];
    } | null;
  };
}

export interface AnswerState {
  selectedOptionIds: string[];
  textAnswer: string | null;
  visited: boolean;
  markedForReview: boolean;
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
  };
  participant: { status: string; contestStartedAt: string | null } | null;
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
  return a.selectedOptionIds.length > 0 || !!a.textAnswer?.trim();
}

export function paletteStatus(a: AnswerState | undefined): PaletteStatus {
  if (!a?.visited) return "NOT_VISITED";
  const answered = hasAnswer(a);
  if (a.markedForReview) return answered ? "ANSWERED_MARKED" : "MARKED";
  return answered ? "ANSWERED" : "NOT_ANSWERED";
}
