# AGENTS

Project-specific guidance for AI coding agents. This file is imported by the root `CLAUDE.md`, so it applies to every UI
change in the repo (apps/web, packages/ui, every module's `src/web`).

## IS Big Platform: how UI is built here (read first)

The UI is **Astryx** (`@astryxdesign/core`) in our **TEL theme**, plus the app composites in `@isbp/ui`. The full map of
"which component for what", the wiring and the pitfalls is `docs/ai/ui-components.md`; page patterns, wording and
accessibility are `docs/ai/ui-guidelines.md`. The patterns are compiled in `packages/ui/recipes/primitives.tsx`.

- **Never invent a control.** Use an Astryx component or an `@isbp/ui` composite. No shadcn/Radix (`radix-ui`,
  `class-variance-authority`, `@isbp/ui/{button,input,select,dialog,…}` are gone and ESLint rejects them). No hand-made
  buttons, chips, tabs, cards, menus, dialogs or inputs from `<div>`/`<button>`/`<input>` + classes.
- Run the workflow below with `pnpm astryx …` (repo root) instead of `pnpm exec astryx …`. Read
  `pnpm astryx component <Name> --dense` before you use a component: props differ from what you remember (labels are props,
  `onChange` gives the value, `isDisabled`/`isLoading` naming) and Astryx is a 0.x beta.
- **Project exceptions to the generic rules below**
  - Tailwind **is** available, as layout glue only (`flex`, `grid`, `gap-*`, `p-*`, `w-*`, `min-w-0`, `truncate`, responsive
    prefixes, `sr-only`). Never for colour, border, radius, shadow, font or hover/focus looks: use component props or tokens.
    The old shadcn colour classes (`text-muted-foreground`, `bg-card`…) still resolve through Astryx tokens; don't add new ones.
  - Prefer `VStack`/`HStack`/`Grid`/`Layout`. A plain `<div className="flex …">` for glue (a scroll region, a sticky bar) is
    fine; a `<div>` that draws something is not.
  - Colours, type and radii come from the theme (`packages/ui/src/theme/tel.ts`, then `pnpm ui:theme` and commit the built
    files). Never a `:root` override or a hex value in a component.
  - Icons: Lucide, as `<Icon icon={PlusIcon} />`.
  - Every string goes through next-intl catalogs in en, zh-TW **and** ja-JP; Astryx's own strings follow the UI language through
    `UiProvider`.
- A recurring piece that doesn't exist yet becomes a composite in `@isbp/ui` (own file, documented in
  `docs/ai/ui-components.md`), not a copy in a module.
- Before you finish: `pnpm ui:check`, `pnpm typecheck`, `pnpm lint`, and look at the page in light **and** dark and at 375 px.

<!-- ASTRYX:START -->

Astryx v0.6.7 · 168 components
CLI: run every command as `pnpm exec astryx <cmd>` (shown below as `astryx ...`).

SETUP (once, in app entry e.g. main.tsx) — without these, components render unstyled:
import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";

WORKFLOW — start every page from a template, never from scratch:

1. `astryx build "<idea>"` — names the template to scaffold from and the parts it lacks.
2. `astryx template <name> <path>` — scaffold it; keep its frame, gap and padding; replace the content.
3. `astryx template <Block>` for parts it lacks; `astryx component <Name>` to read props before using one.
   Changing an existing page? Keep it: skip step 2 and add blocks/components inside its sections.

RULES:

- No <div> — components handle all layout and spacing.
- Read `astryx docs layout` before changing a template's frame.
- Dense data = rows (Table, List/Item), not Card-wrapped lists. Badge = counts only.
- Style with component props first, then tokens (var(--color-_|--spacing-_|--radius-*)). No raw hex/px. No StyleX/Tailwind compiler here — don't use xstyle/utility classes directly. Some templates use StyleX and need a compiler plugin; see `astryx docs styling-overview`.
- Palettes and custom colors go through the theme, never :root overrides. See `astryx docs theme`.
- SELF-CHECK: re-read the file; replace any raw <div>/<span>, imported .css/@apply, or hardcoded #hex/px with the component or a token.

`astryx help` lists every command. Key ones beyond the workflow:
search "<query>" find any component / hook / doc / template
discover <words> integrations you could add
docs <topic> getting-started, principles, tokens, theme … (`astryx docs` lists all)
docs cli commands, API reference, integration authoring
upgrade --from <old version> --apply run after a dependency bump
<!-- ASTRYX:END -->
