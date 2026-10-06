'use client';

import type { Me } from '@isbp/contracts';
import { cn } from '@isbp/ui';
import { Stagger, StaggerItem } from '@isbp/ui/motion';
import { PageHeader } from '@isbp/ui/page-header';
import {
  KeyRoundIcon,
  LaptopIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  UserRoundIcon,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useApiQuery } from '@/lib/api';
import { AccessCard } from './access-card';
import { PasswordCard } from './password-card';
import { PreferencesCard } from './preferences-card';
import { ProfileCard } from './profile-card';
import { SessionsCard } from './sessions-card';

const SECTIONS = [
  { id: 'profile', icon: UserRoundIcon },
  { id: 'preferences', icon: SlidersHorizontalIcon },
  { id: 'security', icon: KeyRoundIcon },
  { id: 'sessions', icon: LaptopIcon },
  { id: 'access', icon: ShieldCheckIcon },
] as const;

/** Highlights the section nearest the top of the viewport. */
function useActiveSection() {
  const [active, setActive] = useState<string>(SECTIONS[0].id);
  useEffect(() => {
    const els = SECTIONS.map((s) => document.getElementById(s.id)).filter((el): el is HTMLElement =>
      Boolean(el),
    );
    const observer = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.id);
      },
      { rootMargin: '-72px 0px -55% 0px' },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);
  return active;
}

/** "Profile & preferences" for the signed-in person. */
export function SettingsView() {
  const t = useTranslations('settings');
  const me = useApiQuery<Me>('/me');
  const active = useActiveSection();

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <div className="grid gap-8 lg:grid-cols-[11rem_minmax(0,1fr)]">
        <nav aria-label={t('nav.label')} className="hidden lg:block">
          <ul className="sticky top-20 space-y-0.5">
            {SECTIONS.map(({ id, icon: Icon }) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  aria-current={active === id ? 'true' : undefined}
                  className={cn(
                    'relative flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
                    active === id ? 'font-medium text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {active === id && (
                    <motion.span
                      layoutId="settings-nav-active"
                      className="absolute inset-0 rounded-md bg-accent"
                      transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                    />
                  )}
                  <Icon className="relative size-4" aria-hidden />
                  <span className="relative">{t(`nav.${id}`)}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <Stagger className="min-w-0 max-w-3xl space-y-6">
          <StaggerItem>
            <ProfileCard me={me.data} />
          </StaggerItem>
          <StaggerItem>
            <PreferencesCard me={me.data} />
          </StaggerItem>
          <StaggerItem>
            <PasswordCard me={me.data} loading={me.isLoading} />
          </StaggerItem>
          <StaggerItem>
            <SessionsCard />
          </StaggerItem>
          <StaggerItem>
            <AccessCard />
          </StaggerItem>
        </Stagger>
      </div>
    </>
  );
}
