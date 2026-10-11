'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Divider } from '@astryxdesign/core/Divider';
import { Field } from '@astryxdesign/core/Field';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Grid, GridSpan } from '@astryxdesign/core/Grid';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, Layout, LayoutContent, LayoutFooter, VStack } from '@astryxdesign/core/Layout';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Switch } from '@astryxdesign/core/Switch';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
} from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import type { LocalizedText } from '@isbp/sdk';
import { useApi } from '@isbp/sdk/web';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { LocalizedInput } from '@isbp/ui/localized-input';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiMutation, useApiQuery, useErrorText } from '@isbp/ui/query';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetForm,
  SheetHeader,
  SheetTitle,
} from '@isbp/ui/sheet';
import { Skeleton } from '@isbp/ui/skeleton';
import { ArchiveIcon, ArchiveRestoreIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import {
  type AssetClass,
  CIA_DIMENSIONS,
  CIA_LEVELS,
  type ClassificationLabel,
  type Guidance,
  type Site,
  type UpsertClassInput,
} from '../../contracts';
import { INVALIDATE, useLocalized } from '../lib';

type Tab = 'classes' | 'sites' | 'labels';
const EMPTY_LEVELS = { '1': {}, '2': {}, '3': {}, '4': {} };
const EMPTY_GUIDANCE: Guidance = { c: EMPTY_LEVELS, i: EMPTY_LEVELS, a: EMPTY_LEVELS };

/* ───────────── classes ───────────── */

interface SubDraft {
  id?: string;
  key: string;
  name: LocalizedText;
  archived: boolean;
}

function ClassSheet({
  klass,
  open,
  onOpenChange,
}: {
  klass: AssetClass | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations('isms.settings');
  const tc = useTranslations('common');
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl" closeLabel={tc('close')}>
        <SheetHeader>
          <SheetTitle>
            {klass ? t('classes.editTitle', { code: klass.code }) : t('classes.newTitle')}
          </SheetTitle>
          <SheetDescription>{t('classes.hint')}</SheetDescription>
        </SheetHeader>
        {open && <ClassForm klass={klass} onDone={() => onOpenChange(false)} />}
      </SheetContent>
    </Sheet>
  );
}

function ClassForm({ klass, onDone }: { klass: AssetClass | null; onDone: () => void }) {
  const t = useTranslations('isms');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const api = useApi();
  const ids = {
    name: useId(),
    description: useId(),
    subclasses: useId(),
    guidance: useId(),
    panels: useId(),
    hint: useId(),
  };
  const base = useId();
  const [code, setCode] = useState(klass?.code ?? '');
  const [name, setName] = useState<LocalizedText>(klass?.name ?? {});
  const [description, setDescription] = useState<LocalizedText>(klass?.description ?? {});
  const [sortOrder, setSortOrder] = useState<number>(klass?.sortOrder ?? 100);
  const [guidance, setGuidance] = useState<Guidance>(klass?.guidance ?? EMPTY_GUIDANCE);
  const [subs, setSubs] = useState<SubDraft[]>(
    klass?.subclasses.map((s) => ({ id: s.id, key: s.key, name: s.name, archived: s.archived })) ?? [],
  );
  const [dim, setDim] = useState<(typeof CIA_DIMENSIONS)[number]>('c');
  const [error, setError] = useState<string | null>(null);
  const save = useApiMutation(
    (_a, body: UpsertClassInput) =>
      klass
        ? api.patch<AssetClass>(`/isms/config/classes/${klass.id}`, body)
        : api.post<AssetClass>('/isms/config/classes', body),
    { invalidate: INVALIDATE, success: t('settings.saved'), silent: true },
  );
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await save.mutateAsync({
        code: code.trim().toUpperCase(),
        name,
        description: Object.keys(description).length ? description : null,
        guidance,
        sortOrder: sortOrder || 0,
        subclasses: subs.map((s) => ({
          ...(s.id ? { id: s.id } : {}),
          key: s.key.trim(),
          name: s.name,
          archived: s.archived,
        })),
      });
      onDone();
    } catch (err) {
      setError(errorText(err));
    }
  };
  return (
    <SheetForm onSubmit={submit} noValidate>
      <SheetBody className="py-2">
        <VStack gap={5}>
          <FormLayout defaultOptionality="optional">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[8rem_minmax(0,1fr)_7rem]">
              <TextInput
                label={t('settings.classes.code')}
                isRequired
                isDisabled={Boolean(klass)}
                value={code}
                onChange={(v) => setCode(v.toUpperCase().slice(0, 4))}
              />
              <Field label={tc('name')} inputID={ids.name} isRequired>
                <LocalizedInput id={ids.name} value={name} onChange={setName} />
              </Field>
              <NumberInput
                label={t('settings.classes.order')}
                isIntegerOnly
                value={sortOrder}
                onChange={setSortOrder}
              />
            </div>
            <Text as="p" type="supporting" id={ids.hint}>
              {klass ? t('settings.classes.codeFixed') : t('settings.classes.codeHint')}
            </Text>
            <Field label={tc('description')} inputID={ids.description}>
              <LocalizedInput id={ids.description} value={description} onChange={setDescription} multiline />
            </Field>
          </FormLayout>
          <VStack gap={3} role="group" aria-labelledby={ids.subclasses}>
            <Text type="label" id={ids.subclasses}>
              {t('settings.classes.subclasses')}
            </Text>
            {subs.map((s, i) => (
              <VStack key={s.id ?? `new-${i}`} gap={3}>
                {i > 0 && <Divider />}
                <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-[9rem_minmax(0,1fr)_auto]">
                  <TextInput
                    label={tc('key')}
                    value={s.key}
                    onChange={(v) =>
                      setSubs(subs.map((x, j) => (j === i ? { ...x, key: v.toLowerCase() } : x)))
                    }
                  />
                  <Field label={tc('name')} inputID={`${base}-name-${i}`}>
                    <LocalizedInput
                      id={`${base}-name-${i}`}
                      value={s.name}
                      onChange={(v) => setSubs(subs.map((x, j) => (j === i ? { ...x, name: v } : x)))}
                    />
                  </Field>
                  <HStack gap={2} vAlign="center" className="sm:pt-6">
                    <Switch
                      label={t('settings.inUse')}
                      value={!s.archived}
                      onChange={(v) => setSubs(subs.map((x, j) => (j === i ? { ...x, archived: !v } : x)))}
                    />
                    {!s.id && (
                      <IconButton
                        label={t('settings.classes.removeSubclass')}
                        variant="ghost"
                        size="sm"
                        icon={<Icon icon={Trash2Icon} />}
                        type="button"
                        onClick={() => setSubs(subs.filter((_, j) => j !== i))}
                      />
                    )}
                  </HStack>
                </div>
              </VStack>
            ))}
            <div>
              <Button
                label={t('settings.classes.addSubclass')}
                variant="secondary"
                size="sm"
                icon={<Icon icon={PlusIcon} />}
                type="button"
                onClick={() => setSubs([...subs, { key: '', name: {}, archived: false }])}
              />
            </div>
          </VStack>
          <VStack gap={3} role="group" aria-labelledby={ids.guidance}>
            <Text type="label" id={ids.guidance}>
              {t('settings.classes.guidance')}
            </Text>
            <Text as="p" type="supporting">
              {t('settings.classes.guidanceHint')}
            </Text>
            <TabList role="tablist" value={dim} onChange={(v) => setDim(v as typeof dim)} hasDivider>
              {CIA_DIMENSIONS.map((d) => (
                <Tab
                  key={d}
                  value={d}
                  label={t(`settings.classes.dimension.${d}`)}
                  panelId={`${ids.panels}-${d}`}
                />
              ))}
            </TabList>
            {CIA_DIMENSIONS.map((d) => (
              <div key={d} role="tabpanel" id={`${ids.panels}-${d}`} hidden={dim !== d}>
                {dim === d && (
                  <FormLayout defaultOptionality="optional">
                    {[...CIA_LEVELS].reverse().map((level) => {
                      const id = `${base}-${d}-${level}`;
                      return (
                        <Field key={level} label={t('assetForm.level', { level })} inputID={id}>
                          <LocalizedInput
                            id={id}
                            multiline
                            value={guidance[d][String(level) as '1']}
                            onChange={(v) =>
                              setGuidance({ ...guidance, [d]: { ...guidance[d], [String(level)]: v } })
                            }
                          />
                        </Field>
                      );
                    })}
                  </FormLayout>
                )}
              </div>
            ))}
          </VStack>
          {error && <Banner status="error" title={error} collapsible={false} />}
        </VStack>
      </SheetBody>
      <SheetFooter>
        <Button label={tc('cancel')} variant="secondary" type="button" onClick={onDone} />
        <Button label={tc('save')} variant="primary" isLoading={save.isPending} type="submit" />
      </SheetFooter>
    </SheetForm>
  );
}

