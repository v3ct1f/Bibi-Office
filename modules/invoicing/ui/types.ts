// Response shapes of /api/v1/m/invoicing (mirror of src/service.ts DTOs).
export type Status = "draft" | "open" | "paid" | "void";
export interface Party { name: string; email?: string | null; address?: string | null; taxId?: string | null; paymentInstructions?: string | null; footer?: string | null }
export interface Invoice {
  id: string; number: string | null; status: Status; overdue: boolean; contactId: string | null; companyId: string | null;
  currency: string; issueDate: string | null; dueDate: string | null; notes: string | null; customer: Party | null; seller: Party | null;
  subtotal: number; taxTotal: number; total: number; amountPaid: number; balance: number;
  sentAt: string | null; paidAt: string | null; voidedAt: string | null; voidReason: string | null;
  reminderCount: number; lastRemindedAt: string | null; createdAt: string; updatedAt: string;
}
export interface Line { id?: string; description: string; quantity: number; unitPrice: number; taxRate: number; net?: number; tax?: number }
export interface Payment { id: string; amount: number; paidOn: string; method: string; reference: string | null }
export interface InvoiceFull extends Invoice { lines: Line[]; payments: Payment[] }
export interface Page<T> { data: T[]; nextCursor: string | null }
export interface Summary { data: { currency: string; outstanding: number; openCount: number; overdue: number; overdueCount: number; paid30d: number; drafts: number }[] }
export interface ContactLite { id: string; firstName: string | null; lastName: string | null; email: string | null; companyId: string | null }
export interface CompanyLite { id: string; name: string }
