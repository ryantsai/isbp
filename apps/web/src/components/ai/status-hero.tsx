'use client';

import type { AiConfigInfo, AiStatusInfo } from '@isbp/contracts';
import { cn } from '@isbp/ui';
import { Card, CardContent } from '@isbp/ui/card';
import { Disclosure, duration, ease, FadeIn } from '@isbp/ui/motion';
import { Skeleton } from '@isbp/ui/skeleton';
import {
  CircleCheckIcon,
  CircleMinusIcon,
  CircleXIcon,
  DatabaseIcon,
  LibraryBigIcon,
  ShieldCheckIcon,
  ShieldOffIcon,
  SparklesIcon,
  TriangleAlertIcon,
  WalletIcon,
  WandSparklesIcon,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useFormatter, useTranslations } from 'next-intl';
import { type ReactNode, useId } from 'react';
import { modelLabel, useUsd } from './ai-meta';
import { Badge } from '@astryxdesign/core/Badge';
import { Icon } from '@astryxdesign/core/Icon';

/**
 * Top of Administration → AI: the mode features run in, whether data leaves the platform, and spend. The embedding
 * model and vector store sit behind "Technical details".
 */
export function StatusHero({ status, config }: { status?: AiStatusInfo; config?: AiConfigInfo }) {
  const t = useTranslations('ai.status');
  if (!status || !config)
    return (
      <Card className="mb-4">
        <CardContent className="space-y-4">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-7 w-2/3" />
          <div className="grid gap-4 md:grid-cols-3">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        </CardContent>
      </Card>
    );

  const generative = status.chat.available;
  const keyMissing = config.chat.provider === 'anthropic' && !config.chat.hasApiKey;
  const provider =
    status.chat.provider === 'anthropic' ? t('providers.anthropic') : t('providers.openaiCompatible');

  return (
    <FadeIn y={4} className="mb-4">
      <Card className="relative overflow-hidden">
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b to-transparent',
            generative ? 'from-primary/8' : 'from-muted/70',
          )}
        />
        <CardContent className="relative space-y-5">
          <div className="flex items-start gap-4">
            <span
              className={cn(
                'grid size-11 shrink-0 place-items-center rounded-xl',
                generative ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
              )}
              aria-hidden
            >
              {generative ? <SparklesIcon className="size-5" /> : <LibraryBigIcon className="size-5" />}
            </span>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm text-muted-foreground">{generative ? t('generative') : t('builtin')}</p>
                {generative && keyMissing ? (
                  <Badge
                    variant="warning"
                    label={t('keyMissing')}
                    icon={<Icon icon={TriangleAlertIcon} size="xsm" />}
                  />
                ) : generative ? (
                  <Badge
                    variant="success"
                    label={t('on')}
                    icon={<Icon icon={CircleCheckIcon} size="xsm" />}
                  />
                ) : (
                  <Badge
                    variant="neutral"
                    label={t('noModel')}
                    icon={<Icon icon={CircleMinusIcon} size="xsm" />}
                  />
                )}
              </div>
              <h2 className="text-lg font-semibold tracking-tight break-words">
                {generative
                  ? t('generativeTitle', { model: modelLabel(status.chat.model), provider })
                  : t('builtinTitle')}
              </h2>
              <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
                {generative ? (
                  config.masking.enabled ? (
                    <>
                      <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                      {t('maskingOn')}
                    </>
                  ) : (
                    <>
                      <ShieldOffIcon className="mt-0.5 size-4 shrink-0 text-warning-foreground" aria-hidden />
                      {t('maskingOff')}
                    </>
                  )
                ) : (
                  <>
                    <WandSparklesIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                    {t('builtinBody')}
                  </>
                )}
              </p>
            </div>
          </div>

          <dl className="grid grid-cols-1 gap-3 sm:max-w-sm">
            <Fact icon={<WalletIcon />} label={t('spend')}>
              <Spend spent={config.spentThisMonthUsd} budget={config.monthlyBudgetUsd} />
            </Fact>
          </dl>
          {/* How search works underneath: for whoever deploys and supports the platform. */}
          <Disclosure
            summary={t('technical')}
            triggerClassName="w-fit text-muted-foreground"
            className="border-t pt-2"
          >
            <dl className="grid grid-cols-1 gap-3 pt-2 md:grid-cols-2">
              <Fact icon={<SparklesIcon />} label={t('embeddings')}>
                <span className="font-mono text-sm break-all">{status.embeddings.model}</span>
                <span className="block text-xs text-muted-foreground">
                  {status.embeddings.provider === 'builtin'
                    ? t('embeddingsBuiltin', { dimensions: status.embeddings.dimensions })
                    : status.embeddings.dimensions
                      ? t('embeddingsExternal', { dimensions: status.embeddings.dimensions })
                      : t('embeddingsExternalNoDims')}
                </span>
              </Fact>
              <Fact icon={<DatabaseIcon />} label={t('vectorStore')}>
                <span className="text-sm font-medium">
                  {status.vectorStore === 'pgvector' ? t('pgvector') : t('portable')}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {status.vectorStore === 'pgvector' ? t('pgvectorHint') : t('portableHint')}
                </span>
              </Fact>
            </dl>
          </Disclosure>
        </CardContent>
      </Card>
    </FadeIn>
  );
}

