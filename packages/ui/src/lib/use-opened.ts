'use client';

import { useEffect, useState } from 'react';

/** Defer an overlay's contents until first use, then retain drafts and closing animations. */
export function useOpened(open: boolean) {
  const [opened, setOpened] = useState(open);
  useEffect(() => {
    if (open) setOpened(true);
  }, [open]);
  return open || opened;
}
