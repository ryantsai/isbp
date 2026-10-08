/**
 * `pnpm docs:guide`: embeds the user guide (docs/guide/<locale>/*.md) into `@isbp/guide` (packages/guide/src/
 * generated.ts) for the knowledge base's in-app help. Links between guides become in-app links
 * (`/knowledge/guide/<slug>`), screenshots become web paths (`/help/<locale>/…`), links outside the guide keep only
 * their text. Translations may keep English anchors in their links (`service-desk.md#work-your-queue`): they are
 * rewritten to the translated heading at the same position (`localizeAnchors`). `--check` fails when either is stale
 * (CI: `pnpm docs:check`).
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GuideArticle } from '../../guide/src/index';
import { GUIDE_LOCALES, GUIDES, guideHref } from '../../guide/src/meta';
import { createSlugger } from '../../ui/src/lib/slug';

const IMAGE_PREFIX = '../../../apps/web/public/help/';

/** Plain text of a Markdown paragraph (links keep their text, emphasis and code marks go). */
function plain(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A heading line's text as it reads on screen (link targets, code and emphasis marks dropped). */
function headingText(line: string): string {
  return line
    .replace(/^#+\s+/, '')
    .replace(/\s+#+\s*$/, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|\W)[*_](\S.*?)[*_](?=\W|$)/g, '$1$2')
    .trim();
}

/** A guide's headings outside code blocks, with their anchors (as the app and GitHub make them). */
export function guideHeadings(md: string): { level: number; text: string; anchor: string }[] {
  const slug = createSlugger();
  const headings: { level: number; text: string; anchor: string }[] = [];
  let fenced = false;
  for (const line of md.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const m = fenced ? null : /^(#{1,6})\s/.exec(line);
    if (!m) continue;
    const text = headingText(line);
    headings.push({ level: m[1]!.length, text, anchor: slug(text) });
  }
  return headings;
}

/** The `##` and `###` sections, which every translation keeps in the same order. */
const sections = (md: string) => guideHeadings(md).filter((h) => h.level === 2 || h.level === 3);

/** Applies `fn` to the Markdown outside code blocks. */
function outsideCode(md: string, fn: (text: string) => string): string {
  return md
    .split(/(^\s*```[\s\S]*?^\s*```)/m)
    .map((part, i) => (i % 2 ? part : fn(part)))
    .join('');
}

/**
 * Rewrites links in translations whose anchor is an English heading's (`#work-your-queue`) to the anchor of the
 * heading at the same position in the translation of the target guide. Returns the files that changed (or, with
 * `check`, would change).
 */
export function localizeAnchors(root: string, check: boolean): string[] {
  const files = new Set(GUIDES.map((g) => g.file));
  const read = (locale: string, file: string) => {
    const path = join(root, 'docs/guide', locale, file);
    return existsSync(path) ? readFileSync(path, 'utf8') : null;
  };
  const changed: string[] = [];
  for (const locale of GUIDE_LOCALES.slice(1)) {
    for (const g of GUIDES) {
      const md = read(locale, g.file);
      if (md === null) continue;
      const next = outsideCode(md, (text) =>
        text.replace(/(?<!!)\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, label: string, target: string) => {
          const [file, anchor] = target.split('#') as [string, string | undefined];
          const targetFile = file.replace(/^\.\//, '') || g.file;
          if (!anchor || !files.has(targetFile)) return whole;
          const en = read('en', targetFile);
          const translated = read(locale, targetFile);
          if (en === null || translated === null) return whole;
          const theirs = sections(translated);
          if (theirs.some((h) => h.anchor === anchor)) return whole;
          const ours = sections(en);
          const i = ours.findIndex((h) => h.anchor === anchor);
          if (i < 0 || ours.length !== theirs.length) return whole;
          return `[${label}](${file}#${theirs[i]!.anchor})`;
        }),
      );
      if (next === md) continue;
      changed.push(`${locale}/${g.file}`);
      if (!check) writeFileSync(join(root, 'docs/guide', locale, g.file), next);
    }
  }
  return changed;
}

/** Rewrites one guide's Markdown for the knowledge base. */
export function rewrite(md: string): string {
  const slugOf = new Map(GUIDES.map((g) => [g.file, g.slug]));
  return (
    md
      // Screenshots: served by the web app.
      .replaceAll(`](${IMAGE_PREFIX}`, '](/help/')
      // Links: other guides → in-app links; other relative links (repo files) → text only.
      .replace(/(?<!!)\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, text: string, target: string) => {
        if (/^(https?:|mailto:|\/|#)/.test(target)) return whole;
        const [file, anchor] = target.split('#') as [string, string | undefined];
        const slug = slugOf.get(file.replace(/^\.\//, ''));
        return slug ? `[${text}](${guideHref(slug, anchor)})` : text;
      })
  );
}

/** Title (the `# ` heading), summary (the first paragraph) and the rest of a guide. */
export function parseGuide(md: string): { title: string; summary: string; body: string } {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const h1 = lines.findIndex((l) => l.startsWith('# '));
  if (h1 < 0) throw new Error('a guide must start with a "# " title');
  const title = lines[h1]!.slice(2).trim();
  let i = h1 + 1;
  while (i < lines.length && !lines[i]!.trim()) i++;
  const start = i;
  while (i < lines.length && lines[i]!.trim() && !/^(#|!\[|>|\||- |\d+\. )/.test(lines[i]!)) i++;
  const summary = plain(lines.slice(start, i).join(' ')).slice(0, 500);
  const body = lines
    .slice(summary ? i : start)
    .join('\n')
    .trim();
  return { title, summary, body };
}

export function buildGuide(root: string): { articles: GuideArticle[]; version: string } {
  const articles: GuideArticle[] = [];
  for (const locale of GUIDE_LOCALES) {
    GUIDES.forEach((g, order) => {
      const path = join(root, 'docs/guide', locale, g.file);
      if (!existsSync(path)) return;
      const { title, summary, body: raw } = parseGuide(readFileSync(path, 'utf8'));
      const body = rewrite(raw);
      const hash = createHash('sha256')
        .update(JSON.stringify([title, summary, body]))
        .digest('base64url')
        .slice(0, 16);
      articles.push({
        slug: g.slug,
        file: g.file,
        locale,
        order,
        title,
        summary,
        body,
        hash,
      });
    });
  }
  const version = createHash('sha256')
    .update(articles.map((a) => `${a.locale}/${a.slug}:${a.hash}`).join('\n'))
    .digest('base64url')
    .slice(0, 16);
  return { articles, version };
}

export function renderGuideModule(root: string): string {
  const { articles, version } = buildGuide(root);
  return [
    '// AUTO-GENERATED by `pnpm docs:guide` from docs/guide — do not edit.',
    "import type { GuideArticle } from './index';",
    '',
    `export const GUIDE_VERSION = ${JSON.stringify(version)};`,
    '',
    `export const guideArticles: GuideArticle[] = ${JSON.stringify(articles, null, 2)};`,
    '',
  ].join('\n');
}

/**
 * Localises the translations' anchors, then writes (or with `check`, compares) packages/guide/src/generated.ts;
 * returns whether everything was up to date.
 */
export async function syncGuide(root: string, check: boolean): Promise<boolean> {
  const prettier = await import('prettier');
  const anchors = localizeAnchors(root, check);
  for (const f of anchors) {
    console.warn(`${check ? '✗' : '✓'} anchors in docs/guide/${f}`);
    if (check) continue;
    // Longer anchors widen tables: keep the guide formatted.
    const path = join(root, 'docs/guide', f);
    const md = readFileSync(path, 'utf8');
    const style = (await prettier.resolveConfig(path)) ?? {};
    writeFileSync(path, await prettier.format(md, { ...style, filepath: path }));
  }
  const file = join(root, 'packages/guide/src/generated.ts');
  const options = (await prettier.resolveConfig(file)) ?? {};
  const next = await prettier.format(renderGuideModule(root), { ...options, parser: 'typescript' });
  const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (current === next) return !anchors.length;
  if (!check) writeFileSync(file, next);
  return false;
}
