'use client';

import { useLocale } from 'next-intl';
import { useEffect, useState } from 'react';
import { useCanHelp } from '@/components/shell/help-link';
import { AreaChapter } from './area-chapter';
import { AiSection, SecuritySection } from './ai-security';
import { ArchitectureSection } from './architecture';
import { getTourContent } from './content';
import { Hero } from './hero';
import { JourneysSection } from './journeys';
import { Overview } from './overview';
import { SectionHead } from './parts';
import { Closing, StartSection } from './start';
import { TourNav } from './tour-nav';

/** The section that is crossing the middle of the screen (for the bar at the top). */
function useActiveSection(ids: string[]) {
  const [active, setActive] = useState(ids[0] ?? '');
  const key = ids.join('|');
  useEffect(() => {
    const els = key
      .split('|')
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) setActive(entry.target.id);
      },
      { rootMargin: '-45% 0px -50% 0px' },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [key]);
  return active;
}

/**
 * The animated product tour (Phase 12): a long page that walks through the twelve functional areas with the real
 * screens of the demo, the architecture, the AI gateway, the security model and four end-to-end stories. Its words
 * live in `content/<locale>.ts`; until another language has a file, everyone reads Traditional Chinese.
 */
export function TourPage() {
  const locale = useLocale();
  const content = getTourContent(locale);
  const canHelp = useCanHelp();
  const active = useActiveSection(content.sections.map((s) => s.id));
  // The screenshots of a language the tour is not written in are the content's own language.
  const shotLocale = content.locale;
  return (
    <div className="tour" lang="zh-Hant-TW" id="tour-root">
      <a className="tour-skip" href="#overview">
        {content.chrome.skip}
      </a>
      <TourNav content={content} active={active} />
      <main>
        <Hero content={content} locale={shotLocale} canHelp={canHelp} />
        <Overview content={content} />
        <section id="areas" className="tour-section tour-areas" aria-labelledby="areas-title">
          <div className="tour-wrap">
            <SectionHead id="areas-title" title={content.areasIntro.title} lead={content.areasIntro.lead} />
          </div>
          {content.areas.map((area, i) => (
            <AreaChapter
              key={area.id}
              area={area}
              index={i}
              total={content.areas.length}
              content={content}
              locale={shotLocale}
              canHelp={canHelp}
            />
          ))}
        </section>
        <ArchitectureSection content={content} locale={shotLocale} />
        <AiSection content={content} locale={shotLocale} />
        <SecuritySection content={content} locale={shotLocale} />
        <JourneysSection content={content} locale={shotLocale} canHelp={canHelp} />
        <StartSection content={content} locale={shotLocale} canHelp={canHelp} />
        <Closing content={content} canHelp={canHelp} />
      </main>
    </div>
  );
}
