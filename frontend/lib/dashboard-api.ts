import { authRequest } from "./auth";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VerificationListItem {
  verification_id: string;
  reference_id: string;
  document_type: string;
  status: string;
  score: number | null;
  decision: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface VerificationDetail extends VerificationListItem {
  extracted_fields: Record<string, string> | null;
  checks: Record<string, unknown> | null;
  locale: string;
  doc_front_url: string | null;
  doc_back_url: string | null;
  selfie_url: string | null;
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: string;
  plan: string;
  status: string;
  webhook_url: string | null;
  created_at: string;
}

export interface ApiKeyItem {
  id: string;
  name: string;
  environment: string;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

export interface ApiKeyCreated extends ApiKeyItem {
  raw_key: string;
}

export interface UserSettings {
  require_liveness: boolean;
  retention_days: number;
  score_approve_threshold: number | null;
  score_reject_threshold: number | null;
  allowed_doc_types: string[] | null;
  allowed_origins: string[] | null;
}

export interface AdminStats {
  total_verifications: number;
  total_users: number;
  by_status: Record<string, number>;
  approval_rate: number;
  avg_score: number | null;
}

export interface QueueItem {
  verification_id: string;
  reference_id: string;
  document_type: string;
  score: number | null;
  created_at: string;
  doc_front_url: string | null;
}

export interface AdminUserItem {
  id: string;
  name: string;
  email: string;
  role: string;
  plan: string;
  status: string;
  created_at: string;
}

// ── Verifications ─────────────────────────────────────────────────────────────

export const listVerifications = (
  token: string,
  params?: { status?: string; limit?: number; offset?: number; admin?: boolean }
) => {
  const p = new URLSearchParams();
  if (params?.status) p.set("status_filter", params.status);
  if (params?.limit) p.set("limit", String(params.limit));
  if (params?.offset) p.set("offset", String(params.offset));
  const base = params?.admin ? "/admin/verifications" : "/v1/verifications";
  return authRequest<VerificationListItem[]>(`${base}?${p}`, token);
};

export const getVerification = (
  token: string,
  id: string,
  admin?: boolean
) => {
  const base = admin ? `/admin/verify/${id}` : `/v1/verifications/${id}`;
  return authRequest<VerificationDetail>(base, token);
};

export const manualDecision = (
  token: string,
  id: string,
  decision: "approved" | "rejected",
  notes?: string
) =>
  authRequest(`/admin/verify/${id}/decision`, token, {
    method: "PATCH",
    body: JSON.stringify({ decision, notes }),
  });

// ── Review queue ──────────────────────────────────────────────────────────────

export const getQueue = (token: string, params?: { limit?: number; offset?: number }) => {
  const p = new URLSearchParams();
  if (params?.limit) p.set("limit", String(params.limit));
  if (params?.offset) p.set("offset", String(params.offset));
  return authRequest<{ items: QueueItem[]; total: number }>(`/admin/queue?${p}`, token);
};

// ── Profile ───────────────────────────────────────────────────────────────────

export const getMe = (token: string) =>
  authRequest<UserProfile>("/v1/me", token);

export const updateMe = (token: string, data: { name?: string; webhook_url?: string; webhook_secret?: string }) =>
  authRequest<UserProfile>("/v1/me", token, {
    method: "PATCH",
    body: JSON.stringify(data),
  });

export const changePassword = (token: string, data: { current_password: string; new_password: string }) =>
  authRequest<void>("/v1/me/password", token, {
    method: "PATCH",
    body: JSON.stringify(data),
  });

// ── API Keys ──────────────────────────────────────────────────────────────────

export const listKeys = (token: string) =>
  authRequest<ApiKeyItem[]>("/v1/keys", token);

export const createKey = (token: string, data: { name: string; environment: string }) =>
  authRequest<ApiKeyCreated>("/v1/keys", token, {
    method: "POST",
    body: JSON.stringify(data),
  });

export const revokeKey = (token: string, keyId: string) =>
  authRequest<void>(`/v1/keys/${keyId}`, token, { method: "DELETE" });

// ── Settings ──────────────────────────────────────────────────────────────────

export const getSettings = (token: string) =>
  authRequest<UserSettings>("/v1/settings", token);

export const updateSettings = (token: string, data: Partial<UserSettings>) =>
  authRequest<UserSettings>("/v1/settings", token, {
    method: "PATCH",
    body: JSON.stringify(data),
  });

// ── Admin stats ───────────────────────────────────────────────────────────────

export const getAdminStats = (token: string) =>
  authRequest<AdminStats>("/admin/stats", token);

// ── Admin users ───────────────────────────────────────────────────────────────

export const listUsers = (token: string, params?: { status?: string; limit?: number }) => {
  const p = new URLSearchParams();
  if (params?.status) p.set("status_filter", params.status);
  if (params?.limit) p.set("limit", String(params.limit));
  return authRequest<AdminUserItem[]>(`/admin/users?${p}`, token);
};
