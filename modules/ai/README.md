# AI summaries (`ai`)

Meeting notes and support tickets summarised by Claude, using the company's own Anthropic API key:
- **Meetings:** paste notes, or upload a transcript (Teams/Zoom `.vtt`, `.srt`, `.txt`, `.md` or Word `.docx`). Claude returns a summary, key points, decisions, action items with owner and due date, open questions, and a follow-up email draft.
- **Action items → Tasks:** tick the items and press **Create N tasks**. Owners are matched to team members by full name, or by first name when only one person has it.
- **Support tickets:** an **AI summary** panel on each ticket gives a short recap and a suggested reply. Internal notes are used for context but never quoted in the reply.
- **Contacts and Deals:** a meeting can be linked to a contact and a deal. Contact pages get a **Summaries** tab, and deal pages a side panel, each with a **New meeting summary** button.
- **Usage:** tokens used per month and an estimated cost, with an optional monthly limit.

Turned off by default. An owner or admin adds it under **Add features**, then sets the API key in its **Settings**. Turning it off hides the pages and makes the API answer 403, but keeps all data.

## Who can do what

| Permission | Lets you | Default roles |
|---|---|---|
| `ai:summary.read` | See team summaries and your own | viewer, member, manager, admin, owner |
| `ai:summary.write` | Create, edit, regenerate and delete your own summaries; create tasks from action items | member, manager, admin, owner |
| `ai:summary.manage` | See and change everyone's summaries; see usage; test the key | manager, admin, owner |

Summaries are **Everyone in the team** (default) or **Only me**. Managers see all of them.

## Settings

Under **Add features → AI summaries → Settings**:
- **Anthropic API key:** stored encrypted (module secret). Without it, the pages show a "not set up yet" notice and nothing is sent.
- **Model:** Claude Opus 5.5 (default, best results), Sonnet 5.5, or Haiku 5.5 (cheapest). Opus and Sonnet use server-side fallbacks when the model is busy.
- **Write summaries in:** `auto` (default: the language of the meeting or customer) or a fixed language.
- **Monthly token limit:** default 1,000,000; 0 = no limit. A request that would pass the limit is refused before anything is sent (429).

The **Usage** tab shows the last 6 months and a **Test the API key** button.

## Privacy

- The notes, transcript or ticket conversation are sent to Anthropic under the company's own key and account terms. The new-meeting page says so above the Summarise button.
- Calls always go to `https://api.anthropic.com`. `AI_API_BASE_URL` overrides this for tests and local development only; a server-wide `ANTHROPIC_BASE_URL` is ignored, so a company key can't be redirected.
- The text is fenced in the prompt, and Claude is told never to follow instructions written inside it.
- The source text is kept with the summary (up to 400,000 characters) so it can be summarised again. Deleting the summary deletes it.

## How a request is billed

Each call logs its tokens in `ai_usage`, including calls that fail after Anthropic has charged for them (a refusal, a cut-off or unreadable answer). The error is shown to the user, and the usage row is still kept (see `ModuleError` `keepChanges` in ARCHITECTURE).

## Events (for workflows)

| Event | When |
|---|---|
| `ai.summary.created` | A meeting or ticket summary is created (kind, title, action item count, contact, deal, ticket) |
| `ai.action_items.tasks_created` | Tasks were created from action items |

## Data

All tables have tenant row-level security:

| Table | Holds |
|---|---|
| `ai_summaries` | Meeting and ticket summaries: source text, links, summary, key points, decisions, open questions, follow-up email, suggested reply, model and tokens |
| `ai_action_items` | Action items: text, owner, due date, and the task created from it |
| `ai_usage` | One row per Claude call: purpose, model, tokens, user |

## Platform pieces this module added

- **`ModuleError` with `keepChanges`:** the platform commits the request's transaction, then answers with the error.
- **`host.Slot`:** module pages can render other modules' `entity.*` slots. Support's ticket page renders `entity.sidebar:ticket`, CRM's deal page `entity.sidebar:deal`.

## Tests

No real key or credit is needed: `tests/fake-claude.ts` stands in for the Anthropic API. It answers queued replies, or makes a plausible answer from the notes (lines with "will" become action items).
- `tests/transcript.test.ts`: VTT/SRT/Word transcript reading.
- `apps/api/test/ai.test.ts`: setup and roles, meeting summaries and owner matching, tasks, editing and regenerating, ticket summaries, errors and billed failures, the monthly limit, privacy between users and companies.
- `apps/web/e2e/ai.spec.ts`: adding the key, a Teams transcript to summary, task and follow-up email, editing, and the ticket side panel.

**Local development without a key:** start the API with `--fake-ai` (launch config `api-fake-ai`). Any API key then works and nothing leaves the computer.
