'use client';

import type { IdentityProvider } from '@isbp/contracts';
import { IconTile } from '@isbp/ui/icon-tile';
import { CloudIcon, FolderTreeIcon, KeyRoundIcon, type LucideIcon, ShieldCheckIcon } from 'lucide-react';

/** What the admin picks in step 1: Entra is an OIDC preset. */
export type IdpChoice = 'entra' | 'oidc' | 'saml' | 'ldap';
export const IDP_CHOICES: IdpChoice[] = ['entra', 'oidc', 'saml', 'ldap'];

const META: Record<IdpChoice, { icon: LucideIcon; tone: string }> = {
  entra: { icon: CloudIcon, tone: 'text-info' },
  oidc: { icon: KeyRoundIcon, tone: 'text-primary' },
  saml: { icon: ShieldCheckIcon, tone: 'text-success' },
  ldap: { icon: FolderTreeIcon, tone: 'text-warning-foreground' },
};

export function choiceOf(idp: Pick<IdentityProvider, 'type' | 'config'>): IdpChoice {
  return idp.type === 'oidc' && idp.config.preset === 'entra' ? 'entra' : idp.type;
}

export const typeOfChoice = (choice: IdpChoice) => (choice === 'entra' ? 'oidc' : choice);

/** Coloured icon tile per provider kind (always paired with a text label elsewhere). */
export function IdpTypeTile({ choice, className }: { choice: IdpChoice; className?: string }) {
  const { icon: Icon, tone } = META[choice];
  return (
    <IconTile aria-hidden className={`${tone} ${className ?? ''}`.trim()}>
      <Icon />
    </IconTile>
  );
}
