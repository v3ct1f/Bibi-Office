# Mail (`@office/module-mail`)

Everyone in a business gets their **own private mail inbox inside Office**, with the Gmail things people know: folders, conversations, labels, stars,
search, drafts, attachments, signatures, keyboard shortcuts. **Only the person can read their mailbox, not even the owner or an admin.**
It is where the work mailboxes sold by the Work email feature (`modules/workmail`) are read and written.

**Status: phase 1, built and tested with a pretend mail server only. No real server is connected yet** (see "Before real use").

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

## Getting new mail
`POST /sync` asks the provider (the screen does it on opening, on Refresh and every 30 seconds while open); `GET /unread` (the menu badge, polled by the app) does it too if the last fetch is older than 20 s, and ignores a failing server. Messages are never stored twice (`remote_uid`).
Mail the server marks as spam goes to Spam. We do no spam filtering of our own.

## Safe display of mail
`src/sanitize.ts` is an allow-list HTML cleaner run when mail arrives: no scripts, frames, forms, event handlers, `javascript:`/`data:` links, risky styles; links open in a new tab with `noopener`; pictures from the internet are not loaded (kept as `data-remote-src`, "Show pictures" turns them on). The app shows the result in a sandboxed iframe **without scripts** and with its own content-security-policy (second layer). 8 unit tests cover XSS tricks.

## API (`/api/v1/m/mail`, all `mail:inbox.use` = "use my own mailbox", given to every role)
`GET/PATCH /account` · `GET /unread` · `POST /sync` · `GET /folders` · `GET /threads?folder|label|q&limit&offset` · `GET /threads/:id[?folder=trash|spam]` · `POST /threads/action {ids, action, labelId?}` (read unread star unstar archive inbox spam trash delete label unlabel) ·
`GET|PATCH /messages/:id` · `POST /messages/:id/add-contact|add-lead` · `GET /attachments/:id` (base64 JSON) · `POST /drafts {replyTo?, all?, forwardOf?}` · `PUT|DELETE /drafts/:id` · `POST /drafts/:id/attachments` · `DELETE /drafts/:id/attachments/:attId` · `POST /drafts/:id/send` · `POST /folders/trash/empty` · labels `POST|PATCH|DELETE /labels`.
A mail server that fails answers 424 with a plain message and the draft is kept.

## Events
Emits `mail.lead.requested { name, email, subject, requestedBy }` (Leads handles it).
Subscribes to Work email's `workmail.mailbox.created` (the colleague's mailbox becomes their Mail account, replacing a pretend one), `.suspended` and `.deleted` (account paused: old mail readable, no sending or receiving) and `.resumed` (new in this session).

## Before real use (nothing below is done)
1. Write the real `MailProvider` (a new file next to `fake-provider.ts`): IMAP (`imapflow`, as in `modules/support/src/mail.ts`) to read and SMTP (`nodemailer`) to send, for the provider chosen for Work email (suggested ResellerClub/Titan). Choose it with `MAIL_PROVIDER`. It must reach mailboxes without a stored password (provider-side access).
   Provider calls currently run inside the request's database transaction: fine for the pretend one, but a slow real server should be fetched by the worker (a scheduled job) instead of inside `GET /unread`.
2. Two-way sync: read/starred/moved/deleted state lives only in Office today (sending and receiving are real through the provider). Write flags and folder moves back over IMAP.
3. Mailboxes created in Work email **before** Mail was turned on are not linked (only the creation event links them). Add a "link my mailbox" step or an event replay.
4. Attachments and bodies are stored in Postgres (`bytea`): decide retention and quotas per person before real volume. The sending limit is 200 messages per person per day.
5. Terms/privacy text about stored mail.

## Not yet (later phases)
Real-time push, spam filtering of our own, calendar invites, undo send, scheduled send, canned replies, importing from Gmail/Outlook, several accounts per person, mobile app, rich-text compose, contact suggestions while typing addresses, filters/rules, vacation reply, aliases ("send as"), snooze, categories/priority inbox, conversation mute, print, shared inboxes and delegation, ranked full-text search, offline mode, folding of quoted text in long threads.
