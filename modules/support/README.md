# Support inbox (`support`)

Turns your support email into tickets. The team answers from one shared inbox, and replies go out as normal emails threaded under the customer's message. Tickets can be assigned, given a priority, and carry internal notes. Saved replies cover common answers, every ticket is linked to a Contact with the customer's earlier tickets, and response-time targets flag overdue tickets.

Turned off by default. An owner or admin adds it under **Add features**. Turning it off hides the pages, makes the API answer 403 and stops fetching mail, but keeps all data. Adding it again brings everything back.

## Who can do what

| Permission | Lets you | Default roles |
|---|---|---|
| `support:tickets.read` | See tickets, conversations, notes, saved replies and targets | viewer, member, manager, admin, owner |
| `support:tickets.reply` | Reply, add notes, create tickets, assign, change status and priority, check mail now | member, manager, admin, owner |
| `support:inbox.manage` | Manage saved replies and response targets, test the mailbox, delete tickets | manager, admin, owner |

Mailbox settings, including the passwords, are module settings, so only owners and admins (`core:modules.manage`) can change them.

The module declares these core permissions:
- `core:contacts.read` and `core:contacts.write`, to match each sender to a Contact or create one.
- `core:members.read`, for assignees and author names.

## The mailbox

Each company connects its own email account in **Support → Settings**:
- Support address and sender name.
- IMAP server, port, security, user name, password and folder.
- SMTP server, port, security, user name and password.

Passwords are sealed secrets: they are never shown again and are never returned by the API. **Save and test** checks both connections and explains failures in plain words, such as a wrong password, a refused connection or a missing folder.

- **Fetching:** a job runs every minute (`fetch_mail`) and reads new messages by IMAP UID.
  - It remembers the last UID it read and the folder's UIDVALIDITY, so each message is read once.
  - On the first run it imports mail from the last 3 days, at most 50 messages per run, and marks them as read.
  - **Check mail** runs the same fetch on demand.
- **Messages it skips:**
  - Automatic replies (`Auto-Submitted`, `Precedence: bulk/list/junk`, `X-Autoreply`, mailer-daemon and postmaster).
  - Mail sent from the support address itself.
  - Duplicates, matched by `Message-ID`.
- **Threading:** a message joins an existing ticket when its `In-Reply-To` or `References` header names a message on that ticket.
  - Otherwise it joins when the subject carries `[#123]` and the sender is that ticket's customer.
  - Everything else starts a new ticket.
  - A reply from the customer reopens a pending or solved ticket.
- **Quoted text:** the history quoted below a reply is cut off ("On … wrote:", Outlook header blocks, and the Spanish, French and German equivalents).
- **Attachments:** up to 20 per email are stored, each up to 10 MB.
- **Replies** go out by SMTP:
  - Subject: `Re: <subject> [#n]`.
  - Headers: a `Message-ID` on the support domain, `In-Reply-To` set to the customer's last message, `References` set to the thread.
  - Body: plain text and HTML, signed with the agent's name and the sender name.
- **Failed sends:**
  - The reply is kept and marked "Not sent" with the reason, and the ticket status doesn't change.
  - **Retry** sends it again, and the `retry_failed_sends` job tries every 5 minutes, up to 4 attempts within a day.
- **Security:** tenants type in the mail hosts, so every connection first resolves the host.
  - In production it refuses private, loopback and link-local addresses, and unencrypted connections.
  - Outside production, or with `SUPPORT_ALLOW_PRIVATE_MAIL_HOSTS=true`, local test mail servers are allowed.

## Pages

- **Support** (`/support`): the inbox.
  - Views: Open, Mine, Unassigned, Pending, Overdue (with counts), Solved and All.
  - Search by `#number`, subject, customer or message text, and filter by priority.
  - Rows show the ticket number, subject, customer, a preview of the last message, status, priority, overdue flags, assignee and last activity.
  - A banner appears when the mailbox isn't set up or can't be read.
  - The list refreshes every 30 seconds.
- **Ticket** (`/support/:id`): the whole conversation.
  - Customer messages, replies and internal notes, which are yellow and never emailed. Attachments can be downloaded.
  - Composer: Reply or Internal note, Cc, a saved-reply picker, and the status after sending (Pending by default, Solved, or keep Open). Ctrl+Enter sends.
  - Side panel: status, priority and assignee ("Assign to me"), and response targets (due, done, overdue).
  - Customer card: link to the Contact and the customer's other tickets.
  - Managers can delete a ticket.
- **New ticket** (`/support/new`): two kinds.
  - **Email a customer**: we write first, and the reply threads back.
  - **Log a call or visit**: record a question that came in by phone or in person. Nothing is emailed.
- **Support settings** (`/support/settings`, also linked from Settings): the mailbox form and connection test, saved replies, and response targets.
- **Dashboard widget**: counts of open, mine, unassigned and overdue tickets, plus replies that weren't sent and mailbox errors.

## Saved replies and targets

- **Saved replies** fill in `{{customer.firstName}}`, `{{customer.name}}`, `{{customer.email}}`, `{{ticket.number}}`, `{{ticket.subject}}` and `{{agent.name}}`. Unknown tags stay as typed.
- **Response targets** set the first-reply and solved-within times per priority, in clock time from when the ticket came in.
  - Defaults:

    | Priority | First reply | Solved |
    |---|---|---|
    | Urgent | 1 h | 8 h |
    | High | 4 h | 1 day |
    | Normal | 8 h | 2 days |
    | Low | 1 day | 5 days |

  - Leave a target empty for none.
  - Changing a target or a ticket's priority recalculates the due times of open tickets.
  - A ticket is overdue when it has no first reply after its first-reply time, or isn't solved after its resolution time.

## Events (for workflows)

| Event | When |
|---|---|
| `support.ticket.created` | A ticket comes in by email, or is created by hand |
| `support.ticket.customer_replied` | The customer writes again (`reopened` says whether it reopened) |
| `support.ticket.replied` | Someone on the team replies |
| `support.ticket.assigned` | The assignee changes |
| `support.ticket.status_changed` | Open, pending or solved changes |

## Data

All tables have tenant row-level security:

| Table | Holds |
|---|---|
| `support_tickets` | Tickets, with a per-company number |
| `support_messages` | Customer emails, replies and notes, with send status |
| `support_files` | Attachments |
| `support_macros` | Saved replies |
| `support_targets` | Response targets |
| `support_sync` | IMAP position and last error |

## Tests

- `modules/support/tests/mail.test.ts`: parsing, quote stripping, auto-reply detection, private-address checks, and fetching and sending against real in-memory IMAP and SMTP servers (`tests/mail-servers.ts`).
- `apps/api/test/support.test.ts`:
  - Roles and secret settings.
  - Ingest, threading, duplicates and attachments.
  - Contact linking, replies sent by SMTP, notes, assignment and search.
  - Phone tickets, failed sends and retry, saved replies, targets and overdue.
  - The background job, isolation between companies, and switching off and on.
- `apps/web/e2e/support.spec.ts`: the full flow in the browser, with local mail servers.
