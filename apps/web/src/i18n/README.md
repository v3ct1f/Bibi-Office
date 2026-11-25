# Language and currency (web app)

## Language
- **Texts** live in `locales/<code>.ts`. `en.ts` is the master list of keys; every other file only needs the keys it translates (anything missing shows the English text, key by key).
- **Add a language:** copy `en.ts` to `xx.ts` (e.g. `ca.ts`), change `meta` (`name` as people write it, `intl` = the Intl language tag used for dates and numbers, e.g. `ca-ES`), translate the values, keep the `{placeholders}`. It shows up in the pickers by itself (`import.meta.glob`). `pnpm --filter @office/web test` checks that every file only uses real keys and placeholders.
- **Use it:** `import { t } from "../i18n/core.ts"` then `t("nav.dashboard")`, `t("dash.welcomeBack", { name })`. Counts: define `key_one` and `key_other`, call `t("key", { count })`. Links or bold text inside a sentence: `tx("start.agree", { terms: <Link/>, privacy: <Link/> })`.
- **Which language:** the person's saved choice (account, once signed in: `users.ui_locale`; browser: `localStorage office.locale`), else the first browser language we have, else English. Changing it reloads the page, so every text, date and number switches together.
- **Dates and numbers:** `intl.ts` makes every `Intl.DateTimeFormat/NumberFormat/...` that doesn't name a language (including the ones inside feature modules) use the chosen language. It must stay the first import in `main.tsx`.
- Not translated yet: the feature modules' own screens (Invoices, CRM, ...), Admin, Colleagues, the legal pages. They show English.

## Currency
- Prices are set and **billed in euros**. The picker only changes what pages that sell the product show (`/plans`, `/start`): converted amounts are marked `≈`, with a note saying so. The checkout and the in-app Plan page always show the real euro price.
- `useMoney()` (`lib/currency.tsx`) gives `eur(n)` (converted when a currency is picked) and `exact(n)` (always euros). Rates come from `GET /rates` (cached 5 minutes).
- Money maths is in `@office/core/currency` (`packages/core/src/currency.ts`): whole minor units, `minorDigits` (JPY 0, EUR 2, KWD 3), `convertMinor`.
- A business also has a **display currency** (Settings > General, `tenants.display_currency`). It never changes saved amounts or existing invoices; optionally it also becomes the invoicing module's default currency for new invoices.
