'use client';

import { cn } from '@isbp/ui';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@isbp/ui/dialog';
import { Input } from '@isbp/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { ListPlusIcon, PlusIcon, Rows3Icon, Trash2Icon, WandSparklesIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import {
  type Direction,
  type FieldMapping,
  isCompatible,
  type LocalField,
  MAPPING_DIRECTIONS,
  type MappingDirection,
  type RemoteField,
} from '../../contracts';
import type { MappingIssue } from '../../mapping';
import { DIRECTION_ICON } from '../badges';
import { useLabel } from '../lib';

/** An issue's translated text (the API's English message when the code is unknown). */
export function useIssueText() {
  const t = useTranslations('integrations.issues');
  const tf = useTranslations('integrations.fieldType');
  return (i: { code?: string; message: string; params?: Record<string, string> }) => {
    if (!i.code || !t.has(i.code)) return i.message;
    const params = { ...(i.params ?? {}) };
    if (i.code === 'incompatible')
      for (const k of ['local', 'remote'] as const)
        if (params[k] && tf.has(params[k])) params[k] = tf(params[k]);
    return t(i.code, params);
  };
}

export function IssueList({
  issues,
  id,
}: {
  issues: { code?: string; message: string; params?: Record<string, string> }[];
  id?: string;
}) {
  const text = useIssueText();
  if (!issues.length) return null;
  return (
    <ul id={id} className="grid gap-0.5 text-xs text-destructive">
      {issues.map((i, k) => (
        <li key={k}>{text(i)}</li>
      ))}
    </ul>
  );
}

interface ValueRow {
  remote: string;
  local: string;
  direction: MappingDirection;
}

/** The API's value-map rules for live feedback: per direction, a value may have one row. */
function rowIssues(rows: ValueRow[]): MappingIssue[][] {
  const pulls = new Set<string>();
  const pushes = new Set<string>();
  return rows.map((r) => {
    const out: MappingIssue[] = [];
    if (r.remote.trim() && r.direction !== 'push') {
      const k = r.remote.trim().toLowerCase();
      if (pulls.has(k))
        out.push({ path: 'remote', code: 'duplicate_value', message: '', params: { value: r.remote } });
      pulls.add(k);
    }
    if (r.local.trim() && r.direction !== 'pull') {
      const k = r.local.trim().toLowerCase();
      if (pushes.has(k))
        out.push({ path: 'local', code: 'duplicate_local_value', message: '', params: { value: r.local } });
      pushes.add(k);
    }
    return out;
  });
}

/**
 * The value map of one mapping: rows of remote value ↔ ISBP value, each with a direction, so several remote
 * values can become one ISBP value ("Into ISBP only") while one row says what it becomes going out. Values
 * identical on both sides need no row.
 */
