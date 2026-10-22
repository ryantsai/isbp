# Writing the user guide

The user guide (`docs/guide/<locale>/`) is for the people who **use** IS Big Platform: employees, service desk
agents, change managers, asset managers, project teams, data engineers and administrators. It explains what each
feature is for in our IS work and how to do the everyday tasks. Design: `docs/architecture.md` §14.

The guides are also imported into the knowledge base ("Using IS Big Platform"), where Ask IS and the assistant cite
them, so write every guide so that each section stands on its own when someone lands on it from a search.

## Files

| Path                                  | What                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------- |
| `docs/guide/en/*.md`                  | The guides in English (written first; the source for translations)                    |
| `docs/guide/zh-TW/*.md`, `ja-JP/*.md` | The same guides, same file names, same headings in the same order                     |
| `docs/guide/shots/<guide>.json`       | The screenshots a guide uses (captured by `pnpm docs:screenshots` for every language) |
| `apps/web/public/help/<locale>/*.jpg` | The captured screenshots (served by the web app at `/help/<locale>/…`)                |
| `docs/guide/shots/tour.json`          | The product tour's screenshots (see "The product tour" below)                         |

After changing a guide: `pnpm docs:guide` (embeds the guides for the knowledge base) and, if screens changed,
`pnpm docs:screenshots` against the running demo stack. `pnpm docs:check` fails when the embedded copy is stale.

## Voice and format

- Write for someone doing their job, not for a developer. Second person, present tense, short sentences, plain
  words. No marketing ("powerful", "seamless").
- **Task first.** Headings are actions ("Report an issue", "Approve a request"). Each task says _when_ you need it in
  our work, then numbered steps, then **What happens next** (approvals, notifications, SLAs, who sees it).
- **UI labels in bold, exactly as the screen shows them** in that language. Take them from the catalogs
  (`packages/i18n/messages/<locale>/*.json`, `modules/<id>/messages/<locale>.json`) — never paraphrase a button.
  Navigation is written as **Group → Page** for the sidebar (e.g. **Service desk → Tickets**) and **Administration
  → Page** for admin pages; the user menu is the avatar at the top right.
