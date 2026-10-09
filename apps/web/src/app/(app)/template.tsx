'use client';

import { ease, useEntranceMotion } from '@isbp/ui/motion';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';

/**
 * Re-mounts on every navigation: the new page fades in (opacity only, 150 ms). Server-rendered first loads and
 * reduced motion show it at once.
 */
export default function Template({ children }: { children: ReactNode }) {
  const play = useEntranceMotion();
  return (
    <motion.div
      initial={play ? { opacity: 0 } : false}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15, ease: ease.enter }}
    >
      {children}
    </motion.div>
  );
}
