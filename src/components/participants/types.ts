export interface Participant {
  id: string;
  username: string;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  isActive: boolean;
  createdAt: string;
  contestCount: number;
}

export interface ListResponse {
  participants: Participant[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface IssuedCredential {
  username: string;
  password: string;
}

export interface ImportResult {
  summary: { totalRows: number; created: number; skipped: number };
  created: { row: number; username: string; fullName: string | null; email: string | null }[];
  skipped: { row: number; username?: string; reason: string }[];
}
