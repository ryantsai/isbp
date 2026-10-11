'use client';

import type { Me } from '@isbp/contracts';
import type { Page } from '@isbp/sdk';
import { cn } from '@isbp/ui';
import { Stagger, StaggerItem } from '@isbp/ui/motion';
import { PageHeader } from '@isbp/ui/page-header';
import {
  BellIcon,
  KeyRoundIcon,
  LaptopIcon,
  PlaneTakeoffIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  UserRoundIcon,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useApiQuery } from '@/lib/api';
import { AccessCard } from './access-card';
import { NotificationsCard } from './notifications-card';
import { OutOfOfficeCard } from './out-of-office-card';
import { PasswordCard } from './password-card';
import { PreferencesCard } from './preferences-card';
import { ProfileCard } from './profile-card';
import { SessionsCard } from './sessions-card';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';

const SECTIONS = [
  { id: 'profile', nav: 'profile', icon: UserRoundIcon },
  { id: 'preferences', nav: 'preferences', icon: SlidersHorizontalIcon },
  { id: 'notifications', nav: 'notifications', icon: BellIcon },
  { id: 'out-of-office', nav: 'outOfOffice', icon: PlaneTakeoffIcon },
  { id: 'security', nav: 'security', icon: KeyRoundIcon },
  { id: 'sessions', nav: 'sessions', icon: LaptopIcon },
  { id: 'access', nav: 'access', icon: ShieldCheckIcon },
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
  // Out of office only matters to people who approve things (they can hand their approvals over).
  const approvals = useApiQuery<Page<unknown>>('/me/approvals', { status: 'done', pageSize: 1 });
  const pending = useApiQuery<Page<unknown>>('/me/approvals', { status: 'pending', pageSize: 1 });
  const approves = (approvals.data?.total ?? 0) > 0 || (pending.data?.total ?? 0) > 0;

  const mustChange = Boolean(me.data?.mustChangePassword && me.data.authSource === 'local');

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      {mustChange && (
        <div className="mb-4">
          <Banner
            status="warning"
            title={t('password.requiredTitle')}
            description={t('password.requiredBody')}
            endContent={
              <Button label={t('password.requiredAction')} variant="secondary" size="sm" href="#security" />
            }
            collapsible={false}
          />
        </div>
      )}
      <div className="grid gap-5 lg:grid-cols-[11rem_minmax(0,1fr)]">
        <nav aria-label={t('nav.label')} className="hidden lg:block">
          <ul className="sticky top-20 space-y-0.5">
            {SECTIONS.filter(({ id }) => approves || id !== 'out-of-office').map(
              ({ id, nav, icon: Icon }) => (
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
                    <span className="relative">{t(`nav.${nav}`)}</span>
                  </a>
                </li>
              ),
            )}
          </ul>
        </nav>
        <Stagger className="min-w-0 max-w-3xl space-y-5">
          <StaggerItem>
            <ProfileCard me={me.data} />
          </StaggerItem>
          <StaggerItem>
            <PreferencesCard me={me.data} />
          </StaggerItem>
          <StaggerItem>
            <NotificationsCard />
          </StaggerItem>
          <StaggerItem>{approves && <OutOfOfficeCard />}</StaggerItem>
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
