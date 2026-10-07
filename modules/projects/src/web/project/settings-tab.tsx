'use client';

import { UserAvatar } from '@isbp/ui/avatar';
import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { type PersonOption, PersonPicker } from '@isbp/ui/person-picker';
import { useApiMutation } from '@isbp/ui/query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  Trash2Icon,
  UserPlusIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { MEMBER_ROLES, type MemberRole, type Milestone, type ProjectDetail } from '../../contracts';
import { ConfirmDialog } from '../components/inputs';
import { ProjectForm } from '../components/project-form';
import { dateValue, INVALIDATE, projectApi, projectHref } from '../lib';

function MembersSection({ project }: { project: ProjectDetail }) {
  const t = useTranslations('projects.settings.members');
  const tr = useTranslations('projects.roles');
  const id = useId();
  const [person, setPerson] = useState<PersonOption | null>(null);
  const [role, setRole] = useState<MemberRole>('member');
  const [allocation, setAllocation] = useState('100');
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
        setAllocation('100');
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
  const pct = Math.max(0, Math.min(100, Number(allocation) || 0));
  return (
    <Card className="min-w-0 gap-4">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <form
          className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem_7rem_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (person) add.mutate({ userId: person.id, role, allocationPct: role === 'viewer' ? 0 : pct });
          }}
        >
          <div className="grid min-w-0 gap-2">
            <Label htmlFor={`${id}-person`}>{t('person')}</Label>
            <PersonPicker
              id={`${id}-person`}
              value={person}
              onChange={setPerson}
              excludeIds={project.members.map((m) => m.userId)}
            />
          </div>
          <div className="grid min-w-0 gap-2">
            <Label htmlFor={`${id}-role`}>{t('role')}</Label>
            <Select value={role} onValueChange={(v) => setRole(v as MemberRole)}>
              <SelectTrigger id={`${id}-role`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MEMBER_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {tr(r)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid min-w-0 gap-2">
            <Label htmlFor={`${id}-allocation`}>{t('allocation')}</Label>
            <Input
              id={`${id}-allocation`}
              type="number"
              min={0}
              max={100}
              step={5}
              disabled={role === 'viewer'}
              value={role === 'viewer' ? '0' : allocation}
              onChange={(e) => setAllocation(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={!person} loading={add.isPending}>
            <UserPlusIcon />
            {t('add')}
          </Button>
        </form>
        <ul className="divide-y rounded-lg border">
          {project.members.map((m) => (
            <li
              key={m.userId}
              className="grid gap-3 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_9rem_7rem_2.25rem] sm:items-center"
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <UserAvatar name={m.displayName} src={m.avatarUrl} className="size-7 text-[10px]" />
                <span className="grid min-w-0">
                  <span className="truncate text-sm font-medium">{m.displayName}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {m.isOwner ? t('owner') : (m.jobTitle ?? m.email)}
                  </span>
                </span>
              </span>
              <Select
                value={m.role}
                disabled={m.isOwner}
                onValueChange={(v) => update.mutate({ userId: m.userId, role: v as MemberRole })}
              >
                <SelectTrigger className="w-full" aria-label={t('roleOf', { name: m.displayName })}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MEMBER_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {tr(r)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                key={`${m.userId}:${m.allocationPct}`}
                type="number"
                min={0}
                max={100}
                step={5}
                defaultValue={m.allocationPct}
                disabled={m.role === 'viewer'}
                aria-label={t('allocationOf', { name: m.displayName })}
                onBlur={(e) => {
                  const v = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                  if (v !== m.allocationPct) update.mutate({ userId: m.userId, allocationPct: v });
                }}
              />
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={m.isOwner}
                aria-label={t('remove', { name: m.displayName })}
                onClick={() => setRemoving({ userId: m.userId, name: m.displayName })}
              >
                <Trash2Icon />
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t('removeTitle', { name: removing?.name ?? '' })}
        description={t('removeBody')}
        confirmLabel={t('removeConfirm')}
        destructive
        loading={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.userId)}
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
  return (
    <li className="flex min-w-0 flex-wrap items-center gap-2 px-3 py-2">
      <span className="flex flex-col">
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-6"
          disabled={index === 0}
          aria-label={t('moveUp', { name: milestone.name })}
          onClick={() => onMove(index, index - 1)}
        >
          <ArrowUpIcon className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-6"
          disabled={index === count - 1}
          aria-label={t('moveDown', { name: milestone.name })}
          onClick={() => onMove(index, index + 1)}
        >
          <ArrowDownIcon className="size-3.5" />
        </Button>
      </span>
      {editing ? (
        <form
          className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) save.mutate({ name: name.trim(), dueDate: due || null });
          }}
        >
          <Input
            autoFocus
            value={name}
            maxLength={200}
            aria-label={t('name')}
            onChange={(e) => setName(e.target.value)}
            className="min-w-40 flex-1"
          />
          <Input
            type="date"
            value={due}
            aria-label={t('due')}
            onChange={(e) => setDue(e.target.value)}
            className="w-40"
          />
          <Button type="submit" size="sm" loading={save.isPending}>
            {tc('save')}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
            {tc('cancel')}
          </Button>
        </form>
      ) : (
        <>
          <span className="grid min-w-0 flex-1">
            <span className="truncate text-sm font-medium">{milestone.name}</span>
            <span className="text-xs text-muted-foreground">
              {milestone.dueDate
                ? format.dateTime(dateValue(milestone.dueDate), { dateStyle: 'medium' })
                : t('noDate')}{' '}
              · {t(`status.${milestone.status}`)} ·{' '}
              {t('progress', { done: milestone.doneCount, total: milestone.taskCount })}
            </span>
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => save.mutate({ status: milestone.status === 'done' ? 'open' : 'done' })}
          >
            {milestone.status === 'done' ? <RotateCcwIcon /> : <CheckIcon />}
            {milestone.status === 'done' ? t('reopen') : t('complete')}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('edit', { name: milestone.name })}
            onClick={() => setEditing(true)}
          >
            <PencilIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('delete', { name: milestone.name })}
            onClick={() => setConfirm(true)}
          >
            <Trash2Icon />
          </Button>
        </>
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('deleteTitle', { name: milestone.name })}
        description={t('deleteBody')}
        confirmLabel={tc('delete')}
        destructive
        loading={remove.isPending}
        onConfirm={() => remove.mutate(undefined)}
      />
    </li>
  );
}

