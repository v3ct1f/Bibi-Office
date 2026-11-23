// DTOs returned by the Office API (/api/v1). Kept in sync by hand with apps/api routes.
export interface TenantRef { id: string; slug: string; name: string; status: string; tenantStatus: "active" | "suspended" }
export interface Me { kind: "user"; userId: string; email: string; tenants: TenantRef[]; platformAdmin: boolean; selfSignup: boolean }

export interface UiSlot { slot: string; label?: string; icon?: string; route?: string; component?: string; permission?: string }
export interface Access {
  tenant: { id: string; slug: string; name: string; region: string; plan: string; createdAt: string };
  actor: { type: string; id: string };
  /** A program owner looking in read-only (not a member). */
  viewing?: boolean;
  permissions: string[];
  modules: { key: string; name: string; version: string; slots: UiSlot[] }[];
}

export interface Page<T> { data: T[]; nextCursor: string | null }
interface Row { id: string; createdAt: string; updatedAt: string; createdBy: string | null; custom?: Record<string, unknown> }
export interface Contact extends Row { companyId: string | null; firstName: string | null; lastName: string | null; email: string | null; phone: string | null }
export interface Company extends Row { name: string; domain: string | null; taxId: string | null; address: Record<string, unknown> | null }
export interface Task extends Row { title: string; description: string | null; status: "open" | "in_progress" | "done" | "cancelled"; priority: number; dueAt: string | null; assigneeId: string | null }

export interface Member { id: string; userId: string; email: string; name: string | null; status: string; createdAt: string; roles: string[] }
export interface Role { id: string; key: string; name: string; system: boolean; permissions: string[] }

export interface ModuleInfo {
  key: string; name: string; version: string; description: string; dependsOn: string[]; enabled: boolean;
  /** false = the program owner hasn't included this feature for the business. */
  allowed: boolean;
  icon: string | null; category: string; roles: string[];
  enabledAt: string | null; enabledBy: { id: string; name: string } | null;
  disabledAt: string | null; disabledBy: { id: string; name: string } | null;
  settings: Record<string, unknown>; secretsSet: string[]; permissions: { key: string; label: string }[];
  requires: string[]; settingsSchema: import("@office/ui").JsonSchema; ui: { slots: UiSlot[] };
}

export interface ApiKey { id: string; name: string; scopes: string[]; expiresAt: string | null; lastUsedAt: string | null; revokedAt: string | null; createdAt: string }

export interface WorkflowAction { key: string; input: Record<string, unknown> }
export interface Workflow {
  id: string; name: string; enabled: boolean; trigger: { event: string }; conditions: unknown;
  actions: WorkflowAction[]; version: number; createdAt: string; updatedAt: string;
  /** Whose access the workflow runs with (the person who last saved it); null if they left. */
  runAs: string | null; runAsName: string | null;
}
export interface WorkflowInput { name: string; enabled: boolean; trigger: { event: string }; conditions: unknown; actions: WorkflowAction[] }
export interface StepResult { key: string; status: "succeeded" | "failed" | "skipped"; output?: unknown; error?: string; at: string }
export interface WorkflowRun {
  id: string; workflowId: string; workflowVersion: number; eventId: string;
  status: "pending" | "running" | "succeeded" | "failed" | "skipped" | "cancelled";
  steps: StepResult[]; error: string | null; startedAt: string; endedAt: string | null;
}
export interface Catalog { events: string[]; actions: { key: string; module: string; label: string; input: import("@office/ui").JsonSchema }[] }

export interface Webhook { id: string; url: string; description: string | null; events: string[]; active: boolean; failureStreak: number; createdAt: string }
export interface Delivery {
  id: string; endpointId: string; eventId: string; eventType: string; status: "pending" | "delivered" | "failed";
  attempts: number; statusCode: number | null; lastError: string | null; nextAttemptAt: string; deliveredAt: string | null; createdAt: string;
}

export interface AuditEntry {
  id: string; seq: number; actorType: string; actorId: string | null; action: string; entityType: string | null;
  entityId: string | null; diff: unknown; ip: string | null; userAgent: string | null; requestId: string | null; at: string; hash: string;
}
