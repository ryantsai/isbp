'use client';

import { parseRecordRef } from '@isbp/sdk';
import { useCan, usePlatform } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { Button } from '@isbp/ui/button';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { Textarea } from '@isbp/ui/textarea';
import {
  ArrowLeftIcon,
  BookOpenIcon,
  CircleSlashIcon,
  FeatherIcon,
  LightbulbIcon,
  SendIcon,
  SnailIcon,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { type FormEvent, useEffect, useId, useState } from 'react';
import type { CreateTicketInput, TicketDetail } from '../../contracts';
import { LinkedRecordChip } from '../components/linked-record-chip';
import { ServicePicker } from '../components/pickers';
import { INVALIDATE, ticketHref } from '../lib';
import type { ArticleHit, CmdbService } from '../types';

const IMPACT = [
  { urgency: 1, key: 'blocked', icon: CircleSlashIcon },
  { urgency: 2, key: 'slow', icon: SnailIcon },
  { urgency: 3, key: 'minor', icon: FeatherIcon },
] as const;

const words = (s: string) => s.trim().split(/\s+/u).filter(Boolean).length;
/** CJK text has no spaces: count characters in pairs so a short Chinese/Japanese sentence qualifies too. */
const enoughText = (s: string) => words(s) >= 3 || (/[぀-ヿ㐀-鿿]/u.test(s) && s.trim().length >= 6);

/** Knowledge suggestions for what the user has typed so far (debounced; only with the knowledge module). */
function useDeflection(text: string, enabled: boolean) {
  const locale = useLocale();
  const [q, setQ] = useState('');
  useEffect(() => {
    const h = setTimeout(() => setQ(enabled && enoughText(text) ? text.trim().slice(0, 480) : ''), 400);
    return () => clearTimeout(h);
  }, [text, enabled]);
  const { data } = useApiQuery<{ items: ArticleHit[] }>(q ? '/knowledge/search' : null, {
    q,
    limit: 3,
    locale,
  });
  return q ? (data?.items ?? []) : [];
}

/** "These articles might help" cards (open in the same tab). */
function Suggestions({ articles }: { articles: ArticleHit[] }) {
  const t = useTranslations('itsm.report');
  return (
    <>
      {articles.length ? (
        <ul className="grid gap-2">
          <AnimatePresence initial={false}>
            {articles.map((a, i) => (
              <motion.li
                key={a.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25, delay: i * 0.05 }}
              >
                <Link
                  href={a.href}
                  className="group grid gap-1 rounded-xl border bg-card p-3 transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:hover:translate-y-0"
                >
                  <span className="flex items-start gap-2 text-sm font-medium group-hover:underline">
                    <BookOpenIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                    {a.title}
                  </span>
                  <span className="line-clamp-3 text-xs text-muted-foreground">{a.snippet || a.summary}</span>
                </Link>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed px-3 py-4 text-sm text-muted-foreground">
          {t('suggestions.empty')}
        </p>
      )}
      {articles.length > 0 && <p className="text-xs text-muted-foreground">{t('suggestions.hint')}</p>}
    </>
  );
}

/** "Report an issue": the friendly self-service form, with knowledge suggestions while you type. */
export default function ReportPage() {
  const t = useTranslations('itsm.report');
  const router = useRouter();
  const id = useId();
  const { enabledModules } = usePlatform();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [urgency, setUrgency] = useState<1 | 2 | 3>(2);
  const [service, setService] = useState<CmdbService | null>(null);
  const [errors, setErrors] = useState<{ title?: string }>({});
  // `?link=itam.asset:<id>`: "Report a problem" from another module's page (e.g. My devices).
  const params = useSearchParams();
  const linkParam = params.get('link');
  const [dropLink, setDropLink] = useState(false);
  const link = !dropLink && linkParam ? parseRecordRef(linkParam) : null;
  const knowledge = useCan('knowledge.articles.read') && enabledModules.includes('knowledge');
  const services = useCan('cmdb.services.read') && enabledModules.includes('cmdb');
  const articles = useDeflection(`${title} ${description}`, knowledge);

  const submit = useApiMutation(
    (api, body: CreateTicketInput) => api.post<TicketDetail>('/itsm/tickets', body),
    {
      invalidate: [...INVALIDATE, '/me/requests'],
      success: (r) => t('created', { reference: r.reference }),
      onSuccess: (r) => router.push(ticketHref(r.reference)),
    },
  );

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (title.trim().length < 3) {
      setErrors({ title: t('titleRequired') });
      document.getElementById(`${id}-title`)?.focus();
      return;
    }
    setErrors({});
    submit.mutate({
      type: 'incident',
      channel: 'portal',
      title: title.trim(),
      description: description.trim(),
      urgency,
      ciIds: service ? [service.id] : [],
      links: link ? [{ type: link.type, id: link.id }] : [],
    });
  };

  return (
    <div className="mx-auto grid max-w-5xl gap-2">
      <PageHeader
        eyebrow={
          <Link href="/requests" className="inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeftIcon className="size-3.5" aria-hidden />
            {t('back')}
          </Link>
        }
        title={t('title')}
        description={t('description')}
      />
      <div className={cn('grid grid-cols-1 gap-4', knowledge && 'lg:grid-cols-[minmax(0,1fr)_20rem]')}>
        <form
          noValidate
          onSubmit={onSubmit}
          className="grid min-w-0 gap-4 rounded-xl border bg-card p-4 sm:p-5"
        >
          {link && <LinkedRecordChip record={link} onRemove={() => setDropLink(true)} />}
          <div className="grid gap-2">
            <Label htmlFor={`${id}-title`} className="text-base">
              {t('whatsWrong')}
            </Label>
            <Input
              id={`${id}-title`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('whatsWrongPlaceholder')}
              maxLength={200}
              autoComplete="off"
              aria-invalid={errors.title ? true : undefined}
              aria-describedby={errors.title ? `${id}-title-error` : undefined}
              className="h-10"
            />
            {errors.title && (
              <p id={`${id}-title-error`} className="text-sm text-destructive">
                {errors.title}
              </p>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${id}-description`} className="text-base">
              {t('tellUsMore')}
            </Label>
            <Textarea
              id={`${id}-description`}
              rows={6}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('tellUsMorePlaceholder')}
              aria-describedby={`${id}-description-hint`}
            />
            <p id={`${id}-description-hint`} className="text-xs text-muted-foreground">
              {t('tellUsMoreHint')}
            </p>
          </div>
          {articles.length > 0 && (
            <section className="grid gap-2 lg:hidden" aria-labelledby={`${id}-help-inline`}>
              <h2 id={`${id}-help-inline`} className="flex items-center gap-2 text-sm font-semibold">
                <LightbulbIcon className="size-4 text-primary" aria-hidden />
                {t('suggestions.title')}
              </h2>
              <Suggestions articles={articles} />
            </section>
          )}
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-base font-medium">{t('impactLegend')}</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {IMPACT.map((o) => {
                const Icon = o.icon;
                return (
                  <label
                    key={o.key}
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-all hover:bg-accent/50 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
                      urgency === o.urgency && 'border-primary bg-primary/5 shadow-xs',
                    )}
                  >
                    <input
                      type="radio"
                      name={`${id}-urgency`}
                      value={o.urgency}
                      checked={urgency === o.urgency}
                      onChange={() => setUrgency(o.urgency)}
                      className="sr-only"
                    />
                    <span
                      className={cn(
                        'grid size-8 shrink-0 place-items-center rounded-lg',
                        urgency === o.urgency
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground',
                      )}
                      aria-hidden
                    >
                      <Icon className="size-4" />
                    </span>
                    <span className="grid gap-0.5">
                      <span className="text-sm font-medium">{t(`impact.${o.key}`)}</span>
                      <span className="text-xs text-muted-foreground">{t(`impact.${o.key}Hint`)}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          {services && (
            <div className="grid gap-2">
              <Label htmlFor={`${id}-service`} className="text-base">
                {t('whichService')}{' '}
                <span className="text-sm font-normal text-muted-foreground">({t('optional')})</span>
              </Label>
              <ServicePicker
                id={`${id}-service`}
                value={service}
                onChange={setService}
                aria-describedby={`${id}-service-hint`}
              />
              <p id={`${id}-service-hint`} className="text-xs text-muted-foreground">
                {t('whichServiceHint')}
              </p>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
            <Button asChild variant="ghost">
              <Link href="/requests">{t('cancel')}</Link>
            </Button>
            <Button type="submit" loading={submit.isPending}>
              <SendIcon />
              {t('submit')}
            </Button>
          </div>
        </form>

        {knowledge && (
          <aside className="hidden min-w-0 content-start gap-3 lg:grid" aria-labelledby={`${id}-help`}>
            <h2 id={`${id}-help`} className="flex items-center gap-2 text-sm font-semibold">
              <LightbulbIcon className="size-4 text-primary" aria-hidden />
              {t('suggestions.title')}
            </h2>
            <Suggestions articles={articles} />
          </aside>
        )}
      </div>
      <p className="sr-only" aria-live="polite">
        {articles.length ? t('suggestions.announce', { count: articles.length }) : ''}
      </p>
    </div>
  );
}
