'use client';

import {
  AppWindow,
  BellRing,
  Blocks,
  BookOpen,
  Bug,
  CalendarClock,
  ChartColumn,
  ClipboardList,
  FilePenLine,
  KeyRound,
  LifeBuoy,
  ListChecks,
  LayoutDashboard,
  type LucideIcon,
  Megaphone,
  Network,
  Plug,
  ScrollText,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TextCursorInput,
  User,
  Users,
  UsersRound,
  Workflow,
  Building,
  ChartGantt,
  FileText,
  FolderKanban,
  GitBranch,
  Kanban,
  Laptop,
  Layers,
  ListTodo,
  MonitorSmartphone,
  Package,
  ReceiptText,
  Rocket,
  Server,
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
  'life-buoy': LifeBuoy,
  'book-open': BookOpen,
  sparkles: Sparkles,
  bug: Bug,
  'calendar-clock': CalendarClock,
  'chart-column': ChartColumn,
  'sliders-horizontal': SlidersHorizontal,
  building: Building,
  'chart-gantt': ChartGantt,
  'file-text': FileText,
  'folder-kanban': FolderKanban,
  'git-branch': GitBranch,
  kanban: Kanban,
  laptop: Laptop,
  layers: Layers,
  'list-todo': ListTodo,
  'monitor-smartphone': MonitorSmartphone,
  package: Package,
  'receipt-text': ReceiptText,
  rocket: Rocket,
  server: Server,
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
