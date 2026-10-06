'use client';

import {
  AppWindow,
  BellRing,
  Blocks,
  ClipboardList,
  FilePenLine,
  KeyRound,
  ListChecks,
  LayoutDashboard,
  type LucideIcon,
  Megaphone,
  Network,
  Plug,
  ScrollText,
  Settings,
  ShieldCheck,
  TextCursorInput,
  User,
  Users,
  UsersRound,
  Workflow,
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
  'list-checks': ListChecks,
  'clipboard-list': ClipboardList,
  'app-window': AppWindow,
  plug: Plug,
  workflow: Workflow,
  'file-pen-line': FilePenLine,
  'text-cursor-input': TextCursorInput,
  'bell-ring': BellRing,
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
