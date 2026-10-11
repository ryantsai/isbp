import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import base from './base.js';

/**
 * The shadcn/Radix-era primitives that Astryx replaced (docs/ai/ui-components.md → "Replaced primitives"). Importing
 * one is an error: use the Astryx component that owns the behaviour (`pnpm astryx component <Name>`).
 * Kept (not listed): `card`, `sheet`, `data-table`, `filter-bar`, `page-header`, `empty-state`, `status`,
 * `avatar` (UserAvatar), `skeleton`, `form` (Form, FormField, fieldStatus) and the other app composites.
 */
const REMOVED_PRIMITIVES = [
  'button',
  'badge',
  'input',
  'textarea',
  'label',
  'select',
  'checkbox',
  'switch',
  'dialog',
  'alert-dialog',
  'dropdown-menu',
  'popover',
  'tooltip',
  'tabs',
  'separator',
  'scroll-area',
  'spinner',
  'kbd',
  'command',
  'table',
  'sonner',
];

const astryxMessage =
  'Use the Astryx component instead (docs/ai/ui-components.md; `pnpm astryx component <Name>`).';

/** Flat config for the Next.js app and React packages. */
export default [
  ...base,
  ...nextVitals,
  ...nextTs,
  { ignores: ['.next/**', 'next-env.d.ts', '**/theme/built/**'] },
  {
    rules: {
      '@next/next/no-html-link-for-pages': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/incompatible-library': 'off',
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'radix-ui', message: `Radix primitives are gone. ${astryxMessage}` },
            {
              name: 'class-variance-authority',
              message: `Variants come from the Astryx component's props. ${astryxMessage}`,
            },
            { name: 'sonner', message: "Use `toast` from '@isbp/ui/toast'." },
            { name: 'cmdk', message: 'Use the Astryx CommandPalette / Typeahead.' },
          ],
          patterns: [
            {
              regex: `^(@isbp/ui/|\.{1,2}/(components/)?)(${REMOVED_PRIMITIVES.join('|')})$`,
              message: `This shadcn-era primitive was replaced by Astryx. ${astryxMessage}`,
            },
          ],
        },
      ],
    },
  },
];
