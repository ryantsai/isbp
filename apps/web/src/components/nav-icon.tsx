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
  Activity,
  ArrowLeftRight,
  ArrowRightLeft,
  ClipboardCheck,
  Database,
  DatabaseZap,
  History,
  ServerCog,
  GitCompareArrows,
  Globe,
  RefreshCw,
  SquareTerminal,
  Braces,
  BrainCircuit,
  CalendarCheck,
  CircleCheck,
  Cpu,
  FingerprintPattern,
  FolderLock,
  Gauge,
  House,
  Inbox,
  KeySquare,
  PackageOpen,
  Ticket,
  Timer,
  UserCheck,
  BookOpenCheck,
  GitPullRequestArrow,
  Radar,
  NotebookPen,
  FolderTree,
} from 'lucide-react';
import type { IconType } from '@astryxdesign/core/Icon';
import { DynamicIcon, type IconName } from 'lucide-react/dynamic';
import type { SVGProps } from 'react';

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
  activity: Activity,
  'arrow-left-right': ArrowLeftRight,
  'arrow-right-left': ArrowRightLeft,
  'clipboard-check': ClipboardCheck,
  database: Database,
  'database-zap': DatabaseZap,
  history: History,
  'server-cog': ServerCog,
  'git-compare-arrows': GitCompareArrows,
  globe: Globe,
  'refresh-cw': RefreshCw,
  'square-terminal': SquareTerminal,
  braces: Braces,
  'brain-circuit': BrainCircuit,
  'calendar-check': CalendarCheck,
  'circle-check': CircleCheck,
  cpu: Cpu,
  'fingerprint-pattern': FingerprintPattern,
  'folder-lock': FolderLock,
  gauge: Gauge,
  house: House,
  inbox: Inbox,
  'key-square': KeySquare,
  'package-open': PackageOpen,
  ticket: Ticket,
  timer: Timer,
  'user-check': UserCheck,
  'book-open-check': BookOpenCheck,
  'git-pull-request-arrow': GitPullRequestArrow,
  radar: Radar,
  'notebook-pen': NotebookPen,
  'folder-tree': FolderTree,
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

const dynamicIcons = new Map<string, IconType>();

/**
 * The icon component for a manifest icon name, for Astryx props that take an icon (`SideNavItem icon`, `<Icon icon>`).
 * Unknown names lazy-load; the component is cached per name so its identity is stable across renders.
 */
export function navIcon(name?: string): IconType {
  if (!name) return Blocks;
  const known = STATIC[name];
  if (known) return known;
  let icon = dynamicIcons.get(name);
  if (!icon) {
    icon = (props: SVGProps<SVGSVGElement>) => (
      <DynamicIcon
        name={name as IconName}
        {...(props as object)}
        fallback={() => <Blocks {...(props as object)} />}
      />
    );
    dynamicIcons.set(name, icon);
  }
  return icon;
}
