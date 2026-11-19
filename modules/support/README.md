# Support inbox (`support`)

Shared inbox for customer requests. Email and a public contact form become numbered tickets; the team replies (emailed in-thread), adds internal notes, assigns, and solves them. First-reply targets per priority.

## Model
- `support_tickets`: per-tenant `number` (gapless counter in `support_counters`), subject, status `new | open | pending | solved`, priority `low | normal | high | urgent`, channel `email | web | internal`, requester name/email, `contact_id`, `assignee_id` (member FK), `due_at` (first-reply target), `first_response_at`, `sla_breached_at`, `solved_at`, `last_message_at`.
- `support_messages`: kind `customer | reply | note`, author (member) for reply/note, body (plain text), email `message_id`. Append-only (update trigger raises; app role has no UPDATE/DELETE).

## Email
- Inbound address: `ctx.mail.inboundAddress()` (shown in the UI under "Inbox address"). Forward your public support address there.
- Threading: In-Reply-To/References matched against stored Message-IDs; else `[#n]` in the subject **and** the same sender; else a new ticket. Quoted history ("On … wrote:", `>` lines, "Original Message") is stripped.
- A customer message on a pending/solved ticket reopens it. Bounces (mailer-daemon/postmaster) are ignored.
- Auto-reply on new email/web tickets (setting `autoAck`), not to no-reply/robot senders and at most one per sender per hour. Reply-To = inbound address.
- Replies: subject `Re: [#n] Subject`, threaded to the customer's last message, signature + reference footer. Replying assigns an unassigned ticket to the replier and records the first response.

## Contact form
Public page `/p/<tenant>/support/contact` (setting `publicForm`). Honeypot `website`, max 5 tickets per email per day, per-IP limit (platform).

## SLA
`due_at = created_at + slaHours(priority)` (settings, defaults urgent 1, high 4, normal 24, low 72; calendar hours). Changing priority before the first reply moves the target. Job `sla-check` (5 min) sets `sla_breached_at` once and emits `support.ticket.sla_breached`.

## Permissions
| Key | Default roles |
|---|---|
| `support:tickets.read` | member, admin |
| `support:tickets.work` (reply, note, status, priority, take/release own) | member, admin |
| `support:tickets.manage` (assign anyone) | admin |

Requires `core:contacts.read`, `core:contacts.write`, `core:mail.send`.

## Events / workflow
Emits (all usable as triggers): `support.ticket.created`, `.assigned`, `.status_changed`, `.replied`, `.customer_replied`, `.sla_breached`. Actions: `support.assign {id, assigneeId|null}`, `support.set_status {id, status}`. Handler on `created` links the requester to a core contact (find by email or create).

## API (`/api/v1/m/support`)
`GET /tickets?view=open|mine|unassigned|pending|breached|solved|all&q=&contactId=&cursor=`, `GET /counts`, `GET /summary`, `GET /meta`, `POST /tickets`, `GET|PATCH /tickets/:id`, `POST /tickets/:id/reply`, `POST /tickets/:id/notes`. Public: `GET|POST /api/v1/public/<tenant>/m/support/form`.

## UI
Nav "Support" (`/m/support/inbox`): views with counts, search (subject, email, `#n`), ticket view with conversation, reply/note composer, side panel. Dashboard widget, contact tab "Tickets", public contact form.

## Settings
`teamName`, `publicForm`, `formTitle`, `autoAck`, `signature`, `slaUrgentHours`, `slaHighHours`, `slaNormalHours`, `slaLowHours`.
