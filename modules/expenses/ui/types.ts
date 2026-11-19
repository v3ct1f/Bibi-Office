export type ExpenseStatus = "draft" | "submitted" | "approved" | "rejected" | "reimbursed";
export interface Category { id: string; name: string; code: string | null; position: number; archived: boolean }
export interface Expense {
  id: string; status: ExpenseStatus; spentOn: string; merchant: string; categoryId: string | null; categoryName: string | null;
  amount: number; tax: number; currency: string; description: string | null;
  submitterId: string; submitterName: string | null; mine: boolean; canDecide: boolean;
  receipt: { id: string; filename: string | null; mime: string | null } | null;
  submittedAt: string | null; decidedBy: string | null; decidedAt: string | null; decisionNote: string | null;
  reimbursedAt: string | null; reimbursementRef: string | null; createdAt: string; updatedAt: string;
}
export interface Page<T> { data: T[]; nextCursor: string | null }
export interface SummaryRow {
  currency: string; myDraft: number; myPending: number; myToBePaid: number;
  toApproveCount?: number; toApprove?: number; toReimburseCount?: number; toReimburse?: number; approvedThisMonth?: number;
}
export interface Summary { seesAll: boolean; data: SummaryRow[] }
