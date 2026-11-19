// UI contract between the web shell and first-party module UI (build-time slots).
// Type-only and dependency-free so module UI packages can import it without server code.

/** Calls to the module's own API (`/api/v1/m/<key>`), authenticated and tenant-scoped by the shell. */
export interface ModuleApi {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body: unknown): Promise<T>;
  patch<T>(path: string, body: unknown): Promise<T>;
  del(path: string): Promise<void>;
  /** Fetch a file response (e.g. PDF) and return it as a Blob. */
  blob(path: string): Promise<Blob>;
  /** Core API (`/api/v1`), read-only use for lookups such as contacts. */
  core<T>(path: string): Promise<T>;
}

/** Props every slot component and module page receives. */
export interface SlotProps {
  tenantId: string;
  /** Set for entity.* slots. */
  entity?: { type: string; id: string; data?: Record<string, unknown> };
  api: ModuleApi;
  /** Permission check against the signed-in user's grants (UI only; the API enforces). */
  can(permission: string): boolean;
  /** For pages: path below the page's route, e.g. "/0190…" for /m/invoicing/invoices/0190…; "" at the root. */
  subPath?: string;
  /** Navigate within the app, e.g. navigate("/m/invoicing/invoices/new"). */
  navigate(to: string): void;
  /** Human-readable message for an API error. */
  errorMessage(e: unknown): string;
}
