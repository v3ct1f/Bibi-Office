/**
 * What Mail needs from a mail server. A real provider talks standard IMAP (to read) and SMTP (to send) to the mailbox host
 * (e.g. Titan through ResellerClub, the company suggested for Work email). The module never talks to a server directly,
 * so the company can be swapped, and local use and tests run on the built-in pretend one (fake-provider.ts).
 *
 * Passwords: Office stores NO mailbox password (Work email shows the starting password once and forgets it). A real provider
 * therefore reaches mailboxes with access it holds itself (a server-side secret or the host's delegated/admin access,
 * set in the server's environment), never with something saved in the database.
 */

/** A person or address in a message. */
export interface Party { name: string; email: string }

export interface MailFile { name: string; contentType: string; data: Buffer }

/** A message as it arrives from the mail server (already split into parts). */
export interface IncomingMail {
  /** The server's id for it (IMAP UID); unique per mailbox, used to never store a message twice. */
  uid: string;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  from: Party;
  to: Party[];
  cc: Party[];
  subject: string;
  text: string;
  /** Raw HTML as received: Office cleans it before keeping or showing it. */
  html: string | null;
  date: string;
  files: MailFile[];
  /** The server's own spam verdict (we do no spam filtering of our own yet). */
  spam?: boolean;
}

export interface OutgoingMail {
  from: Party;
  to: Party[];
  cc: Party[];
  bcc: Party[];
  subject: string;
  text: string;
  html: string | null;
  messageId: string;
  inReplyTo: string | null;
  references: string[];
  files: MailFile[];
}

/** The mailbox being used: its address, and the Work email mailbox id when there is one. */
export interface ProviderAccount { address: string; providerRef: string | null }

export class MailProviderError extends Error {
  constructor(message: string, readonly code = "provider_error") { super(message); }
}

export interface MailProvider {
  /** Short name for logs, e.g. "fake" or "imap". */
  readonly key: string;
  /** True when a person with no Work email mailbox may get a pretend one (development only). Real providers say false. */
  readonly autoProvision: boolean;
  /** New mail since `cursor` (null = first time). Returns the new cursor to pass next time. Reading = IMAP. */
  fetchNew(account: ProviderAccount, cursor: string | null): Promise<{ messages: IncomingMail[]; cursor: string }>;
  /** Hands a message to the mail server for delivery. Sending = SMTP. */
  send(account: ProviderAccount, mail: OutgoingMail): Promise<void>;
}

interface Runtime { provider: MailProvider | null }
let runtime: Runtime = { provider: null };
/** Called once when the server starts (and by tests). `provider: null` = mail isn't set up on this server. */
export function configureMail(r: Partial<Runtime>) { runtime = { ...runtime, ...r }; }
export const getMailProvider = () => runtime.provider;
