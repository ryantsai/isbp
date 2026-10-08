'use client';

import type { AiConfigInfo, AiStatusInfo } from '@isbp/contracts';
import { useCan } from '@isbp/sdk/web';
import { EmptyState } from '@isbp/ui/empty-state';
import { PageHeader } from '@isbp/ui/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
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
import { useApiQuery } from '@/lib/api';
import { CONFIG_PATH, STATUS_PATH } from './ai-meta';
import { IndexPanel } from './index-panel';
import { McpPanel } from './mcp-panel';
import { ModelsPanel } from './models-panel';
import { PrivacyPanel } from './privacy-panel';
import { StatusHero } from './status-hero';
import { UsagePanel } from './usage-panel';

const TABS = ['models', 'privacy', 'usage', 'index', 'mcp'] as const;
type Tab = (typeof TABS)[number];

/** Administration → AI: providers, privacy and budget, usage, the semantic index and outside agents (MCP). */
export function AiAdminView() {
  const t = useTranslations('ai');
  const ts = useTranslations('shell');
  const canManage = useCan('core.ai.manage');
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const raw = sp.get('tab');
  const tab: Tab = (TABS as readonly string[]).includes(raw ?? '') ? (raw as Tab) : 'models';
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
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label={t('tabs.label')}>
          <TabsTrigger value="models">
            <CpuIcon aria-hidden /> {t('tabs.models')}
          </TabsTrigger>
          <TabsTrigger value="privacy">
            <ShieldCheckIcon aria-hidden /> {t('tabs.privacy')}
          </TabsTrigger>
          <TabsTrigger value="usage">
            <ChartNoAxesColumnIcon aria-hidden /> {t('tabs.usage')}
          </TabsTrigger>
          <TabsTrigger value="index">
            <DatabaseIcon aria-hidden /> {t('tabs.index')}
          </TabsTrigger>
          <TabsTrigger value="mcp">
            <BotIcon aria-hidden /> {t('tabs.mcp')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="models">
          <ModelsPanel />
        </TabsContent>
        <TabsContent value="privacy">
          <PrivacyPanel />
        </TabsContent>
        <TabsContent value="usage">
          <UsagePanel />
        </TabsContent>
        <TabsContent value="index">
          <IndexPanel />
        </TabsContent>
        <TabsContent value="mcp">
          <McpPanel />
        </TabsContent>
      </Tabs>
    </>
  );
}
