'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
} from '@astryxdesign/core/Table';
import { Heading, Text } from '@astryxdesign/core/Text';
import { localize } from '@isbp/sdk';
import { UserAvatar } from '@isbp/ui/avatar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { Markdown } from '@isbp/ui/markdown';
import { Meter } from '@isbp/ui/meter';
import { Disclosure } from '@isbp/ui/motion';
import { StatTile } from '@isbp/ui/stat-tile';
import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleXIcon,
  FlagIcon,
  SparklesIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { Fragment } from 'react';
import { Divider } from '@astryxdesign/core/Divider';
import type { ReportProject, ReportSection, StateReasonDto, StatusReport } from '../../contracts';
import { DueDate, HealthBadge, ReportStateBadge } from '../components/badges';
import { dateValue, projectHref } from '../lib';

type Section = StatusReport['template']['sections'][number];

/** "14 days after the target date", "2 milestones overdue". */
export function useReasonText() {
  const t = useTranslations('projects.reasons');
  return (r: StateReasonDto) => t(r.code, { value: r.value ?? 0 });
}

/** A section's heading: its own title in the reader's language, else the default for its type. */
export function useSectionHeading() {
  const t = useTranslations('projects.report.sections');
  const ts = useTranslations('projects.reportState');
  const locale = useLocale();
  return (s: ReportSection) => {
    const own = s.title ? localize(s.title, locale) : '';
    if (own) return own;
    if (s.type === 'projects') return s.states.map((x) => ts(x)).join(' · ');
    return t(s.type);
  };
}

function ProjectName({ p }: { p: Pick<ReportProject, 'key' | 'name'> }) {
  return (
    <Link href={projectHref(p.key)} color="primary" weight="medium">
      {`${p.key} ${p.name}`}
    </Link>
  );
}

function Reasons({ project }: { project: ReportProject }) {
  const reason = useReasonText();
  const t = useTranslations('projects.report');
  if (!project.reasons.length && !project.mismatch) return null;
  return (
    <HStack gap={2} vAlign="center" wrap="wrap">
      {project.reasons.length > 0 && <Text type="supporting">{project.reasons.map(reason).join(' · ')}</Text>}
      {project.mismatch && (
        <Badge variant="warning" label={t('mismatch')} icon={<Icon icon={TriangleAlertIcon} size="xsm" />} />
      )}
    </HStack>
  );
}

function SummarySection({ report }: { report: StatusReport }) {
  const t = useTranslations('projects.report');
  const n = report.narrative;
  return (
    <VStack gap={2}>
      {n.summary ? <Markdown>{n.summary}</Markdown> : <Text type="supporting">{t('nothing')}</Text>}
      {n.mode && (
        <HStack gap={1} vAlign="center">
          <Icon icon={SparklesIcon} size="xsm" color="secondary" />
          <Text type="supporting">{n.mode === 'llm' ? t('writtenByAi') : t('writtenBuiltin')}</Text>
        </HStack>
      )}
    </VStack>
  );
}

function CountsSection({ report }: { report: StatusReport }) {
  const t = useTranslations('projects.reportState');
  const tr = useTranslations('projects.report');
  const c = report.counts;
  return (
    <VStack gap={3}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <StatTile
          icon={<CircleXIcon />}
          tone={c.delayed ? 'destructive' : 'default'}
          label={t('delayed')}
          value={c.delayed}
        />
        <StatTile
          icon={<TriangleAlertIcon />}
          tone={c.at_risk ? 'warning' : 'default'}
          label={t('at_risk')}
          value={c.at_risk}
        />
        <StatTile icon={<CircleCheckIcon />} tone="success" label={t('on_track')} value={c.on_track} />
        <StatTile icon={<CircleDashedIcon />} label={t('no_update')} value={c.no_update} />
        <StatTile icon={<FlagIcon />} label={t('completed')} value={c.completed} />
      </div>
      <HStack gap={3} wrap="wrap">
        <Text type="supporting">
          {tr('updatesReceived', { submitted: c.submitted, expected: c.submitted + c.missing })}
        </Text>
        {c.mismatches > 0 && <Text type="supporting">{tr('mismatches', { count: c.mismatches })}</Text>}
      </HStack>
    </VStack>
  );
}

