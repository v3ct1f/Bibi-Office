export type DocStatus = "draft" | "sent" | "completed" | "declined" | "voided" | "expired";
export type SignerStatus = "waiting" | "pending" | "viewed" | "signed" | "declined";
export interface Template { id: string; name: string; title: string; body: string; archived: boolean; fields: string[] }
export interface DocRow {
  id: string; number: number; title: string; status: DocStatus; contactId: string | null; sentAt: string | null; completedAt: string | null;
  expiresAt: string | null; createdAt: string; signers: { name: string; email: string; status: SignerStatus }[];
}
export interface Signer {
  id: string; position: number; name: string; email: string; status: SignerStatus; viewedAt: string | null; signedAt: string | null;
  signedName: string | null; hasSignatureImage: boolean; declineReason: string | null; lastSentAt: string | null;
}
export interface Doc extends Omit<DocRow, "signers"> {
  body: string; message: string | null; inOrder: boolean; contentHash: string | null; voidReason: string | null; createdBy: string; createdByName: string | null;
  unresolved: string[]; signers: Signer[]; trail: { id: string; kind: string; at: string; who: string | null; ip: string | null }[];
}
export interface PublicDoc {
  document: { number: number; title: string; body: string; status: DocStatus; sender: string; expiresAt: string | null; contentHash: string | null; completedAt: string | null };
  signer: { name: string; email: string; status: SignerStatus; signedAt: string | null };
  signers: { name: string; status: SignerStatus; me: boolean }[];
  canSign: boolean;
}
