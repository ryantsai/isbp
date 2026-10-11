'use client';

import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Button } from '@astryxdesign/core/Button';
import { Card as SurfaceCard } from '@astryxdesign/core/Card';
import { DateInput } from '@astryxdesign/core/DateInput';
import { Field } from '@astryxdesign/core/Field';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { UserAvatar } from '@isbp/ui/avatar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { type PersonOption, PersonPicker } from '@isbp/ui/person-picker';
import { useApiMutation } from '@isbp/ui/query';
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  PencilIcon,
  RotateCcwIcon,
  Trash2Icon,
  UserPlusIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';
import { MEMBER_ROLES, type MemberRole, type Milestone, type ProjectDetail } from '../../contracts';
import { toIsoDate } from '../components/inputs';
import { ProjectForm } from '../components/project-form';
import { dateValue, INVALIDATE, projectApi, projectHref, useSearchParam } from '../lib';
import { AddMilestoneForm } from './milestone-form';

const clampPct = (n: number | null) => Math.max(0, Math.min(100, n ?? 0));

/** Allocation percent that saves when you leave the field. */
function AllocationInput({
  label,
  value,
  disabled,
  onSave,
}: {
  label: string;
  value: number;
  disabled?: boolean;
  onSave: (pct: number) => void;
}) {
  const [draft, setDraft] = useState<number | null>(value);
  return (
    <NumberInput
      label={label}
      isLabelHidden
      min={0}
      max={100}
      step={5}
      value={draft}
      isDisabled={disabled}
      onChange={setDraft}
      onBlur={() => {
        const v = clampPct(draft);
        if (v !== value) onSave(v);
      }}
    />
  );
}