function ProjectTable({ projects, report }: { projects: ReportProject[]; report: StatusReport }) {
  const t = useTranslations('projects.report.columns');
  const tr = useTranslations('projects.report');
  const format = useFormatter();
  const day = (d: string | null) => (d ? format.dateTime(dateValue(d), { dateStyle: 'medium' }) : '—');
  return (
    <div className="min-w-0 overflow-x-auto">
      <Table aria-label={tr('projectsTable')}>
        <TableHeader>
          <TableRow isHeaderRow>
            <TableHeaderCell className="w-full max-w-0">{t('project')}</TableHeaderCell>
            <TableHeaderCell className="max-w-none whitespace-nowrap">{t('state')}</TableHeaderCell>
            <TableHeaderCell className="hidden max-w-none whitespace-nowrap md:table-cell">
              {t('manager')}
            </TableHeaderCell>
            <TableHeaderCell className="hidden max-w-none whitespace-nowrap lg:table-cell">
              {t('target')}
            </TableHeaderCell>
            <TableHeaderCell className="hidden max-w-none whitespace-nowrap lg:table-cell">
              {t('forecast')}
            </TableHeaderCell>
            <TableHeaderCell className="hidden max-w-none whitespace-nowrap sm:table-cell">
              {t('progress')}
            </TableHeaderCell>
          </TableRow>
        </TableHeader>
        <TableBody>
          {projects.map((p) => (
            <TableRow key={p.id}>
              <TableCell className="w-full max-w-0">
                <VStack gap={1} className="min-w-0">
                  <span className="min-w-0 wrap-anywhere">
                    <ProjectName p={p} />
                  </span>
                  <Reasons project={p} />
                </VStack>
              </TableCell>
              <TableCell className="max-w-none whitespace-nowrap">
                <ReportStateBadge state={p.state} />
              </TableCell>
              <TableCell className="hidden max-w-none whitespace-nowrap md:table-cell">
                <Text>{p.manager?.displayName ?? '—'}</Text>
              </TableCell>
              <TableCell className="hidden max-w-none whitespace-nowrap lg:table-cell">
                <Text>{day(p.targetDate)}</Text>
              </TableCell>
              <TableCell className="hidden max-w-none whitespace-nowrap lg:table-cell">
                <Text>{day(p.forecastDate)}</Text>
              </TableCell>
              <TableCell className="hidden max-w-none whitespace-nowrap sm:table-cell">
                {p.progress !== null ? (
                  <Meter
                    value={p.progress}
                    max={100}
                    label={t('progress')}
                    valueText={`${p.progress}%`}
                    showValue
                    size="sm"
                  />
                ) : (
                  <Text type="supporting">—</Text>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {report.truncated && <Text type="supporting">{tr('truncated')}</Text>}
    </div>
  );
}

function ProjectBriefs({ projects, report }: { projects: ReportProject[]; report: StatusReport }) {
  return (
    <ul className="grid gap-3">
      {projects.map((p, i) => (
        <li key={p.id} className="grid min-w-0 gap-1">
          {i > 0 && <Divider />}
          <HStack gap={2} vAlign="center" wrap="wrap">
            <span className="min-w-0 wrap-anywhere">
              <ProjectName p={p} />
            </span>
            <ReportStateBadge state={p.state} />
          </HStack>
          <Reasons project={p} />
          {report.narrative.projects[p.id]?.brief && (
            <span className="wrap-anywhere">
              <Text>{report.narrative.projects[p.id]!.brief}</Text>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function ProjectFull({ projects, report }: { projects: ReportProject[]; report: StatusReport }) {
  const t = useTranslations('projects.report');
  const tu = useTranslations('projects.updates.fields');
  const format = useFormatter();
  return (
    <div className="grid gap-5">
      {projects.map((p, i) => {
        const n = report.narrative.projects[p.id];
        return (
          <article key={p.id} className="grid min-w-0 gap-2" aria-label={`${p.key} ${p.name}`}>
            {i > 0 && <Divider />}
            <HStack gap={2} vAlign="center" wrap="wrap">
              <Heading level={3}>
                <ProjectName p={p} />
              </Heading>
              <ReportStateBadge state={p.state} />
              {p.reported && <HealthBadge health={p.reported} plain />}
            </HStack>
            <Reasons project={p} />
            <HStack gap={3} wrap="wrap">
              {p.manager && (
                <Text type="supporting">{t('managerName', { name: p.manager.displayName })}</Text>
              )}
              {p.targetDate && (
                <Text type="supporting">
                  {t('targetOn', { date: format.dateTime(dateValue(p.targetDate), { dateStyle: 'medium' }) })}
                </Text>
              )}
              {p.forecastDate && (
                <Text type="supporting">
                  {t('expectedOn', {
                    date: format.dateTime(dateValue(p.forecastDate), { dateStyle: 'medium' }),
                  })}
                </Text>
              )}
              {p.progress !== null && (
                <Text type="supporting">{t('progressValue', { progress: p.progress })}</Text>
              )}
            </HStack>
            {n?.brief && (
              <span className="wrap-anywhere">
                <Text>{n.brief}</Text>
              </span>
            )}
            {(['done', 'next', 'blockers'] as const)
              .filter((f) => n?.[f])
              .map((f) => (
                <section key={f} className="grid min-w-0 gap-1">
                  <Text type="label">{tu(f)}</Text>
                  <div className="min-w-0 wrap-anywhere">
                    <Markdown>{n![f]!}</Markdown>
                  </div>
                </section>
              ))}
            {p.missing.length > 0 && (
              <Text type="supporting">
                {t('missingFrom', { names: p.missing.map((m) => m.displayName).join(', ') })}
              </Text>
            )}
            {p.updates.length > 0 && (
              <Disclosure summary={t('showUpdates', { count: p.updates.length })}>
                <ul className="grid gap-3 pt-2">
                  {p.updates.map((u) => (
                    <li key={u.id} className="grid min-w-0 gap-1">
                      <HStack gap={2} vAlign="center" wrap="wrap">
                        <UserAvatar
                          name={u.author?.displayName ?? '—'}
                          src={u.author?.avatarUrl}
                          className="size-5 text-[9px]"
                        />
                        <Text weight="medium">{u.author?.displayName ?? '—'}</Text>
                        <HealthBadge health={u.status} plain />
                      </HStack>
                      <span className="wrap-anywhere">
                        <Text type="supporting">{u.summary}</Text>
                      </span>
                    </li>
                  ))}
                </ul>
              </Disclosure>
            )}
          </article>
        );
      })}
    </div>
  );
}

function ItemsSection({ items }: { items: StatusReport['narrative']['blockers'] }) {
  const t = useTranslations('projects.report');
  if (!items.length) return <Text type="supporting">{t('nothing')}</Text>;
  return (
    <ul className="grid gap-1.5">
      {items.map((i) => (
        <li key={`${i.text}-${i.projects.join()}`}>
          <span className="wrap-anywhere">
            <Text>{i.text}</Text>
          </span>{' '}
          {i.projects.map((k) => (
            <Fragment key={k}>
              {' '}
              <Link href={projectHref(k)}>{k}</Link>
            </Fragment>
          ))}
        </li>
      ))}
    </ul>
  );
}

function MilestonesSection({ report, days }: { report: StatusReport; days: number }) {
  const t = useTranslations('projects.report');
  if (!report.milestones) return <Text type="supporting">{t('milestonesPast')}</Text>;
  const limit = new Date(`${report.today}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + days);
  const until = limit.toISOString().slice(0, 10);
  const list = report.milestones.filter((m) => m.dueDate && m.dueDate <= until);
  if (!list.length) return <Text type="supporting">{t('noMilestones', { days })}</Text>;
  return (
    <ul className="grid gap-2">
      {list.map((m) => (
        <li key={m.id}>
          <HStack gap={2} vAlign="center" wrap="wrap">
            <DueDate date={m.dueDate} today={report.today} long />
            <Link href={projectHref(m.project.key)}>{m.project.key}</Link>
            <span className="min-w-0 wrap-anywhere">
              <Text>{m.name}</Text>
            </span>
          </HStack>
        </li>
      ))}
    </ul>
  );
}

function MissingSection({ report }: { report: StatusReport }) {
  const t = useTranslations('projects.report');
  const list = report.projects.filter((p) => p.missing.length);
  if (!list.length) return <Text type="supporting">{t('noneMissing')}</Text>;
  return (
    <ul className="grid gap-2">
      {list.map((p) => (
        <li key={p.id} className="grid min-w-0 gap-0.5">
          <ProjectName p={p} />
          <Text type="supporting">{p.missing.map((m) => m.displayName).join(', ')}</Text>
        </li>
      ))}
    </ul>
  );
}

function DecisionsSection({ report }: { report: StatusReport }) {
  const t = useTranslations('projects.report');
  const format = useFormatter();
  if (!report.decisions) return <Text type="supporting">{t('decisionsUnavailable')}</Text>;
  if (!report.decisions.length) return <Text type="supporting">{t('noDecisions')}</Text>;
  return (
    <ul className="grid gap-2.5">
      {report.decisions.map((d, i) => (
        <li key={`${d.meeting.reference}-${i}`} className="grid min-w-0 gap-0.5">
          <span className="wrap-anywhere">
            <Text>{d.text}</Text>
          </span>
          <HStack gap={2} vAlign="center" wrap="wrap">
            <Link href={d.meeting.href}>{`${d.meeting.reference} ${d.meeting.title}`}</Link>
            <Text type="supporting">
              {format.dateTime(new Date(d.meeting.startsAt), { dateStyle: 'medium' })}
            </Text>
            {d.projects.map((k) => (
              <Link key={k} href={projectHref(k)}>
                {k}
              </Link>
            ))}
          </HStack>
        </li>
      ))}
    </ul>
  );
}

/** One section of the report, in a card under its heading. */
export function ReportSectionCard({ section, report }: { section: Section; report: StatusReport }) {
  const heading = useSectionHeading();
  const t = useTranslations('projects.report');
  const projects =
    section.type === 'projects' ? report.projects.filter((p) => section.states.includes(p.state)) : [];
  return (
    <Card className="min-w-0 gap-4" id={`section-${section.id}`}>
      <CardHeader>
        {/* Sections are the report's level-2 headings; projects inside them are level 3. */}
        <CardTitle role="heading" aria-level={2}>
          {heading(section)}
        </CardTitle>
        {section.type === 'projects' && (
          <CardDescription>{t('projectCount', { count: projects.length })}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="grid min-w-0 gap-3">
        {section.type === 'summary' ? (
          <SummarySection report={report} />
        ) : section.type === 'counts' ? (
          <CountsSection report={report} />
        ) : section.type === 'projects' ? (
          !projects.length ? (
            <Text type="supporting">{t('noProjects')}</Text>
          ) : section.detail === 'table' ? (
            <ProjectTable projects={projects} report={report} />
          ) : section.detail === 'brief' ? (
            <ProjectBriefs projects={projects} report={report} />
          ) : (
            <ProjectFull projects={projects} report={report} />
          )
        ) : section.type === 'blockers' ? (
          <ItemsSection items={report.narrative.blockers} />
        ) : section.type === 'asks' ? (
          <ItemsSection items={report.narrative.asks} />
        ) : section.type === 'milestones' ? (
          <MilestonesSection report={report} days={section.days} />
        ) : section.type === 'missing' ? (
          <MissingSection report={report} />
        ) : (
          <DecisionsSection report={report} />
        )}
      </CardContent>
    </Card>
  );
}
