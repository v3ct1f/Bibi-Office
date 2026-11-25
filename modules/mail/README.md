# Mail (`@office/module-mail`)

Everyone in a business gets their **own private mail inbox inside Office**, with the Gmail things people know: folders, conversations, labels, stars,
search, drafts, attachments, signatures, keyboard shortcuts. **Only the person can read their mailbox, not even the owner or an admin.**
It is where the work mailboxes sold by the Work email feature (`modules/workmail`) are read and written.

**Status:** phase 1 (Session 39) plus the "before real use" work (Session 40). The connection to a real mail server (IMAP/SMTP) is built and
tested against real in-memory IMAP and SMTP servers. **It has not been connected to a real mail host yet.** That needs the host's details on
the server (see "Connecting a real mail server").

## What a person sees (`/inbox`)
- **Folders:** Inbox, Starred, Sent, Drafts, Spam, Archive, Trash. Unread counts next to them; the number next to **Mail** in the menu counts inbox conversations with something unread.
- **Conversations:** messages that answer each other (by `In-Reply-To`/`References`, else by "Re:" subject within 60 days) are one line in the list and one page in the reading pane. The newest message is open, older ones fold up.
- **Actions:** open (marks read), mark read/unread, star, archive, spam, trash, restore, delete forever, empty trash, move to, labels, bulk actions on ticked rows.
- **Write:** compose, reply, reply all, forward (keeps attachments, starts a new conversation). A draft exists on the server from the moment the window opens and saves about a second after the last keystroke; Drafts lists it.
  **Compose is plain text** (received HTML mail is shown as it was sent). The signature (Mail settings) is added to new messages, replies and forwards.
- **Attachments:** up to 5 MB per file and 10 MB per message. Programs and scripts (`.exe .bat .js .ps1 ...`) are refused when sending and flagged when received. Files are always handed out as a plain download with a neutral type, never opened in the browser.
- **Search:** one box with Gmail-style words: `from:` `to:` `subject:` `filename:` `has:attachment` `is:unread|read|starred` `label:` `in:folder` `before:YYYY-MM-DD` `after:` `-word` `"exact phrase"`; plain words match subject, text, sender and recipients. The options button builds the same text from fields.
- **Keyboard:** `c` compose, `j`/`k` move, `Enter`/`o` open, `u` back, `e` archive, `#` delete (forever in Trash/Spam), `!` spam, `s` star, `x` tick, `r` reply, `a` reply all, `f` forward, `Shift+I`/`Shift+U` read/unread, `/` search, `?` help. They stay quiet while typing.
- **CRM:** a sender who is already a Contact shows the contact's name. "Add as contact" creates the Contact (shared core data). "Add as lead" emits `mail.lead.requested`; **Leads** (if on) creates the lead (or notes the email on their open lead). No module imports another.
- **Languages:** the main labels are translated (de, es, fr, it, nl, pt) in `ui/i18n.ts`, following `<html lang>`; the rest shows English.

## Privacy (how it is enforced)
Every table has `user_id` and a row-level-security policy `tenant_id = app_tenant_id() AND user_id = mail_user_id()`. `mail_user_id()` reads
`app.mail_user`, which each request sets from its signed-in person (`scopeTo` in `service.ts`); with nothing set no row is visible, so a query that forgets to filter still shows nothing of anyone else's.
Event handlers (Work email events) set it to the colleague they act for. The API tests check colleague, owner and other-business access, and the database rule directly.
Message contents are never put in events (only name, address and subject, and only when the person presses "Add as lead").

## Model (`migrations/0001_init.sql`)
```
account (one per person: address, display name, source workmail|local, status active|paused, signature, sync cursor)
message (folder inbox|sent|drafts|spam|trash|archive, thread_id, headers, from/to/cc/bcc, text + cleaned html, flags read/starred/attachments)
  ├─< attachment (bytea, name, safe content type)
  └─< message_label >─ label (name, colour)
```
Starred is a flag, not a folder. Labels are kept on every message of a conversation.

