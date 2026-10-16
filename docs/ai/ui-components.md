# UI components

**Astryx first.** The product's UI is built from [Astryx](https://github.com/facebook/astryx) (Meta's React design
system, `@astryxdesign/core`) in our **TEL theme**, plus a small set of app composites in `@isbp/ui`. This page answers
"which component do I use for X?" so that a new page is assembled from what exists instead of invented from scratch.
Look and feel (colour, type, density, page patterns) is in [`ui-guidelines.md`](ui-guidelines.md); this page is the
component map. The pattern snippets below are compiled in
[`packages/ui/recipes/primitives.tsx`](../../packages/ui/recipes/primitives.tsx) (type-checked on every
`pnpm typecheck`): copy from there, they cannot rot silently.

## The rule

1. **Need a control or a layout piece?** Use the Astryx component. Don't hand-roll one from `<div>`/`<button>`/`<input>`
   and Tailwind classes, and don't paste a shadcn/Radix snippet (those libraries are gone).
2. **Need a bigger recurring piece** (a list with URL state, a page header, a status chip, a person picker)? Use the
   app composite in `@isbp/ui` (table below). Don't build a second one.
3. **Neither exists?** Compose it from Astryx primitives, check `pnpm astryx search "<what you need>"` and the templates
   first, then add it to `@isbp/ui` (own file, props documented, i18n through catalogs) and list it here in the same
   change. If Astryx lacks something fundamental, say so in the PR instead of working around it silently.

## Look it up, don't guess

`SheetContent` and `FormDialog` mount their contents on first open, then keep them mounted to preserve drafts and
closing animations. Gate queries in their parent forms on the open state too. Shared API queries forward cancellation
signals to `api.get(path, query, signal)` so abandoned filters/pages stop their reads. Toasts use one Astryx viewport
whose portal follows the active native dialog, keeping feedback and its controls above the backdrop.

```bash
pnpm astryx component Selector --dense     # props, anatomy, do/don't, examples of one component
pnpm astryx search "date range"           # components, hooks, docs, templates in one ranked list
pnpm astryx build "settings page"         # which template to start a page from (+ the parts it lacks)
pnpm astryx template table-page           # print / scaffold a page template (keep its frame and spacing)
pnpm astryx docs tokens                   # colour, spacing, radius, typography tokens
pnpm astryx docs layout                   # building a layout outside-in (Layout, Stack, Grid)
```

`pnpm astryx` is `astryx` of `@isbp/ui`'s installed version. Astryx is a 0.x beta: props are renamed between
releases, so read the component docs for the installed version instead of relying on memory. The agent rules Astryx
generates for AI tools are in [`packages/ui/AGENTS.md`](../../packages/ui/AGENTS.md); they apply here, with the
project exceptions listed under "Tailwind" below.

## How it is wired

