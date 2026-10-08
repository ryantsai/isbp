'use client';

import type { LocalizedText } from '@isbp/sdk';
import { useApi } from '@isbp/sdk/web';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@isbp/ui/dialog';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { LocalizedInput } from '@isbp/ui/localized-input';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiMutation, useApiQuery, useErrorText } from '@isbp/ui/query';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@isbp/ui/sheet';
import { Skeleton } from '@isbp/ui/skeleton';
import { Switch } from '@isbp/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@isbp/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import { Textarea } from '@isbp/ui/textarea';
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
  const ids = { code: useId(), name: useId(), description: useId(), order: useId() };
  const base = useId();
  const [code, setCode] = useState(klass?.code ?? '');
  const [name, setName] = useState<LocalizedText>(klass?.name ?? {});
  const [description, setDescription] = useState<LocalizedText>(klass?.description ?? {});
  const [sortOrder, setSortOrder] = useState(String(klass?.sortOrder ?? 100));
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
        sortOrder: Number(sortOrder) || 0,
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
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate>
      <SheetBody className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[8rem_minmax(0,1fr)_6rem]">
          <div className="grid gap-1.5">
            <Label htmlFor={ids.code}>{t('settings.classes.code')}</Label>
            <Input
              id={ids.code}
              value={code}
              disabled={Boolean(klass)}
              maxLength={4}
              className="font-mono uppercase"
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              aria-describedby={`${ids.code}-hint`}
            />
          </div>
          <div className="grid min-w-0 gap-1.5">
            <Label htmlFor={ids.name}>{tc('name')}</Label>
            <LocalizedInput id={ids.name} value={name} onChange={setName} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={ids.order}>{t('settings.classes.order')}</Label>
            <Input
              id={ids.order}
              inputMode="numeric"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
            />
          </div>
        </div>
        <p id={`${ids.code}-hint`} className="-mt-3 text-xs text-muted-foreground">
          {klass ? t('settings.classes.codeFixed') : t('settings.classes.codeHint')}
        </p>
        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor={ids.description}>{tc('description')}</Label>
          <LocalizedInput id={ids.description} value={description} onChange={setDescription} multiline />
        </div>
        <fieldset className="min-w-0 space-y-2">
          <legend className="text-sm font-medium">{t('settings.classes.subclasses')}</legend>
          {subs.map((s, i) => (
            <div
              key={s.id ?? `new-${i}`}
              className="grid grid-cols-1 items-start gap-2 rounded-md border p-2 sm:grid-cols-[9rem_minmax(0,1fr)_auto]"
            >
              <div className="grid gap-1">
                <Label htmlFor={`${base}-key-${i}`} className="text-xs">
                  {tc('key')}
                </Label>
                <Input
                  id={`${base}-key-${i}`}
                  value={s.key}
                  className="font-mono"
                  onChange={(e) =>
                    setSubs(subs.map((x, j) => (j === i ? { ...x, key: e.target.value.toLowerCase() } : x)))
                  }
                />
              </div>
              <div className="grid min-w-0 gap-1">
                <Label htmlFor={`${base}-name-${i}`} className="text-xs">
                  {tc('name')}
                </Label>
                <LocalizedInput
                  id={`${base}-name-${i}`}
                  value={s.name}
                  onChange={(v) => setSubs(subs.map((x, j) => (j === i ? { ...x, name: v } : x)))}
                />
              </div>
              <div className="flex items-center gap-2 pt-5">
                <Switch
                  id={`${base}-arch-${i}`}
                  checked={!s.archived}
                  onCheckedChange={(v) => setSubs(subs.map((x, j) => (j === i ? { ...x, archived: !v } : x)))}
                />
                <Label htmlFor={`${base}-arch-${i}`} className="text-xs">
                  {t('settings.inUse')}
                </Label>
                {!s.id && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('settings.classes.removeSubclass')}
                    onClick={() => setSubs(subs.filter((_, j) => j !== i))}
                  >
                    <Trash2Icon />
                  </Button>
                )}
              </div>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setSubs([...subs, { key: '', name: {}, archived: false }])}
          >
            <PlusIcon /> {t('settings.classes.addSubclass')}
          </Button>
        </fieldset>
        <fieldset className="min-w-0 space-y-3">
          <legend className="text-sm font-medium">{t('settings.classes.guidance')}</legend>
          <p className="text-xs text-muted-foreground">{t('settings.classes.guidanceHint')}</p>
          <Tabs value={dim} onValueChange={(v) => setDim(v as typeof dim)} className="gap-3">
            <TabsList>
              {CIA_DIMENSIONS.map((d) => (
                <TabsTrigger key={d} value={d}>
                  {t(`settings.classes.dimension.${d}`)}
                </TabsTrigger>
              ))}
            </TabsList>
            {CIA_DIMENSIONS.map((d) => (
              <TabsContent key={d} value={d} className="space-y-3">
                {[...CIA_LEVELS].reverse().map((level) => {
                  const id = `${base}-${d}-${level}`;
                  return (
                    <div key={level} className="grid min-w-0 gap-1.5">
                      <Label htmlFor={id}>{t('assetForm.level', { level })}</Label>
                      <LocalizedInput
                        id={id}
                        multiline
                        value={guidance[d][String(level) as '1']}
                        onChange={(v) =>
                          setGuidance({ ...guidance, [d]: { ...guidance[d], [String(level)]: v } })
                        }
                      />
                    </div>
                  );
                })}
              </TabsContent>
            ))}
          </Tabs>
        </fieldset>
        {error && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
      </SheetBody>
      <SheetFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          {tc('cancel')}
        </Button>
        <Button type="submit" loading={save.isPending}>
          {tc('save')}
        </Button>
      </SheetFooter>
    </form>
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
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setEditing('new')}>
          <PlusIcon /> {t('classes.new')}
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {(data?.items ?? []).map((c) => (
          <Card key={c.id} className="min-w-0">
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{c.code}</span> {localized(c.name)}
                {c.archived && <Badge variant="muted">{t('archived')}</Badge>}
              </CardTitle>
              <CardDescription>
                {t('classes.counts', { subclasses: c.subclasses.length, assets: c.assetCount })}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {c.subclasses
                  .filter((s) => !s.archived)
                  .map((s) => localized(s.name))
                  .join(' · ') || '—'}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setEditing(c)}>
                  <PencilIcon /> {tc('edit')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  loading={archive.isPending && archive.variables?.id === c.id}
                  onClick={() => archive.mutate(c)}
                >
                  {c.archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />}{' '}
                  {c.archived ? t('restore') : t('archive')}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <ClassSheet
        klass={editing === 'new' ? null : editing}
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
      />
    </div>
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
  const ids = { code: useId(), name: useId(), description: useId() };
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{site ? t('sites.editTitle', { code: site.code }) : t('sites.newTitle')}</DialogTitle>
          <DialogDescription>{t('sites.hint')}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[8rem_minmax(0,1fr)]">
          <div className="grid gap-1.5">
            <Label htmlFor={ids.code}>{t('sites.code')}</Label>
            <Input
              id={ids.code}
              value={code}
              disabled={Boolean(site)}
              maxLength={8}
              className="font-mono uppercase"
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={ids.name}>{tc('name')}</Label>
            <Input id={ids.name} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor={ids.description}>{tc('description')}</Label>
            <Textarea
              id={ids.description}
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
        {error && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {tc('cancel')}
          </Button>
          <Button
            type="button"
            loading={save.isPending}
            onClick={async () => {
              setError(null);
              try {
                await save.mutateAsync(undefined);
                onOpenChange(false);
              } catch (err) {
                setError(errorText(err));
              }
            }}
          >
            {tc('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
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
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setEditing('new')}>
          <PlusIcon /> {t('sites.new')}
        </Button>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <Table aria-label={t('tabs.sites')}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('sites.code')}</TableHead>
              <TableHead>{tc('name')}</TableHead>
              <TableHead className="hidden sm:table-cell">{t('sites.assets')}</TableHead>
              <TableHead>{tc('status')}</TableHead>
              <TableHead>
                <span className="sr-only">{tc('actions')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data?.items ?? []).map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-mono">{s.code}</TableCell>
                <TableCell>{s.name}</TableCell>
                <TableCell className="hidden tabular-nums sm:table-cell">{s.assetCount}</TableCell>
                <TableCell>
                  {s.archived ? (
                    <Badge variant="muted">{t('archived')}</Badge>
                  ) : (
                    <Badge variant="success">{t('inUse')}</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t('sites.editTitle', { code: s.code })}
                    onClick={() => setEditing(s)}
                  >
                    <PencilIcon />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={
                      s.archived ? t('restoreItem', { name: s.code }) : t('archiveItem', { name: s.code })
                    }
                    onClick={() => toggle.mutate(s)}
                  >
                    {s.archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {editing !== null && (
        <SiteDialog
          site={editing === 'new' ? null : editing}
          open
          onOpenChange={(o) => !o && setEditing(null)}
        />
      )}
    </div>
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
  const ids = { key: useId(), name: useId(), description: useId(), rank: useId() };
  const [key, setKey] = useState(label?.key ?? '');
  const [name, setName] = useState<LocalizedText>(label?.name ?? {});
  const [description, setDescription] = useState<LocalizedText>(label?.description ?? {});
  const [rank, setRank] = useState(String(label?.rank ?? 10));
  const [error, setError] = useState<string | null>(null);
  const body = {
    name,
    description: Object.keys(description).length ? description : null,
    rank: Number(rank) || 0,
  };
  const save = useApiMutation(
    () =>
      label
        ? api.patch(`/isms/config/labels/${label.id}`, body)
        : api.post('/isms/config/labels', { key: key.trim(), ...body }),
    { invalidate: INVALIDATE, success: t('saved'), silent: true },
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{label ? t('labels.editTitle') : t('labels.newTitle')}</DialogTitle>
          <DialogDescription>{t('labels.hint')}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_6rem]">
          <div className="grid gap-1.5">
            <Label htmlFor={ids.key}>{tc('key')}</Label>
            <Input
              id={ids.key}
              value={key}
              disabled={Boolean(label)}
              className="font-mono"
              onChange={(e) => setKey(e.target.value.toLowerCase())}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={ids.rank}>{t('labels.rank')}</Label>
            <Input id={ids.rank} inputMode="numeric" value={rank} onChange={(e) => setRank(e.target.value)} />
          </div>
          <div className="grid min-w-0 gap-1.5 sm:col-span-2">
            <Label htmlFor={ids.name}>{tc('name')}</Label>
            <LocalizedInput id={ids.name} value={name} onChange={setName} />
          </div>
          <div className="grid min-w-0 gap-1.5 sm:col-span-2">
            <Label htmlFor={ids.description}>{tc('description')}</Label>
            <LocalizedInput id={ids.description} value={description} onChange={setDescription} multiline />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{t('labels.rankHint')}</p>
        {error && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {tc('cancel')}
          </Button>
          <Button
            type="button"
            loading={save.isPending}
            onClick={async () => {
              setError(null);
              try {
                await save.mutateAsync(undefined);
                onOpenChange(false);
              } catch (err) {
                setError(errorText(err));
              }
            }}
          >
            {tc('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
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
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setEditing('new')}>
          <PlusIcon /> {t('labels.new')}
        </Button>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <Table aria-label={t('tabs.labels')}>
          <TableHeader>
            <TableRow>
              <TableHead>{tc('name')}</TableHead>
              <TableHead className="hidden sm:table-cell">{tc('key')}</TableHead>
              <TableHead className="hidden sm:table-cell">{t('labels.rank')}</TableHead>
              <TableHead>{tc('status')}</TableHead>
              <TableHead>
                <span className="sr-only">{tc('actions')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data?.items ?? []).map((l) => (
              <TableRow key={l.id}>
                <TableCell>{localized(l.name)}</TableCell>
                <TableCell className="hidden font-mono text-xs sm:table-cell">{l.key}</TableCell>
                <TableCell className="hidden tabular-nums sm:table-cell">{l.rank}</TableCell>
                <TableCell>
                  {l.archived ? (
                    <Badge variant="muted">{t('archived')}</Badge>
                  ) : (
                    <Badge variant="success">{t('inUse')}</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t('labels.editItem', { name: localized(l.name) })}
                    onClick={() => setEditing(l)}
                  >
                    <PencilIcon />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={
                      l.archived
                        ? t('restoreItem', { name: localized(l.name) })
                        : t('archiveItem', { name: localized(l.name) })
                    }
                    onClick={() => toggle.mutate(l)}
                  >
                    {l.archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {editing !== null && (
        <LabelDialog
          label={editing === 'new' ? null : editing}
          open
          onOpenChange={(o) => !o && setEditing(null)}
        />
      )}
    </div>
  );
}

/** Information security → Settings: classes (with sub-classes and C/I/A guidance), sites and classification labels. */
export default function SettingsPage() {
  const t = useTranslations('isms.settings');
  const [tab, setTab] = useState<Tab>('classes');
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="gap-4">
        <TabsList>
          <TabsTrigger value="classes">{t('tabs.classes')}</TabsTrigger>
          <TabsTrigger value="sites">{t('tabs.sites')}</TabsTrigger>
          <TabsTrigger value="labels">{t('tabs.labels')}</TabsTrigger>
        </TabsList>
        <TabsContent value="classes" className="min-w-0">
          {tab === 'classes' && <ClassesTab />}
        </TabsContent>
        <TabsContent value="sites" className="min-w-0">
          {tab === 'sites' && <SitesTab />}
        </TabsContent>
        <TabsContent value="labels" className="min-w-0">
          {tab === 'labels' && <LabelsTab />}
        </TabsContent>
      </Tabs>
    </>
  );
}
