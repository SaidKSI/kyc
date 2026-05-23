const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export interface AuthUser {
  user_id: string;
  name: string;
  role: "user" | "admin";
  access_token: string;
}

const STORAGE_KEY = "kyc_auth";

export function getStoredAuth(): AuthUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

export function storeAuth(user: AuthUser) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
}

export function clearAuth() {
  localStorage.removeItem(STORAGE_KEY);
}

export async function apiLogin(
  email: string,
  password: string
): Promise<AuthUser> {
  const res = await fetch(`${BASE_URL}/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? "Login failed");
  }
  const data = await res.json();
  return {
    user_id: data.user_id,
    name: data.name,
    role: data.role,
    access_token: data.access_token,
  };
}

export async function apiLogout(token: string): Promise<void> {
  await fetch(`${BASE_URL}/v1/auth/logout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => {});
}

// ── Authenticated fetch helper ────────────────────────────────────────────────

export async function authRequest<T>(
  path: string,
  token: string,
  options?: RequestInit
): Promise<T> {
  const { headers: extra, ...rest } = options ?? {};
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(extra as Record<string, string>),
    },
    ...rest,
  });

  if (res.status === 401) {
    clearAuth();
    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }
    throw new Error("Unauthorized");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
