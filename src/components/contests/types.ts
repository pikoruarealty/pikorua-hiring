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
