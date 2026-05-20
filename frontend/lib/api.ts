import type {
  CreateVerificationRequest,
  CreateVerificationResponse,
  VerificationStatusResponse,
} from "./verification";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function request<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function createVerification(
  data: CreateVerificationRequest,
  apiKey: string
): Promise<CreateVerificationResponse> {
  return request("/v1/verify", {
    method: "POST",
    headers: { "X-API-Key": apiKey },
    body: JSON.stringify(data),
  });
}

export async function uploadDocument(
  verificationId: string,
  slot: "doc_front" | "doc_back" | "selfie",
  file: File,
  apiKey: string
): Promise<void> {
  const form = new FormData();
  form.append("slot", slot);
  form.append("file", file);
  const res = await fetch(
    `${BASE_URL}/v1/verify/${verificationId}/upload`,
    {
      method: "POST",
      headers: { "X-API-Key": apiKey },
      body: form,
    }
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `Upload failed HTTP ${res.status}`);
  }
}

export async function submitVerification(
  verificationId: string,
  apiKey: string
): Promise<{ status: string; estimated_seconds: number }> {
  return request(`/v1/verify/${verificationId}/submit`, {
    method: "POST",
    headers: { "X-API-Key": apiKey },
  });
}

export async function getVerificationStatus(
  verificationId: string,
  apiKey: string
): Promise<VerificationStatusResponse> {
  return request(`/v1/verify/${verificationId}/status`, {
    headers: { "X-API-Key": apiKey },
  });
}

export function streamVerificationProgress(
  verificationId: string,
  apiKey: string,
  onEvent: (data: unknown) => void,
  onError?: (err: Event) => void
): EventSource {
  const url = `${BASE_URL}/v1/verify/${verificationId}/stream?api_key=${encodeURIComponent(apiKey)}`;
  const es = new EventSource(url);
  es.onmessage = (e) => {
    try {
      onEvent(JSON.parse(e.data));
    } catch {
      onEvent(e.data);
    }
  };
  if (onError) es.onerror = onError;
  return es;
}
