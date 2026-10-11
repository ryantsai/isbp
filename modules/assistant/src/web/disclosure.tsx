'use client';

import { Collapsible } from '@astryxdesign/core/Collapsible';
import { Divider } from '@astryxdesign/core/Divider';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import type { LucideIcon } from 'lucide-react';
import { Component, type ReactNode } from 'react';

/**
 * A titled section that opens and closes: the Astryx `Collapsible` (a button with `aria-expanded` controlling its
 * content), whose content is a labelled region.
 */
export function Disclosure({
  title,
  icon,
  meta,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon?: LucideIcon;
  meta?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <section>
      <Divider />
      <div className="px-4">
        <Collapsible
          defaultIsOpen={defaultOpen}
          trigger={
            <HStack gap={2} vAlign="center">
              {icon && <Icon icon={icon} color="secondary" />}
              <Text weight="medium">{title}</Text>
              {meta}
            </HStack>
          }
        >
          <div role="region" aria-label={title} className="min-w-0 pb-4">
            {children}
          </div>
        </Collapsible>
      </div>
    </section>
  );
}

/** Keeps a module's preview from taking the whole change set page down when it can't render a value. */
export class PreviewBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
