export type DocumentType =
  | "national_id"
  | "passport"
  | "residence_permit"
  | "drivers_license";

export type VerificationStatus =
  | "pending"
  | "processing"
  | "approved"
  | "rejected"
  | "review"
  | "error";

export type FaceMatchConfidence = "high" | "low" | "none";

export interface CreateVerificationRequest {
  reference_id: string;
  document_type: DocumentType;
  locale?: string;
  redirect_url?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateVerificationResponse {
  verification_id: string;
  session_token: string;
  verify_url: string;
  upload_endpoint: string;
  upload_urls: Record<string, string> | null;
  expires_at: string;
}

export interface VerificationStatusResponse {
  verification_id: string;
  status: VerificationStatus;
  score: number | null;
  decision: string | null;
  extracted_fields: Record<string, string> | null;
  checks: Record<string, unknown> | null;
  completed_at: string | null;
}

export interface SSEProgressEvent {
  step: "doc_auth" | "ocr" | "face_match" | "liveness" | "scoring" | "done";
  status: "running" | "complete" | "failed";
  message?: string;
}

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  national_id: "National ID (CIN)",
  passport: "Passport",
  residence_permit: "Residence Permit",
  drivers_license: "Driver's License",
};

export const DOCUMENT_REQUIRES_BACK: Record<DocumentType, boolean> = {
  national_id: true,
  passport: false,
  residence_permit: true,
  drivers_license: true,
};

export interface SessionInfoResponse {
  verification_id: string;
  document_type: DocumentType;
  locale: string;
  status: VerificationStatus;
  require_selfie: boolean;
  redirect_url: string | null;
  expires_at: string | null;
}

export interface SubmitResponse {
  verification_id: string;
  status: string;
  estimated_seconds: number;
}
