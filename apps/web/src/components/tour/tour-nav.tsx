'use client';

import { Button } from '@astryxdesign/core/Button';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { ArrowLeftIcon, ListIcon } from 'lucide-react';
import { motion, useScroll, useSpring } from 'motion/react';
import { BrandMark } from '@/components/shell/brand';
import type { TourContent } from './content';
import { tourIcons } from './icons';

/**
 * The bar that stays on top: where you are in the tour (a thin progress line and the current chapter), a menu of
 * the twelve areas, and the way back to the product. Below `lg` the chapters fold into one menu.
 */
export function TourNav({ content, active }: { content: TourContent; active: string }) {
  const { chrome, sections, areas } = content;
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 220, damping: 40, mass: 0.4 });
  const areaItems = areas.map((a) => ({ label: a.nav, icon: tourIcons[a.icon], href: `#${a.id}` }));
  return (
    <header className="tour-nav">
      <div className="tour-wrap tour-nav-inner">
        <a href="#top" className="tour-nav-brand" aria-label={`${chrome.brand} · ${content.meta.title}`}>
          <BrandMark className="size-7" />
          <Text weight="semibold" maxLines={1}>
            {chrome.brand}
          </Text>
        </a>
        <nav className="tour-nav-links" aria-label={content.meta.title}>
          {sections.map((s) =>
            s.id === 'areas' ? (
              <DropdownMenu
                key={s.id}
                placement="below"
                alignment="start"
                menuWidth={220}
                menuMaxHeight={520}
                button={{
                  label: chrome.menuAreas,
                  variant: active === 'areas' ? 'secondary' : 'ghost',
                  size: 'sm',
                }}
                items={areaItems}
              />
            ) : (
              <Button
                key={s.id}
                variant={active === s.id ? 'secondary' : 'ghost'}
                size="sm"
                label={s.nav}
                href={`#${s.id}`}
                aria-current={active === s.id ? 'location' : undefined}
              />
            ),
          )}
        </nav>
        <HStack gap={2} vAlign="center" align="center" className="tour-nav-end">
          <span className="tour-nav-menu">
            <DropdownMenu
              placement="below"
              alignment="end"
              menuWidth={240}
              menuMaxHeight={520}
              hasChevron={false}
              renderTrigger={(props) => (
                <Button
                  {...props}
                  variant="ghost"
                  size="sm"
                  isIconOnly
                  label={content.meta.title}
                  icon={<Icon icon={ListIcon} />}
                />
              )}
              items={[
                ...sections.filter((s) => s.id !== 'areas').map((s) => ({ label: s.nav, href: `#${s.id}` })),
                ...areaItems,
              ]}
            />
          </span>
          <Button
            variant="secondary"
            size="sm"
            label={chrome.back}
            href="/"
            icon={<Icon icon={ArrowLeftIcon} />}
          />
        </HStack>
      </div>
      <motion.div className="tour-nav-progress" style={{ scaleX }} role="presentation" aria-hidden />
    </header>
  );
}
