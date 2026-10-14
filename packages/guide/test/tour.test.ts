import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { guideHeadings } from '../../create-module/src/guide';
import { GUIDES } from '../src';
import type { TourContent, TourShot } from '../../../apps/web/src/components/tour/content/types';
import { zhTW } from '../../../apps/web/src/components/tour/content/zh-TW';
import { TOUR_LOCALES, tourAvailable } from '../../../apps/web/src/components/tour/locales';

/**
 * The product tour (`/tour`, apps/web/src/components/tour): its words are data, so what could rot is checked here, in
 * one place: every picture exists as a real capture of the right size and is in the shot list, the facts match the
 * generated reference, links go to guides and headings that exist, labels in **bold** are labels the product has.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const helpDir = (locale: string) => join(root, 'apps/web/public/help', locale, 'tour');
const contents: TourContent[] = [zhTW];

/** Every screenshot the content shows, with where it is used. */
function shotsOf(c: TourContent): { shot: TourShot; where: string }[] {
  return [
    ...c.areas.flatMap((a) => a.steps.map((s) => ({ shot: s.shot, where: `${a.id}/${s.id}` }))),
    ...c.journeys.items.flatMap((j) => j.steps.map((s, i) => ({ shot: s.shot, where: `${j.id}/${i + 1}` }))),
    ...c.hero.shots.map((shot, i) => ({ shot, where: `hero/${i}` })),
    ...c.polish.langs.map((l) => ({ shot: l.shot, where: `polish/${l.locale}` })),
    { shot: c.polish.dark.shot, where: 'polish/dark' },
    { shot: c.architecture.modules.toggleShot, where: 'architecture/modules' },
    { shot: c.architecture.config.shot, where: 'architecture/config' },
    { shot: c.security.shot, where: 'security' },
  ];
}

/** Width and height of a JPEG file (from its first start-of-frame marker). */
function jpegSize(file: string): { w: number; h: number } {
  const buf = readFileSync(file);
  expect(buf.subarray(0, 2).toString('hex'), `${file} is not a JPEG`).toBe('ffd8');
  let i = 2;
  while (i < buf.length) {
    expect(buf[i]).toBe(0xff);
    const marker = buf[i + 1]!;
    const length = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + length;
  }
  throw new Error(`no size in ${file}`);
}

/** Every string of the content (copy, labels, notes). */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) strings(v, out);
  return out;
}

/** What the zh-TW product says: the guide and every catalog (labels in **bold** must be found in one of them). */
function productText(): string {
  const parts: string[] = [];
  for (const g of GUIDES)
    parts.push(readFileSync(join(root, 'docs/guide/zh-TW', g.file), 'utf8').replaceAll('**', ''));
  const core = join(root, 'packages/i18n/messages/zh-TW');
  for (const f of readdirSync(core)) parts.push(readFileSync(join(core, f), 'utf8'));
  for (const m of readdirSync(join(root, 'modules'))) {
    const f = join(root, 'modules', m, 'messages/zh-TW.json');
    if (existsSync(f)) parts.push(readFileSync(f, 'utf8'));
  }
  return parts.join('\n');
}

