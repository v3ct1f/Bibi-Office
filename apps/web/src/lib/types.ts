// API response shapes (mirror of apps/api; keep in sync or generate from /docs/json later).
export interface Me { kind: "user"; userId: string; email: string; tenants: { id: string; slug: string; name: string; status: string }[] }
export interface Page<T> { data: T[]; nextCursor: string | null }
export interface Contact { id: string; firstName: string | null; lastName: string | null; email: string | null; phone: string | null; companyId: string | null; custom: Record<string, unknown>; createdAt: string; updatedAt: string }
export interface Member { id: string; userId: string; email: string; name: string | null; status: string; roles: string[]; createdAt: string }
export interface Role { id: string; key: string; name: string; system: boolean; permissions: string[] }
export interface ApiKey { id: string; name: string; scopes: string[]; expiresAt: string | null; lastUsedAt: string | null; revokedAt: string | null; createdAt: string }
export interface UiSlot { slot: string; label?: string; icon?: string; route?: string; component?: string; permission?: string }
export interface JsonSchema { type?: string; properties?: Record<string, JsonSchema & { "x-secret"?: boolean; default?: unknown; enum?: unknown[]; description?: string; title?: string }>; required?: string[]; enum?: unknown[]; [k: string]: unknown }
export interface ModuleInfo {
  key: string; name: string; version: string; description: string; dependsOn: string[]; enabled: boolean;
  settings: Record<string, unknown>; secretsSet: string[]; permissions: { key: string; label: string }[];
  ui: { slots: UiSlot[] }; settingsSchema: JsonSchema;
}
export interface WorkflowAction { key: string; input?: Record<string, unknown> }
export interface Workflow { id: string; name: string; enabled: boolean; trigger: { event: string }; conditions: unknown; actions: WorkflowAction[]; version: number; createdAt: string; updatedAt: string }
export interface StepResult { key: string; status: string; output?: unknown; error?: string; at: string }
export interface WorkflowRun { id: string; workflowId: string; workflowVersion: number; eventId: string; status: string; steps: StepResult[]; error: string | null; startedAt: string; endedAt: string | null }
export interface Catalog { events: string[]; actions: { key: string; module: string; label: string; input: JsonSchema }[] }
export interface Webhook { id: string; url: string; description: string | null; events: string[]; active: boolean; failureStreak: number; createdAt: string }
export interface Delivery { id: string; eventId: string; eventType: string; status: string; attempts: number; statusCode: number | null; lastError: string | null; nextAttemptAt: string; deliveredAt: string | null; createdAt: string }
export interface AuditEntry { id: string; seq: number; actorType: string; actorId: string | null; action: string; entityType: string | null; entityId: string | null; diff: unknown; ip: string | null; at: string; hash: string }
