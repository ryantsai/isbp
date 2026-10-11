'use client';

import { Icon } from '@astryxdesign/core/Icon';
import { VStack } from '@astryxdesign/core/Layout';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import type { AiConfigInfo, AiStatusInfo } from '@isbp/contracts';
import { useCan } from '@isbp/sdk/web';
import { EmptyState } from '@isbp/ui/empty-state';
import { PageHeader } from '@isbp/ui/page-header';
import {
  BotIcon,
  ChartNoAxesColumnIcon,
  CpuIcon,
  DatabaseIcon,
  LockIcon,
  ShieldCheckIcon,
} from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { useApiQuery } from '@/lib/api';
import { CONFIG_PATH, STATUS_PATH } from './ai-meta';
import { IndexPanel } from './index-panel';
import { McpPanel } from './mcp-panel';
import { ModelsPanel } from './models-panel';
import { PrivacyPanel } from './privacy-panel';
import { StatusHero } from './status-hero';
import { UsagePanel } from './usage-panel';

const TABS = ['models', 'privacy', 'usage', 'index', 'mcp'] as const;
type TabKey = (typeof TABS)[number];
const TAB_ICONS = {
  models: CpuIcon,
  privacy: ShieldCheckIcon,
  usage: ChartNoAxesColumnIcon,
  index: DatabaseIcon,
  mcp: BotIcon,
} as const;

/** Administration → AI: providers, privacy and budget, usage, the semantic index and outside agents (MCP). */
export function AiAdminView() {
  const t = useTranslations('ai');
  const panelId = useId();
  const ts = useTranslations('shell');
  const canManage = useCan('core.ai.manage');
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const raw = sp.get('tab');
  const tab: TabKey = (TABS as readonly string[]).includes(raw ?? '') ? (raw as TabKey) : 'models';
  const status = useApiQuery<AiStatusInfo>(STATUS_PATH, undefined, { enabled: canManage });
  const config = useApiQuery<AiConfigInfo>(CONFIG_PATH, undefined, { enabled: canManage });

  // Switching tabs drops the usage range.
  const setTab = (v: string) =>
    router.replace(v === 'models' ? pathname : `${pathname}?tab=${v}`, { scroll: false });

  if (!canManage) return <EmptyState icon={<LockIcon />} title={ts('forbidden')} />;

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <StatusHero status={status.data} config={config.data} />
      <VStack gap={4}>
        <TabList role="tablist" aria-label={t('tabs.label')} value={tab} onChange={setTab}>
          {TABS.map((key) => (
            <Tab
              key={key}
              value={key}
              label={t(`tabs.${key}`)}
              icon={<Icon icon={TAB_ICONS[key]} />}
              panelId={panelId}
            />
          ))}
        </TabList>
        <div role="tabpanel" id={panelId} aria-label={t(`tabs.${tab}`)}>
          {tab === 'models' && <ModelsPanel />}
          {tab === 'privacy' && <PrivacyPanel />}
          {tab === 'usage' && <UsagePanel />}
          {tab === 'index' && <IndexPanel />}
          {tab === 'mcp' && <McpPanel />}
        </div>
      </VStack>
    </>
  );
}
