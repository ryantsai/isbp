import { defineTheme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral/built';

/**
 * The IS Big Platform theme: Astryx's neutral theme re-coloured for Tokyo Electron.
 *
 * - Source of truth for colour, type, radius and the navy rail. **Never hard-code these in page code**: use Astryx
 *   components (they read this theme) or the semantic tokens (`--color-*`, `--radius-*`).
 * - This file is compiled by `pnpm --filter @isbp/ui theme:build` into `src/theme/built/tel.{css,js,d.ts}`, which the
 *   app loads (a built theme is required for SSR: no flash of unstyled components). `theme:check` fails when the
 *   built files are stale; run `theme:build` after every edit here and commit the output.
 * - Every colour was converted from the OKLCH palette the app used before the Astryx migration; the status text pairs
 *   keep their WCAG AA contrast on their own tints. Re-check contrast (light and dark) when you change one.
 *
 * Gotchas learned the hard way:
 * - Astryx quotes `typography.*.family` as ONE font name. Put only the primary family there and everything else
 *   (CJK faces, platform fonts) in `fallbacks`, otherwise the page silently renders in a system font.
 * - The neutral base paints the status tint tokens (`--color-background-red`, …) as strong fills. We re-tint them to
 *   10–15 % so banners, badges and tinted cards match the product's quiet look.
 * - Inside a nested `<Theme mode="dark">` (the navy rail) `light-dark()` always resolves to its dark value, so
 *   anything painted inside it must use one value or a token, not a light/dark pair.
 */
export const TEL = {
  /** The logo blue (--brand). */
  brand: '#4AA4DC',
  /** The logo's green square: "you are here" and the brand mark only, never a status. */
  green: '#85BA42',
  navy: '#08243E',
  navyDark: '#020914',
  navyItem: '#183755',
} as const;

// Astryx quotes `family` as one font name: CJK and platform faces belong in `fallbacks`.
const SANS = 'IBM Plex Sans Variable';
const FALLBACK =
  "'IBM Plex Sans TC', 'IBM Plex Sans JP', 'PingFang TC', 'Hiragino Sans', 'Noto Sans TC', 'Microsoft JhengHei', 'Yu Gothic UI', system-ui, sans-serif";

export const telTheme = defineTheme({
  name: 'tel',
  extends: neutralTheme,

  // Accent = the deepened logo blue (AA under white text and on its own tint); dark mode = the lifted blue.
  color: { accent: ['#0066A1', '#57AEE4'], neutralStyle: 'cool' },

  typography: {
    scale: { base: 14, ratio: 1.2 },
    body: { family: SANS, fallbacks: FALLBACK },
    heading: { family: SANS, fallbacks: FALLBACK },
    code: { family: 'IBM Plex Mono', fallbacks: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
  },

  // Square-cut like the TEL logo: inner 2 / element 4 / container 6 px (Astryx's default is 4 / 8 / 12).
  radius: { base: 4, multiplier: 0.5 },

  tokens: {
    // Surfaces: a blue-tinted page with white cards (cards are flat: a 1 px border, no resting shadow).
    '--color-background-body': ['#F3F6F9', '#0C1218'],
    '--color-background-surface': ['#FFFFFF', '#121A21'],
    '--color-background-card': ['#FFFFFF', '#121A21'],
    '--color-background-popover': ['#FFFFFF', '#161E26'],
    '--color-text-primary': ['#131E28', '#EBEFF2'],
    '--color-text-secondary': ['#535E67', '#A8B2BA'],
    '--color-border': ['#DCE0E4', '#2C3136'],
    '--color-border-emphasized': ['#C4CCD2', '#363D43'],

    // Status colours.
    '--color-success': ['#376F20', '#93CB60'],
    '--color-error': ['#BE2323', '#FD7273'],
    '--color-warning': ['#EFA831', '#EDB345'],
    // The destructive button paints the error colour on this tint: Astryx's default (#FFC4BE) is only 4.0:1.
    '--color-error-muted': ['#FEE4E2', 'color-mix(in srgb, #FF9890 14%, transparent)'],

    // Status tints (10–15 %) with the status colour as text: the quiet chip / banner / note look.
    '--color-background-red': [
      'color-mix(in srgb, #BE2323 10%, transparent)',
      'color-mix(in srgb, #FD7273 15%, transparent)',
    ],
    '--color-text-red': ['#BE2323', '#FD7273'],
    '--color-background-green': [
      'color-mix(in srgb, #376F20 11%, transparent)',
      'color-mix(in srgb, #93CB60 15%, transparent)',
    ],
    '--color-text-green': ['#376F20', '#93CB60'],
    '--color-background-yellow': [
      'color-mix(in srgb, #EFA831 22%, transparent)',
      'color-mix(in srgb, #EDB345 15%, transparent)',
    ],
    '--color-text-yellow': ['#864900', '#F5CB70'],
    '--color-background-blue': [
      'color-mix(in srgb, #2A61B1 10%, transparent)',
      'color-mix(in srgb, #7CB5F5 15%, transparent)',
    ],
    '--color-text-blue': ['#2A61B1', '#8CC0F7'],
    '--color-background-orange': [
      'color-mix(in srgb, #EFA831 22%, transparent)',
      'color-mix(in srgb, #EDB345 15%, transparent)',
    ],
    '--color-text-orange': ['#864900', '#F5CB70'],
  },

  components: {
    badge: {
      'variant:success': {
        backgroundColor: 'var(--color-background-green)',
        color: 'var(--color-text-green)',
      },
      'variant:error': { backgroundColor: 'var(--color-background-red)', color: 'var(--color-text-red)' },
      'variant:warning': {
        backgroundColor: 'var(--color-background-yellow)',
        color: 'var(--color-text-yellow)',
      },
      'variant:info': { backgroundColor: 'var(--color-background-blue)', color: 'var(--color-text-blue)' },
    },
    banner: {
      'status:info': { backgroundColor: 'var(--color-background-blue)', color: 'var(--color-text-blue)' },
      'status:error': { backgroundColor: 'var(--color-background-red)', color: 'var(--color-text-red)' },
      'status:warning': {
        backgroundColor: 'var(--color-background-yellow)',
        color: 'var(--color-text-yellow)',
      },
      'status:success': {
        backgroundColor: 'var(--color-background-green)',
        color: 'var(--color-text-green)',
      },
    },
    // The navigation rail is TEL navy in both modes: the one bold surface; content stays quiet.
    'app-shell-sidenav': {
      base: { backgroundColor: 'light-dark(#08243E, #020914)' },
    },
    // The phone drawer is the same rail: navy (it sits inside the nested dark Theme, so one fixed value).
    'mobile-nav': {
      base: { backgroundColor: '#08243E' },
    },
    'side-nav-item': {
      selected: {
        // One value: inside the rail's nested dark Theme `light-dark()` always resolves dark.
        backgroundColor: '#183755',
        // The green marks the current page and nothing else.
        boxShadow: 'inset 3px 0 0 #85BA42',
      },
    },
  },
});