| Piece        | Where                                                                         | What to know                                                                                                                                                                                                                                                           |
| ------------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Components   | `@astryxdesign/core/<Name>`                                                   | One import path per component (`@astryxdesign/core/Button`). Modules list `@astryxdesign/core` as a peer dependency.                                                                                                                                                   |
| Theme        | `packages/ui/src/theme/tel.ts` → built to `src/theme/built/tel.{css,js,d.ts}` | `defineTheme` extending Astryx's neutral theme: TEL palette, IBM Plex, square radii, navy rail, soft status tints. **Edit it, then `pnpm ui:theme`** and commit the built files; `pnpm --filter @isbp/ui theme:check` (in the quality gate) fails when they are stale. |
| Providers    | `@isbp/ui/provider` (`UiProvider`, mounted in `RootProviders`)                | Astryx `Theme` (light/dark/system), `LinkProvider` (every `href` is a Next.js `Link`), `InternationalizationProvider` (Astryx's own strings in en / zh-TW / ja-JP, next to next-intl), toasts.                                                                         |
| CSS layers   | `apps/web/src/app/layers.css`, `globals.css`                                  | One order for Astryx and Tailwind: reset → theme → base → astryx-base → astryx-theme → components → utilities. Tailwind utilities win over component styles, so a `className` override works.                                                                          |
| Icons        | `lucide-react`                                                                | Always `<Icon icon={PlusIcon} />` (`@astryxdesign/core/Icon`), which sizes and colours it. Never `className="size-4"` on a Lucide icon inside an Astryx prop.                                                                                                          |
| Toasts       | `import { toast } from '@isbp/ui/toast'`                                      | `toast.success(t('saved'))`, `toast.error(t('failed'), { description })`, `{ action: { label, onClick } }` for Undo. Errors stay until dismissed.                                                                                                                      |
| Light / dark | `@isbp/ui/theme` (`ThemeProvider`, `useTheme`)                                | Stores the choice per device, sets `data-theme` / `.dark` before first paint. Don't toggle classes yourself.                                                                                                                                                           |
| Tailwind     | `globals.css`                                                                 | **Layout glue only** (see below). The shadcn-era colour classes (`text-muted-foreground`, `bg-card`, `border-destructive`…) still resolve, now through Astryx tokens, so they follow the theme; don't add new ones.                                                    |

### Tailwind: glue, not design

Astryx owns how things _look_; Tailwind positions them. Fine: `flex`, `grid`, `gap-*`, `p-*`/`m-*`, `w-*`, `min-w-0`,
`truncate`, `sr-only`, responsive prefixes (`sm:`/`lg:`) and `hidden`. Not fine: colours, borders, radii, shadows, font
sizes/weights, hover/focus styles on controls, hand-made cards/chips/tabs. For those use component props
(`<Text color="secondary" weight="medium">`, `<Badge variant="success">`), the semantic tokens (`var(--color-text-secondary)`) or a
theme change. Prefer `VStack` / `HStack` / `Grid` (`@astryxdesign/core/Layout`, `/Grid`) when it is a straight swap.

## Primitives: which Astryx component?

| I need…                             | Use                                                                            | Notes                                                                                                                                                                                                                                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A button                            | `Button`                                                                       | `label` is the text **and** the accessible name (never children). `variant`: `primary` (the one next step), `secondary` (default), `ghost` (toolbars), `destructive` (only inside a confirmation). `isLoading`, `isDisabled`, `icon`, `href`.                                          |
| An icon-only button                 | `IconButton` (or `Button isIconOnly` for a link)                               | `label` is required: it is the aria-label and the tooltip.                                                                                                                                                                                                                             |
| A link to a page / a file download  | `Button href`, `Link`; `DownloadButton` (`@isbp/ui`)                           | `href` renders through Next's `Link`. Downloads need the composite (Astryx has no `download`).                                                                                                                                                                                         |
| Text, headings                      | `Text`, `Heading`                                                              | `type` (`body`/`supporting`/`label`/`code`/`large`), `color` (`secondary`…), `weight`, `maxLines`. A page's `h1` comes from `PageHeader`.                                                                                                                                              |
| A text / password / email field     | `TextInput`                                                                    | `label` (required), `value` + `onChange(value)` (the **value**, not an event), `description` (hint), `status` (error), `isRequired`/`isOptional`, `startIcon`, `hasClear`.                                                                                                             |
| Multi-line text, numbers, dates     | `TextArea`, `NumberInput`, `DateInput` / `DateTimeInput` / `TimeInput`         | Same field props. Files: `FileInput` (uploads still go through the core attachments panel).                                                                                                                                                                                            |
| One option from a list              | `Selector`                                                                     | `options`, `value` (`string \| null`), `onChange`, `hasSearch` for long lists, `hasClear` for "none". **No empty-string values.** Searchable pick of a record/person/CI (server-side search): `Typeahead` fed by `useApiSearchSource` (below). Several: `MultiSelector` / `Tokenizer`. |
| An on/off setting                   | `Switch` (applies at once) / `CheckboxInput` (in a form)                       | `label`, `value`, `onChange(checked)`. Choose one of a few visible options: `RadioList` + `RadioListItem`; a filter toggle: `SegmentedControl`.                                                                                                                                        |
| A custom control that needs a label | `Field`                                                                        | `label`, `inputID`, `description`, `status`: the same frame the inputs use (our pickers use it).                                                                                                                                                                                       |
| A confirmation or small task        | `AlertDialog` (destructive/irreversible) / `FormDialog` (`@isbp/ui`)           | Controlled (`isOpen`/`onOpenChange`; no trigger part). `AlertDialog`'s `onAction` does **not** close it: close after success. A form or small task is **`FormDialog`** (header, scrolling body, Cancel + primary footer; never assemble `Dialog` + `Layout` by hand).                  |
| A side panel for a record form      | `Sheet` (`@isbp/ui/sheet`)                                                     | Astryx has no drawer; this is ours, on `Dialog`. More than 4 fields → a Sheet.                                                                                                                                                                                                         |
| Tabs                                | `TabList` + `Tab`                                                              | You render the selected panel. Tabs that only filter a list: `SegmentedControl`. Sibling pages of an area: `SectionTabs` (`@isbp/ui`).                                                                                                                                                 |
| A menu                              | `DropdownMenu`, `MoreMenu` (⋯)                                                 | `items` (label, icon, onClick/href, `variant: 'destructive'`, dividers, sections). Destructive last, after a divider, and confirm with an `AlertDialog`.                                                                                                                               |
| A popover / a hint                  | `Popover` / `Tooltip`                                                          | Popover: click-opened, may hold controls. Tooltip: a few words on hover/focus; never essential information.                                                                                                                                                                            |
| A status or count chip              | `Badge` (`variant` neutral/info/success/warning/error)                         | Statuses of records use `StatusBadge`/`MappedStatus` (`@isbp/ui/status`): icon + text.                                                                                                                                                                                                 |
| A message                           | `Banner` (inline), `toast` (transient)                                         | `Banner status="info\|warning\|error\|success" collapsible={false}`.                                                                                                                                                                                                                   |
| A card / panel                      | `Card` + `CardHeader`/`CardTitle`/`CardContent` (`@isbp/ui/card`)              | The surface is Astryx; the anatomy is ours. Don't add your own padding.                                                                                                                                                                                                                |
| Layout                              | `VStack`, `HStack`, `StackItem`, `Grid`, `Layout`, `Divider`, `ScrollableArea` | Gaps are the 0–10 spacing scale (`gap={4}` = 16 px).                                                                                                                                                                                                                                   |
| Key-value facts                     | `MetadataList` + `MetadataListItem`                                            |                                                                                                                                                                                                                                                                                        |
| Loading                             | `Skeleton` (`@isbp/ui/skeleton`), `Spinner`, `ProgressBar`                     | Skeletons are shaped like the result.                                                                                                                                                                                                                                                  |
| A person's avatar                   | `UserAvatar` (`@isbp/ui/avatar`)                                               | Photo or initials on a name-derived colour. Size with `className="size-7"`.                                                                                                                                                                                                            |

## App composites (`@isbp/ui`)

Same imports and props everywhere; they are built on Astryx.

| Composite                                                                                                                                    | Import                                     | For                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DataTable`, `useListState`, `DataTableSummary`                                                                                              | `@isbp/ui/data-table`                      | Every list: server paging/sorting/search in the URL, responsive columns (`meta.priority`), selection, empty/error states.                                                                                                                                                                                               |
| `FilterBar`, `SearchInput`                                                                                                                   | `@isbp/ui/filter-bar`, `…/search-input`    | The toolbar of a list: search + primary filters + a Filters popover with removable chips.                                                                                                                                                                                                                               |
| `PageHeader`, `DetailHeader`, `BackLink`                                                                                                     | `@isbp/ui/page-header`                     | Title/description/actions of a list or hub; the record header of a detail page.                                                                                                                                                                                                                                         |
| `SectionTabs`                                                                                                                                | `@isbp/ui/section-tabs`                    | Sibling pages of an area as tabs with their own URLs.                                                                                                                                                                                                                                                                   |
| `EmptyState`, `ErrorState`, `ProblemBanner`                                                                                                  | `@isbp/ui/empty-state`, `…/problem-banner` | The three non-loaded states (see ui-guidelines → States).                                                                                                                                                                                                                                                               |
| `StatusBadge`, `MappedStatus`, `defineStatusMap`                                                                                             | `@isbp/ui/status`                          | One status vocabulary per entity, icon + text.                                                                                                                                                                                                                                                                          |
| `Card`…                                                                                                                                      | `@isbp/ui/card`                            | Card anatomy.                                                                                                                                                                                                                                                                                                           |
| `Sheet`…                                                                                                                                     | `@isbp/ui/sheet`                           | Record-form drawer (`dirty` asks "Discard changes?").                                                                                                                                                                                                                                                                   |
| `StatTile`, `IconTile`, `Timeline`, `Meter`, `Stepper`, `InUse`                                                                              | `@isbp/ui/<name>`                          | KPI tile, icon on a surface, event history, usage bar, wizard steps, "in use by" panels.                                                                                                                                                                                                                                |
| `OptionalFields`, `LocalizedInput`, `RowsField`                                                                                              | `@isbp/ui/<name>`                          | "More details" row, a text per language, an editable table of rows.                                                                                                                                                                                                                                                     |
| `PersonPicker`, `RecordPicker`, `FormRenderer`, `ConditionBuilder`, `DecisionList`, `RunDetail`, `WorkflowDiagram`, `CodeEditor`, `Markdown` | `@isbp/ui/<name>`                          | The larger shared pieces (forms from `FieldDef`s, rule builders, run logs, diagrams, SQL/script editor).                                                                                                                                                                                                                |
| `Form`, `FormField`, `fieldStatus`                                                                                                           | `@isbp/ui/form`                            | react-hook-form binding for Astryx inputs (below).                                                                                                                                                                                                                                                                      |
| `RelativeTime`, `DateTime`                                                                                                                   | `@isbp/ui/relative-time`                   | "3 hours ago" in lists, absolute times in details.                                                                                                                                                                                                                                                                      |
| `DownloadButton`                                                                                                                             | `@isbp/ui/download-button`                 | A button that saves a file.                                                                                                                                                                                                                                                                                             |
| `FilePickButton`                                                                                                                             | `@isbp/ui/file-pick-button`                | An `IconButton` that opens the file picker (`accept`, `multiple`, `onPick(files)`), for a chat composer's attach action where `FileInput` doesn't fit. Upload through the core attachments API.                                                                                                                         |
| `useApiSearchSource`                                                                                                                         | `@isbp/ui/search-source`                   | The data source of every picker: wraps a list endpoint (`path`, `query(q)`, `toItem(row)`) into the `SearchSource` that Astryx `Typeahead` takes. Never build a Popover + Command picker.                                                                                                                               |
| `Segmented`                                                                                                                                  | `@isbp/ui/segmented`                       | A view switch / range / mode with **four or more** options: Astryx `SegmentedControl`, a `Selector` below `sm` (Astryx truncates segment labels on a phone). Up to three options: `SegmentedControl` directly.                                                                                                          |
| `FormDialog`                                                                                                                                 | `@isbp/ui/form-dialog`                     | The modal for a few fields or one small task: `title`, `size` (sm 448 / md 512 / lg 576 / xl 672), `onSubmit` + `submitLabel` + `cancelLabel` + `isSubmitting`, `defaultOptionality` (wraps the fields in `FormLayout`), `footerStart`. Wrap it in the react-hook-form `Form` provider. More than ~4 fields: a `Sheet`. |
| `toast`, `UiProvider`, `ThemeProvider`                                                                                                       | `@isbp/ui/toast`, `…/provider`, `…/theme`  | Wiring (above).                                                                                                                                                                                                                                                                                                         |
| `useApiQuery`, `useApiMutation`, `applyServerErrors`                                                                                         | `@isbp/ui/query`                           | Data hooks (not visual; here because every page uses them).                                                                                                                                                                                                                                                             |
| Motion helpers (`FadeIn`, `Stagger`, `Collapse`…)                                                                                            | `@isbp/ui/motion`                          | Only for the cases in ui-guidelines → Motion; Astryx components animate themselves.                                                                                                                                                                                                                                     |

## Forms

An Astryx input draws its own label, hint and error, so a form field is **one component**:

```tsx
<FormField
  control={form.control}
  name="email"
  render={({ field, fieldState }) => (
    <TextInput
      label={t('email')}
      isRequired
      value={field.value}
      onChange={field.onChange}
      onBlur={field.onBlur}
      status={fieldStatus(fieldState)}
    />
  )}
/>
```

- Required/optional is a text marker on the label (not an asterisk). When most fields are required wrap them in
  `<FormLayout defaultOptionality="required">` and mark only the optional ones (`isOptional`); otherwise
  `defaultOptionality="optional"` and `isRequired`.
- Hints go in `description`, errors in `status` (from `fieldStatus(fieldState)` or your own message). Server
  validation errors still go through `applyServerErrors` and arrive in `fieldState`.
- Record forms: `Sheet` for more than 4 fields, `Dialog` for at most 4. Destructive actions confirm with `AlertDialog`.
- Group related fields with a heading (`<Text type="label">`) and a `VStack`, not nested bordered boxes.

## Pitfalls we already hit

- `typography.*.family` in the theme is **one** font name (Astryx quotes it); CJK and platform faces go in `fallbacks`.
- Astryx's neutral base paints status colours as strong fills; the TEL theme re-tints `--color-background-red|green|yellow|blue|orange`
  to 10–15 %. Don't "fix" a loud banner with a class: change the token in the theme.
- Inside a nested `<Theme mode="dark">` (the navy rail, the phone drawer) `light-dark()` always resolves dark: use one value.
- `Dialog`/`AlertDialog`/`Sheet` are controlled and have no trigger component: put `open` state in the parent.
- `Selector` has no empty-string value: use `null` with `hasClear`, or a sentinel option.
- `FilterBar` controls need their own hidden `label` or `aria-label`, matching the filter name. The panel renders a
  visible caption, not an enclosing `<label>`: nesting labels makes screen readers repeat the name.
- `onChange` of every input passes the **value**; reading `e.target.value` is the old API.
- `Button` has no `children`/`asChild`/`download`: use `label`, `href`, `DownloadButton`.
- Native `<dialog>` elements have no `role` attribute: select with `dialog[open]` (or `getByRole('dialog')`), not `[role=dialog]`.
- Astryx's `CommandPalette` starts with nothing highlighted; `shell/command-palette.tsx` nudges the first row.
- **Selector's role depends on search.** Without `hasSearch` its trigger is `role=combobox`; with `hasSearch` it is a `button[aria-haspopup=listbox]`
  (and a searchable `Selector` inside `FormLayout defaultOptionality="required"` gets `aria-required` on a button: wrap it in an optional layout).
  Closed option labels stay in the DOM as hidden spans (`getByText` finds them; filter by visibility in tests).
- **Closed popovers keep their content in the DOM** (`Popover`, `Dialog`): pass `content={isOpen ? panel : null}` for anything with text a test
  or screen reader could meet twice (the notification bell does).
- **`Dialog` names itself from the `DialogHeader` that exists when it opens.** Content that mounts later needs an explicit `aria-label`.
- **`Table` in children mode gives every cell `max-width: 0` and `overflow: hidden`.** Shrink-to-content columns need
  `max-w-none whitespace-nowrap`; the flexible column `w-full max-w-0`. It has no caption/label of its own; use `aria-label`.
  Never `ScrollableArea axis="both"` around a table (content grows to 1,000,000 px).
- `ClickableCard` is a card with a hidden link/button on top: users are fine, Playwright's `getByRole('link').click()` is intercepted. Use a real
  `Link` for e2e-critical cards.
- `Banner` is always `role=alert`: on page load it is announced assertively. Use it for what deserves that.
- `Toast` mirrors its text into a hidden live region: tests assert toasts inside `[data-toast-id]`, not `getByText` on the page.
- `Tokenizer`'s "Create" row text is English-only and it adds on Enter (not comma). `TextInput` has no `maxLength`/`type="url"`/`inputMode`/mono
  font: clamp in `onChange`. `Text` has no status colours (use an icon or a `Badge`). `Tab` has no `isDisabled`.
- `UserAvatar` sets the exact diameter inline: Astryx puts a bare `size-<px>` class on its avatar that Tailwind's own `size-16`/`size-40`
  utilities override. Always use `UserAvatar`, never `Avatar` directly.
- `CardTitle`'s `className` lays out the title (`flex items-center gap-2` puts an icon beside the text).
- If `pnpm astryx search "two words"` fails on Windows, search with one word or run `pnpm exec astryx …` from `packages/ui`.

## Guardrails

- ESLint (`tooling/eslint-config/next.js`) errors on imports of the replaced primitives, `radix-ui`, `class-variance-authority`,
  `sonner` and `cmdk`.
- `pnpm ui:check` fails on leftover `LegacyButton`/`LegacyBadge` markers and a stale built theme.
- `pnpm typecheck` compiles the recipes file, so documented patterns break loudly after an Astryx upgrade.
- e2e axe scans (light and dark) cover every new page: Astryx components are accessible by default, hand-rolled ones are not.

## Upgrading Astryx

Bump `@astryxdesign/*` in the `pnpm-workspace.yaml` catalog, `pnpm install`, then: `pnpm ui:theme` (rebuild the theme; commit
it), `pnpm astryx upgrade --from <old version> --apply`, `pnpm typecheck` (recipes + all pages), the e2e suite, and a
screenshot pass in light and dark. Read the Astryx changelog first: it is a beta and renames props.