function ClassesTab() {
  const t = useTranslations('isms.settings');
  const tc = useTranslations('common');
  const api = useApi();
  const localized = useLocalized();
  const { data, isLoading } = useApiQuery<{ items: AssetClass[] }>('/isms/config/classes');
  const [editing, setEditing] = useState<AssetClass | null | 'new'>(null);
  const archive = useApiMutation(
    (_a, c: AssetClass) => api.post(`/isms/config/classes/${c.id}/${c.archived ? 'restore' : 'archive'}`, {}),
    { invalidate: INVALIDATE, success: t('saved') },
  );
  if (isLoading) return <Skeleton className="h-40 w-full" />;
  return (
    <VStack gap={4}>
      <HStack hAlign="end">
        <Button
          label={t('classes.new')}
          variant="primary"
          icon={<Icon icon={PlusIcon} />}
          onClick={() => setEditing('new')}
        />
      </HStack>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {(data?.items ?? []).map((c) => (
          <Card key={c.id} className="min-w-0">
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                <Text type="code">{c.code}</Text> {localized(c.name)}
                {c.archived && <Badge variant="neutral" label={t('archived')} />}
              </CardTitle>
              <CardDescription>
                {t('classes.counts', { subclasses: c.subclasses.length, assets: c.assetCount })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <VStack gap={3}>
                <Text as="p" color="secondary">
                  {c.subclasses
                    .filter((s) => !s.archived)
                    .map((s) => localized(s.name))
                    .join(' · ') || '—'}
                </Text>
                <HStack gap={2} wrap="wrap">
                  <Button
                    label={tc('edit')}
                    variant="secondary"
                    size="sm"
                    icon={<Icon icon={PencilIcon} />}
                    onClick={() => setEditing(c)}
                  />
                  <Button
                    label={c.archived ? t('restore') : t('archive')}
                    variant="ghost"
                    size="sm"
                    icon={<Icon icon={c.archived ? ArchiveRestoreIcon : ArchiveIcon} />}
                    isLoading={archive.isPending && archive.variables?.id === c.id}
                    onClick={() => archive.mutate(c)}
                  />
                </HStack>
              </VStack>
            </CardContent>
          </Card>
        ))}
      </div>
      <ClassSheet
        klass={editing === 'new' ? null : editing}
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
      />
    </VStack>
  );
}

/* ───────────── sites ───────────── */

function SiteDialog({
  site,
  open,
  onOpenChange,
}: {
  site: Site | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations('isms.settings');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const api = useApi();
  const [code, setCode] = useState(site?.code ?? '');
  const [name, setName] = useState(site?.name ?? '');
  const [description, setDescription] = useState(site?.description ?? '');
  const [error, setError] = useState<string | null>(null);
  const save = useApiMutation(
    () =>
      site
        ? api.patch(`/isms/config/sites/${site.id}`, {
            name: name.trim(),
            description: description.trim() || null,
          })
        : api.post('/isms/config/sites', {
            code: code.trim().toUpperCase(),
            name: name.trim(),
            description: description.trim() || null,
          }),
    { invalidate: INVALIDATE, success: t('saved'), silent: true },
  );
  return (
    <Dialog isOpen={open} onOpenChange={onOpenChange} width={512} purpose="form">
      <Layout
        header={
          <DialogHeader
            title={site ? t('sites.editTitle', { code: site.code }) : t('sites.newTitle')}
            subtitle={t('sites.hint')}
            onOpenChange={onOpenChange}
          />
        }
        content={
          <LayoutContent padding={4}>
            <FormLayout defaultOptionality="optional">
              <Grid columns={{ minWidth: 160 }} gap={4}>
                <TextInput
                  label={t('sites.code')}
                  isRequired
                  isDisabled={Boolean(site)}
                  value={code}
                  onChange={(v) => setCode(v.toUpperCase().slice(0, 8))}
                />
                <TextInput label={tc('name')} isRequired value={name} onChange={setName} />
                <GridSpan columns="full">
                  <TextArea
                    label={tc('description')}
                    rows={2}
                    value={description}
                    onChange={setDescription}
                  />
                </GridSpan>
              </Grid>
              {error && <Banner status="error" title={error} collapsible={false} />}
            </FormLayout>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider padding={3}>
            <HStack gap={2} hAlign="end">
              <Button label={tc('cancel')} variant="ghost" onClick={() => onOpenChange(false)} />
              <Button
                label={tc('save')}
                variant="primary"
                isLoading={save.isPending}
                onClick={async () => {
                  setError(null);
                  try {
                    await save.mutateAsync(undefined);
                    onOpenChange(false);
                  } catch (err) {
                    setError(errorText(err));
                  }
                }}
              />
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}

function SitesTab() {
  const t = useTranslations('isms.settings');
  const tc = useTranslations('common');
  const api = useApi();
  const { data, isLoading } = useApiQuery<{ items: Site[] }>('/isms/config/sites');
  const [editing, setEditing] = useState<Site | null | 'new'>(null);
  const toggle = useApiMutation(
    (_a, s: Site) => api.patch(`/isms/config/sites/${s.id}`, { archived: !s.archived }),
    {
      invalidate: INVALIDATE,
      success: t('saved'),
    },
  );
  if (isLoading) return <Skeleton className="h-40 w-full" />;
  return (
    <VStack gap={4}>
      <HStack hAlign="end">
        <Button
          label={t('sites.new')}
          variant="primary"
          icon={<Icon icon={PlusIcon} />}
          onClick={() => setEditing('new')}
        />
      </HStack>
      <Table aria-label={t('tabs.sites')}>
        <TableHeader>
          <TableRow>
            <TableHeaderCell>{t('sites.code')}</TableHeaderCell>
            <TableHeaderCell>{tc('name')}</TableHeaderCell>
            <TableHeaderCell className="hidden sm:table-cell">{t('sites.assets')}</TableHeaderCell>
            <TableHeaderCell>{tc('status')}</TableHeaderCell>
            <TableHeaderCell>
              <span className="sr-only">{tc('actions')}</span>
            </TableHeaderCell>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(data?.items ?? []).map((s) => (
            <TableRow key={s.id}>
              <TableCell>
                <Text type="code">{s.code}</Text>
              </TableCell>
              <TableCell>{s.name}</TableCell>
              <TableCell className="hidden sm:table-cell">
                <Text hasTabularNumbers>{s.assetCount}</Text>
              </TableCell>
              <TableCell>
                {s.archived ? (
                  <Badge variant="neutral" label={t('archived')} />
                ) : (
                  <Badge variant="success" label={t('inUse')} />
                )}
              </TableCell>
              <TableCell>
                <HStack gap={1} hAlign="end" wrap="nowrap">
                  <IconButton
                    label={t('sites.editTitle', { code: s.code })}
                    variant="ghost"
                    size="sm"
                    icon={<Icon icon={PencilIcon} />}
                    onClick={() => setEditing(s)}
                  />
                  <IconButton
                    label={
                      s.archived ? t('restoreItem', { name: s.code }) : t('archiveItem', { name: s.code })
                    }
                    variant="ghost"
                    size="sm"
                    icon={<Icon icon={s.archived ? ArchiveRestoreIcon : ArchiveIcon} />}
                    onClick={() => toggle.mutate(s)}
                  />
                </HStack>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {editing !== null && (
        <SiteDialog
          site={editing === 'new' ? null : editing}
          open
          onOpenChange={(o) => !o && setEditing(null)}
        />
      )}
    </VStack>
  );
}

/* ───────────── labels ───────────── */

function LabelDialog({
  label,
  open,
  onOpenChange,
}: {
  label: ClassificationLabel | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations('isms.settings');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const api = useApi();
  const ids = { name: useId(), description: useId() };
  const [key, setKey] = useState(label?.key ?? '');
  const [name, setName] = useState<LocalizedText>(label?.name ?? {});
  const [description, setDescription] = useState<LocalizedText>(label?.description ?? {});
  const [rank, setRank] = useState<number>(label?.rank ?? 10);
  const [error, setError] = useState<string | null>(null);
  const body = {
    name,
    description: Object.keys(description).length ? description : null,
    rank: rank || 0,
  };
  const save = useApiMutation(
    () =>
      label
        ? api.patch(`/isms/config/labels/${label.id}`, body)
        : api.post('/isms/config/labels', { key: key.trim(), ...body }),
    { invalidate: INVALIDATE, success: t('saved'), silent: true },
  );
  return (
    <Dialog isOpen={open} onOpenChange={onOpenChange} width={512} purpose="form">
      <Layout
        header={
          <DialogHeader
            title={label ? t('labels.editTitle') : t('labels.newTitle')}
            subtitle={t('labels.hint')}
            onOpenChange={onOpenChange}
          />
        }
        content={
          <LayoutContent padding={4}>
            <FormLayout defaultOptionality="optional">
              <Grid columns={{ minWidth: 160 }} gap={4} align="end">
                <TextInput
                  label={tc('key')}
                  isRequired
                  isDisabled={Boolean(label)}
                  value={key}
                  onChange={(v) => setKey(v.toLowerCase())}
                />
                <NumberInput
                  label={t('labels.rank')}
                  description={t('labels.rankHint')}
                  isIntegerOnly
                  value={rank}
                  onChange={setRank}
                />
              </Grid>
              <Field label={tc('name')} inputID={ids.name} isRequired>
                <LocalizedInput id={ids.name} value={name} onChange={setName} />
              </Field>
              <Field label={tc('description')} inputID={ids.description}>
                <LocalizedInput
                  id={ids.description}
                  value={description}
                  onChange={setDescription}
                  multiline
                />
              </Field>
              {error && <Banner status="error" title={error} collapsible={false} />}
            </FormLayout>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider padding={3}>
            <HStack gap={2} hAlign="end">
              <Button label={tc('cancel')} variant="ghost" onClick={() => onOpenChange(false)} />
              <Button
                label={tc('save')}
                variant="primary"
                isLoading={save.isPending}
                onClick={async () => {
                  setError(null);
                  try {
                    await save.mutateAsync(undefined);
                    onOpenChange(false);
                  } catch (err) {
                    setError(errorText(err));
                  }
                }}
              />
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}

function LabelsTab() {
  const t = useTranslations('isms.settings');
  const tc = useTranslations('common');
  const api = useApi();
  const localized = useLocalized();
  const { data, isLoading } = useApiQuery<{ items: ClassificationLabel[] }>('/isms/config/labels');
  const [editing, setEditing] = useState<ClassificationLabel | null | 'new'>(null);
  const toggle = useApiMutation(
    (_a, l: ClassificationLabel) => api.patch(`/isms/config/labels/${l.id}`, { archived: !l.archived }),
    {
      invalidate: INVALIDATE,
      success: t('saved'),
    },
  );
  if (isLoading) return <Skeleton className="h-40 w-full" />;
  return (
    <VStack gap={4}>
      <HStack hAlign="end">
        <Button
          label={t('labels.new')}
          variant="primary"
          icon={<Icon icon={PlusIcon} />}
          onClick={() => setEditing('new')}
        />
      </HStack>
      <Table aria-label={t('tabs.labels')}>
        <TableHeader>
          <TableRow>
            <TableHeaderCell>{tc('name')}</TableHeaderCell>
            <TableHeaderCell className="hidden sm:table-cell">{tc('key')}</TableHeaderCell>
            <TableHeaderCell className="hidden sm:table-cell">{t('labels.rank')}</TableHeaderCell>
            <TableHeaderCell>{tc('status')}</TableHeaderCell>
            <TableHeaderCell>
              <span className="sr-only">{tc('actions')}</span>
            </TableHeaderCell>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(data?.items ?? []).map((l) => (
            <TableRow key={l.id}>
              <TableCell>{localized(l.name)}</TableCell>
              <TableCell className="hidden sm:table-cell">
                <Text type="code">{l.key}</Text>
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                <Text hasTabularNumbers>{l.rank}</Text>
              </TableCell>
              <TableCell>
                {l.archived ? (
                  <Badge variant="neutral" label={t('archived')} />
                ) : (
                  <Badge variant="success" label={t('inUse')} />
                )}
              </TableCell>
              <TableCell>
                <HStack gap={1} hAlign="end" wrap="nowrap">
                  <IconButton
                    label={t('labels.editItem', { name: localized(l.name) })}
                    variant="ghost"
                    size="sm"
                    icon={<Icon icon={PencilIcon} />}
                    onClick={() => setEditing(l)}
                  />
                  <IconButton
                    label={
                      l.archived
                        ? t('restoreItem', { name: localized(l.name) })
                        : t('archiveItem', { name: localized(l.name) })
                    }
                    variant="ghost"
                    size="sm"
                    icon={<Icon icon={l.archived ? ArchiveRestoreIcon : ArchiveIcon} />}
                    onClick={() => toggle.mutate(l)}
                  />
                </HStack>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {editing !== null && (
        <LabelDialog
          label={editing === 'new' ? null : editing}
          open
          onOpenChange={(o) => !o && setEditing(null)}
        />
      )}
    </VStack>
  );
}

/** Information security → Settings: classes (with sub-classes and C/I/A guidance), sites and classification labels. */
export default function SettingsPage() {
  const t = useTranslations('isms.settings');
  const panels = useId();
  const [tab, setTab] = useState<Tab>('classes');
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <VStack gap={4}>
        <TabList role="tablist" value={tab} onChange={(v) => setTab(v as Tab)} hasDivider>
          <Tab value="classes" label={t('tabs.classes')} panelId={`${panels}-classes`} />
          <Tab value="sites" label={t('tabs.sites')} panelId={`${panels}-sites`} />
          <Tab value="labels" label={t('tabs.labels')} panelId={`${panels}-labels`} />
        </TabList>
        <div role="tabpanel" id={`${panels}-classes`} hidden={tab !== 'classes'} className="min-w-0">
          {tab === 'classes' && <ClassesTab />}
        </div>
        <div role="tabpanel" id={`${panels}-sites`} hidden={tab !== 'sites'} className="min-w-0">
          {tab === 'sites' && <SitesTab />}
        </div>
        <div role="tabpanel" id={`${panels}-labels`} hidden={tab !== 'labels'} className="min-w-0">
          {tab === 'labels' && <LabelsTab />}
        </div>
      </VStack>
    </>
  );
}
