'use client';

import type { PermissionInfo } from '@isbp/contracts';
import { isPermissionPattern, matchPermission } from '@isbp/sdk';
import { cn } from '@isbp/ui';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { Checkbox } from '@isbp/ui/checkbox';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { SearchInput } from '@isbp/ui/search-input';
import { Skeleton } from '@isbp/ui/skeleton';
import { Hint } from '@isbp/ui/tooltip';
import { AsteriskIcon, CheckIcon, ChevronDownIcon, LockIcon, MinusIcon, PlusIcon, XIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { createContext, type ReactNode, use, useId, useMemo, useState } from 'react';
import {
  type GroupState,
  groupCatalog,
  groupState,
  humanize,
  impliedBy,
  isGranted,
  isWildcard,
  type ModuleGroup,
  type ResourceGroup,
  toggleGroup,
  togglePermission,
  useGrantable,
  usePermissionText,
} from './role-utils';

const SCOPE_ORDER = ['global', 'department', 'record'];

/** Whether permission codes (`core.users.read`, `core.*`) show next to their descriptions. */
const CodesContext = createContext(false);

/** "Everything in Service desk" for `itsm.*`, "Everything for People" for `core.users.*`; other patterns as code. */
function usePatternName() {
  const t = useTranslations('roles.permissions');
  const tr = useTranslations();
  const resource = useResourceLabel();
  return (pattern: string): string | null => {
    if (pattern === '*') return t('everything');
    const parts = pattern.split('.');
    if (parts.length === 2 && parts[1] === '*' && !parts[0]!.includes('*')) {
      const key = `${parts[0]}.meta.name`;
      return t('everythingIn', { name: tr.has(key) ? tr(key) : humanize(parts[0]!) });
    }
    if (parts.length === 3 && parts[2] === '*' && !parts[0]!.includes('*') && !parts[1]!.includes('*'))
      return t('everythingIn', { name: resource(parts[0]!, parts[1]!) });
    return null;
  };
}

/** A resource's name in the UI language (`roles.resources.<module>.<resource>`), never a code. */
export function useResourceLabel() {
  const t = useTranslations('roles');
  return (module: string, resource: string) => {
    const key = `resources.${module}.${resource}`;
    return t.has(key) ? t(key) : humanize(resource);
  };
}

/**
 * Catalog-driven permission picker. Keys are `module.resource.action`; module/resource "select all"
 * produce wildcards (`core.*`, `core.users.*`). Wildcards already on the role render as chips and the
 * permissions they imply show as checked + disabled. Read-only mode renders granted/not-granted marks.
 */
export function PermissionEditor({
  catalog,
  value,
  onChange,
  readOnly = false,
  loading = false,
  showCodes = false,
  className,
}: {
  catalog: PermissionInfo[];
  value: string[];
  onChange?: (value: string[]) => void;
  readOnly?: boolean;
  loading?: boolean;
  /** Show the permission codes (off: descriptions only). */
  showCodes?: boolean;
  className?: string;
}) {
  const t = useTranslations('roles.permissions');
  const describe = usePermissionText();
  const grantable = useGrantable();
  const patternName = usePatternName();
  const codes = showCodes;
  const [filter, setFilter] = useState('');
  const modules = useMemo(() => groupCatalog(catalog), [catalog]);
  const catalogKeys = useMemo(() => new Set(catalog.map((p) => p.key)), [catalog]);
  const editable = !readOnly && Boolean(onChange);
  const set = (next: string[]) => onChange?.(next);

  // Wildcards and keys the catalog doesn't know (e.g. from a disabled module) show as chips.
  const patterns = value.filter((p) => isWildcard(p) || !catalogKeys.has(p));

  const needle = filter.trim().toLowerCase();
  const matches = (p: PermissionInfo) =>
    !needle || p.key.toLowerCase().includes(needle) || describe(p.description).toLowerCase().includes(needle);

  if (loading) {
    return (
      <div className={cn('space-y-3', className)}>
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <CodesContext value={showCodes}>
      <div className={cn('space-y-4', className)}>
        {patterns.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">{t('patterns')}</p>
            <ul className="flex flex-wrap gap-1.5" aria-label={t('patterns')}>
              <AnimatePresence initial={false}>
                {patterns.map((p) => {
                  const count = catalog.filter((c) => matchPermission(p, c.key)).length;
                  return (
                    <motion.li
                      key={p}
                      layout
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ duration: 0.15 }}
                      className="inline-flex items-center gap-1.5 rounded-md border bg-card py-1 pr-1 pl-2 text-xs"
                    >
                      {isWildcard(p) ? (
                        <AsteriskIcon className="size-3.5 text-primary" aria-hidden />
                      ) : (
                        <LockIcon className="size-3 text-muted-foreground" aria-hidden />
                      )}
                      {patternName(p) && !codes ? (
                        <span className="font-medium">{patternName(p)}</span>
                      ) : (
                        <code className="font-mono font-medium">{p}</code>
                      )}
                      <span className="text-muted-foreground">
                        {catalogKeys.has(p) || isWildcard(p) ? t('covers', { count }) : t('notInCatalog')}
                      </span>
                      {editable ? (
                        <button
                          type="button"
                          onClick={() => set(value.filter((v) => v !== p))}
                          className="rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                          aria-label={t('removePattern', { pattern: p })}
                        >
                          <XIcon className="size-3.5" />
                        </button>
                      ) : (
                        <span className="w-1" />
                      )}
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
          </div>
        )}

        {catalog.length > 10 && (
          <SearchInput
            value={filter}
            onChange={setFilter}
            delay={0}
            placeholder={t('filter')}
            className="sm:w-full"
          />
        )}

        {modules.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('emptyCatalog')}</p>
        )}

        <div className="space-y-3">
          {modules.map((m) => {
            const resources = m.resources
              .map((r) => ({ ...r, permissions: r.permissions.filter(matches) }))
              .filter((r) => r.permissions.length > 0);
            if (needle && resources.length === 0) return null;
            return (
              <ModuleSection
                key={m.module}
                module={m}
                visible={resources}
                value={value}
                editable={editable}
                forceOpen={Boolean(needle)}
                defaultOpen={modules.length <= 3 || m.keys.some((k) => isGranted(value, k))}
                onChange={set}
                grantable={grantable}
                describe={describe}
              />
            );
          })}
        </div>

        {editable && <AddPattern value={value} onAdd={(p) => set([...value, p])} grantable={grantable} />}
      </div>
    </CodesContext>
  );
}

/* ───────────────────────── module ───────────────────────── */

function ModuleSection({
  module: m,
  visible,
  value,
  editable,
  forceOpen,
  defaultOpen,
  onChange,
  grantable,
  describe,
}: {
  module: ModuleGroup;
  visible: ResourceGroup[];
  value: string[];
  editable: boolean;
  forceOpen: boolean;
  defaultOpen: boolean;
  onChange: (value: string[]) => void;
  grantable: (pattern: string) => boolean;
  describe: (description: string) => string;
}) {
  const t = useTranslations('roles.permissions');
  const tr = useTranslations();
  // Decided once on mount so toggling permissions never collapses the section under the cursor.
  const [openState, setOpen] = useState(defaultOpen);
  const open = forceOpen || openState;
  const contentId = useId();
  const state = groupState(value, m.keys, m.pattern);
  const name = tr.has(`${m.module}.meta.name`) ? tr(`${m.module}.meta.name`) : humanize(m.module);
  const codes = use(CodesContext);

  return (
    <section className="overflow-hidden rounded-lg border bg-card" aria-label={name}>
      <div className="flex items-center gap-3 bg-muted/40 px-3 py-2.5">
        <GroupToggle
          state={state}
          pattern={m.pattern}
          label={t('selectModule', { module: name })}
          editable={editable}
          grantable={grantable}
          onToggle={(select) => onChange(toggleGroup(value, m.pattern, select))}
        />
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls={contentId}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <span className="truncate font-medium">{name}</span>
          {codes && (
            <code className="hidden font-mono text-xs text-muted-foreground sm:inline">{m.pattern}</code>
          )}
          <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
            {t('selectedOf', { count: state.count, total: state.total })}
          </span>
          <ChevronDownIcon
            className={cn(
              'size-4 shrink-0 text-muted-foreground transition-transform duration-200',
              open && 'rotate-180',
            )}
            aria-hidden
          />
        </button>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={contentId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="divide-y border-t">
              {visible.map((r) => (
                <ResourceBlock
                  key={r.resource}
                  resource={r}
                  value={value}
                  editable={editable}
                  onChange={onChange}
                  grantable={grantable}
                  describe={describe}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

/* ───────────────────────── resource ───────────────────────── */

function ResourceBlock({
  resource: r,
  value,
  editable,
  onChange,
  grantable,
  describe,
}: {
  resource: ResourceGroup;
  value: string[];
  editable: boolean;
  onChange: (value: string[]) => void;
  grantable: (pattern: string) => boolean;
  describe: (description: string) => string;
}) {
  const t = useTranslations('roles');
  const tc = useTranslations('common');
  // `r.keys` is the full resource even when the visible rows are filtered.
  const state = groupState(value, r.keys, r.pattern);
  const name = useResourceLabel()(r.module, r.resource);
  const codes = use(CodesContext);

  return (
    <div className="px-3 py-2">
      <div className="flex items-center gap-3 py-1.5">
        <GroupToggle
          state={state}
          pattern={r.pattern}
          label={t('permissions.selectResource', { resource: name })}
          editable={editable}
          grantable={grantable}
          onToggle={(select) => onChange(toggleGroup(value, r.pattern, select))}
        />
        <span className="text-sm font-medium">{name}</span>
        {codes && (
          <code className="hidden font-mono text-xs text-muted-foreground sm:inline">{r.pattern}</code>
        )}
        {state.broader && <ImpliedNote pattern={state.broader} className="ml-auto" />}
      </div>
      <ul className="ml-7 space-y-0.5 pb-1">
        {r.permissions.map((p) => {
          const action = p.key.split('.').slice(2).join('.') || p.key;
          const via = impliedBy(value, p.key);
          const explicit = value.includes(p.key);
          const checked = explicit || via !== undefined;
          const held = grantable(p.key);
          const disabled = !editable || via !== undefined || (!checked && !held);
          const id = `perm-${p.key}`;
          const scopes = [...p.scopes].sort((a, b) => SCOPE_ORDER.indexOf(a) - SCOPE_ORDER.indexOf(b));
          return (
            <li
              key={p.key}
              className={cn(
                'flex items-start gap-3 rounded-md px-1.5 py-1.5 transition-colors',
                editable && !disabled && 'hover:bg-accent/40',
              )}
            >
              {editable ? (
                <Checkbox
                  id={id}
                  checked={checked}
                  disabled={disabled}
                  onCheckedChange={(v) => onChange(togglePermission(value, p.key, v === true))}
                  className="mt-0.5"
                />
              ) : (
                <Mark checked={checked} />
              )}
              <label
                htmlFor={editable ? id : undefined}
                className={cn(
                  'min-w-0 flex-1 space-y-0.5',
                  editable && !disabled && 'cursor-pointer',
                  !checked && !editable && 'text-muted-foreground',
                )}
              >
                <span className="flex flex-wrap items-baseline gap-x-2">
                  {codes && <code className="font-mono text-xs font-semibold">{action}</code>}
                  <span className="text-sm">{describe(p.description)}</span>
                </span>
                {codes && <span className="sr-only">{p.key}</span>}
                {via && <ImpliedNote pattern={via} />}
                {!checked && !held && editable && (
                  <span className="block text-xs text-muted-foreground">{t('permissions.notHeld')}</span>
                )}
              </label>
              <span
                className="hidden shrink-0 flex-wrap justify-end gap-1 sm:flex"
                aria-label={t('permissions.scopes')}
              >
                {scopes.map((s) => (
                  <Badge key={s} variant="muted" className="font-normal">
                    {tc.has(`scope_values.${s}`) ? tc(`scope_values.${s}`) : s}
                  </Badge>
                ))}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ImpliedNote({ pattern, className }: { pattern: string; className?: string }) {
  const t = useTranslations('roles.permissions');
  const codes = use(CodesContext);
  const name = usePatternName()(pattern);
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs text-muted-foreground', className)}>
      <AsteriskIcon className="size-3 text-primary" aria-hidden />
      {name && !codes
        ? t('impliedByName', { name })
        : t.rich('impliedBy', {
            pattern,
            code: (chunks: ReactNode) => <code className="font-mono">{chunks}</code>,
          })}
    </span>
  );
}

function Mark({ checked }: { checked: boolean }) {
  const t = useTranslations('roles.permissions');
  return checked ? (
    <span
      role="img"
      aria-label={t('granted')}
      className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-[4px] bg-primary text-primary-foreground"
    >
      <CheckIcon className="size-3" />
    </span>
  ) : (
    <span
      role="img"
      aria-label={t('notGranted')}
      className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-[4px] border border-dashed text-muted-foreground/60"
    >
      <MinusIcon className="size-3" />
    </span>
  );
}

function GroupToggle({
  state,
  pattern,
  label,
  editable,
  grantable,
  onToggle,
}: {
  state: GroupState;
  pattern: string;
  label: string;
  editable: boolean;
  grantable: (pattern: string) => boolean;
  onToggle: (select: boolean) => void;
}) {
  const t = useTranslations('roles.permissions');
  if (!editable) return <Mark checked={state.all} />;
  const checked = state.all ? true : state.some ? 'indeterminate' : false;
  // Fully granted by something we can't remove at this level → nothing to toggle.
  const locked = Boolean(state.broader) || (state.all && !state.removable);
  const blocked = !state.all && !grantable(pattern);
  const box = (
    <Checkbox
      checked={checked}
      disabled={locked || blocked}
      onCheckedChange={() => onToggle(!state.all)}
      aria-label={`${label} (${pattern})`}
    />
  );
  if (blocked) {
    return (
      <Hint label={t('notHeld')}>
        <span className="inline-flex">{box}</span>
      </Hint>
    );
  }
  if (!state.all) {
    return (
      <Hint label={t('selectAllHint', { pattern })}>
        <span className="inline-flex">{box}</span>
      </Hint>
    );
  }
  return box;
}

/* ───────────────────────── advanced: raw pattern ───────────────────────── */

function AddPattern({
  value,
  onAdd,
  grantable,
}: {
  value: string[];
  onAdd: (pattern: string) => void;
  grantable: (pattern: string) => boolean;
}) {
  const t = useTranslations('roles.permissions');
  const tc = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  const submit = () => {
    const p = draft.trim();
    if (!p) return;
    if (!isPermissionPattern(p)) return setError(t('patternInvalid'));
    if (value.includes(p)) return setError(t('patternExists'));
    if (!grantable(p)) return setError(t('patternNotHeld'));
    onAdd(p);
    setDraft('');
    setError(null);
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-sm text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <ChevronDownIcon className={cn('size-4 transition-transform duration-200', open && 'rotate-180')} />
        {open ? tc('hideAdvanced') : t('advanced')}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="grid gap-2 px-0.5 pt-3 pb-0.5">
              <Label htmlFor={id}>{t('addPattern')}</Label>
              <div className="flex gap-2">
                <Input
                  id={id}
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    setError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      submit();
                    }
                  }}
                  placeholder="assets.*.read"
                  spellCheck={false}
                  autoCapitalize="off"
                  autoComplete="off"
                  aria-invalid={Boolean(error)}
                  aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}
                  className="font-mono"
                />
                <Button type="button" variant="outline" onClick={submit} disabled={!draft.trim()}>
                  <PlusIcon /> {tc('add')}
                </Button>
              </div>
              <p id={`${id}-hint`} className="text-xs text-muted-foreground">
                {t('patternHint')}
              </p>
              {error && (
                <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
                  {error}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
