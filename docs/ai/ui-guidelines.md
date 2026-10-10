# UI guidelines

How pages look and behave, so a new module feels like part of the product. Copy from the modules named under
"See". Accessibility (WCAG 2.1 AA), three languages and 375 px phones are requirements, not extras (R27–R33).

## Look and feel

The visual language follows Tokyo Electron's logo: TEL blue with a splash of green, square-cut shapes, and a compact,
information-dense layout that shows the essentials first. All of it lives in tokens (`apps/web/src/app/globals.css`)
and the shared components: page code uses the tokens and never hard-codes colours, radii or fonts.

- **Colour.** `primary` is the logo blue deepened for AA (white text on it); `brand` is the logo blue itself and
  `brand-green` its green square. The green is a splash: it marks "you are here" (the current page in the navigation,
  the brand mark) and nothing else, never a status (that is `success`) or a decoration. The navigation rail is TEL navy
  (`sidebar` tokens) in both themes; content surfaces stay quiet (`background` light grey, `card` white). Every text
  pair, status text on its own tint included, is checked for AA in light and dark: re-check when you change a token.
- **Type.** IBM Plex everywhere, self-hosted so Windows, macOS, Linux and phones render the same: Plex Sans (Latin,
  variable), Plex Sans TC / JP (loaded only for zh-TW / ja-JP, split by unicode-range by `apps/web/scripts/fonts.mjs`)
  and Plex Mono (code, references). Scale: page title `text-xl` semibold, card title 15 px semibold, body and table
  text `text-sm`, labels 13 px medium, meta `text-xs`. Sentence case only: no all-caps labels or eyebrows (they
  don't exist in Chinese and Japanese anyway). Numbers in tables are tabular.
- **Shape.** Radii are 2 / 4 / 6 / 8 px (`rounded-sm` … `rounded-xl`): controls 4 px, cards 6 px, chips 3 px.
  Surfaces are flat: a 1 px border, no resting shadow (shadows are for overlays and hover lifts).
- **Density.** Controls are 32 px (`h-8`; `sm` 28, `lg` 36), table rows about 36 px, cards pad 16 px, page sections
  sit 16–20 px apart, the content area is up to 1,600 px wide. Don't add your own padding on top of the shared
  components' (no `p-6` cards, no `gap-8` page grids).
- **Show the essentials first.** A record form opens on its required fields and the one or two everyone fills; the
  rest goes behind one `OptionalFields` row ("More details", with a `hint` naming what is inside and the `filled`
  count). Detail pages lead with the facts people act on; history, technical details and rarely used settings sit
  behind a `Disclosure` or a tab.
- **Icons on a surface** (record headers, KPI tiles, empty states, quick links) use `IconTile` (`@isbp/ui/icon-tile`):
  one square tinted by a text colour class (`text-success`, `text-muted-foreground`, …). Event histories use
  `Timeline` (`@isbp/ui/timeline`) with an `IconTile size="xs"` as the indicator.

### Add-on components (ReUI)

The add-on collection is [ReUI](https://reui.io) in its compact `radix-mira` style: shadcn/ui-compatible, Radix-based
and made for dense admin screens (data grid, filters, timeline, tree, kanban, gantt, date selector). `IconTile` and
`Timeline` come from it. To add another, read it first with `pnpm dlx shadcn@latest view @reui/<name>` in
`packages/ui` (the registry is in `packages/ui/components.json`), then port it by hand into
`packages/ui/src/components/<name>.tsx`: relative imports (`../lib/utils`), our tokens and square radii, `'use client'`
when it holds state, every string from a catalog in three languages, and a credit line at the top. Don't run
`shadcn add` for ReUI items: it would install their `cn` placeholder as an npm package. Prefer a component we already
have (`DataTable`, `FilterBar`, `Stepper`) over a second one that does the same.

## Page patterns

| Page            | Structure                                                                                                                                                                                                                                                                                   | See                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| List            | `PageHeader` (title, one-line description, primary action) → `SectionTabs` when the area has sibling pages → quick tabs (each with a `TabsContent`) → `DataTable` with a `FilterBar` in `toolbar` → `EmptyState` / `ErrorState`                                                             | `alm/src/web/pages/inventory-page.tsx`, `etl` Data APIs       |
| Detail          | `DetailHeader` (back link to the list, reference · type, title, status, primary action + ≤ 2 secondary + "More") → banner for what needs the viewer → summary cards → `Tabs` (overview, history, …) → aside with the fields people edit first, then `core.record.links`/`core.record.files` | `itam` asset page, `alm` release page                         |
| Form            | `Sheet` (`side="right"`, `sm:max-w-xl`, `SheetForm` + sticky `SheetFooter`, `?create=1`/`?edit=<id>`) for any record form with more than 4 fields; `Dialog` for at most 4 fields or one decision; a full page only for builders with a canvas or code editor                                | `apps/web/src/components/databases/connection-form-sheet.tsx` |
| Dashboard       | KPI tiles (`StatTile`: number + label + trend/context) → charts with a table twin → "needs attention" lists linking to filtered lists. Counts that represent problems are links                                                                                                             | `itam` overview, `scheduler` overview                         |
| Wizard (portal) | `Stepper` + `StepTransition`, one decision per step, a review step, then a confirmation (`SuccessMark`) with what happens next                                                                                                                                                              | `apps/web` access-request wizard, `dbaccess` request          |

- **Navigation:** the sidebar is personal entries first (Home, My work, Requests, My devices, Knowledge), then one
  collapsible group per area, then one **Administration** row (the `/admin` hub). Declare one top-level entry per
  module whose pages are `children` (1–4 of them), sub-pages behind `SectionTabs` as that page's `tabs`, and every
  settings page as `section: 'admin'` with an `area` and a one-line `description` (a hub card). Gate entries on the
  permission of the people who **work** there; what someone only takes part in (a review, a check, a task) reaches
  them through My work (`manifest.work`, recipe 29). Top-level rows need distinct icons (the collapsed rail shows only
  icons). Labels name the page for the person ("Asset settings", "Who has access"), never the mechanism. Sibling
  pages of one area are `SectionTabs`, not header buttons that repeat sidebar entries.
- **URLs:** list state lives in the URL (`useListState`). Open sheets (`?edit=<id>`, `?create=1`) are shareable.
  Detail pages use human references (`/itsm/INC-00042`, `/alm/erp/releases/12.1.0`), not UUIDs, when the entity
  has one.
- **Actions:** one primary action per page: the next step in the record's life ("Submit for approval", "Resolve"),
  not a generic Status menu. At most 2 secondary buttons; the rest goes in "More". Destructive actions are never
  plain header buttons: they sit last in "More" and confirm with an `AlertDialog`. Don't repeat an action in the
  header and in a card.
- **Wording:** "New <thing>" creates a record, "Add <thing>" puts an existing thing into a collection (members,
  software on the approved list). Never "Register" or "Create". Card footers say "View all"; exports say
  "Export CSV".
- **Nesting:** no bordered box inside a bordered box inside a card; use a heading and a divider for the second
  level.

### List page

```tsx
const [state, set] = useListState({ sort: '-updatedAt' });
const { data, isLoading, isFetching, error, refetch } = useApiQuery<Page<Asset>>('/itam/assets', state);
<DataTable
  label={t('hardware.title')}
  columns={columns} // identity + status: meta.priority 1 (default); secondary: 2; nice-to-have: 3
  data={data?.items ?? []}
  total={data?.total ?? 0}
  page={state.page}
  pageSize={state.pageSize}
  loading={isLoading}
  fetching={isFetching}
  error={error}
  onRetry={() => refetch()}
  getRowId={(a) => a.tag}
  toolbar={
    <FilterBar
      search={<SearchInput value={state.q ?? ''} onChange={(q) => set({ q })} placeholder={t('search')} />}
      filters={[
        { id: 'category', label: t('category'), primary: true, control: <CategorySelect …/>, value: categoryName, onClear: () => set({ category: undefined }) },
        { id: 'location', label: t('location'), control: <LocationSelect …/>, value: locationName, onClear: () => set({ location: undefined }) },
      ]}
      onClearAll={() => set({ category: undefined, location: undefined, q: undefined })}
    />
  }
  empty={filtered ? <EmptyState variant="filtered" onClearFilters={clear} /> : <EmptyState … />}
/>
```

- `DataTable` columns: `meta.priority` is measured on the **table's own width** (container query): `2` hides below
  672 px, `3` below 1,200 px (a 1,440 px laptop with the sidebar open). The identifying column and status stay
  (priority 1); give the identifying column `meta.wrap` so long titles wrap on a phone. Put the essentials of hidden
  columns into the identifying cell with `<DataTableSummary>` (shown only while they're hidden). Drop columns that are mostly "—". No table may scroll sideways at 1,280 or 1,440 px.
- `FilterBar`: search + at most 2 `primary` filters inline; the rest behind **Filters** (popover; a bottom sheet on a
  phone, which then holds all filters). Applied filters show as removable chips with Clear all.
- Quick tabs (`Tabs` that filter the list) sit directly under the header (or `SectionTabs`), above the table card.
- Coming back from a detail page: `BackLink` restores the list's filters, page and sort (remembered per list by
  `useListState`) and the opened row flashes once (`getRowId` must be set). `highlightId` flashes a row you choose
  (the record just created).

### Detail page

```tsx
<DetailHeader
  back={{ href: '/itam/hardware', label: t('nav.hardware'), highlight: asset.tag }}
  icon={<LaptopIcon />}
  reference={`${asset.tag} · ${categoryName}`}
  title={asset.name}
  status={<MappedStatus map={assetStatus} value={asset.status} t={t} animate />}
  meta={t('assignedTo', { name })}
  primaryAction={<Button onClick={assign}>{t('assign')}</Button>}
  actions={[{ label: t('edit'), icon: <PencilIcon />, onSelect: () => setEdit(true) }]}
  menu={[
    { label: t('recordWipe'), onSelect: openWipe },
    { label: t('dispose'), destructive: true, onSelect: () => setConfirmDispose(true) },
  ]}
/>
```

- Back link: always the list's name, to the list the person came from (problem → Problems, not Tickets). Status
  shows once (header **or** a stepper), not again in a Details row. Titles wrap; never `truncate` an `h1`.
- On a phone only the primary action and "More" stay in the header; secondary actions move into "More".

### Sections of an area

```tsx
<PageHeader title={t('scheduler.title')} actions={<Button>{t('newJob')}</Button>} />
<SectionTabs
  label={t('scheduler.sections')}
  items={[
    { href: '/scheduler', label: t('overview'), match: 'exact' },
    { href: '/scheduler/jobs', label: t('jobs') },
    { href: '/scheduler/runs', label: t('runs') },
  ]}
/>
```

Each tab is its own URL (a query such as `?tab=approved` works too), so deep links and list state keep working.
`prefix` matching (default) keeps a tab active on the detail pages below it.

## Status, badges and tones

- Status is **icon + text**, never colour alone. Map each status once (`badges.tsx`:
  `defineStatusMap({ code: { tone, icon, labelKey } })`) and render it everywhere with `StatusBadge` or
  `MappedStatus` from `@isbp/ui/status` (one style: icon + text chip; no dots, no coloured text alone).
- Tones: `success` (done, healthy), `info` (in progress, informational), `warning` (needs attention soon),
  `destructive` (failed, blocked, overdue), `muted` (inactive, draft, unknown), `primary` (unread and pending
  counts, everywhere the same). The `--success`, `--info`, `--warning-foreground` and `--destructive` text tokens are
  tuned for AA on their own tints. Don't invent colours.
- **When not to badge:** non-status attributes (environment, sign-in source, category, value tier, criticality,
  scores) are plain text or a `neutral` outline chip, never success/warning/destructive. Where one value dominates a
  column (Active, In use, Production), render it `quiet` (muted text) and give a chip only to the exceptions
  (Suspended, Retired, Missing). One badge per fact: don't show the same status in the header and a Details row.
  Scores and usage are a `Meter` with `primary`/`neutral` tone.
- Status everywhere answers "what's happening, who is it waiting for, what's next": pair the badge with one line
  ("Waiting for Mei Lin · since 2 days").
- Times: relative ("3 hours ago", `RelativeTime`) in lists, absolute (`DateTime`) in details and tooltips.

## Forms

- Surface: `Sheet` for record forms with more than 4 fields, `Dialog` for at most 4 fields or one decision (see
  Page patterns). Put `SheetBody` and `SheetFooter` inside a `SheetForm` so the footer (primary action) stays
  visible on a phone; `DialogFooter` sticks to the bottom of a scrolling dialog. Pass `dirty={form.formState.isDirty}`
  to `SheetContent` so Esc or a click outside asks "Discard changes?".
- Use plain controlled state for small forms, react-hook-form (`@isbp/ui/form`) for large ones. Validate with the
  same Zod schema as the API when practical. Map server `VALIDATION_FAILED` issues with `applyServerErrors`.
- Validation messages are plain language in three languages ("Required", "Enter at least 2 characters"): the web
  app installs `useZodErrorMap()` (`@isbp/ui/validation`) globally, so Zod schemas need no messages. Write custom
  refinement messages through the catalog, not in English in the schema. The error replaces the hint
  (`FormDescription` hides while the field is invalid).
- Every control has a visible `<Label htmlFor>`. Use `aria-describedby` for hints and errors and `aria-invalid` on
  errors. Group related fields in a `fieldset` with a `legend`. A yes/no field is one row: `[✓] Label` (the label is
  part of the click target), or a `Switch` row when it takes effect at once; `FormFields` does this for `boolean`.
- Show the server's error near the submit button (`role="alert"`), translated by code (`useErrorText`).
- Quick reversible actions confirm with a toast that offers Undo (`toast.success(text, { action })`) instead of
  a dialog. Error toasts stay 8 s; an error that blocks the task also shows inline.
- Show async results (tests, previews) in a live region (`role="status"`, or `aria-live="polite"`). Settings that
  save on change show `<SavedIndicator at={savedAt} />`.
- Optional fields go behind one `OptionalFields` row (`@isbp/ui/optional-fields`) after the essentials and before
  custom fields: forms with 5+ fields, 2+ optional ones. Keep required fields, fields that change what else shows,
  identifying fields and custom fields visible. Pass `filled={countFilled(...)}` so an edit form shows that hidden
  fields hold data, and `hint={list([...labels])}` (`useFieldList`) with the default "More details" label. Fields
  stay mounted and the row opens itself when one of them is invalid. A section that already has a name (Purchase
  details, Advanced settings) keeps it as `label`.
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

Motion explains a change (something added, removed, moved, opened, finished); it never decorates a page load. Use
the shared components from `@isbp/ui/motion` (and `stepper`, `meter`, `section-tabs`, `status`), not hand-rolled
`motion/react` in modules.

- **Tokens:** `duration` fast 120 / base 180 / slow 240 ms (CSS `duration-(--motion-fast|base|slow)`), easings
  `ease.enter` / `ease.exit` / `ease.move` (CSS `ease-enter|exit|move`), `spring.indicator` for tab underlines and
  pills. Distances: content 4 px, overlays 8 px. **Nothing over 250 ms** except continuous indicators (spinners,
  shimmer, typing dots, indeterminate bars).
- **Reduced motion:** `MotionConfig reducedMotion="user"` is global, and every shared component also renders the
  end state with **no fade or stagger** (check `useReducedMotion()` from `@isbp/ui/motion` in your own code; CSS
  transitions need `motion-reduce:transition-none`). Loops become static.
- **No entrance on page load:** content rendered on the server or present when the page opens doesn't fade in
  (`useEntranceMotion()` is false during hydration). The page itself fades 150 ms in the shell. `PageHeader` and
  `DataTable` rows don't animate in.

| Interaction                       | Use                                                                         | Timing                  |
| --------------------------------- | --------------------------------------------------------------------------- | ----------------------- |
| A section appears after an action | `FadeIn` (opacity + 4 px)                                                   | 180 ms                  |
| Cards or tiles appear             | `Stagger` + `StaggerItem` (30 ms × the first 6; none over 24 children)      | 180 ms                  |
| Skeleton → content                | `Reveal loading={isLoading} skeleton={…}` (skeleton shaped like the result) | 150 ms                  |
| Item added / removed / reordered  | `AnimatedList` + `AnimatedItem` (`highlight` for live arrivals)             | 180 ms in, ≈ 200 ms out |
| Expand / collapse                 | `Collapse` + `CollapseChevron`, or `Disclosure`                             | 180 ms                  |
| Section tabs / tabs               | `SectionTabs`, `Tabs` (indicator slides; content fades)                     | spring; 150 ms          |
| Wizard step                       | `Stepper` + `StepTransition step={i}` (direction-aware; focuses the step)   | 180 ms                  |
| Value / usage / progress          | `Meter` (width from 0, then old → new)                                      | 250 ms                  |
| Live number                       | `AnimatedNumber` (real value first; animates later changes only)            | 250 ms                  |
| Status changes in place           | `StatusBadge changeKey={code}` / `MappedStatus animate`                     | 180 ms                  |
| Done / saved                      | `SuccessMark`, `SavedIndicator at={savedAt}`                                | 240 ms; chip shows 2 s  |
| Clickable tile                    | `Card interactive` (lift 2 px + shadow)                                     | 150 ms                  |
| Loading after a click / refetch   | `NavProgress active` (shell), `DataTable fetching` (2 px bar after 150 ms)  | loop                    |
| Back to a list                    | `BackLink` + `DataTable` (opened row flashes once)                          | 1 s hold + fade         |

```tsx
<AnimatedList className="divide-y">
  {items.map((a) => (
    <AnimatedItem key={a.id} highlight={a.id === arrivedId}>
      <ApprovalRow approval={a} />
    </AnimatedItem>
  ))}
</AnimatedList>

<Disclosure summary={t('advanced')}>
  <AdvancedFields />
</Disclosure>

<Stepper steps={steps} current={step} onStepClick={setStep} />
<StepTransition step={step}>{renderStep(step)}</StepTransition>
```

Charts: bars grow from the baseline in 250 ms total with per-item delays capped at 120 ms. Sheets slide in 240 ms
and out 180 ms; dialogs fade + scale 0.98 in 180 ms and out 120 ms; popovers and menus 120 ms.

## States

Every view that loads data has three states besides "loaded", and none of them may pretend to be another.

- **Loading:** a skeleton shaped like the result (`Skeleton`, `Reveal`), `DataTable loading`. Refetches keep the old
  content and show the 2 px bar.
- **Error:** `ErrorState` (`@isbp/ui/empty-state`) says what couldn't load, shows the translated error and a
  **Retry**; a 403 reads "You don't have access to this" (no retry), a 404 "Not found". `DataTable` shows it when
  given `error` (pass `error={error} onRetry={() => refetch()}` from the query) and keeps old rows with a compact
  "Couldn't refresh" bar when a background refetch fails. Cards and panels use `<ErrorState compact error={q.error}
onRetry={() => q.refetch()} />`. **Never show an empty state for a failed request.**
- **Failed work** (a job run, a sync, a test): `ProblemBanner` with the cause in plain words, one next step
  (open the connection, test, run again) and the raw error behind "Technical details". Never show a driver's
  message as the headline.
- **Empty:** `EmptyState`, with copy for who is looking. People who can create: "No stocktakes yet" + the action.
  People who can't (check `useCan`; **no** `action`): what will appear here and when ("Stocktakes you take part in
  appear here."). Filtered to nothing: `<EmptyState variant="filtered" onClearFilters={clear} />`. In a card or
  panel: `variant="compact"` (one line + action), or render nothing when the card only matters with content (home
  and dashboard work cards).

```tsx
const q = useApiQuery<Summary>('/itam/summary');
if (q.error) return <ErrorState compact error={q.error} onRetry={() => q.refetch()} />;
<EmptyState
  icon={<ClipboardCheckIcon />}
  title={canManage ? t('stocktakes.empty.title') : t('stocktakes.empty.participantTitle')}
  description={canManage ? t('stocktakes.empty.description') : t('stocktakes.empty.participant')}
  action={canManage ? <Button onClick={create}>{t('stocktakes.new')}</Button> : undefined}
/>;
```

## Accessibility checklist

- Landmarks: one `h1` per page (`PageHeader`). Sections use headings or `role="region"` + `aria-labelledby`.
- Everything is keyboard operable: the focus is visible (`focus-visible:ring-[3px] ring-ring/50`), there are no
  traps, and dialogs return focus. Drag-and-drop has a keyboard alternative ("Move to…").
- Icon-only buttons have `aria-label` (translated); in repeated rows it names the row ("Remove approver Mei Lin",
  not "Remove"). Pickers (`PersonPicker`, `RecordPicker`, selects) get an `aria-label` or a `<Label htmlFor>`.
  Decorative icons are `aria-hidden`.
- Tables have a `label` (DataTable). Clickable rows also contain a real link or button.
- `axe` must find nothing in light and dark mode. Run it on open sheets, dialogs and every tab.

## Layout at 375 px

- Grids are `grid-cols-1` until a breakpoint. Children with truncated text need `min-w-0`. Badge rows and chip
  lists `flex-wrap`; stats rows are `grid-cols-2 sm:grid-cols-3/4`; long unbroken values (URIs, keys) get
  `break-all min-w-0`.
- Tables keep the identifying column and status; secondary columns use `meta.priority` (`DataTable`) or
  `hidden sm:table-cell` / `md:` / `lg:`. Wide content scrolls in its own container.
- Toolbars: only search + **Filters** on a phone (`FilterBar`); quick tabs that don't fit become a `Select`.
- Sheet footers stack (`flex-col-reverse gap-2 sm:flex-row`) and stay visible at the bottom. Sticky action bars are
  one row: primary + "More"; destructive actions never go in a sticky bar.
- Detail headers keep the primary action and "More" only (`DetailHeader` does it).

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
| My work                | 我的工作           | 自分の作業                   |
| filters / clear all    | 篩選 / 全部清除    | フィルター / すべてクリア    |
| retry                  | 重試               | 再試行                       |
| discard changes?       | 要捨棄變更嗎？     | 変更を破棄しますか?          |
| more actions           | 更多動作           | その他の操作                 |
| required (validation)  | 此欄位為必填       | この項目は必須です           |
| account (sign-in)      | 帳號               | アカウント                   |
| keep (review decision) | 保留               | 維持                         |
| sign off (final check) | 核定               | 確定（確定する）             |
| owner (of an asset)    | 資產負責人         | 管理責任者                   |
| approved list          | 核准清單           | 承認済みリスト               |
| links & files (tab)    | 連結與檔案         | リンクとファイル             |

## i18n mechanics

- Module text lives in `modules/<id>/messages/<locale>.json` under the namespace `<id>`. Read it with
  `useTranslations('<id>')` or `useTranslations('<id>.area')`. Keys referenced from manifests use the full path
  (`<id>.nav.home`).
- Use ICU for plurals and selects (`{count, plural, one {# job} other {# jobs}}`). zh-TW and ja-JP may use `other`
  only. Never concatenate translated fragments. Pass values instead.
- Server-generated text that users see (notifications, emails) comes from the catalogs in the recipient's locale.
  Don't put English into payloads for display.
- Translate `aria-label`s, toasts, empty states and error messages too.
