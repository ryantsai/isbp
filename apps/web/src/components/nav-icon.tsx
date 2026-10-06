'use client';

import {
  Blocks,
  KeyRound,
  LayoutDashboard,
  type LucideIcon,
  Megaphone,
  Network,
  ScrollText,
  Settings,
  ShieldCheck,
  User,
  Users,
  UsersRound,
} from 'lucide-react';
import { DynamicIcon, type IconName } from 'lucide-react/dynamic';

const STATIC: Record<string, LucideIcon> = {
  'layout-dashboard': LayoutDashboard,
  users: Users,
  'users-round': UsersRound,
  network: Network,
  'shield-check': ShieldCheck,
  'scroll-text': ScrollText,
  blocks: Blocks,
  'key-round': KeyRound,
  megaphone: Megaphone,
  settings: Settings,
  user: User,
};

/** Icons named in module manifests (kebab-case lucide names). Common ones are bundled; others lazy-load. */
export function NavIcon({ name, className }: { name?: string; className?: string }) {
  if (!name) return <Blocks className={className} aria-hidden />;
  const Static = STATIC[name];
  if (Static) return <Static className={className} aria-hidden />;
  return (
    <DynamicIcon
      name={name as IconName}
      className={className}
      aria-hidden
      fallback={() => <Blocks className={className} />}
    />
  );
}
