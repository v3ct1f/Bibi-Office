// Response shapes of /api/v1/m/crm (mirror of src/service.ts DTOs).
export interface Stage { id: string; name: string; position: number; probability: number }
export interface Deal {
  id: string; title: string; value: number; currency: string; stageId: string; status: "open" | "won" | "lost";
  contactId: string | null; companyId: string | null; ownerId: string | null; expectedClose: string | null; notes: string | null;
  lostReason: string | null; closedAt: string | null; stageChangedAt: string; stale: boolean; createdAt: string; updatedAt: string;
}
export interface DealFull extends Deal { stage: { id: string; name: string; probability: number } | null }
export interface BoardStage extends Stage { count: number; totals: Record<string, number>; deals: Deal[] }
export interface Activity {
  id: string; type: "note" | "call" | "email" | "meeting" | "task"; subject: string; body: string | null;
  dealId: string | null; contactId: string | null; companyId: string | null; dueAt: string | null; doneAt: string | null; overdue: boolean; createdAt: string;
}
export interface Page<T> { data: T[]; nextCursor: string | null }
export interface Summary {
  data: { currency: string; openCount: number; openValue: number; weighted: number; wonCount: number; wonValue: number; lostCount: number }[];
  tasksDue: number;
}
export interface ContactLite { id: string; firstName: string | null; lastName: string | null; email: string | null; companyId: string | null }
export interface CompanyLite { id: string; name: string }
