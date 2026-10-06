'use client';

import { easeOut } from '@isbp/ui/motion';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';

/** Re-mounts on every navigation → a short, purposeful page transition (opacity-only under reduced motion). */
export default function Template({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: easeOut }}
    >
      {children}
    </motion.div>
  );
}
