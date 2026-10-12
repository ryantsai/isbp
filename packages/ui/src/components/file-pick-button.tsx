'use client';

import { IconButton } from '@astryxdesign/core/IconButton';
import { type ComponentProps, useRef } from 'react';

type IconButtonProps = ComponentProps<typeof IconButton>;

/**
 * An icon button that opens the file picker (a composer's "attach" action), for places too small for `FileInput`.
 * The chosen files go to `onPick`; upload them through the core attachments API. `accept` and `multiple` are the
 * picker's; the input is reset after each pick, so picking the same file again still reports it.
 */
export function FilePickButton({
  accept,
  multiple,
  onPick,
  ...props
}: Omit<IconButtonProps, 'onClick' | 'clickAction'> & {
  accept?: string;
  multiple?: boolean;
  onPick: (files: File[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <IconButton {...props} onClick={() => input.current?.click()} />
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const files = Array.from(e.currentTarget.files ?? []);
          e.currentTarget.value = '';
          if (files.length) onPick(files);
        }}
      />
    </>
  );
}
