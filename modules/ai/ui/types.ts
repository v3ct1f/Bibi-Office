export type Kind = "meeting" | "email" | "notes";
export interface ActionItem { task: string; owner: string | null; due: string | null }
export interface Result { title: string; tldr: string; keyPoints: string[]; decisions: string[]; actionItems: ActionItem[]; openQuestions: string[] }
export interface SummaryRow {
  id: string; kind: Kind; title: string; sourceChars: number; status: "done" | "refused"; result: Result | null; model: string;
  inputTokens: number; outputTokens: number; tasksCreated: number; createdBy: string; createdByName: string | null; mine: boolean; createdAt: string;
}
export interface Summary extends SummaryRow { sourceText: string | null }
export interface Status {
  configured: boolean; model: string; canManage: boolean;
  usage: { month: string; requests: number; inputTokens: number; outputTokens: number; used: number; limit: number };
}
