'use client';

import type { ApiClient } from '@isbp/contracts';
import { matchPermission } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import {
  ArrowUpRightIcon,
  BotIcon,
  CircleCheckIcon,
  GitPullRequestArrowIcon,
  KeyRoundIcon,
  PlugIcon,
  ShieldOffIcon,
  TerminalIcon,
  WrenchIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useApiQuery } from '@/lib/api';
import { CopyButton, useOrigin } from '../applications/app-parts';

const MCP_PERMISSION = 'core.mcp.use';
/** Revisions the server speaks (apps/api/src/kernel/ai/mcp.ts): stateless 2026-07-28 and initialize-based ones. */
const MODERN = ['2026-07-28'];
const LEGACY = ['2025-11-25', '2025-06-18', '2025-03-26'];
/** Never a real key: people paste their own. */
const KEY_PLACEHOLDER = '<API key>';

/** API clients that may connect (they hold `core.mcp.use`), for people who manage API clients. */
function McpClients() {
  const t = useTranslations('ai.mcp');
  const { data, isLoading } = useApiQuery<{ items: ApiClient[] }>('/api-clients');
  if (isLoading || !data) return null;
  const clients = data.items.filter(
    (c) => !c.revokedAt && c.permissions.some((p) => matchPermission(p, MCP_PERMISSION)),
  );
  return (
    <div className="grid gap-2">
      <h3 className="text-sm font-medium">{t('clientsTitle')}</h3>
      {clients.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('clientsEmpty')}</p>
      ) : (
        <ul className="grid gap-1.5">
          {clients.map((c) => (
            <li key={c.id} className="flex min-w-0 items-center gap-2 text-sm">
              <BotIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <Link
                href={`/admin/api-clients/${c.id}`}
                className="truncate font-medium hover:underline focus-visible:underline focus-visible:outline-none"
              >
                {c.name}
              </Link>
              <code className="hidden truncate font-mono text-xs text-muted-foreground sm:inline">
                {c.clientId}
              </code>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Administration → AI → Outside agents (MCP): the platform's MCP endpoint, who may use it, what it offers and how to
 * connect Claude Code. Design: docs/architecture.md §13.4.
 */
export function McpPanel() {
  const t = useTranslations('ai.mcp');
  const origin = useOrigin();
  const canManageClients = useCan('core.api-clients.manage');
  const url = `${origin}/api/v1/mcp`;
  const command = `claude mcp add --transport http isbp ${url} --header "Authorization: Bearer ${KEY_PLACEHOLDER}"`;

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PlugIcon className="size-4 text-primary" aria-hidden />
            {t('endpoint')}
          </CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm">
          <div className="grid gap-1.5">
            <p className="text-xs font-medium text-muted-foreground">{t('endpointUrl')}</p>
            <div className="flex min-w-0 items-center gap-1 rounded-lg border bg-muted/40 py-1 pr-1 pl-3">
              <code className="min-w-0 flex-1 font-mono text-xs break-all">{url}</code>
              <CopyButton value={url} label={t('copyEndpoint')} />
            </div>
            <p className="text-xs text-muted-foreground">{t('endpointHint')}</p>
          </div>
          <div className="grid gap-1.5">
            <h3 className="text-sm font-medium">{t('versions')}</h3>
            <ul className="flex flex-wrap gap-1.5" aria-label={t('versions')}>
              {MODERN.map((v) => (
                <li key={v}>
                  <Badge variant="success">
                    <CircleCheckIcon aria-hidden /> {v} · {t('stateless')}
                  </Badge>
                </li>
              ))}
              {LEGACY.map((v) => (
                <li key={v}>
                  <Badge variant="muted">
                    {v} · {t('legacy')}
                  </Badge>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">{t('versionsBody')}</p>
          </div>
        </CardContent>
      </Card>

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRoundIcon className="size-4 text-primary" aria-hidden />
            {t('access')}
          </CardTitle>
          <CardDescription>{t('accessBody', { permission: MCP_PERMISSION })}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {canManageClients && <McpClients />}
          <Button variant="outline" size="sm" asChild className="justify-self-start">
            <Link href="/admin/api-clients">
              {t('manageClients')} <ArrowUpRightIcon />
            </Link>
          </Button>
        </CardContent>
      </Card>

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <WrenchIcon className="size-4 text-primary" aria-hidden />
            {t('offered')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-3 text-sm">
            <li className="flex items-start gap-2.5">
              <WrenchIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span>{t('offeredTools')}</span>
            </li>
            <li className="flex items-start gap-2.5">
              <PlugIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span>{t('offeredResources')}</span>
            </li>
            <li className="flex items-start gap-2.5">
              <GitPullRequestArrowIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span>{t('offeredChangeSets')}</span>
            </li>
            <li className="flex items-start gap-2.5">
              <ShieldOffIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span>{t('offeredNoDestructive')}</span>
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TerminalIcon className="size-4 text-primary" aria-hidden />
            {t('connect')}
          </CardTitle>
          <CardDescription>{t('connectBody')}</CardDescription>
        </CardHeader>
        <CardContent>
          {/* Wraps instead of scrolling: a narrow screen still shows the whole command. */}
          <figure className="grid min-w-0 gap-1.5">
            <figcaption className="text-xs font-medium text-muted-foreground">{t('command')}</figcaption>
            <div className="flex min-w-0 items-start gap-1 rounded-lg border bg-muted/40 py-1 pr-1 pl-3">
              <pre className="min-w-0 flex-1 py-1.5 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap">
                <code>{command}</code>
              </pre>
              <CopyButton value={command} label={t('copyCommand')} />
            </div>
            <p className="text-xs text-muted-foreground">{t('placeholderHint')}</p>
          </figure>
        </CardContent>
      </Card>
    </div>
  );
}
