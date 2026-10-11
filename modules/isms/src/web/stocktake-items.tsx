'use client';

import { useApi } from '@isbp/sdk/web';
import { DecisionList, type DecisionListProps, type DecisionOption } from '@isbp/ui/decision-list';
import { useApiMutation } from '@isbp/ui/query';
import { toast } from '@isbp/ui/toast';
import { CheckIcon, PencilLineIcon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import type { StocktakeItem } from '../contracts';
import { ResultBadge } from './badges';
import { assetHref, INVALIDATE, stocktakeHref, useDay, useLocalized } from './lib';
import { RecordItemDialog } from './stocktake-dialogs';

type Choice = 'confirmed' | 'different';
type WithStocktake = StocktakeItem & { stocktake?: { reference: string; name: string; dueOn: string } };

/** What the register says about the asset, so the person can answer "is this still right?" without opening it. */
export function RegisterFacts({ item, className }: { item: StocktakeItem; className?: string }) {
  const t = useTranslations('isms');
  const day = useDay();
  const s = item.snapshot;
  const product = [s.brand, s.model, s.version].filter(Boolean).join(' ');
  const facts = [
    s.location ? t('record.facts.location', { value: s.location }) : t('record.facts.noLocation'),
    t('record.facts.quantity', { value: s.quantity }),
    s.usersText ? t('record.facts.users', { value: s.usersText }) : null,
    product || null,
    item.lastVerifiedOn
      ? t('record.facts.verified', { date: day(item.lastVerifiedOn) })
      : t('record.facts.neverVerified'),
  ].filter(Boolean);
  return <p className={className}>{facts.join(' · ')}</p>;
}

function ItemSummary({ item, showAssignee }: { item: WithStocktake; showAssignee: boolean }) {
  const t = useTranslations('isms');
  const localized = useLocalized();
  const day = useDay();
  const s = item.snapshot;
  return (
    <div className="grid min-w-0 gap-0.5">
      <p className="font-medium wrap-break-word">{s.name}</p>
      <p className="text-xs text-muted-foreground">
        {item.assetId ? (
          <Link href={assetHref(s.number)} className="font-mono hover:underline">
            {s.number}
          </Link>
        ) : (
          <span className="font-mono">{s.number}</span>
        )}
        {' · '}
        {localized(s.subclassName) || localized(s.className)}
        {item.stocktake && (
          <>
            {' · '}
            <Link href={stocktakeHref(item.stocktake.reference)} className="hover:underline">
              {item.stocktake.name}
            </Link>{' '}
            ({t('stocktakes.dueOn', { date: day(item.stocktake.dueOn) })})
          </>
        )}
      </p>
      <RegisterFacts item={item} className="text-xs wrap-break-word text-muted-foreground" />
      {showAssignee && (item.assignee || item.assigneeGroup) && (
        <p className="text-xs text-muted-foreground">
          {t('record.checkedBy', { name: item.assignee?.displayName ?? item.assigneeGroup?.name ?? '' })}
        </p>
      )}
    </div>
  );
}

/**
 * Stocktake items with the two answers inline: "It's right" (one click) and "Something's different…" (corrections,
 * missing or disposed, in a dialog that shows the register first). Shared by the stocktake page and "Waiting for you".
 */
export function StocktakeItemList({
  items,
  stocktakeOf,
  showAssignee = false,
  ...list
}: Omit<
  DecisionListProps<WithStocktake, Choice>,
  'getId' | 'renderItem' | 'options' | 'decisionOf' | 'canDecide' | 'onDecide' | 'renderResult'
> & {
  items: readonly WithStocktake[];
  /** The stocktake an item belongs to (its reference). */
  stocktakeOf: (item: WithStocktake) => string;
  showAssignee?: boolean;
}) {
  const t = useTranslations('isms');
  const api = useApi();
  const [different, setDifferent] = useState<WithStocktake | null>(null);
  const confirm = useApiMutation(
    async (_a, list: WithStocktake[]) => {
      for (const i of list)
        await api.post(`/isms/stocktakes/${stocktakeOf(i)}/items/${i.id}`, { result: 'confirmed' });
      return list.length;
    },
    {
      invalidate: INVALIDATE,
      onSuccess: (n, list) =>
        toast.success(
          n === 1
            ? t('record.confirmedOne', { name: list[0]!.snapshot.name })
            : t('record.confirmedMany', { count: n }),
        ),
    },
  );
  const busy = useMemo(
    () => new Set<string>(confirm.isPending ? (confirm.variables ?? []).map((i) => i.id) : []),
    [confirm.isPending, confirm.variables],
  );
  const options: DecisionOption<Choice>[] = [
    { value: 'confirmed', label: t('record.right'), icon: <CheckIcon /> },
    { value: 'different', label: t('record.different'), icon: <PencilLineIcon />, bulk: false },
  ];
  return (
    <>
      <DecisionList<WithStocktake, Choice>
        {...list}
        items={items}
        getId={(i) => i.id}
        renderItem={(i) => <ItemSummary item={i} showAssignee={showAssignee} />}
        options={options}
        decisionOf={(i) => (!i.result ? null : i.result === 'confirmed' ? 'confirmed' : 'different')}
        canDecide={(i) => i.canRecord}
        renderResult={(i) => (
          <span className="grid justify-items-start gap-1 sm:justify-items-end">
            <ResultBadge result={i.result} />
            {i.note && (
              <span className="max-w-64 text-xs wrap-break-word text-muted-foreground">{i.note}</span>
            )}
          </span>
        )}
        optionLabel={(o, i) =>
          o.value === 'confirmed'
            ? t('record.rightFor', { name: i.snapshot.name })
            : t('record.differentFor', { name: i.snapshot.name })
        }
        groupLabel={(i) => t('record.groupFor', { name: i.snapshot.name })}
        bulkLabel={(_o, count) => t('record.confirmSelected', { count })}
        onDecide={(list, choice) => {
          if (choice === 'confirmed') confirm.mutate(list);
          else setDifferent(list[0] ?? null);
        }}
        busy={busy}
      />
      <RecordItemDialog
        stocktake={different ? stocktakeOf(different) : ''}
        item={different}
        onOpenChange={(o) => !o && setDifferent(null)}
      />
    </>
  );
}
