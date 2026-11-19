# Docs & e-sign (`docs`)

Document templates with merge fields, sending for signature by email link, a fixed content hash, and a signed PDF with a signature certificate and evidence trail.

## Model
- `docs_templates`: name (unique), title and body with `{{fields}}`, archived. "Simple agreement" is seeded on enable.
- `docs_documents`: number (per tenant), title, body, status `draft | sent | completed | declined | voided | expired`, contact, `in_order`, `content_hash` (SHA-256 of title + body, set on send), `expires_at`, message.
- `docs_signers`: name, email, position, status `waiting | pending | viewed | signed | declined`, `token_hash` (SHA-256 of the link token), typed name, optional drawn PNG, IP.
- `docs_events`: evidence trail (created, sent, reminded, viewed, signed, declined, completed, voided, expired) with actor, IP, details (user agent, consent, hash). **Append-only.**
- DB guards: title/body can't change after send; closed documents can't change status; a signature can't be changed.

## Body format
Plain text: `# Heading`, `## Subheading`, `- bullet`, blank line = paragraph. Rendered as text in the app, on the signing page and in the PDF (never HTML).

## Merge fields
`{{contact.name}}`, `{{contact.first_name}}`, `{{contact.last_name}}`, `{{contact.email}}`, `{{company.name}}` (from the contact's company), `{{org.name}}` (setting `senderName`), `{{today}}`, plus any custom field passed as `values`. Merged values can't inject fields. A document with unfilled fields can't be sent.

## Signing flow
1. Draft (from a template or blank), edit, add signers (or the contact signs).
2. Send: content hash fixed; each signer (or only the first, when `inOrder`) gets a link `/p/<tenant>/docs/sign/<signer>#<token>`. The token is in the URL fragment (not sent to servers in logs) and stored only as a hash.
3. Signer opens (recorded once), types their name, may draw, ticks consent, signs. Or declines with a reason (the document closes).
4. When all have signed: completed, everyone gets a link to the signed PDF.
- Reminders rotate the link (old links stop working); at most one per hour.
- Cancel (sender or admin): links die, notified signers are told.
- Job `expire` (hourly) closes documents past `expires_at` (setting `expiryDays`, default 30).

## PDF
Deterministic (pdf-lib, standard fonts): the text, a signatures section (drawn image or typed name), and a certificate page with the hash, signers, IPs and the full trail.

## Permissions
| Key | Default roles |
|---|---|
| `docs:documents.read` | member, admin |
| `docs:documents.send` | member, admin |
| `docs:templates.manage` | admin |

Requires `core:contacts.read`, `core:companies.read`, `core:mail.send`.

## Events / workflow
`docs.document.sent`, `.viewed`, `.signed`, `.completed`, `.declined`, `.voided`, `.expired` (all triggers). Action `docs.send_template {templateId, contactId, values?}`.

## API (`/api/v1/m/docs`)
`GET|POST /templates`, `PATCH /templates/:id`, `GET|POST /documents` (`status`, `q`, `contactId`, cursor), `GET|PATCH /documents/:id`, `POST /documents/:id/send|remind|void`, `GET /documents/:id/pdf`.
Public (`/api/v1/public/<tenant>/m/docs`): `POST /sign/:id/open|sign|decline`, `GET /sign/:id/pdf?token=`.

## UI
Nav "E-sign" (`/m/docs/documents`): Documents, Templates; document page (text, signers, evidence trail, send, remind, cancel, PDF). Public signing page `/p/<tenant>/docs/sign`. Dashboard widget "Waiting for signatures".

## Settings
`senderName` (shown to signers; set it, otherwise "Office"), `expiryDays` (30).

## Legal note
This is a simple electronic signature (typed name + consent + evidence trail), suitable for most everyday agreements. It is not a qualified electronic signature (eIDAS QES).
