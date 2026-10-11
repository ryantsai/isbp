'use client';

import { Button } from '@astryxdesign/core/Button';
import { ClickableCard } from '@astryxdesign/core/ClickableCard';
import { Divider } from '@astryxdesign/core/Divider';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { RadioList, RadioListItem } from '@astryxdesign/core/RadioList';
import { Heading, Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { parseRecordRef } from '@isbp/sdk';
import { useCan, usePlatform } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { Card, CardContent } from '@isbp/ui/card';
import { EmptyState } from '@isbp/ui/empty-state';
import { AnimatedItem, AnimatedList } from '@isbp/ui/motion';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { BookOpenIcon, CircleSlashIcon, FeatherIcon, LightbulbIcon, SendIcon, SnailIcon } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
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
    <VStack gap={2}>
      {articles.length ? (
        <AnimatedList>
          {articles.map((a) => (
            <AnimatedItem key={a.id} className="pb-2">
              <ClickableCard label={a.title} href={a.href} padding={3}>
                <VStack gap={1}>
                  <HStack gap={2} vAlign="start">
                    <Icon icon={BookOpenIcon} color="accent" />
                    <Text weight="medium">{a.title}</Text>
                  </HStack>
                  <Text type="supporting" maxLines={3}>
                    {a.snippet || a.summary}
                  </Text>
                </VStack>
              </ClickableCard>
            </AnimatedItem>
          ))}
        </AnimatedList>
      ) : (
        <EmptyState variant="compact" title={t('suggestions.empty')} />
      )}
      {articles.length > 0 && (
        <Text as="p" type="supporting">
          {t('suggestions.hint')}
        </Text>
      )}
    </VStack>
  );
}

/** The heading of the suggestions block (a level-2 outline entry, sized like a card title). */
function SuggestionsHeading({ id }: { id: string }) {
  const t = useTranslations('itsm.report');
  return (
    <HStack gap={2} vAlign="center">
      <Icon icon={LightbulbIcon} color="accent" />
      <Heading level={3} accessibilityLevel={2} id={id}>
        {t('suggestions.title')}
      </Heading>
    </HStack>
  );
}

/** "Report an issue": the friendly self-service form, with knowledge suggestions while you type. */
export default function ReportPage() {
  const t = useTranslations('itsm.report');
  const router = useRouter();
  const id = useId();
  const { enabledModules } = usePlatform();
  const titleInput = useRef<HTMLInputElement>(null);
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
      titleInput.current?.focus();
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
        back={{ href: '/requests', label: t('back') }}
        title={t('title')}
        description={t('description')}
      />
      <div className={cn('grid grid-cols-1 gap-4', knowledge && 'lg:grid-cols-[minmax(0,1fr)_20rem]')}>
        <Card className="min-w-0">
          <CardContent>
            <form noValidate onSubmit={onSubmit}>
              <FormLayout defaultOptionality="optional">
                {link && <LinkedRecordChip record={link} onRemove={() => setDropLink(true)} />}
                <TextInput
                  ref={titleInput}
                  label={t('whatsWrong')}
                  isRequired
                  value={title}
                  onChange={(v) => setTitle(v.slice(0, 200))}
                  placeholder={t('whatsWrongPlaceholder')}
                  autoComplete="off"
                  status={errors.title ? { type: 'error', message: errors.title } : undefined}
                  statusVariant="detached"
                />
                <TextArea
                  label={t('tellUsMore')}
                  rows={6}
                  value={description}
                  onChange={setDescription}
                  placeholder={t('tellUsMorePlaceholder')}
                  description={t('tellUsMoreHint')}
                />
                {articles.length > 0 && (
                  <VStack as="section" gap={2} className="lg:hidden" aria-labelledby={`${id}-help-inline`}>
                    <SuggestionsHeading id={`${id}-help-inline`} />
                    <Suggestions articles={articles} />
                  </VStack>
                )}
                <RadioList
                  label={t('impactLegend')}
                  value={String(urgency)}
                  onChange={(v) => setUrgency(Number(v) as 1 | 2 | 3)}
                >
                  {IMPACT.map((o) => (
                    <RadioListItem
                      key={o.key}
                      value={String(o.urgency)}
                      label={t(`impact.${o.key}`)}
                      description={t(`impact.${o.key}Hint`)}
                      endContent={<Icon icon={o.icon} color="secondary" />}
                    />
                  ))}
                </RadioList>
                {services && (
                  <ServicePicker
                    label={t('whichService')}
                    description={t('whichServiceHint')}
                    isOptional
                    value={service}
                    onChange={setService}
                  />
                )}
                <Divider />
                <HStack gap={2} wrap="wrap" hAlign="end" vAlign="center">
                  <Button label={t('cancel')} variant="ghost" href="/requests" />
                  <Button
                    label={t('submit')}
                    variant="primary"
                    icon={<Icon icon={SendIcon} />}
                    isLoading={submit.isPending}
                    type="submit"
                  />
                </HStack>
              </FormLayout>
            </form>
          </CardContent>
        </Card>

        {knowledge && (
          <aside className="hidden min-w-0 content-start gap-3 lg:grid" aria-labelledby={`${id}-help`}>
            <SuggestionsHeading id={`${id}-help`} />
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
