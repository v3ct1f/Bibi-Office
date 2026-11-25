# Bibi Office icons

One icon per plan, all the same glass bubble with an office window on it:

| Plan | Icon | Look |
|---|---|---|
| Starter | `plans/icon-starter.svg` | Indigo glass bubble, four panes |
| Business | `plans/icon-business.svg` | Teal bubble with a halo ring |
| Complete | `plans/icon-complete.svg` | Gold warmth inside the bubble |

Each has `-512.png` and `-1024.png` versions next to it (transparent corners) for stores, social media and the like.

## In the app
- The browser tab's icon, and the logo at the top of the menu, follow the plan of the business you are in (`apps/web/src/lib/brand.ts`, files `apps/web/public/favicon-<plan>.svg`). They change straight away when the plan is changed.
- Pages that don't belong to one business (sign-in, plans, program admin) and businesses without a plan use `favicon.svg`, which is the Starter icon.
- To change an icon: edit the SVG in `branding/options` (`make_plan_icons.py` rebuilds the three files and copies them into the app).

## `options/`
Every idea that was drawn on the way (about 40 pictures, with the small scripts that made them). Not used by the app.
