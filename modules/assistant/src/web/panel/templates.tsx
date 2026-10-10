'use client';

import { defaultFieldValues, type FieldDef, type FormElement } from '@isbp/sdk';
import { cn } from '@isbp/ui';
import { Button } from '@isbp/ui/button';
import { EmptyState } from '@isbp/ui/empty-state';
import { Form } from '@isbp/ui/form';
import { Disclosure } from '@isbp/ui/motion';
import { FormFields, useFieldsResolver } from '@isbp/ui/form-renderer';
import { applyServerErrors, useApiMutation, useApiQuery } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import {
  ArrowLeftIcon,
  BoxIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  FilePlus2Icon,
  WandSparklesIcon,
} from 'lucide-react';
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
        {formError && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            <CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            {formError}
          </p>
        )}
        <p className="text-xs text-muted-foreground">{t('nothingLive')}</p>
        <Button type="submit" loading={build.isPending} className="justify-self-start">
          {!build.isPending && <WandSparklesIcon />}
          {t('build')}
        </Button>
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
        variant="ghost"
        size="sm"
        onClick={onBack}
        className="-ml-2 justify-self-start text-muted-foreground"
      >
        <ArrowLeftIcon /> {t('back')}
      </Button>
      <div className="space-y-1">
        <h3 id={headingId} className="flex items-center gap-2 text-base font-semibold">
          <span className="text-primary">
            <KindIcon kind={picked.kind} />
          </span>
          {text(picked.template.label)}
        </h3>
        <p className="text-sm text-muted-foreground">{text(picked.template.description)}</p>
        {!picked.kind.canApply && <p className="text-xs text-muted-foreground">{t('needsReviewer')}</p>}
      </div>
      {isLoading ? (
        <div className="grid gap-3" aria-busy="true">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-2/3" />
        </div>
      ) : error || !fields ? (
        <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
          <CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t('loadError')}
        </p>
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
    <div className="grid gap-5">
      <div aria-live="polite">
        {built && (
          <motion.p
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2 text-sm text-success"
          >
            <CircleCheckIcon className="size-4 shrink-0" aria-hidden />
            {t('built', { reference: built })}
          </motion.p>
        )}
      </div>
      {changeSetId && (
        <div className="grid gap-2">
          <ChangeSetCard id={changeSetId} onNavigate={onNavigate} />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{t('addingTo')}</span>
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              onClick={() => {
                onChangeSet(null);
                setBuilt(null);
              }}
            >
              <FilePlus2Icon className="size-3.5" />
              {t('startNew')}
            </Button>
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
          <h3 id={listId} className="text-sm font-semibold">
            {t('title')}
          </h3>
          <ul className="grid gap-2">
            {templates.map(({ kind: k, template: tpl }) => (
              <li key={`${k.kind}/${tpl.id}`} className="min-w-0">
                <button
                  type="button"
                  onClick={() => {
                    setBuilt(null);
                    setPicked({ kind: k, template: tpl });
                  }}
                  className={cn(
                    'group flex w-full min-w-0 items-center gap-3 rounded-xl border bg-card px-3.5 py-3 text-left outline-none transition-all',
                    'hover:border-ring/40 hover:shadow-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none',
                  )}
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                    <KindIcon kind={k} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{text(tpl.label)}</span>
                    <span className="block text-xs text-muted-foreground">{text(tpl.description)}</span>
                  </span>
                  <ChevronRightIcon
                    className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                    aria-hidden
                  />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {without.length > 0 && (
        <Disclosure
          summary={t('whyNot')}
          triggerClassName="text-xs text-muted-foreground"
          contentClassName="text-xs text-muted-foreground"
        >
          <p className="pb-1">
            {t('withoutTemplates', { kinds: list(without.map((k) => kindLabel(k.kind))) })}
          </p>
        </Disclosure>
      )}
    </div>
  );
}
