# AI summaries (`ai`)

Summaries of meeting notes, call transcripts and email threads with Claude: a short overview, key points, decisions, action items and open questions. Chosen action items become core tasks.

## Privacy and cost
- **Opt-in:** nothing is sent until an admin adds the organization's own Anthropic API key, and then only the text a person submits when they click Summarize (or a workflow runs `ai.summarize`).
- Key stored as a module secret (`x-secret`, sealed at rest, write-only in the UI and API).
- **Monthly token limit** per organization (`monthlyTokenLimit`, default 2,000,000 input + output tokens). Checked before each call; over the limit → 409, no call made.
- `keepSource` (default on): store the original text with the summary. Off → only the summary and the character count are kept.
- The text goes to Claude as untrusted data inside `<document>` tags; the system prompt tells the model not to follow instructions in it. Output is structured (JSON schema) and rendered as plain text.

## Claude API use (`src/claude.ts`, the only file that calls it)
- Official SDK `@anthropic-ai/sdk` (pinned), `client.beta.messages.parse` with a Zod output format.
- Model setting: `claude-opus-5-5` (default), `claude-sonnet-5-5`, `claude-haiku-5-5`. Effort `medium`, `max_tokens` 16000.
- Refusals: the server-side fallback is on (Opus/Sonnet). A final refusal is stored as status `refused` (no result, no event, tokens still counted).
- Errors → user messages: bad key 422, rate limited/unreachable 409, bad request 422. The SDK retries twice; timeout 120 s.
- Base URL from `ANTHROPIC_BASE_URL` (SDK default); tests and E2E point it at `tests/fake-claude.ts`, so CI never calls the real API.

## Model
- `ai_summaries`: kind `meeting | email | notes`, title, `source_text` (optional, ≤200,000 chars), `source_chars`, status `done | refused`, `result` (jsonb), model, input/output tokens, `tasks_created`, `created_by`.
- `ai_usage`: per tenant per month: requests, input tokens, output tokens.

## Permissions
| Key | Default roles |
|---|---|
| `ai:summaries.read` | member, admin |
| `ai:summaries.create` | member, admin |
| `ai:summaries.manage` (delete anyone's) | admin |

Requires `core:tasks.write`.

## Events / workflow
Event and trigger `ai.summary.created {id, kind, title, tldr, actionItems}`. Action `ai.summarize {text, kind?, title?}` → `{summaryId, status, title, tldr, actionItems}` (e.g. summarize the body of an inbound support email).

## API (`/api/v1/m/ai`)
`GET /status` (configured, model, this month's usage and limit), `GET|POST /summaries`, `POST /summaries/upload?filename=&kind=&title=` (.txt, .md, .vtt, .srt, .eml, .csv; WebVTT/SRT timings stripped), `GET|DELETE /summaries/:id` (author or admin), `POST /summaries/:id/tasks {items: [index…]}`.

## UI
Nav "Summaries" (`/m/ai/summaries`): usage bar, list, "New summary" (paste or upload), summary page (overview, key points, decisions, open questions, action items → "Create tasks", original text). Home shows an "Open tasks" card (core).

## Settings
`apiKey` (secret), `model`, `monthlyTokenLimit`, `language` (empty = same as the text), `keepSource`.
