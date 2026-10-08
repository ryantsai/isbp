'use client';

import { UserAvatar } from '@isbp/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@isbp/ui/dropdown-menu';
import { usePlatform } from '@isbp/sdk/web';
import { guideHref } from '@isbp/guide/meta';
import { BookOpenIcon, LifeBuoyIcon, LogOutIcon, UserCogIcon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useSignOut } from './use-sign-out';

export function UserMenu() {
  const t = useTranslations('shell');
  const { user, enabledModules, permissions } = usePlatform();
  const help = enabledModules.includes('knowledge') && permissions.hasAny('knowledge.articles.read');
  const signOut = useSignOut();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex items-center gap-2 rounded-full p-0.5 outline-none transition-shadow focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:ring-2 data-[state=open]:ring-primary/30"
        aria-label={user.displayName}
      >
        <UserAvatar name={user.displayName} src={user.avatarUrl} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex items-center gap-3 py-2 font-normal">
          <UserAvatar name={user.displayName} src={user.avatarUrl} className="size-9" />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground">{user.displayName}</div>
            <div className="truncate text-xs text-muted-foreground">{user.email}</div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <UserCogIcon /> {t('profile')}
          </Link>
        </DropdownMenuItem>
        {help && (
          <DropdownMenuItem asChild>
            <Link href={guideHref('start-here')}>
              <LifeBuoyIcon /> {t('help')}
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <a href="/api/docs" target="_blank" rel="noreferrer">
            <BookOpenIcon /> {t('apiDocs')}
          </a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => void signOut()}>
          <LogOutIcon /> {t('signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