describe('the product tour', () => {
  it('is offered only in the languages it is written in', () => {
    expect(TOUR_LOCALES).toEqual(['zh-TW']);
    expect(tourAvailable('zh-TW')).toBe(true);
    expect(tourAvailable('en')).toBe(false);
    expect(tourAvailable('ja-JP')).toBe(false);
  });

  for (const c of contents) {
    describe(c.locale, () => {
      it('shows only real captures: they exist, have the stated size and are in the shot list', () => {
        const manifest = JSON.parse(readFileSync(join(root, 'docs/guide/shots/tour.json'), 'utf8')) as {
          name: string;
          dir?: string;
          locales?: string[];
        }[];
        const wanted = (name: string, locale: string) =>
          manifest.some(
            (s) => s.name === name && s.dir === 'tour' && (!s.locales || s.locales.includes(locale)),
          );
        const problems: string[] = [];
        for (const { shot, where } of shotsOf(c)) {
          const locale = shot.locale ?? c.locale;
          const file = join(helpDir(locale), `${shot.name}.jpg`);
          if (!existsSync(file)) {
            problems.push(
              `${where}: ${locale}/tour/${shot.name}.jpg does not exist (pnpm docs:screenshots tour)`,
            );
            continue;
          }
          const size = jpegSize(file);
          if (size.w !== shot.w || size.h !== shot.h)
            problems.push(
              `${where}: ${shot.name} is ${size.w}×${size.h}, the content says ${shot.w}×${shot.h}`,
            );
          if (!wanted(shot.name, locale))
            problems.push(`${where}: ${shot.name} (${locale}) is not in docs/guide/shots/tour.json`);
          if (!shot.alt.trim()) problems.push(`${where}: ${shot.name} has no alt text`);
        }
        expect(problems).toEqual([]);
      });

      it('has no capture that nothing shows', () => {
        const used = new Set(shotsOf(c).map(({ shot }) => `${shot.locale ?? c.locale}/${shot.name}.jpg`));
        const orphans: string[] = [];
        for (const locale of ['en', 'zh-TW', 'ja-JP']) {
          if (!existsSync(helpDir(locale))) continue;
          for (const f of readdirSync(helpDir(locale)))
            if (!used.has(`${locale}/${f}`)) orphans.push(`${locale}/tour/${f}`);
        }
        expect(orphans).toEqual([]);
      });

      it('puts every call-out inside its screenshot', () => {
        const problems: string[] = [];
        for (const a of c.areas)
          for (const s of a.steps)
            for (const m of s.marks ?? []) {
              if (m.x < 0 || m.y < 0 || m.x > s.shot.w || m.y > s.shot.h)
                problems.push(
                  `${a.id}/${s.id}: "${m.label}" is at ${m.x},${m.y}, outside ${s.shot.w}×${s.shot.h}`,
                );
              if (!m.label.trim()) problems.push(`${a.id}/${s.id}: a call-out has no label`);
            }
        expect(problems).toEqual([]);
        // Every step of every area has call-outs: they are what makes the pictures a tutorial.
        expect(
          c.areas.flatMap((a) => a.steps.filter((s) => !s.marks?.length).map((s) => `${a.id}/${s.id}`)),
        ).toEqual([]);
      });

      it('has unique anchors and step ids', () => {
        const anchors = [...c.sections.map((s) => s.id), ...c.areas.map((a) => a.id), 'top'];
        expect(anchors.filter((id, i) => anchors.indexOf(id) !== i)).toEqual([]);
        // Each section of the bar exists as an anchor of the page, and the areas are its twelve chapters.
        expect(c.areas).toHaveLength(12);
        for (const a of c.areas) {
          const ids = a.steps.map((s) => s.id);
          expect(
            ids.filter((id, i) => ids.indexOf(id) !== i),
            a.id,
          ).toEqual([]);
        }
        const journeys = c.journeys.items.map((j) => j.id);
        expect(journeys.filter((id, i) => journeys.indexOf(id) !== i)).toEqual([]);
      });

      it('links only to guides and headings that exist', () => {
        const slugs = new Map(GUIDES.map((g) => [g.slug, g.file]));
        const links = [
          ...c.areas.map((a) => ({ ...a.guide, anchor: undefined as string | undefined, where: a.id })),
          ...c.journeys.items.map((j) => ({ ...j.guide, where: j.id })),
          ...c.roles.items.map((r) => ({
            ...r.guide,
            anchor: undefined as string | undefined,
            where: r.guide.slug,
          })),
          ...c.closing.actions
            .filter((a) => a.slug)
            .map((a) => ({
              slug: a.slug!,
              label: a.label,
              anchor: undefined as string | undefined,
              where: a.label,
            })),
        ];
        const broken: string[] = [];
        for (const l of links) {
          const file = slugs.get(l.slug);
          if (!file) {
            broken.push(`${l.where}: no guide "${l.slug}"`);
            continue;
          }
          if (l.anchor) {
            const md = readFileSync(join(root, 'docs/guide', c.locale, file), 'utf8');
            if (!guideHeadings(md).some((h) => h.anchor === l.anchor))
              broken.push(`${l.where}: ${file} has no heading #${l.anchor}`);
          }
        }
        expect(broken).toEqual([]);
      });

      it('marks labels in pairs, and every bold label is one the product has', () => {
        const unpaired = strings(c).filter((s) => (s.match(/\*\*/g) ?? []).length % 2 === 1);
        expect(unpaired).toEqual([]);
        const corpus = productText();
        const missing = new Set<string>();
        for (const s of strings(c))
          for (const m of s.matchAll(/\*\*(.+?)\*\*/g)) {
            const label = m[1]!;
            // Bold marks a label as the screen shows it, so it must be in the guide or a catalog; a few are the tour's own emphasis.
            if (!corpus.includes(label)) missing.add(label);
          }
        expect([...missing].sort()).toEqual([]);
      });

      it('states the numbers the generated reference counts', () => {
        const reference = readFileSync(join(root, 'docs/ai/reference.md'), 'utf8').replaceAll('\r', '');
        /** Rows of the tables under every "### <heading>" of the reference, summed (header and separator rows aside). */
        const rows = (heading: string) =>
          reference
            .split(/\n(?=### )/)
            .filter((s) => s.startsWith(`### ${heading}\n`))
            .reduce((n, s) => n + s.split('\n').filter((l) => l.startsWith('|')).length - 2, 0);
        const modules = reference.split(/\n(?=## )/).find((s) => s.startsWith('## Modules\n'))!;
        const counted = {
          modules: modules.split('\n').filter((l) => l.startsWith('|')).length - 2,
          permissions: rows('Permissions'),
          roles: rows('Roles'),
          events: rows('Events emitted'),
          aiTools: rows('AI tools'),
          notifications: rows('Notifications'),
          areas: c.areas.length,
          languages: 3,
        };
        for (const stat of c.overview.stats)
          expect(
            stat.value,
            `${stat.key}: after changing a manifest, run pnpm docs:reference and update the tour's numbers`,
          ).toBe(counted[stat.key]);
      });
    });
  }
});