function MembersSection({ project }: { project: ProjectDetail }) {
  const t = useTranslations('projects.settings.members');
  const tr = useTranslations('projects.roles');
  const tc = useTranslations('common');
  const id = useId();
  const [person, setPerson] = useState<PersonOption | null>(null);
  const [noPerson, setNoPerson] = useState(false);
  const [role, setRole] = useState<MemberRole>('member');
  const [allocation, setAllocation] = useState<number | null>(100);
  const [removing, setRemoving] = useState<{ userId: string; name: string } | null>(null);
  const base = `${projectApi(project.key)}/members`;
  const add = useApiMutation(
    (api, body: { userId: string; role: MemberRole; allocationPct: number }) => api.post(base, body),
    {
      invalidate: INVALIDATE,
      success: t('added'),
      onSuccess: () => {
        setPerson(null);
        setRole('member');
        setAllocation(100);
      },
    },
  );
  const update = useApiMutation(
    (api, v: { userId: string; role?: MemberRole; allocationPct?: number }) =>
      api.patch(`${base}/${v.userId}`, { role: v.role, allocationPct: v.allocationPct }),
    { invalidate: INVALIDATE, success: t('updated') },
  );
  const remove = useApiMutation((api, userId: string) => api.delete(`${base}/${userId}`), {
    invalidate: INVALIDATE,
    success: t('removed'),
    onSuccess: () => setRemoving(null),
  });
  const roleOptions = MEMBER_ROLES.map((r) => ({ value: r, label: tr(r) }));
  return (
    <Card className="min-w-0 gap-4">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <form
          className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem_7rem_auto] sm:items-end"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!person) {
              setNoPerson(true);
              return;
            }
            add.mutate({
              userId: person.id,
              role,
              allocationPct: role === 'viewer' ? 0 : clampPct(allocation),
            });
          }}
        >
          <Field
            label={t('person')}
            inputID={`${id}-person`}
            isRequired
            status={noPerson ? { type: 'error', message: t('personRequired') } : undefined}
          >
            <PersonPicker
              id={`${id}-person`}
              value={person}
              onChange={(p) => {
                setPerson(p);
                if (p) setNoPerson(false);
              }}
              invalid={noPerson}
              excludeIds={project.members.map((m) => m.userId)}
            />
          </Field>
          <Selector
            label={t('role')}
            value={role}
            onChange={(v) => setRole(v as MemberRole)}
            options={roleOptions}
          />
          <NumberInput
            label={t('allocation')}
            min={0}
            max={100}
            step={5}
            isDisabled={role === 'viewer'}
            value={role === 'viewer' ? 0 : allocation}
            onChange={setAllocation}
          />
          <Button
            label={t('add')}
            variant="primary"
            icon={<Icon icon={UserPlusIcon} />}
            isLoading={add.isPending}
            type="submit"
          />
        </form>
        <SurfaceCard padding={0}>
          <ul className="divide-y">
            {project.members.map((m) => (
              <li
                key={m.userId}
                className="grid gap-3 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_9rem_7rem_2.25rem] sm:items-center"
              >
                <HStack gap={2} vAlign="center" className="min-w-0">
                  <UserAvatar name={m.displayName} src={m.avatarUrl} className="size-7 text-[10px]" />
                  <VStack className="min-w-0">
                    <Text weight="medium" maxLines={1}>
                      {m.displayName}
                    </Text>
                    <Text type="supporting" maxLines={1}>
                      {m.isOwner ? t('owner') : (m.jobTitle ?? m.email)}
                    </Text>
                  </VStack>
                </HStack>
                <Selector
                  label={t('roleOf', { name: m.displayName })}
                  isLabelHidden
                  value={m.role}
                  isDisabled={m.isOwner}
                  onChange={(v) => update.mutate({ userId: m.userId, role: v as MemberRole })}
                  options={roleOptions}
                />
                <AllocationInput
                  key={`${m.userId}:${m.allocationPct}`}
                  label={t('allocationOf', { name: m.displayName })}
                  value={m.allocationPct}
                  disabled={m.role === 'viewer'}
                  onSave={(allocationPct) => update.mutate({ userId: m.userId, allocationPct })}
                />
                <IconButton
                  label={t('remove', { name: m.displayName })}
                  variant="ghost"
                  size="sm"
                  icon={<Icon icon={Trash2Icon} />}
                  isDisabled={m.isOwner}
                  onClick={() => setRemoving({ userId: m.userId, name: m.displayName })}
                />
              </li>
            ))}
          </ul>
        </SurfaceCard>
      </CardContent>
      <AlertDialog
        isOpen={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t('removeTitle', { name: removing?.name ?? '' })}
        description={t('removeBody')}
        actionLabel={t('removeConfirm')}
        cancelLabel={tc('cancel')}
        isActionLoading={remove.isPending}
        onAction={() => removing && remove.mutate(removing.userId)}
      />
    </Card>
  );
}