function MilestonesSection({ project }: { project: ProjectDetail }) {
  const t = useTranslations('projects.settings.milestones');
  const id = useId();
  const [name, setName] = useState('');
  const [due, setDue] = useState('');
  const base = `${projectApi(project.key)}/milestones`;
  const create = useApiMutation(
    (api, body: { name: string; dueDate: string | null }) => api.post(base, body),
    {
      invalidate: INVALIDATE,
      success: t('created'),
      onSuccess: () => {
        setName('');
        setDue('');
      },
    },
  );
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
          <ol className="divide-y rounded-lg border" aria-label={t('title')}>
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
        )}
        <form
          className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate({ name: name.trim(), dueDate: due || null });
          }}
        >
          <div className="grid min-w-0 gap-2">
            <Label htmlFor={`${id}-name`}>{t('name')}</Label>
            <Input id={`${id}-name`} value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid min-w-0 gap-2">
            <Label htmlFor={`${id}-due`}>{t('due')}</Label>
            <Input id={`${id}-due`} type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
          <Button type="submit" disabled={!name.trim()} loading={create.isPending}>
            <PlusIcon />
            {t('add')}
          </Button>
        </form>
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
    <Card className="min-w-0 gap-4 border-destructive/30">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="grid gap-0.5">
            <span className="text-sm font-medium">{archived ? t('unarchive') : t('archive')}</span>
            <span className="text-sm text-muted-foreground">
              {archived ? t('unarchiveHint') : t('archiveHint')}
            </span>
          </div>
          <Button
            variant="outline"
            onClick={() => (archived ? archive.mutate(false) : setConfirm('archive'))}
            loading={archive.isPending && archived}
          >
            {archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
            {archived ? t('unarchive') : t('archive')}
          </Button>
        </div>
        <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="grid gap-0.5">
            <span className="text-sm font-medium">{t('delete')}</span>
            <span className="text-sm text-muted-foreground">
              {project.viewer.canDelete ? t('deleteHint') : t('deleteBlocked')}
            </span>
          </div>
          <Button
            variant="destructive"
            disabled={!project.viewer.canDelete}
            onClick={() => setConfirm('delete')}
          >
            <Trash2Icon />
            {t('delete')}
          </Button>
        </div>
      </CardContent>
      <ConfirmDialog
        open={confirm === 'archive'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t('archiveTitle', { name: project.name })}
        description={t('archiveBody')}
        confirmLabel={t('archive')}
        loading={archive.isPending}
        onConfirm={() => archive.mutate(true)}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t('deleteTitle', { name: project.name })}
        description={t('deleteBody', { count: project.totalTasks + project.taskCounts.cancelled })}
        confirmLabel={tc('delete')}
        destructive
        loading={remove.isPending}
        onConfirm={() => remove.mutate(undefined)}
      />
    </Card>
  );
}

/** Managers: details, members (role, allocation), milestones (with reorder), archive and delete. */
export function SettingsTab({ project }: { project: ProjectDetail }) {
  const t = useTranslations('projects.settings');
  const router = useRouter();
  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
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
      <div className="min-w-0 lg:col-span-2">
        <MembersSection project={project} />
      </div>
      <div className="min-w-0 lg:col-span-2">
        <MilestonesSection project={project} />
      </div>
      <div className="min-w-0 lg:col-span-2">
        <DangerZone project={project} />
      </div>
    </div>
  );
}
