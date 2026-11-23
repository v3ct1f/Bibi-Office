# Leads (`@office/module-leads`)

People who might become customers, before they are contacts or deals. Add them by hand, from a public web form or from a
workflow; follow up; then convert the good ones into a contact (and company), with a CRM deal if CRM is on.

## Model

```
lead (status new → contacted → qualified → converted, or disqualified; reopen back to an open status)
  └─< activity (note | call | meeting | email | status | system)
form (one per business: public "contact us" page, off until turned on; the token in its link is the only key)
```

- A lead needs someone to reach: a name, an email, a phone number or a company (DB check too).
- New leads are owned by whoever added them; web-form leads start unassigned. Owners must be active members.
- Logging a call, email or meeting on a **new** lead marks it **contacted**.
- **Convert** (`POST /leads/:id/convert { company, deal? }`): reuses the contact with the same email (else creates one) and the
  company with the same name, case-insensitive (else creates one); stores both ids on the lead. Converted leads are final.
  With `deal`, `leads.lead.converted` carries `deal: { title, valueCents, currency }` and CRM opens that deal (see CRM README).
- **Web form**: `GET/POST /api/v1/public/t/<tenantId>/m/leads/form/:token`, shown at `/p/<tenantId>/leads/form/<token>`.
  Name and email required; phone/company optional per form settings. Hidden honeypot field `website`: filled = thanked, nothing kept.
  If the email already has an open lead, the message is added to that lead instead of a new one. Replacing the link stops the old one.
  Public routes are rate-limited per IP by the platform.

## Settings

| Key | Default | Notes |
|---|---|---|
| `currency` | `EUR` | Default for a lead's possible value |

## API (`/api/v1/m/leads`)

| Method | Path | Permission |
|---|---|---|
| GET | `/config` · `/summary` · `/people` · `/leads?view=open\|all\|<status>&source&ownerId&q&limit&cursor` · `/leads/:id` · `/form` | `leads:lead.read` |
| POST/PATCH/DELETE | `/leads` · `/leads/:id` | `leads:lead.write` |
| POST | `/leads/:id/status { status, reason? }` · `/leads/:id/activities { kind, body }` · `/leads/:id/convert` | `leads:lead.write` |
| PATCH / POST | `/form` · `/form/replace-link` | `leads:form.manage` |

Roles when a business adds the feature: manager all three, member read + write, viewer read.

## Events (payload v1)

`leads.lead.{created,updated,status_changed,qualified,disqualified,converted,deleted}`, `leads.activity.logged`.
Lead payload: `{ id, name, firstName, lastName, email, phone, companyName, source, status, ownerId, valueCents, currency, contactId, companyId }`;
`status_changed` adds `fromStatus`; `disqualified` adds `reason`; `updated` adds `changes`; `converted` adds `deal` (or null).

## Workflow actions

- `leads.create_lead` `{ name?, email?, phone?, company?, message?, source? }` → `{ leadId, name }`
- `leads.set_status` `{ leadId, status, reason? }` → `{ leadId, status }`
- `leads.log_activity` `{ leadId, body }` → `{ activityId }`

## Metrics

`leads.new_leads`, `leads.converted`, `leads.conversion_rate` (converted ÷ decided in the period), `leads.open_leads` (now).

## UI slots

Leads list (`nav.main`, tabs To work on / Qualified / Converted / Disqualified / All, source filter, search), "+ New → Lead"
(`global.create`), lead page (status bar, timeline, Convert / Disqualify), "Leads" dashboard widget, **Web form** settings (`nav.settings`),
public form page.

## Not yet

Importing leads from a spreadsheet, an embeddable form snippet (the link works in an iframe or as a button), email notifications for
new web-form leads (use a workflow on `leads.lead.created`), lead scoring.
