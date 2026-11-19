import { auth } from "./auth.ts";

const BASE = (import.meta.env.VITE_API_URL as string | undefined) || "/api/v1";
const TENANT_KEY = "office.tenant";

export const tenantStore = {
  get: (): string | null => { try { return localStorage.getItem(TENANT_KEY); } catch { return null; } },
  set: (id: string | null) => { try { if (id) localStorage.setItem(TENANT_KEY, id); else localStorage.removeItem(TENANT_KEY); } catch { /* ignore */ } },
};

/** RFC 9457 problem from the API. */
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}

async function request(path: string, init: { method?: string; body?: unknown; tenant?: boolean }) {
  const token = await auth.token();
  if (!token) { await auth.login(); throw new ApiError(401, "unauthorized", "Signing in…"); }
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  const tenant = tenantStore.get();
  if (init.tenant !== false && tenant) headers["x-tenant-id"] = tenant;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  return fetch(`${BASE}${path}`, {
    method: init.method ?? "GET", headers, ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
}

async function fail(res: Response): Promise<never> {
  const ct = res.headers.get("content-type") ?? "";
  const data = ct.includes("json") ? await res.json().catch(() => null) : null;
  const p = (typeof data === "object" && data) ? data as { code?: string; title?: string; details?: unknown } : {};
  throw new ApiError(res.status, p.code ?? "error", p.title ?? `Request failed (${res.status})`, p.details);
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; tenant?: boolean } = {}): Promise<T> {
  const res = await request(path, init);
  if (!res.ok) return fail(res);
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") ?? "";
  return (ct.includes("json") ? await res.json() : await res.text()) as T;
}

/** GET a file response (e.g. a PDF) as a Blob. */
export async function getBlob(path: string): Promise<Blob> {
  const res = await request(path, {});
  if (!res.ok) return fail(res);
  return res.blob();
}

export const get = <T,>(p: string) => api<T>(p);
export const post = <T,>(p: string, body: unknown = {}) => api<T>(p, { method: "POST", body });
export const put = <T,>(p: string, body: unknown) => api<T>(p, { method: "PUT", body });
export const patch = <T,>(p: string, body: unknown) => api<T>(p, { method: "PATCH", body });
export const del = (p: string) => api<void>(p, { method: "DELETE" });

/** Human-readable message incl. field errors. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const d = e.details as { fieldErrors?: Record<string, string[]> } | { path: string; message: string }[] | undefined;
    if (Array.isArray(d) && d.length) return `${e.message}: ${d.map((x) => `${x.path || "body"} ${x.message}`).join("; ")}`;
    if (d && !Array.isArray(d) && d.fieldErrors) {
      const f = Object.entries(d.fieldErrors).map(([k, v]) => `${k}: ${v.join(", ")}`);
      if (f.length) return `${e.message}: ${f.join("; ")}`;
    }
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}