- **Permissions.** When a page or button needs a role, say which one and who grants it ("If you don't see
  **Integrations**, ask an administrator for the **Integrations administrator** role").
- **Concrete examples.** Use the demo data (the laptop request over 60 000 TWD, VPN incidents, Finance ERP,
  CS-00001) and say "in the demo". Never invent records, people or numbers that the demo doesn't have.
- **Only what exists.** Check every claim against the code: pages in `apps/web/src/app`, `apps/web/src/components`
  and `modules/*/src/web`, permissions in the manifests, rules in the services, and the flows in `e2e/tests/*.spec.ts`.
  If something is API-only, say so and point to `docs/api.md`; if you're unsure it exists, leave it out.
- Tips as blockquotes (`> **Tip:** …`), side notes as `> **Note:** …`, warnings as `> **Important:** …` (zh-TW
  **提示：** / **注意：** / **重要：**, ja-JP **ヒント:** / **注:** / **重要:**). Tables for comparisons, not for steps.
- Link other guides by relative path (`[Approvals](employees.md#approve-a-request)`); link anchors are the GitHub
  slugs of the English headings — in translations keep the link targets pointing at the translated file and its
  translated heading's slug.
- Length: Start here ≈ 1 000 words; role guides 2 000–4 000; keep sections short enough to read on a phone.

## Template

```markdown
# Service desk guide

Who this is for and what it helps you do, in terms of our work (two or three sentences).

## What you can do here

- Outcome-oriented bullets (with links to the sections below)

## Work your queue

When … (why and when this matters in our work).

1. Go to **Service desk → Tickets**.
2. …

**What happens next:** …

> **Tip:** …

![The ticket workspace with the SLA timers](../../../apps/web/public/help/en/service-desk-ticket.jpg)

## How it connects

- Related guides and the records this work touches.
```

## Screenshots

Each guide lists its screenshots in `docs/guide/shots/<guide>.json`; the script captures each one in every language
from the demo stack (`E2E_BASE_URL`, default `http://localhost:3000`) and writes
`apps/web/public/help/<locale>/<name>.jpg`. Reference them from the guide as
`![Alt text](../../../apps/web/public/help/<locale>/<name>.jpg)`; the alt text says what the picture shows.

```json
[
  {
    "name": "service-desk-ticket",
    "as": "helpdesk",
    "path": "/itsm/tickets/INC-00012",
    "waitFor": "main h1",
    "steps": [
      { "click": { "role": "tab", "name": { "en": "Activity", "zh-TW": "活動", "ja-JP": "アクティビティ" } } }
    ],
    "clip": null
  }
]
```

| Field     | Meaning                                                                                                          |
| --------- | ---------------------------------------------------------------------------------------------------------------- |
| `name`    | File name (kebab-case, prefixed with the guide, e.g. `employees-portal`)                                         |
| `as`      | Demo user: `admin`, `helpdesk`, `hr.partner` or `auditor`                                                        |
| `path`    | URL path and query; prefer URL state (`?tab=…`) to clicks                                                        |
| `waitFor` | CSS selector to wait for before steps (default `main h1`)                                                        |
| `steps`   | Optional clicks: `{ "click": { "role", "name": { per locale } } }` or `{ "click": { "css" } }`, `{ "wait": ms }` |
| `clip`    | CSS selector of the element to capture (e.g. `[role="dialog"]`), or `null` for the viewport (1280 × 800)         |
| `theme`   | Optional `light` (default) or `dark`                                                                             |
| `locales` | Optional list of languages to capture (default: all three); a guide in one language lists just that one          |
| `dir`     | Optional sub-folder of `apps/web/public/help/<locale>/` to write to (the tour uses `tour`)                       |
| `from`    | Optional name of another shot whose page, user and steps this one takes; what is set here overrides it           |

Use records that the demo seed always creates, with stable references. Keep screenshots to the screens a reader
needs to recognise; 2–4 per role guide is plenty.

## The product tour

`/tour` (apps/web/src/components/tour) is an animated walk through the twelve functional areas, the architecture, the AI
gateway, the security model and five end-to-end scenarios. It is linked from **Start here**, and from the user menu for
people using Traditional Chinese. **It exists in Traditional Chinese only for now**; Design: `docs/architecture.md` §18.

- **Words are data.** All copy is in `apps/web/src/components/tour/content/<locale>*.ts` (areas and steps, architecture,
  scenarios, labels), typed by `content/types.ts`; `**label**` marks a label exactly as the screen shows it. A new language
  is a new `<locale>.ts` next to `zh-TW.ts`, listed in `content/index.ts` and `locales.ts` (the user menu offers the tour
  only in languages that have one); no component changes.
- **Every picture is a real capture.** `docs/guide/shots/tour.json` lists them (`"dir": "tour"`; most take their page from a
  guide shot with `"from"`): `pnpm docs:screenshots tour` from a freshly seeded demo, in the tour's language (the first
  screen of the language trio is captured in all three). The step's `marks` are points in the capture's pixels (1 280 × 800)
  with a short label: they take turns, one label at a time. Never draw or mock up a product screen.
- **Numbers and labels are checked.** `packages/guide/test/tour.test.ts` fails when a picture is missing, has another size,
  is not in the shot list or is shown by nothing; when a call-out lies outside its picture; when a link or anchor points at a
  guide that is not there; when a bold label is not one the zh-TW guide or catalogs contain; and when a figure of the
  overview (modules, permissions, roles, events, AI tools, notifications) differs from `docs/ai/reference.md`: after
  `pnpm docs:reference`, update the numbers in `content/zh-TW.ts`.
- **Motion.** It is a presentation page: longer moves than the product's 250 ms rule, and the same promises (HTML complete
  without script, `prefers-reduced-motion` shows everything and stops every loop, the stories never start by themselves).
  Colour, radius and type come from the theme's tokens; controls are Astryx components.