function MilestoneRow({
  milestone,
  index,
  count,
  project,
  onMove,
}: {
  milestone: Milestone;
  index: number;
  count: number;
  project: ProjectDetail;
  onMove: (from: number, to: number) => void;
}) {
  const t = useTranslations('projects.settings.milestones');
  const tc = useTranslations('common');
  const format = useFormatter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(milestone.name);
  const [due, setDue] = useState(milestone.dueDate ?? '');
  const [confirm, setConfirm] = useState(false);
  const path = `${projectApi(project.key)}/milestones/${milestone.id}`;
  const save = useApiMutation((api, body: Record<string, unknown>) => api.patch(path, body), {
    invalidate: INVALIDATE,
    success: tc('saved'),
    onSuccess: () => setEditing(false),
  });
  const remove = useApiMutation((api) => api.delete(path), {
    invalidate: INVALIDATE,
    success: t('deleted'),
    onSuccess: () => setConfirm(false),
  });
  const done = milestone.status === 'done';
  return (
    <li className="flex min-w-0 flex-wrap items-center gap-2 px-3 py-2">
      <VStack>
        <IconButton
          label={t('moveUp', { name: milestone.name })}
          variant="ghost"
          size="sm"
          icon={<Icon icon={ArrowUpIcon} />}
          isDisabled={index === 0}
          onClick={() => onMove(index, index - 1)}
        />
        <IconButton
          label={t('moveDown', { name: milestone.name })}
          variant="ghost"
          size="sm"
          icon={<Icon icon={ArrowDownIcon} />}
          isDisabled={index === count - 1}
          onClick={() => onMove(index, index + 1)}
        />
      </VStack>
      {editing ? (
        <form
          className="min-w-0 flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) save.mutate({ name: name.trim(), dueDate: due || null });
          }}
        >
          <HStack gap={2} vAlign="end" wrap="wrap">
            <StackItem size="fill" className="min-w-40">
              <TextInput
                label={t('name')}
                isLabelHidden
                hasAutoFocus
                value={name}
                onChange={(v) => setName(v.slice(0, 200))}
              />
            </StackItem>
            <DateInput
              label={t('due')}
              isLabelHidden
              hasClear
              width={176}
              value={toIsoDate(due)}
              onChange={(v) => setDue(v ?? '')}
            />
            <Button label={tc('save')} variant="primary" size="sm" isLoading={save.isPending} type="submit" />
            <Button label={tc('cancel')} variant="ghost" size="sm" onClick={() => setEditing(false)} />
          </HStack>
        </form>
      ) : (
        <>
          <VStack className="min-w-36 flex-1">
            <Text weight="medium" maxLines={1}>
              {milestone.name}
            </Text>
            <Text type="supporting">
              {milestone.dueDate
                ? format.dateTime(dateValue(milestone.dueDate), { dateStyle: 'medium' })
                : t('noDate')}{' '}
              · {t(`status.${milestone.status}`)} ·{' '}
              {t('progress', { done: milestone.doneCount, total: milestone.taskCount })}
            </Text>
          </VStack>
          <Button
            label={done ? t('reopen') : t('complete')}
            variant="ghost"
            size="sm"
            icon={<Icon icon={done ? RotateCcwIcon : CheckIcon} />}
            onClick={() => save.mutate({ status: done ? 'open' : 'done' })}
          />
          <IconButton
            label={t('edit', { name: milestone.name })}
            variant="ghost"
            size="sm"
            icon={<Icon icon={PencilIcon} />}
            onClick={() => setEditing(true)}
          />
          <IconButton
            label={t('delete', { name: milestone.name })}
            variant="ghost"
            size="sm"
            icon={<Icon icon={Trash2Icon} />}
            onClick={() => setConfirm(true)}
          />
        </>
      )}
      <AlertDialog
        isOpen={confirm}
        onOpenChange={setConfirm}
        title={t('deleteTitle', { name: milestone.name })}
        description={t('deleteBody')}
        actionLabel={tc('delete')}
        cancelLabel={tc('cancel')}
        isActionLoading={remove.isPending}
        onAction={() => remove.mutate(undefined)}
      />
    </li>
  );
}

function MilestonesSection({ project }: { project: ProjectDetail }) {
  const t = useTranslations('projects.settings.milestones');
  const base = `${projectApi(project.key)}/milestones`;
  const reorder = useApiMutation((api, ids: string[]) => api.post(`${base}/reorder`, { ids }), {
    invalidate: INVALIDATE,
  });
  const move = (from: number, to: number) => {
    const ids = project.milestones.map((m) => m.id);
    const [item] = ids.splice(from, 1);
    ids.splice(to, 0, item!);
    reorder.mutate(ids);
  };
  return (
    <Card className="min-w-0 gap-4">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {project.milestones.length > 0 && (
          <SurfaceCard padding={0}>
            <ol className="divide-y" aria-label={t('title')}>
              {project.milestones.map((m, i) => (
                <MilestoneRow
                  key={`${m.id}:${m.name}:${m.dueDate}`}
                  milestone={m}
                  index={i}
                  count={project.milestones.length}
                  project={project}
                  onMove={move}
                />
              ))}
            </ol>
          </SurfaceCard>
        )}
        <AddMilestoneForm project={project} />
      </CardContent>
    </Card>
  );
}

