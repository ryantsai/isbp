'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { Divider } from '@astryxdesign/core/Divider';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Token } from '@astryxdesign/core/Token';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import type { PermissionInfo } from '@isbp/contracts';
import { isPermissionPattern, matchPermission } from '@isbp/sdk';
import { cn } from '@isbp/ui';
import { SearchInput } from '@isbp/ui/search-input';
import { Skeleton } from '@isbp/ui/skeleton';
import { AsteriskIcon, LockIcon, PlusIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { createContext, use, useMemo, useState } from 'react';
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

/** "Included by “Everything in Service desk”" (or by the pattern itself when codes are shown). */
function useImpliedText() {
  const t = useTranslations('roles.permissions');
  const codes = use(CodesContext);
  const patternName = usePatternName();
  return (pattern: string): string => {
    const name = patternName(pattern);
    return name && !codes ? t('impliedByName', { name }) : t.markup('impliedBy', { pattern, code: (c) => c });
  };
}

/**
 * Catalog-driven permission picker. Keys are `module.resource.action`; module/resource "select all"
 * produce wildcards (`core.*`, `core.users.*`). Wildcards already on the role render as chips and the
 * permissions they imply show as checked + disabled. Read-only mode renders the same boxes, checked or not, that
 * can't be changed.
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
      <div className={className}>
        <VStack gap={4}>
          {patterns.length > 0 && (
            <VStack gap={2}>
              <Text type="label">{t('patterns')}</Text>
              <HStack gap={1.5} wrap="wrap" role="list" aria-label={t('patterns')}>
                {patterns.map((p) => {
                  const count = catalog.filter((c) => matchPermission(p, c.key)).length;
                  const name = patternName(p);
                  return (
                    <div key={p} role="listitem">
                      <Token
                        label={name && !codes ? name : p}
                        size="sm"
                        icon={<Icon icon={isWildcard(p) ? AsteriskIcon : LockIcon} size="xsm" />}
                        endContent={
                          <Text type="supporting">
                            {catalogKeys.has(p) || isWildcard(p) ? t('covers', { count }) : t('notInCatalog')}
                          </Text>
                        }
                        onRemove={editable ? () => set(value.filter((v) => v !== p)) : undefined}
                      />
                    </div>
                  );
                })}
              </HStack>
            </VStack>
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
            <div className="py-6 text-center">
              <Text color="secondary">{t('emptyCatalog')}</Text>
            </div>
          )}

          <VStack gap={3}>
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
          </VStack>

          {editable && <AddPattern value={value} onAdd={(p) => set([...value, p])} grantable={grantable} />}
        </VStack>
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
  const state = groupState(value, m.keys, m.pattern);
  const name = tr.has(`${m.module}.meta.name`) ? tr(`${m.module}.meta.name`) : humanize(m.module);
  const codes = use(CodesContext);

  return (
    <Card padding={0} role="region" aria-label={name}>
      <HStack gap={3} vAlign="start" padding={3}>
        <GroupToggle
          state={state}
          pattern={m.pattern}
          label={t('selectModule', { module: name })}
          editable={editable}
          grantable={grantable}
          onToggle={(select) => onChange(toggleGroup(value, m.pattern, select))}
        />
        <StackItem size="fill">
          <Collapsible
            isOpen={open}
            onOpenChange={setOpen}
            trigger={
              <HStack gap={2} vAlign="center">
                <StackItem size="fill">
                  <HStack gap={2} vAlign="center">
                    <Text weight="medium" maxLines={1}>
                      {name}
                    </Text>
                    {codes && <Text type="code">{m.pattern}</Text>}
                  </HStack>
                </StackItem>
                <Text type="supporting" hasTabularNumbers>
                  {t('selectedOf', { count: state.count, total: state.total })}
                </Text>
              </HStack>
            }
          >
            <VStack gap={0}>
              {visible.map((r, i) => (
                <div key={r.resource}>
                  {i > 0 && <Divider />}
                  <ResourceBlock
                    resource={r}
                    value={value}
                    editable={editable}
                    onChange={onChange}
                    grantable={grantable}
                    describe={describe}
                  />
                </div>
              ))}
            </VStack>
          </Collapsible>
        </StackItem>
      </HStack>
    </Card>
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
  const implied = useImpliedText();
  // `r.keys` is the full resource even when the visible rows are filtered.
  const state = groupState(value, r.keys, r.pattern);
  const name = useResourceLabel()(r.module, r.resource);
  const codes = use(CodesContext);

  return (
    <VStack gap={1} paddingBlock={2}>
      <HStack gap={3} vAlign="center">
        <GroupToggle
          state={state}
          pattern={r.pattern}
          label={t('permissions.selectResource', { resource: name })}
          editable={editable}
          grantable={grantable}
          onToggle={(select) => onChange(toggleGroup(value, r.pattern, select))}
        />
        <StackItem size="fill">
          <HStack gap={2} vAlign="center" wrap="wrap">
            <Text weight="medium">{name}</Text>
            {codes && <Text type="code">{r.pattern}</Text>}
          </HStack>
        </StackItem>
        {state.broader && (
          <HStack gap={1} vAlign="center">
            <Icon icon={AsteriskIcon} size="xsm" color="accent" />
            <Text type="supporting">{implied(state.broader)}</Text>
          </HStack>
        )}
      </HStack>
      <VStack gap={0.5} paddingInlineStart={8}>
        {r.permissions.map((p) => {
          const action = p.key.split('.').slice(2).join('.') || p.key;
          const via = impliedBy(value, p.key);
          const explicit = value.includes(p.key);
          const checked = explicit || via !== undefined;
          const held = grantable(p.key);
          const disabled = !editable || via !== undefined || (!checked && !held);
          const scopes = [...p.scopes].sort((a, b) => SCOPE_ORDER.indexOf(a) - SCOPE_ORDER.indexOf(b));
          // Under the description: the code (when shown), why it is on already, why it can't be turned on.
          const notes = [
            codes ? p.key : null,
            via ? implied(via) : null,
            !checked && !held && editable ? t('permissions.notHeld') : null,
          ].filter((n): n is string => Boolean(n));
          return (
            <HStack key={p.key} gap={3} vAlign="start">
              <StackItem size="fill">
                <CheckboxInput
                  label={codes ? `${action}: ${describe(p.description)}` : describe(p.description)}
                  description={notes.length ? notes.join(' · ') : undefined}
                  value={checked}
                  onChange={(v) => onChange(togglePermission(value, p.key, v))}
                  isDisabled={editable && disabled}
                  isReadOnly={!editable}
                />
              </StackItem>
              <span className="hidden shrink-0 sm:block" aria-label={t('permissions.scopes')} role="group">
                <HStack gap={1} wrap="wrap" hAlign="end">
                  {scopes.map((s) => (
                    <Badge
                      variant="neutral"
                      label={tc.has(`scope_values.${s}`) ? tc(`scope_values.${s}`) : s}
                      key={s}
                    />
                  ))}
                </HStack>
              </span>
            </HStack>
          );
        })}
      </VStack>
    </VStack>
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
  const checked = state.all ? true : state.some ? 'indeterminate' : false;
  const name = `${label} (${pattern})`;
  if (!editable) return <CheckboxInput label={name} isLabelHidden value={checked} isReadOnly />;
  // Fully granted by something we can't remove at this level → nothing to toggle.
  const locked = Boolean(state.broader) || (state.all && !state.removable);
  const blocked = !state.all && !grantable(pattern);
  const box = (
    <CheckboxInput
      label={name}
      isLabelHidden
      value={checked}
      isDisabled={locked || blocked}
      onChange={() => onToggle(!state.all)}
    />
  );
  if (blocked) return <Tooltip content={t('notHeld')}>{box}</Tooltip>;
  if (!state.all) return <Tooltip content={t('selectAllHint', { pattern })}>{box}</Tooltip>;
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
    <Collapsible
      chevronPosition="start"
      isOpen={open}
      onOpenChange={setOpen}
      trigger={<Text weight="medium">{open ? tc('hideAdvanced') : t('advanced')}</Text>}
    >
      <VStack gap={2} paddingBlockStart={3}>
        <TextInput
          label={t('addPattern')}
          value={draft}
          onChange={(v) => {
            setDraft(v);
            setError(null);
          }}
          onEnter={submit}
          placeholder="assets.*.read"
          autoComplete="off"
          description={t('patternHint')}
          status={error ? { type: 'error', message: error } : undefined}
        />
        <HStack hAlign="end">
          <Button
            label={tc('add')}
            variant="secondary"
            icon={<Icon icon={PlusIcon} />}
            isDisabled={!draft.trim()}
            onClick={submit}
          />
        </HStack>
      </VStack>
    </Collapsible>
  );
}
