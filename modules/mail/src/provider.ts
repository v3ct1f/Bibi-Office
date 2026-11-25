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
  /** Already read / starred on the server (e.g. in a phone's mail app). */
  read?: boolean;
  starred?: boolean;
}

/** Read/starred state of a message Office already has, as the server sees it now (changes made in another mail app). */
export interface RemoteFlags { uid: string; read: boolean; starred: boolean }

/** Where an Office folder lives on the mail server; "deleted" = gone for good. */
export type RemoteFolder = "inbox" | "sent" | "spam" | "trash" | "archive";

/** A change made in Office, to be written back to the mail server (two-way sync). */
export interface RemoteChange { uid: string; read: boolean; starred: boolean; folder: RemoteFolder | "deleted" }

/** What happened to one change: `uid` is the message's new id after a move (null = it no longer exists on the server). */
export interface RemoteChangeResult { uid: string; newUid: string | null }

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
  /**
   * True for a real mail server: fetching and writing changes back run in the worker (the `sync_mail` job, every minute),
   * never inside a page request, so a slow server can't hold up the app. The pretend one says false (instant, in memory).
   */
  readonly background?: boolean;
  /**
   * New mail since `cursor` (null = first time). Returns the new cursor to pass next time. Reading = IMAP.
   * `flags`: current read/starred state of recent messages, so changes made in another mail app show up here.
   */
  fetchNew(account: ProviderAccount, cursor: string | null): Promise<{ messages: IncomingMail[]; cursor: string; flags?: RemoteFlags[] }>;
  /** Hands a message to the mail server for delivery. Sending = SMTP. `uid`: the server's id for the copy kept in Sent, if any. */
  send(account: ProviderAccount, mail: OutgoingMail): Promise<void | { uid: string | null }>;
  /** Writes read/starred/moves/deletes made in Office back to the server. Optional: the pretend one has nothing to write to. */
  applyChanges?(account: ProviderAccount, changes: RemoteChange[]): Promise<RemoteChangeResult[]>;
}

interface Runtime {
  provider: MailProvider | null;
  /** Most mail one person may keep in Office (text, pictures and attachments), in bytes. */
  quotaBytes: number;
  /** Days mail stays in Trash and Spam before it is deleted for good. */
  trashDays: number;
}
export const DEFAULT_QUOTA_BYTES = 2 * 1024 ** 3;
let runtime: Runtime = { provider: null, quotaBytes: DEFAULT_QUOTA_BYTES, trashDays: 30 };
/** Called once when the server starts (and by tests). `provider: null` = mail isn't set up on this server. */
export function configureMail(r: Partial<Runtime>) { runtime = { ...runtime, ...r }; }
export const getMailProvider = () => runtime.provider;
export const getMailLimits = () => ({ quotaBytes: runtime.quotaBytes, trashDays: runtime.trashDays });
