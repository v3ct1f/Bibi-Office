import type { HttpClient } from "@office/ui/module-ui";
import { config } from "../config.ts";
import { getAccessToken } from "../auth/auth.tsx";

/** RFC 9457 problem from the API. */
export class ApiError extends Error {
  constructor(
    public status: number, message: string, public code = "error",
    public details?: unknown, public requestId?: string,
  ) { super(message); this.name = "ApiError"; }
}

type Query = Record<string, string | number | boolean | undefined | null>;

let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

export async function request<T>(method: string, path: string, o: { body?: unknown; query?: Query; tenantId?: string; signal?: AbortSignal } = {}): Promise<T> {
  const url = new URL(`/api/v1${path}`, config.apiUrl);
  for (const [k, v] of Object.entries(o.query ?? {})) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  const token = await getAccessToken();
  const headers: Record<string, string> = { accept: "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  if (o.tenantId) headers["x-tenant-id"] = o.tenantId;
  if (o.body !== undefined) headers["content-type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: o.body === undefined ? null : JSON.stringify(o.body), signal: o.signal ?? null });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, "Cannot reach the server. Check your connection.", "network");
  }
  if (res.status === 401) onUnauthorized();
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? safeJson(text) : undefined;
  if (!res.ok) {
    const p = (data ?? {}) as { title?: string; code?: string; details?: unknown; requestId?: string };
    throw new ApiError(res.status, p.title ?? res.statusText ?? "Request failed", p.code, p.details, p.requestId ?? res.headers.get("x-request-id") ?? undefined);
  }
  return data as T;
}

const safeJson = (t: string) => { try { return JSON.parse(t) as unknown; } catch { return t; } };

/** HttpClient bound to a base path and tenant (also handed to module UIs). */
export function httpClient(base: string, tenantId?: string): HttpClient {
  const o = tenantId ? { tenantId } : {};
  return {
    get: (p, query) => request("GET", base + p, { ...o, ...(query ? { query } : {}) }),
    post: (p, body) => request("POST", base + p, { ...o, body: body ?? {} }),
    put: (p, body) => request("PUT", base + p, { ...o, body: body ?? {} }),
    patch: (p, body) => request("PATCH", base + p, { ...o, body: body ?? {} }),
    del: (p) => request("DELETE", base + p, o),
  };
}

/** Human message for any error (field details from validation problems appended). */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const d = e.details as { fieldErrors?: Record<string, string[]>; formErrors?: string[] } | { path: string; message: string }[] | undefined;
    if (Array.isArray(d) && d.length) return `${e.message}: ${d.map((x) => `${x.path || "body"} ${x.message}`).join("; ")}`;
    if (d && !Array.isArray(d)) {
      const parts = [...(d.formErrors ?? []), ...Object.entries(d.fieldErrors ?? {}).map(([k, v]) => `${k}: ${v.join(", ")}`)];
      if (parts.length) return `${e.message}: ${parts.join("; ")}`;
    }
    return e.message;
  }
  return e instanceof Error ? e.message : "Unexpected error";
}
