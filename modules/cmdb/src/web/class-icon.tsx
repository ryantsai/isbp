'use client';

import {
  AppWindowIcon,
  BoxIcon,
  BriefcaseBusinessIcon,
  BuildingIcon,
  CloudIcon,
  ContainerIcon,
  CpuIcon,
  DatabaseIcon,
  GlobeIcon,
  HardDriveIcon,
  LaptopIcon,
  LayersIcon,
  type LucideIcon,
  type LucideProps,
  MailIcon,
  MonitorIcon,
  NetworkIcon,
  PrinterIcon,
  RouterIcon,
  ServerCogIcon,
  ServerIcon,
  ShieldIcon,
  SmartphoneIcon,
  WifiIcon,
} from 'lucide-react';
import { DynamicIcon, type IconName } from 'lucide-react/dynamic';

/** Icons offered by the class editor (bundled); other lucide names set through the API load lazily. */
export const CLASS_ICONS: Record<string, LucideIcon> = {
  'briefcase-business': BriefcaseBusinessIcon,
  'app-window': AppWindowIcon,
  server: ServerIcon,
  'server-cog': ServerCogIcon,
  database: DatabaseIcon,
  router: RouterIcon,
  network: NetworkIcon,
  'hard-drive': HardDriveIcon,
  cloud: CloudIcon,
  laptop: LaptopIcon,
  monitor: MonitorIcon,
  smartphone: SmartphoneIcon,
  printer: PrinterIcon,
  shield: ShieldIcon,
  globe: GlobeIcon,
  mail: MailIcon,
  wifi: WifiIcon,
  cpu: CpuIcon,
  container: ContainerIcon,
  layers: LayersIcon,
  building: BuildingIcon,
  box: BoxIcon,
};

/** A class's icon (decorative: the class name is always shown or announced next to it). */
export function ClassIcon({ name, ...props }: { name: string | null | undefined } & LucideProps) {
  const Static = CLASS_ICONS[name ?? 'box'];
  if (Static) return <Static aria-hidden {...props} />;
  return (
    <DynamicIcon
      name={name as IconName}
      aria-hidden
      fallback={() => <BoxIcon aria-hidden {...props} />}
      {...props}
    />
  );
}