## Provider interface (`src/provider.ts`)
`MailProvider`: `fetchNew(account, cursor)` (IMAP read) and `send(account, mail)` (SMTP), `autoProvision` (a person with no work mailbox gets a pretend one; **only the fake does**).
Wired once with `configureMail({ provider })` (`apps/api/src/app.ts`); `MAIL_PROVIDER=fake|off` (default `fake` in development, `off` in production, so production says "Mail isn't set up on this server yet").
`fakeMailProvider()` (`src/fake-provider.ts`): in-memory mailboxes; the first read of an address gets 5 sample messages (a welcome, a two-message conversation with an attachment, a newsletter with a script and a tracking picture, one spam);
`send` delivers to the recipients' pretend mailboxes so two colleagues in one local business can mail each other; `deliver()`, `sent`, `failNext("send"|"fetch")`.
**No mailbox password is stored by Office** (Work email shows the starting password once and forgets it). A real provider reaches mailboxes with access it holds itself (a server-side secret / the host's delegated access), never a password from the database.
`imapMailProvider()` (`src/imap-provider.ts`) is the real one (below). `mailProviderFromEnv()` (`src/env.ts`) builds the provider and limits from the environment; the API (`server.ts`) and the worker (`main.ts`, `dev-local.ts`) both call it.

## Connecting a real mail server (`MAIL_PROVIDER=imap`)
Office signs in to each person's mailbox as a **master user**: one login the mail host gives Office for all its mailboxes (Dovecot and Stalwart both
have this). The person's own password is never needed or stored. The settings go only in the server's environment (`.env.local` locally), never in the database or in git:
```
MAIL_PROVIDER=imap
MAIL_IMAP_HOST=mail.example.com      MAIL_IMAP_PORT=993    MAIL_IMAP_SECURITY=tls|starttls|none   (none only outside production)
MAIL_SUBMIT_HOST=mail.example.com    MAIL_SUBMIT_PORT=465  MAIL_SUBMIT_SECURITY=tls|starttls|none (defaults: the IMAP host; 465 with tls, 587 otherwise)
MAIL_MASTER_USER=office              MAIL_MASTER_PASSWORD=...
MAIL_LOGIN_FORMAT={address}*{master}  (Dovecot, the default)  or  {address}%{master}  (Stalwart)
MAIL_SUBMIT_USER / MAIL_SUBMIT_PASSWORD   optional: a relay account allowed to send for the business's domains, instead of the master login
MAIL_QUOTA_MB=2048                    most mail one person keeps in Office (default 2 GB)
MAIL_TRASH_DAYS=30                    days before Trash and Spam are emptied (default 30)
```
The host must offer a master user (or an equal admin sign-in for IMAP and SMTP). Titan (ResellerClub) doesn't advertise one; Stalwart and Dovecot do,
so a self-run Stalwart next to Office is the simplest fit. Check this before choosing the Work email company.

What the real provider does: reads **Inbox** and the server's **Junk** folder (as Spam) without marking anything read. The first fetch brings in the last
90 days, then 100 messages per folder per fetch until caught up. It sends over SMTP and saves the same message into the server's **Sent** folder.
It writes read, star, moves (Inbox, Archive, Spam, Trash, Sent: found by their special-use mark or usual name, created if missing) and deletes back over IMAP.
Message ids are `<uidValidity>:<uid>:<folder>`, so a moved message is still found. Drafts and labels stay in Office (not written to the server).

## Getting new mail
- **Real mail server** (`background: true`): the worker's `sync_mail` job runs every minute. For everyone's mailbox in the business (longest-waiting first, at most 25 per run, 40 s budget)
  it writes Office's changes to the server, then fetches new mail and the read/star state of the last 300 messages per folder (so changes made on a phone show up; a change made in Office and not yet written wins).
  Page requests never talk to the server, except sending (SMTP, a few seconds at most). `POST /sync` then only answers `{ background: true }` and the screen reloads the list.
  A failure is kept in `mail_accounts.last_sync_error` and shown at the bottom of the screen.
- **Pretend server** (development, tests): as before, `POST /sync` fetches (on opening, Refresh and every 30 s), and `GET /unread` too if the last fetch is older than 20 s.

Messages are never stored twice (`remote_uid`). Mail the server marks as spam (or keeps in Junk) goes to Spam. We do no spam filtering of our own.

## Two-way sync
Every change in Office (read/unread, star, archive, spam, trash, restore) sets `remote_dirty`. Deleting for good (Delete forever, Empty trash, the 30-day clean-up) first
writes the server id into `mail_remote_deletions` (private per person, like the rest). The job sends them with `applyChanges` and stores each message's new server id after a move.
If the same message changed again meanwhile, it stays marked and goes next time.

