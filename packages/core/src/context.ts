export type ActorType = "user" | "api_key" | "system" | "module";

export interface Actor {
  type: ActorType;
  id: string;                 // user id, api key id, module key, "system"
  userId?: string;
  membershipId?: string;
  permissions: ReadonlySet<string>;
}

/** Everything a core service needs about the caller. Built by the API per request. */
export interface RequestContext {
  tenantId: string;
  actor: Actor;
  requestId: string;
  ip?: string;
  userAgent?: string;
  /** Event that caused this work (workflow/handler chains); used for loop guard. */
  causation?: { id: string; correlationId: string; depth: number };
}
