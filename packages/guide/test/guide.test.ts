import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { guideHeadings } from '../../create-module/src/guide';
import { GUIDE_LOCALES, GUIDES, guideArticles } from '../src';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const guidePath = (locale: string, file: string) => join(root, 'docs/guide', locale, file);
const read = (locale: string, file: string) => readFileSync(guidePath(locale, file), 'utf8');

/** Levels of the `## ` and `### ` headings, which translations keep in the same order. */
const headings = (md: string) =>
  guideHeadings(md)
    .filter((h) => h.level === 2 || h.level === 3)
    .map((h) => h.level);

describe('the user guide', () => {
  it('has every guide in every language', () => {
    const missing = GUIDE_LOCALES.flatMap((l) =>
      GUIDES.filter((g) => !existsSync(guidePath(l, g.file))).map((g) => `${l}/${g.file}`),
    );
    expect(missing).toEqual([]);
  });

  it('keeps the same sections in every language', () => {
    for (const g of GUIDES) {
      if (!existsSync(guidePath('en', g.file))) continue;
      const en = headings(read('en', g.file));
      for (const l of GUIDE_LOCALES.slice(1)) {
        if (!existsSync(guidePath(l, g.file))) continue;
        expect(headings(read(l, g.file)), `${l}/${g.file}`).toEqual(en);
      }
    }
  });

  it('links only to guides and screenshots that exist', () => {
    const broken: string[] = [];
    for (const l of GUIDE_LOCALES)
      for (const g of GUIDES) {
        if (!existsSync(guidePath(l, g.file))) continue;
        const md = read(l, g.file).replace(/```[\s\S]*?```/g, '');
        for (const [, image] of md.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
          if (!image!.startsWith(`../../../apps/web/public/help/${l}/`))
            broken.push(`${l}/${g.file}: ${image}`);
          else if (!existsSync(join(dirname(guidePath(l, g.file)), image!)))
            broken.push(`${l}/${g.file}: ${image}`);
        }
        for (const [, target] of md.matchAll(/(?<!!)\[[^\]]+\]\(([^)\s]+)\)/g)) {
          if (/^(https?:|mailto:|\/)/.test(target!)) continue;
          const [file, anchor] = target!.split('#') as [string, string | undefined];
          const path = join(dirname(guidePath(l, g.file)), file || g.file);
          if (!existsSync(path)) broken.push(`${l}/${g.file}: ${target}`);
          // Anchors must name a heading of the target (in a translation: of the translated target).
          else if (anchor && path.endsWith('.md')) {
            if (!guideHeadings(readFileSync(path, 'utf8')).some((h) => h.anchor === anchor))
              broken.push(`${l}/${g.file}: ${target}`);
          }
        }
      }
    expect(broken).toEqual([]);
  });

  it('embeds every guide for the knowledge base, with in-app links and image paths', () => {
    expect(guideArticles.length).toBeGreaterThan(0);
    for (const a of guideArticles) {
      expect(a.title, `${a.locale}/${a.file}`).not.toBe('');
      expect(a.body).not.toMatch(/\]\(\.\.\/\.\.\/\.\.\/apps\//);
      expect(a.body).not.toMatch(/\]\([a-z-]+\.md/);
    }
  });
});
