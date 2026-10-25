// Thin fetch wrapper. All AI calls go through the backend; no secrets ever reach the browser.

export class ApiError extends Error {
  status: number;
  code?: string;
  retryable?: boolean;
  constructor(status: number, message: string, code?: string, retryable?: boolean) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

async function request<T>(method: string, path: string, body?: unknown, isForm = false): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body && !isForm ? { "Content-Type": "application/json" } : undefined,
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Cannot reach the local server. Is the app running (./start.sh)?", "offline");
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const d = data?.detail;
    if (d && typeof d === "object" && !Array.isArray(d)) throw new ApiError(res.status, d.message ?? "Request failed", d.code, d.retryable);
    if (Array.isArray(d)) throw new ApiError(res.status, d.map((x: any) => `${x.loc?.slice(-1)[0]}: ${x.msg}`).join("; "));
    throw new ApiError(res.status, typeof d === "string" ? d : `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  get: <T = any>(p: string) => request<T>("GET", p),
  post: <T = any>(p: string, b?: unknown) => request<T>("POST", p, b ?? {}),
  put: <T = any>(p: string, b?: unknown) => request<T>("PUT", p, b ?? {}),
  patch: <T = any>(p: string, b?: unknown) => request<T>("PATCH", p, b ?? {}),
  del: <T = any>(p: string) => request<T>("DELETE", p),
  form: <T = any>(p: string, f: FormData) => request<T>("POST", p, f, true),
};

export function qs(params: Record<string, string | number | boolean | undefined | null>) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : "";
}
