'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { VStack } from '@astryxdesign/core/Layout';
import { List, ListItem } from '@astryxdesign/core/List';
import { Heading, Text } from '@astryxdesign/core/Text';
import { defaultFieldValues, type FieldDef, type FormElement } from '@isbp/sdk';
import { EmptyState } from '@isbp/ui/empty-state';
import { Form } from '@isbp/ui/form';
import { IconTile } from '@isbp/ui/icon-tile';
import { Disclosure } from '@isbp/ui/motion';
import { FormFields, useFieldsResolver } from '@isbp/ui/form-renderer';
import { applyServerErrors, useApiMutation, useApiQuery } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import { ArrowLeftIcon, BoxIcon, FilePlus2Icon, WandSparklesIcon } from 'lucide-react';
import { DynamicIcon, type IconName } from 'lucide-react/dynamic';
import { motion } from 'motion/react';
import { useFormatter, useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import { type FieldValues, useForm } from 'react-hook-form';
import { useActionErrorText } from '../change-set/dialogs';
import { type ChangeSetDetailDto, INVALIDATE, type KindInfoDto, useCatalogText, useKindLabel } from '../lib';
import { ChangeSetCard } from './change-set-card';

interface Picked {
  kind: KindInfoDto;
  template: KindInfoDto['templates'][number];
}

/**
 * Templates in the order people need them: a whole request process first, then a form, a field and an approval on
 * their own; the rest after, in the order of their kinds.
 */
const ORDER = [
  'core.form/approval-process',
  'core.form/request-form',
  'core.custom-field/',
  'core.workflow/',
];

function rankOf(kind: string, templateId: string): number {
  const i = ORDER.findIndex((o) => `${kind}/${templateId}`.startsWith(o));
  return i < 0 ? ORDER.length : i;
}

function KindIcon({ kind }: { kind: KindInfoDto }) {
  return kind.icon ? (
    <DynamicIcon name={kind.icon as IconName} className="size-4 shrink-0" aria-hidden />
  ) : (
    <BoxIcon className="size-4 shrink-0" aria-hidden />
  );
}

/** The questions of one template, rendered by the platform's form renderer and validated like the server does. */
function TemplateQuestions({
  picked,
  fields,
  changeSetId,
  onBuilt,
}: {
  picked: Picked;
  fields: FieldDef[];
  changeSetId: string | null;
  onBuilt: (cs: ChangeSetDetailDto) => void;
}) {
  const t = useTranslations('assistant.templates');
  const errorOf = useActionErrorText();
  const elements = useMemo<FormElement[]>(() => fields.map((f) => ({ ...f, id: f.key })), [fields]);
  const resolver = useFieldsResolver(fields);
  const form = useForm<FieldValues>({ resolver, defaultValues: defaultFieldValues(fields) });
  const [formError, setFormError] = useState<string | null>(null);
  const build = useApiMutation(
    (api, answers: Record<string, unknown>) =>
      api.post<ChangeSetDetailDto>('/assistant/templates/build', {
        kind: picked.kind.kind,
        templateId: picked.template.id,
        answers,
        ...(changeSetId ? { changeSetId } : {}),
      }),
    { invalidate: INVALIDATE, silent: true, onSuccess: onBuilt },
  );
  const submit = form.handleSubmit((values) => {
    setFormError(null);
    build.mutate(values, {
      onError: (err) => {
        if (!applyServerErrors(err, form.setError as never)) setFormError(errorOf(err));
      },
    });
  });

  return (
    <Form {...form}>
      <form onSubmit={submit} noValidate className="grid gap-2">
        <FormFields elements={elements} form={form} className="sm:grid-cols-1" />
        {formError && <Banner status="error" title={formError} collapsible={false} />}
        <Text type="supporting">{t('nothingLive')}</Text>
        <Button
          type="submit"
          label={t('build')}
          variant="primary"
          icon={<Icon icon={WandSparklesIcon} />}
          isLoading={build.isPending}
          className="justify-self-start"
        />
      </form>
    </Form>
  );
}

function TemplateForm({
  picked,
  changeSetId,
  onBack,
  onBuilt,
}: {
  picked: Picked;
  changeSetId: string | null;
  onBack: () => void;
  onBuilt: (cs: ChangeSetDetailDto) => void;
}) {
  const t = useTranslations('assistant.templates');
  const text = useCatalogText();
  const headingId = useId();
  const path = `/assistant/templates/${encodeURIComponent(picked.kind.kind)}/${encodeURIComponent(picked.template.id)}`;
  const { data, isLoading, error } = useApiQuery<{ fields: FieldDef[] }>(path);
  const fields = data?.fields;

  return (
    <section aria-labelledby={headingId} className="grid gap-4">
      <Button
        label={t('back')}
        variant="ghost"
        size="sm"
        icon={<Icon icon={ArrowLeftIcon} />}
        onClick={onBack}
        className="-ml-2 justify-self-start text-muted-foreground"
      />
      <VStack gap={1}>
        <Heading id={headingId} level={3}>
          <span className="inline-flex items-center gap-2">
            <KindIcon kind={picked.kind} />
            {text(picked.template.label)}
          </span>
        </Heading>
        <Text color="secondary">{text(picked.template.description)}</Text>
        {!picked.kind.canApply && <Text type="supporting">{t('needsReviewer')}</Text>}
      </VStack>
      {isLoading ? (
        <div className="grid gap-3" aria-busy="true">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-2/3" />
        </div>
      ) : error || !fields ? (
        <Banner status="error" title={t('loadError')} collapsible={false} />
      ) : (
        <TemplateQuestions
          key={path}
          picked={picked}
          fields={fields}
          changeSetId={changeSetId}
          onBuilt={onBuilt}
        />
      )}
    </section>
  );
}

/**
 * Builtin mode (no chat model): the kinds' guided templates instead of free text. A template's answers become a
 * change in a change set (the one started here, until "Start a new change set").
 */
export function TemplatesView({
  kinds,
  changeSetId,
  onChangeSet,
  onNavigate,
}: {
  kinds: readonly KindInfoDto[];
  changeSetId: string | null;
  onChangeSet: (id: string | null) => void;
  onNavigate: () => void;
}) {
  const t = useTranslations('assistant.templates');
  const text = useCatalogText();
  const kindLabel = useKindLabel(kinds);
  const format = useFormatter();
  const list = (xs: string[]) => format.list(xs, { type: 'conjunction' });
  const listId = useId();
  const [picked, setPicked] = useState<Picked | null>(null);
  const [built, setBuilt] = useState<string | null>(null);
  const withTemplates = kinds.filter((k) => k.templates.length > 0);
  const without = kinds.filter((k) => k.templates.length === 0);
  // One flat list, ordered by use (kinds keep their order among the rest).
  const templates = withTemplates
    .flatMap((k, ki) => k.templates.map((tpl, ti) => ({ kind: k, template: tpl, order: ki * 100 + ti })))
    .sort(
      (a, b) => rankOf(a.kind.kind, a.template.id) - rankOf(b.kind.kind, b.template.id) || a.order - b.order,
    );

  if (picked)
    return (
      <TemplateForm
        picked={picked}
        changeSetId={changeSetId}
        onBack={() => setPicked(null)}
        onBuilt={(cs) => {
          onChangeSet(cs.id);
          setBuilt(cs.reference);
          setPicked(null);
        }}
      />
    );

  return (
    <div className="grid grid-cols-1 gap-5">
      <div aria-live="polite">
        {built && (
          <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
            <Banner status="success" title={t('built', { reference: built })} collapsible={false} />
          </motion.div>
        )}
      </div>
      {changeSetId && (
        <div className="grid gap-2">
          <ChangeSetCard id={changeSetId} onNavigate={onNavigate} />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Text type="supporting">{t('addingTo')}</Text>
            <Button
              label={t('startNew')}
              variant="ghost"
              size="sm"
              icon={<Icon icon={FilePlus2Icon} />}
              onClick={() => {
                onChangeSet(null);
                setBuilt(null);
              }}
            />
          </div>
        </div>
      )}

      {withTemplates.length === 0 ? (
        <EmptyState
          icon={<WandSparklesIcon />}
          title={t('noTemplates')}
          description={t('noTemplatesHint')}
          className="py-6"
        />
      ) : (
        <section aria-labelledby={listId} className="grid gap-3">
          <Heading id={listId} level={3}>
            {t('title')}
          </Heading>
          <List hasDividers>
            {templates.map(({ kind: k, template: tpl }) => (
              <ListItem
                key={`${k.kind}/${tpl.id}`}
                label={text(tpl.label)}
                description={
                  <Text type="supporting" maxLines={2}>
                    {text(tpl.description)}
                  </Text>
                }
                startContent={
                  <IconTile size="sm" aria-hidden>
                    <KindIcon kind={k} />
                  </IconTile>
                }
                onClick={() => {
                  setBuilt(null);
                  setPicked({ kind: k, template: tpl });
                }}
              />
            ))}
          </List>
        </section>
      )}
      {without.length > 0 && (
        <Disclosure
          summary={t('whyNot')}
          triggerClassName="text-xs text-muted-foreground"
          contentClassName="text-xs text-muted-foreground"
        >
          <Text type="supporting">
            {t('withoutTemplates', { kinds: list(without.map((k) => kindLabel(k.kind))) })}
          </Text>
        </Disclosure>
      )}
    </div>
  );
}