## Storage and clean-up
- Each person may keep **2 GB** (`MAIL_QUOTA_MB`): text, cleaned HTML and attachments. The sidebar shows how much is used. When full, fetching stops (mail waits on the server, nothing is lost) and sending is refused with "Your mailbox is full"; both start again once there is room.
- Mail in **Trash and Spam is deleted for good after 30 days** (`MAIL_TRASH_DAYS`; `clean_up` job every hour, counted from `trashed_at`), on the server too.
- Attachments up to 5 MB per file and 10 MB per message; 200 sent messages per person per day.
- A work mailbox switched off or deleted pauses the Mail account: its mail stays readable to the person until they delete it or the business's data is deleted.

## Linking mailboxes made before Mail was on
Turning Mail on emits `mail.mailboxes.requested { userId: null }`. A person with no mailbox can press **Link my work mailbox** (`POST /account/link`, the same event with their id).
Work email answers with `workmail.mailbox.created { ..., status, replay: true }` for each mailbox (a switched-off one becomes a paused account).

## Safe display of mail
`src/sanitize.ts` is an allow-list HTML cleaner run when mail arrives: no scripts, frames, forms, event handlers, `javascript:`/`data:` links, risky styles; links open in a new tab with `noopener`; pictures from the internet are not loaded (kept as `data-remote-src`, "Show pictures" turns them on). The app shows the result in a sandboxed iframe **without scripts** and with its own content-security-policy (second layer). 8 unit tests cover XSS tricks.

## API (`/api/v1/m/mail`, all `mail:inbox.use` = "use my own mailbox", given to every role)
`GET/PATCH /account` (also `background`, `storage { usedBytes, quotaBytes, full }`, `account.lastSyncError`) · `POST /account/link` · `GET /unread` · `POST /sync` · `GET /folders` · `GET /threads?folder|label|q&limit&offset` · `GET /threads/:id[?folder=trash|spam]` · `POST /threads/action {ids, action, labelId?}` (read unread star unstar archive inbox spam trash delete label unlabel) ·
`GET|PATCH /messages/:id` · `POST /messages/:id/add-contact|add-lead` · `GET /attachments/:id` (base64 JSON) · `POST /drafts {replyTo?, all?, forwardOf?}` · `PUT|DELETE /drafts/:id` · `POST /drafts/:id/attachments` · `DELETE /drafts/:id/attachments/:attId` · `POST /drafts/:id/send` · `POST /folders/trash/empty` · labels `POST|PATCH|DELETE /labels`.
A mail server that fails answers 424 with a plain message and the draft is kept.

## Events
Emits `mail.lead.requested { name, email, subject, requestedBy }` (Leads handles it) and `mail.mailboxes.requested { userId | null }` (Work email answers).
Subscribes to Work email's `workmail.mailbox.created` (the colleague's mailbox becomes their Mail account, replacing a pretend one), `.suspended` and `.deleted` (account paused: old mail readable, no sending or receiving) and `.resumed` (new in this session).

## Before real use
Done in Session 40: the real provider and fetching in the worker (1), two-way sync (2), linking old mailboxes (3), storage limit and Trash clean-up (4),
Terms and Privacy Policy text about Mail (5, `apps/web/src/pages/Legal.tsx`). **Still needs the user:**
- Choose the mail host and get a master user for it (see "Connecting a real mail server"), then put its details in the server's environment. Titan may not offer one.
- Decide whether 2 GB per person and 30 days in Trash are right (`MAIL_QUOTA_MB`, `MAIL_TRASH_DAYS`), and whether a departed colleague's mail should be deleted after some time (today it stays until the business's data is deleted).
- Have the new Terms/Privacy wording about Mail checked by a lawyer, like the rest of those pages.

Known gaps: messages moved or deleted on the server by another mail app are not noticed (only read/star state is); drafts and labels are not on the server;
the first fetch brings in the last 90 days only; Work email turned off as a whole (feature off) doesn't pause Mail accounts (it emits no events for that).

## Not yet (later phases)
Real-time push, spam filtering of our own, calendar invites, undo send, scheduled send, canned replies, importing from Gmail/Outlook, several accounts per person, mobile app, rich-text compose, contact suggestions while typing addresses, filters/rules, vacation reply, aliases ("send as"), snooze, categories/priority inbox, conversation mute, print, shared inboxes and delegation, ranked full-text search, offline mode, folding of quoted text in long threads.