function DangerZone({ project }: { project: ProjectDetail }) {
  const t = useTranslations('projects.settings.danger');
  const tc = useTranslations('common');
  const router = useRouter();
  const [confirm, setConfirm] = useState<'archive' | 'delete' | null>(null);
  const archived = Boolean(project.archivedAt);
  const archive = useApiMutation(
    (api, value: boolean) => api.patch(projectApi(project.key), { archived: value }),
    {
      invalidate: INVALIDATE,
      success: (_r) => (archived ? t('unarchived') : t('archived')),
      onSuccess: () => setConfirm(null),
    },
  );
  const remove = useApiMutation((api) => api.delete(projectApi(project.key)), {
    invalidate: INVALIDATE,
    success: t('deleted', { key: project.key }),
    onSuccess: () => router.push('/projects'),
  });
  return (
    <Card className="min-w-0 gap-4">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <VStack gap={0.5}>
            <Text weight="medium">{archived ? t('unarchive') : t('archive')}</Text>
            <Text type="supporting">{archived ? t('unarchiveHint') : t('archiveHint')}</Text>
          </VStack>
          <Button
            label={archived ? t('unarchive') : t('archive')}
            variant="secondary"
            icon={<Icon icon={archived ? ArchiveRestoreIcon : ArchiveIcon} />}
            isLoading={archive.isPending && archived}
            onClick={() => (archived ? archive.mutate(false) : setConfirm('archive'))}
          />
        </div>
        <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          <VStack gap={0.5}>
            <Text weight="medium">{t('delete')}</Text>
            <Text type="supporting">{project.viewer.canDelete ? t('deleteHint') : t('deleteBlocked')}</Text>
          </VStack>
          <Button
            label={t('delete')}
            variant="destructive"
            icon={<Icon icon={Trash2Icon} />}
            isDisabled={!project.viewer.canDelete}
            onClick={() => setConfirm('delete')}
          />
        </div>
      </CardContent>
      <AlertDialog
        isOpen={confirm === 'archive'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t('archiveTitle', { name: project.name })}
        description={t('archiveBody')}
        actionLabel={t('archive')}
        actionVariant="primary"
        cancelLabel={tc('cancel')}
        isActionLoading={archive.isPending}
        onAction={() => archive.mutate(true)}
      />
      <AlertDialog
        isOpen={confirm === 'delete'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t('deleteTitle', { name: project.name })}
        description={t('deleteBody', { count: project.totalTasks + project.taskCounts.cancelled })}
        actionLabel={tc('delete')}
        cancelLabel={tc('cancel')}
        isActionLoading={remove.isPending}
        onAction={() => remove.mutate(undefined)}
      />
    </Card>
  );
}

/** Managers: details, members (role, allocation), milestones (with reorder), archive and delete. */
export function SettingsTab({ project }: { project: ProjectDetail }) {
  const t = useTranslations('projects.settings');
  const router = useRouter();
  const [section] = useSearchParam('section');
  // "Manage" on the overview opens the right section (members, milestones), not the top of Settings.
  useEffect(() => {
    if (section !== 'members' && section !== 'milestones') return;
    const el = document.getElementById(section);
    el?.scrollIntoView({ block: 'start' });
    el?.querySelector<HTMLElement>('input, button')?.focus({ preventScroll: true });
  }, [section]);
  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card className="min-w-0 gap-4 lg:col-span-2">
        <CardHeader>
          <CardTitle>{t('details')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ProjectForm
            key={`${project.id}:${String(project.updatedAt)}`}
            project={project}
            onSaved={(p) => {
              if (p.key !== project.key) router.replace(`${projectHref(p.key)}?view=settings`);
            }}
          />
        </CardContent>
      </Card>
      <section id="members" className="min-w-0 scroll-mt-20 lg:col-span-2">
        <MembersSection project={project} />
      </section>
      <section id="milestones" className="min-w-0 scroll-mt-20 lg:col-span-2">
        <MilestonesSection project={project} />
      </section>
      <div className="min-w-0 lg:col-span-2">
        <DangerZone project={project} />
      </div>
    </div>
  );
}
