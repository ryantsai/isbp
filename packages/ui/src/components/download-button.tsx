'use client';

import { Button } from '@astryxdesign/core/Button';
import { type ComponentProps, createContext, use } from 'react';

type ButtonProps = ComponentProps<typeof Button>;

/** The file name for the anchor Astryx's `Button` renders (it passes no `download` of its own). */
const FileName = createContext('');

function Anchor(props: ComponentProps<'a'>) {
  return <a {...props} download={use(FileName)} />;
}

/**
 * A button that saves a file (CSV export, OpenAPI document…). Astryx's `Button` renders links through the app's `Link`
 * and has no `download` attribute, so this renders a plain anchor with it: same look, real link semantics (middle
 * click, "save link as"), and the browser downloads instead of navigating.
 *
 * `download` is the suggested file name; `true` keeps the name the server sends.
 */
export function DownloadButton({
  href,
  download = true,
  ...props
}: Omit<ButtonProps, 'href' | 'as' | 'onClick'> & { href: string; download?: string | true }) {
  return (
    <FileName value={download === true ? '' : download}>
      <Button {...props} href={href} as={Anchor as ButtonProps['as']} />
    </FileName>
  );
}
