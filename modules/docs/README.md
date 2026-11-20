# Docs & e-sign (`docs`)

The company's document library, and documents sent for signature:
- A library with folders and search for any file: PDF, photos, Word, Excel, PowerPoint, text and CSV, at most 7 MB each.
- Signature requests:
  - Start from an uploaded PDF, or from a template with fill-ins that becomes a PDF.
  - Place signature, initials, name, date and text boxes on the pages.
  - Each signer gets a private link: emailed, or copied and sent yourself.
- Signing order, automatic reminders, and an expiry date.
- The signed copy: every value drawn onto the pages, plus a **signing certificate** page with signers, times, IP addresses, devices, the full history, and the fingerprint (SHA-256) of the original file.
- Links to Contacts (pick signers, plus a "Documents" tab on contact pages) and HR (signed documents about a team member appear in their HR documents).

Turned off by default. An owner or admin adds it under **Add features**. Turning it off hides the pages, makes the API answer 403, and stops every signing link (404), but keeps all data.

## Who can do what

| Permission | Lets you | Default roles |
|---|---|---|
| `docs:library.read` | See shared documents and your own; see and sign documents sent to you | viewer, member, manager, admin, owner |
| `docs:library.send` | Upload files; prepare and send documents for signature; use templates | member, manager, admin, owner |
| `docs:library.manage` | See and change everyone's documents; manage templates; send a test email | manager, admin, owner |

**Who sees a document:**
- **"Everyone in the team"** documents: anyone with read access.
- **"Only people involved"** documents: the person who added it, team members who sign it, the team member it's about, and managers.
- Uploads default to the team. Signature requests default to private.
- Only the person who added a document, or a manager, can change, send, cancel or delete it.

## Signing

1. **Prepare.** From **Docs → New signature request**:
   - Upload a PDF; or
   - Pick a template, fill in its fill-ins (pre-filled from a contact or team member), and pick signers. Each signer gets a signature, name and date box at the end.

   Then on the document page:
   - Pick a box type and click on the page; drag boxes to move them, and use the corner to resize.
   - Add signers from the team, from Contacts, or anyone by name and email.
   - Choose options: signing order, a message, an expiry date (default: settings), reminders (default: settings), and the team member it's about.
2. **Send.** Every signer needs at least one signature or initials box. Each signer gets a private link: `/p/<company id>/docs/sign/<secret>`.
   - **With email set up:** the link is emailed. When the order matters, only the next signer is emailed.
   - **Without email:** the sender sees each link with a copy button.
3. **Sign.** The signer opens the link with no account. They:
   - read the PDF;
   - click the highlighted boxes to type or draw their signature;
   - fill in text boxes;
   - agree to sign electronically;
   - finish, or decline with a reason.

   Name and date are filled in automatically. Team members who sign also see the document under **Docs → To sign**, with a **Sign now** button.
4. **Done.** When the last signer signs:
   - The signed copy and its certificate page are created.
   - Everyone, and the sender, gets the signed copy by email.
   - `docs.request.completed` is emitted.
   - The signing link keeps working to download the signed copy.

**Links are the key.** Anyone with a link can sign as that person, as with other e-sign services. Links stop working when the request is cancelled, declined, expired or deleted. If a link went to the wrong person, use **New link** on the document: the old link stops working at once.

**Legal note.** This is a simple electronic signature with an audit trail: who, when, IP address, device, and the original file's fingerprint. It is not a qualified, certificate-based signature.

## Templates

Templates are plain text:
- Lines starting with `#` or `##` are headings.
- Lines starting with `-` are bullet points.
- Fill-ins look like `{{price}}`.

**Known fill-ins** are pre-filled:

| Fill-in | Filled from |
|---|---|
| `contact.name`, `contact.firstName`, `contact.lastName`, `contact.email`, `contact.phone`, `contact.company` | The chosen contact |
| `employee.name`, `employee.email` | The chosen team member |
| `workspace.name` | Your company |
| `today` | Today's date |

Any other name becomes a field to fill in. Empty fill-ins print as a blank line.

The standard PDF fonts cover Western European letters only. Other characters print as `?`.

## Settings

Under **Add features → Docs & e-sign → Settings**:
- **Email:** send-from address, sender name, and outgoing SMTP server, port, security, user name and password. You can reuse your Support mailbox's details. Without them nothing is emailed, and senders copy links instead.
- **Remind signers every (days):** default 3; 0 = off. The `reminders` job runs hourly and sends at most 5 reminders per signer.
- **Signing links expire after (days):** default 30; 0 = never. The same job marks requests as expired and tells the sender.

Mail hosts on private networks and unencrypted connections are refused in production, as in Support. `DOCS_ALLOW_PRIVATE_MAIL_HOSTS=true` allows them, for local testing only.

## HR and Contacts

- **HR:** set **File with a team member** on a request, or start from a template "about a team member". When it's signed, HR lists it in that person's **Documents** as a contract that opens in Docs. The file itself stays in Docs.
- **Contacts:** picking a contact as a signer links the document to them. The contact page gets a **Documents** tab with a **New document for signature** button.

## Events (for workflows)

| Event | When |
|---|---|
| `docs.request.sent` | A request is sent (title, signers' names and emails) |
| `docs.request.signed` | One signer signs |
| `docs.request.completed` | Everyone has signed (includes `employeeId` and `contactId` when set) |
| `docs.request.declined` | A signer declines (with their reason) |
| `docs.request.expired` / `docs.request.cancelled` | The request expired, or the sender cancelled it |

## Data

All tables have tenant row-level security:

| Table | Holds |
|---|---|
| `docs_documents` | Library files and requests: original and signed PDF, options |
| `docs_signers` | Signers, link secret, signature (typed text or PNG), IP address and device |
| `docs_fields` | Boxes on the pages (fractions of the page, from the top left) |
| `docs_templates` | Templates |
| `docs_activity` | History, printed on the certificate page |

## Platform pieces this module added

- **Public module routes:** `publicRoutes` in the SDK, at `/api/v1/public/t/<tenantId>/m/<key>/…`.
  - No sign-in and no permissions: the module checks its own secret.
  - Limited to 120 requests per minute per IP address.
  - An unknown company, an inactive company and a disabled module all answer the same 404.
- **Public pages:** `publicPages` in the module UI, at `/p/<tenantId>/<key>/…`, outside the signed-in app.

## Tests

- `modules/docs/tests/pdf.test.ts`: fill-ins, template layout across pages, broken PDFs, the signed copy with its certificate page, and folder names.
- `apps/api/test/docs.test.ts` covers:
  - roles and file checks, folders, and private documents;
  - signing without email, using copied links;
  - signing order with real emails and team members signing in the app;
  - filing in HR;
  - templates;
  - declining, cancelling and replacing links;
  - reminders and expiry;
  - isolation between companies, and links stopping when the module is off.
- `apps/web/e2e/docs.spec.ts` covers, in the browser:
  - the library;
  - preparing and sending a PDF;
  - a customer signing on the public page (drawn signature);
  - a template signed from the app.