function Fact({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border bg-card/60 px-3 py-2.5">
      <dt className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground [&_svg]:size-3.5">
        <span aria-hidden>{icon}</span>
        {label}
      </dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/** This month's spend against the budget: a meter with text (never colour alone). */
function Spend({ spent, budget }: { spent: number; budget: number }) {
  const t = useTranslations('ai.status');
  const format = useFormatter();
  const usd = useUsd();
  const id = useId();
  if (!budget)
    return (
      <>
        <span className="text-sm font-medium">{usd(spent)}</span>
        <span className="block text-xs text-muted-foreground">{t('noBudget')}</span>
      </>
    );
  const ratio = spent / budget;
  const percent = Math.min(100, Math.round(ratio * 100));
  const tone = ratio >= 1 ? 'over' : ratio >= 0.8 ? 'near' : 'ok';
  const text = t('spendOf', { spent: usd(spent), budget: usd(budget) });
  return (
    <>
      <span id={`${id}-label`} className="text-sm font-medium">
        {text}
      </span>
      <div
        role="progressbar"
        aria-labelledby={`${id}-label`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={t('spendPercent', {
          percent: format.number(Math.min(ratio, 1), { style: 'percent' }),
        })}
        className={cn(
          'mt-1.5 h-1.5 overflow-hidden rounded-full',
          tone === 'ok' && 'bg-primary/15',
          tone === 'near' && 'bg-warning/25',
          tone === 'over' && 'bg-destructive/15',
        )}
      >
        <motion.div
          className={cn(
            'h-full rounded-full',
            tone === 'ok' && 'bg-primary',
            tone === 'near' && 'bg-warning',
            tone === 'over' && 'bg-destructive',
          )}
          initial={{ width: 0 }}
          animate={{ width: `${percent}%` }}
          transition={{ duration: duration.slow, ease: ease.enter }}
        />
      </div>
      <span
        className={cn(
          'mt-1 flex items-center gap-1 text-xs',
          tone === 'ok' && 'text-muted-foreground',
          tone === 'near' && 'text-warning-foreground',
          tone === 'over' && 'text-destructive',
        )}
      >
        {tone === 'over' && <CircleXIcon className="size-3.5 shrink-0" aria-hidden />}
        {tone === 'near' && <TriangleAlertIcon className="size-3.5 shrink-0" aria-hidden />}
        {tone === 'over'
          ? t('budgetSpent')
          : tone === 'near'
            ? t('budgetNear', { percent: format.number(ratio, { style: 'percent' }) })
            : t('budgetUsed', { percent: format.number(ratio, { style: 'percent' }) })}
      </span>
    </>
  );
}
