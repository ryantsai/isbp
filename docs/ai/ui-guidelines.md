# UI guidelines

How pages look and behave, so a new module feels like part of the product. Copy from the modules named under
"See". Accessibility (WCAG 2.1 AA), three languages and 375 px phones are requirements, not extras (R27–R33).

## Page patterns

| Page            | Structure                                                                                                                                                                                                                       | See                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| List            | `PageHeader` (title, one-line description, primary action) → optional quick tabs (filters, each with a `TabsContent`) → `DataTable` with a `SearchInput` and filter selects in `toolbar` → `EmptyState` (none yet / none match) | `alm/src/web/pages/inventory-page.tsx`, `etl` Data APIs       |
| Detail          | Back link, heading with the reference and title, status badge, primary actions → summary cards → `Tabs` (overview, history, …) → aside or tab with `core.record.links` and `core.record.files`                                  | `itam` asset page, `alm` release page                         |
| Form            | `Sheet` (side, `sm:max-w-xl`) for create/edit of rich records; `Dialog` for short ones. Labels above fields, hints below, errors replace hints. Submit stays enabled; validate on submit, then live                             | `apps/web/src/components/databases/connection-form-sheet.tsx` |
| Dashboard       | KPI tiles (number + label + trend/context) → charts with a table twin → "needs attention" lists linking to filtered lists                                                                                                       | `itam` overview, `scheduler` overview                         |
| Wizard (portal) | Steps with a visible progress indicator, one decision per step, a review step, then a confirmation with what happens next                                                                                                       | `apps/web` access-request wizard, `dbaccess` request          |

- **Navigation:** sidebar entries come from the manifest (`section`, `group`, `order`). Keep a module to 1–4
  entries. Settings and administration pages go in `section: 'admin'`.
- **URLs:** list state lives in the URL (`useListState`). Open sheets (`?edit=<id>`, `?create=1`) are shareable.
  Detail pages use human references (`/itsm/INC-00042`, `/alm/erp/releases/12.1.0`), not UUIDs, when the entity
  has one.

## Status, badges and tones

- Status is **icon + text**, never colour alone. Map each status once (`badges.tsx`: status → `{ tone, icon,
labelKey }`) and reuse that map everywhere.
- Tones: `success` (done, healthy), `info` (in progress, informational), `warning` (needs attention soon),
  `destructive` (failed, blocked, overdue), `muted` (inactive, draft, unknown). The `--success`, `--info`,
  `--warning-foreground` and `--destructive` text tokens are tuned for AA on their own tints. Don't invent
  colours.
- Times: relative ("3 hours ago", `RelativeTime`) in lists, absolute (`DateTime`) in details and tooltips.

## Forms

- Use plain controlled state for small forms, react-hook-form (`@isbp/ui/form`) for large ones. Validate with the
  same Zod schema as the API when practical. Map server `VALIDATION_FAILED` issues with `applyServerErrors`.
- Every control has a visible `<Label htmlFor>`. Use `aria-describedby` for hints and errors and `aria-invalid` on
  errors. Group related fields in a `fieldset` with a `legend`.
- Show the server's error near the submit button (`role="alert"`), translated by code (`useErrorText`).
- Show async results (tests, previews) in a live region (`role="status"`, or `aria-live="polite"`).
- Code (SQL, scripts, JSON) uses `CodeEditor`, labelled with `aria-labelledby`. Tab leaves the editor.
- Secrets: password inputs with `autocomplete="new-password"`. After saving, show "Stored. Leave empty to keep it."
  and offer an explicit "Remove" when clearing is allowed.
- Destructive actions confirm with an `AlertDialog` that names the object and the consequence.

## Charts (dataviz)

- Pick the form by the job: a single number → a KPI tile; change over time → a line or bars; parts of a whole → a
  stacked bar (not a pie); ranking → horizontal bars.
- One y-axis. Categorical colours in a fixed order, following the entity rather than its rank. Status colours are
  reserved for status, with a label or icon.
- Two or more series need a legend. Every chart has a **table twin** (a "Table" toggle, or a visually hidden
  table) and a text summary. Hover tooltips are a bonus, never the only way to read values.
- Use thin marks and recessive grid lines. Charts scroll inside their container at 375 px.

_See:_ `modules/itam/src/web` (overview charts with table toggle), `modules/scheduler/src/web` (runs per hour).

## Motion

Use the `motion` wrappers (`FadeIn`, `Stagger`, `StaggerItem`) for entrance and list changes. Keep it short
(≤ 250 ms) and purposeful. `MotionConfig reducedMotion="user"` is global. CSS transitions need
`motion-reduce:transition-none`.

## Accessibility checklist

- Landmarks: one `h1` per page (`PageHeader`). Sections use headings or `role="region"` + `aria-labelledby`.
- Everything is keyboard operable: the focus is visible (`focus-visible:ring-[3px] ring-ring/50`), there are no
  traps, and dialogs return focus. Drag-and-drop has a keyboard alternative ("Move to…").
- Icon-only buttons have `aria-label` (translated). Decorative icons are `aria-hidden`.
- Tables have a `label` (DataTable). Clickable rows also contain a real link or button.
- `axe` must find nothing in light and dark mode. Run it on open sheets, dialogs and every tab.

## Layout at 375 px

- Grids are `grid-cols-1` until a breakpoint. Children with truncated text need `min-w-0`.
- Tables hide secondary columns with `hidden sm:table-cell` / `md:` / `lg:` (keep the identifying column and
  status). Wide content scrolls in its own container.
- Sheet footers stack (`flex-col-reverse gap-2 sm:flex-row`).

## Terminology

Use these terms consistently (R27). zh-TW uses Taiwan IT vocabulary; ja-JP uses Microsoft-style terms with a
half-width space between Japanese and Latin words (`データ API`).

| English                | zh-TW              | ja-JP                        |
| ---------------------- | ------------------ | ---------------------------- |
| user / person          | 使用者 / 人員      | ユーザー                     |
| group                  | 群組               | グループ                     |
| role                   | 角色               | ロール                       |
| permission             | 權限               | アクセス許可                 |
| department             | 部門               | 部署                         |
| audit log              | 稽核日誌           | 監査ログ                     |
| session                | 工作階段           | セッション                   |
| approval / approve     | 簽核 / 核准        | 承認                         |
| request (portal)       | 申請               | 申請                         |
| ticket                 | 工單               | チケット                     |
| attachment             | 附件               | 添付ファイル                 |
| settings               | 設定               | 設定                         |
| search                 | 搜尋               | 検索                         |
| save / cancel / delete | 儲存 / 取消 / 刪除 | 保存 / キャンセル / 削除     |
| database / connection  | 資料庫 / 連線      | データベース / 接続          |
| job / run / schedule   | 作業 / 執行 / 排程 | ジョブ / 実行 / スケジュール |
| module                 | 模組               | モジュール                   |
| sign in                | 登入               | サインイン                   |

## i18n mechanics

- Module text lives in `modules/<id>/messages/<locale>.json` under the namespace `<id>`. Read it with
  `useTranslations('<id>')` or `useTranslations('<id>.area')`. Keys referenced from manifests use the full path
  (`<id>.nav.home`).
- Use ICU for plurals and selects (`{count, plural, one {# job} other {# jobs}}`). zh-TW and ja-JP may use `other`
  only. Never concatenate translated fragments. Pass values instead.
- Server-generated text that users see (notifications, emails) comes from the catalogs in the recipient's locale.
  Don't put English into payloads for display.
- Translate `aria-label`s, toasts, empty states and error messages too.
