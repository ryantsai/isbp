/**
 * The user guide's table of contents (docs/guide/<locale>/<file>) and the slug its in-app link uses
 * (`/knowledge/guide/<slug>`). Every guide is readable by everyone in the knowledge base: staff guides are for many
 * roles (asset managers, engineers…) that don't read the service desk's internal articles.
 */
export const GUIDE_LOCALES = ['en', 'zh-TW', 'ja-JP'] as const;
export type GuideLocale = (typeof GUIDE_LOCALES)[number];

export interface GuideEntry {
  file: string;
  slug: string;
}

export const GUIDES: readonly GuideEntry[] = [
  { file: 'README.md', slug: 'start-here' },
  { file: 'how-it-fits-our-work.md', slug: 'how-it-fits-our-work' },
  { file: 'employees.md', slug: 'employees' },
  { file: 'service-desk.md', slug: 'service-desk' },
  { file: 'changes-and-releases.md', slug: 'changes-and-releases' },
  { file: 'assets.md', slug: 'assets' },
  { file: 'information-security.md', slug: 'information-security' },
  { file: 'projects.md', slug: 'projects' },
  { file: 'data-and-automation.md', slug: 'data-and-automation' },
  { file: 'integrations.md', slug: 'integrations' },
  { file: 'assistant-and-ai.md', slug: 'assistant-and-ai' },
  { file: 'administrators.md', slug: 'administrators' },
  { file: 'processes.md', slug: 'build-a-process' },
  { file: 'glossary.md', slug: 'glossary' },
  { file: 'faq.md', slug: 'faq' },
];

/** Where the in-app help links to a guide (the knowledge base resolves it in the reader's language). */
export const guideHref = (slug: string, anchor?: string) =>
  `/knowledge/guide/${slug}${anchor ? `#${anchor}` : ''}`;

/** Where a guide's screenshots are served (`apps/web/public/help/<locale>/`). */
export const HELP_IMAGES_PATH = '/help/';
