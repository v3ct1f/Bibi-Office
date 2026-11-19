export type TicketStatus = "new" | "open" | "pending" | "solved";
export type Priority = "low" | "normal" | "high" | "urgent";
export interface Ticket {
  id: string; number: number; reference: string; subject: string; status: TicketStatus; priority: Priority; channel: "email" | "web" | "internal";
  requesterName: string | null; requesterEmail: string; contactId: string | null; assigneeId: string | null; assigneeName: string | null;
  dueAt: string | null; firstResponseAt: string | null; solvedAt: string | null; lastMessageAt: string; createdAt: string; overdue: boolean;
}
export interface Message {
  id: string; ticketId: string; kind: "customer" | "reply" | "note"; authorId: string | null; authorName: string | null;
  fromEmail: string | null; fromName: string | null; body: string; createdAt: string;
}
export interface TicketDetail extends Ticket { messages: Message[] }
export interface Page<T> { data: T[]; nextCursor: string | null }
export interface Counts { mine: number; unassigned: number; open: number; pending: number; breached: number }
export interface InboxInfo { address: string | null; formUrl: string | null; teamName: string; sla: Record<Priority, number> }
export interface Member { userId: string; name: string | null; email: string }