function ValueMapDialog({
  open,
  onOpenChange,
  mapping,
  local,
  remote,
  system,
  onSave,
  readOnly,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mapping: FieldMapping;
  local: LocalField;
  remote: RemoteField;
  system: string;
  onSave: (values: { remote: string; local: string; direction?: MappingDirection }[]) => void;
  readOnly: boolean;
}) {
  const t = useTranslations('integrations.mapping');
  const tc = useTranslations('common');
  const label = useLabel();
  const id = useId();
  const [rows, setRows] = useState<ValueRow[]>(() =>
    (mapping.values ?? []).map((v) => ({
      remote: v.remote,
      local: v.local,
      direction: v.direction ?? 'both',
    })),
  );
  const remoteChoices = remote.choices ?? [];
  const localChoices = local.choices ?? [];
  const issues = rowIssues(rows);
  const update = (i: number, patch: Partial<ValueRow>) =>
    setRows((prev) => prev.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const missing = remoteChoices.filter(
    (c) => !rows.some((r) => r.direction !== 'push' && r.remote.toLowerCase() === c.value.toLowerCase()),
  );

  const choiceSelect = (
    value: string,
    choices: { value: string; label: string }[],
    onChange: (v: string) => void,
    aria: string,
    invalid: boolean,
  ) => (
    <Select value={value || ''} onValueChange={onChange} disabled={readOnly}>
      <SelectTrigger className="w-full min-w-0" aria-label={aria} aria-invalid={invalid || undefined}>
        <SelectValue placeholder={t('chooseValue')} />
      </SelectTrigger>
      <SelectContent>
        {choices.map((c) => (
          <SelectItem key={c.value} value={c.value}>
            {c.label}
            {c.label !== c.value && (
              <span className="ml-1 font-mono text-xs text-muted-foreground">{c.value}</span>
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc('close')} className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {t('valuesTitle', { local: label(local.label, local.key), remote: remote.label })}
          </DialogTitle>
          <DialogDescription>{t('valuesDescription', { system })}</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[60vh] min-w-0 gap-2 overflow-y-auto pr-1">
          {rows.length > 0 && (
            <div
              aria-hidden
              className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1fr)_9.5rem_2rem] gap-2 text-xs font-medium text-muted-foreground sm:grid"
            >
              <span>{t('inSystem', { system })}</span>
              <span>{t('inIsbp')}</span>
              <span>{t('direction')}</span>
            </div>
          )}
          <ol className="grid min-w-0 gap-2">
            {rows.map((r, i) => {
              const rowErrors = issues[i] ?? [];
              const n = i + 1;
              return (
                <li
                  key={i}
                  className="grid min-w-0 grid-cols-1 gap-2 rounded-md border p-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_9.5rem_2rem] sm:border-0 sm:p-0"
                  aria-describedby={rowErrors.length ? `${id}-row-${i}` : undefined}
                >
                  {remoteChoices.length ? (
                    choiceSelect(
                      r.remote,
                      remoteChoices,
                      (v) => update(i, { remote: v }),
                      t('remoteValue', { n }),
                      rowErrors.some((e) => e.path === 'remote'),
                    )
                  ) : (
                    <Input
                      aria-label={t('remoteValue', { n })}
                      value={r.remote}
                      disabled={readOnly}
                      aria-invalid={rowErrors.some((e) => e.path === 'remote') || undefined}
                      onChange={(e) => update(i, { remote: e.target.value })}
                    />
                  )}
                  {localChoices.length ? (
                    choiceSelect(
                      r.local,
                      localChoices.map((c) => ({ value: c.value, label: label(c.label, c.value) })),
                      (v) => update(i, { local: v }),
                      t('localValue', { n }),
                      rowErrors.some((e) => e.path === 'local'),
                    )
                  ) : (
                    <Input
                      aria-label={t('localValue', { n })}
                      value={r.local}
                      disabled={readOnly}
                      aria-invalid={rowErrors.some((e) => e.path === 'local') || undefined}
                      onChange={(e) => update(i, { local: e.target.value })}
                    />
                  )}
                  <Select
                    value={r.direction}
                    onValueChange={(v) => update(i, { direction: v as MappingDirection })}
                    disabled={readOnly}
                  >
                    <SelectTrigger className="w-full" aria-label={t('valueDirection', { n })}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MAPPING_DIRECTIONS.map((d) => (
                        <SelectItem key={d} value={d}>
                          {t(`dir.${d}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="justify-self-end"
                    disabled={readOnly}
                    aria-label={t('removeValue', { n })}
                    onClick={() => setRows((prev) => prev.filter((_, k) => k !== i))}
                  >
                    <Trash2Icon />
                  </Button>
                  {rowErrors.length > 0 && (
                    <div className="sm:col-span-4">
                      <IssueList id={`${id}-row-${i}`} issues={rowErrors} />
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          {!readOnly && (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setRows((prev) => [...prev, { remote: '', local: '', direction: 'both' }])}
              >
                <ListPlusIcon /> {t('addValue')}
              </Button>
              {missing.length > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setRows((prev) => [
                      ...prev,
                      ...missing.map((c) => ({
                        remote: c.value,
                        local:
                          localChoices.find((l) => l.value.toLowerCase() === c.value.toLowerCase())?.value ??
                          '',
                        direction: 'both' as const,
                      })),
                    ])
                  }
                >
                  <PlusIcon /> {t('addMissing', { count: missing.length, system })}
                </Button>
              )}
            </div>
          )}
          <p className="text-xs text-muted-foreground">{t('valuesHint')}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tc('cancel')}
          </Button>
          {!readOnly && (
            <Button
              onClick={() => {
                onSave(
                  rows
                    .filter((r) => r.remote.trim() && r.local.trim())
                    .map((r) => ({
                      remote: r.remote.trim(),
                      local: r.local.trim(),
                      ...(r.direction !== 'both' ? { direction: r.direction } : {}),
                    })),
                );
                onOpenChange(false);
              }}
            >
              {tc('save')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The field mapping: ISBP field ↔ remote field, a direction per row (narrowed by the profile's), and value
 * maps for choices. Remote fields of an incompatible type are left out of each row's list.
 */
export function MappingTable({
  mappings,
  onChange,
  localFields,
  remoteFields,
  direction,
  system,
  issues,
  onSuggest,
  suggesting,
  readOnly,
}: {
  mappings: FieldMapping[];
  onChange: (m: FieldMapping[]) => void;
  localFields: LocalField[];
  remoteFields: RemoteField[];
  direction: Direction;
  system: string;
  issues: MappingIssue[];
  onSuggest: () => void;
  suggesting: boolean;
  readOnly: boolean;
}) {
  const t = useTranslations('integrations.mapping');
  const tf = useTranslations('integrations.fieldType');
  const label = useLabel();
  const id = useId();
  const [editingValues, setEditingValues] = useState<number | null>(null);
  const L = new Map(localFields.map((f) => [f.key, f]));
  const R = new Map(remoteFields.map((f) => [f.key, f]));
  const update = (i: number, patch: Partial<FieldMapping>) =>
    onChange(mappings.map((m, k) => (k === i ? { ...m, ...patch } : m)));
  const issuesAt = (i: number) =>
    issues.filter((x) => x.path === `mappings.${i}` || x.path.startsWith(`mappings.${i}.`));
  const allowed = (d: MappingDirection) => direction === 'both' || d === 'both' || d === direction;
  const editing = editingValues !== null ? mappings[editingValues] : undefined;

  return (
    <div className="grid min-w-0 gap-3">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onSuggest}
          loading={suggesting}
          disabled={readOnly}
        >
          <WandSparklesIcon /> {t('suggest')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={readOnly}
          onClick={() => onChange([...mappings, { local: '', remote: '', direction: 'both' }])}
        >
          <PlusIcon /> {t('add')}
        </Button>
      </div>
      {mappings.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          <Rows3Icon className="mx-auto mb-2 size-5" aria-hidden />
          {t('empty')}
        </p>
      ) : (
        <ol className="grid min-w-0 gap-2">
          {mappings.map((m, i) => {
            const lf = L.get(m.local);
            const rf = R.get(m.remote);
            const rowIssues = issuesAt(i);
            const choice = lf?.type === 'choice' || rf?.type === 'choice';
            const DirIcon = DIRECTION_ICON[m.direction === 'both' ? 'both' : m.direction];
            return (
              <li
                key={i}
                className={cn(
                  'grid min-w-0 grid-cols-1 items-start gap-2 rounded-lg border p-2 sm:grid-cols-[minmax(0,1fr)_9.5rem_minmax(0,1fr)_auto]',
                  rowIssues.length > 0 && 'border-destructive/50',
                )}
                aria-describedby={rowIssues.length ? `${id}-issues-${i}` : undefined}
              >
                <Select
                  value={m.local || ''}
                  onValueChange={(v) => update(i, { local: v })}
                  disabled={readOnly}
                >
                  <SelectTrigger
                    className="w-full min-w-0"
                    aria-label={t('localField', { n: i + 1 })}
                    aria-invalid={rowIssues.some((x) => x.path.endsWith('.local')) || undefined}
                  >
                    <SelectValue placeholder={t('chooseLocal')} />
                  </SelectTrigger>
                  <SelectContent>
                    {localFields.map((f) => (
                      <SelectItem key={f.key} value={f.key}>
                        {label(f.label, f.key)}
                        <span className="ml-1 text-xs text-muted-foreground">
                          {tf(f.type)}
                          {f.readOnly ? ` · ${t('readOnly')}` : ''}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={m.direction}
                  onValueChange={(v) => update(i, { direction: v as MappingDirection })}
                  disabled={readOnly}
                >
                  <SelectTrigger className="w-full" aria-label={t('directionOf', { n: i + 1 })}>
                    <DirIcon className="size-4 text-primary" aria-hidden />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MAPPING_DIRECTIONS.map((d) => (
                      <SelectItem key={d} value={d} disabled={!allowed(d)}>
                        {t(`dir.${d}`, { system })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={m.remote || ''}
                  onValueChange={(v) => update(i, { remote: v })}
                  disabled={readOnly}
                >
                  <SelectTrigger
                    className="w-full min-w-0"
                    aria-label={t('remoteField', { n: i + 1, system })}
                    aria-invalid={rowIssues.some((x) => x.path.endsWith('.remote')) || undefined}
                  >
                    <SelectValue placeholder={t('chooseRemote')} />
                  </SelectTrigger>
                  <SelectContent>
                    {remoteFields
                      .filter((f) => !lf || isCompatible(lf.type, f.type) || f.key === m.remote)
                      .map((f) => (
                        <SelectItem key={f.key} value={f.key}>
                          {f.label}
                          <span className="ml-1 text-xs text-muted-foreground">
                            {tf(f.type)}
                            {f.readOnly ? ` · ${t('readOnly')}` : ''}
                          </span>
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-1">
                  {choice && lf && rf && (
                    <Button type="button" variant="outline" size="sm" onClick={() => setEditingValues(i)}>
                      {t('values')}
                      {m.values?.length ? (
                        <Badge variant="secondary" className="ml-1">
                          {m.values.length}
                        </Badge>
                      ) : null}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={readOnly}
                    aria-label={t('remove', { n: i + 1 })}
                    onClick={() => onChange(mappings.filter((_, k) => k !== i))}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
                {rowIssues.length > 0 && (
                  <div className="sm:col-span-4">
                    <IssueList id={`${id}-issues-${i}`} issues={rowIssues} />
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {editing && editingValues !== null && L.get(editing.local) && R.get(editing.remote) && (
        <ValueMapDialog
          key={editingValues}
          open
          onOpenChange={(open) => !open && setEditingValues(null)}
          mapping={editing}
          local={L.get(editing.local)!}
          remote={R.get(editing.remote)!}
          system={system}
          readOnly={readOnly}
          onSave={(values) => update(editingValues, { values: values.length ? values : undefined })}
        />
      )}
    </div>
  );
}
