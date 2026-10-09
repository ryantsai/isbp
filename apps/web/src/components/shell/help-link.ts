import { guideHref } from '@isbp/guide/meta';
import { usePlatform } from '@isbp/sdk/web';

/** The guide is a knowledge-base book: help links need the knowledge module and read access to it. */
export function useCanHelp() {
  const { enabledModules, permissions } = usePlatform();
  return enabledModules.includes('knowledge') && permissions.hasAny('knowledge.articles.read');
}

/** The guide chapter for the area a page belongs to (longest prefix wins); the start page otherwise. */
const AREAS: [prefix: string, slug: string][] = [
  ['/itsm/changes', 'changes-and-releases'],
  ['/alm', 'changes-and-releases'],
  ['/itsm', 'service-desk'],
  ['/cmdb', 'service-desk'],
  ['/helpdesk-ai/chat', 'employees'],
  ['/helpdesk-ai', 'service-desk'],
  ['/announcements', 'service-desk'],
  ['/itam/mine', 'employees'],
  ['/itam', 'assets'],
  ['/isms', 'information-security'],
  ['/projects', 'projects'],
  ['/etl', 'data-and-automation'],
  ['/scheduler', 'data-and-automation'],
  ['/dbaccess', 'data-and-automation'],
  ['/integrations', 'integrations'],
  ['/assistant', 'assistant-and-ai'],
  ['/admin/forms', 'build-a-process'],
  ['/admin/workflows', 'build-a-process'],
  ['/admin', 'administrators'],
  ['/requests', 'employees'],
  ['/my-work', 'employees'],
  ['/approvals', 'employees'],
  ['/knowledge', 'employees'],
];

export function helpHrefFor(pathname: string): string {
  const hit = AREAS.filter(([p]) => pathname === p || pathname.startsWith(`${p}/`)).sort(
    (a, b) => b[0].length - a[0].length,
  )[0];
  return guideHref(hit ? hit[1] : 'start-here');
}
