'use client';

import { Link } from '@astryxdesign/core/Link';
import { Markdown as AstryxMarkdown } from '@astryxdesign/core/Markdown';
import { useOutlineFromMarkdown } from '@astryxdesign/core/Outline';
import { Heading } from '@astryxdesign/core/Text';
import { type ComponentProps, useMemo } from 'react';
import { createSlugger } from '../lib/slug';
import { cn } from '../lib/utils';

/** Screenshots of the user guide, served by the web app itself: the only images rendered inline. */
const HELP_IMAGES = '/help/';

/** Only web links, in-app paths, anchors and mail links survive; anything else (javascript:, data:) is dropped. */
export function safeUrl(url: string): string {
  const u = url.trim();
  if (/^(https?:|mailto:)/i.test(u) || u.startsWith('/') || u.startsWith('#')) return u;
  return '';
}

type Components = NonNullable<ComponentProps<typeof AstryxMarkdown>['components']>;

const components: Components = {
  // Web links leave the app in a new tab and tell crawlers not to follow them.
  link: ({ href, children }) =>
    /^https?:/i.test(href) ? (
      <Link href={href} target="_blank" rel="nofollow">
        {children}
      </Link>
    ) : (
      <Link href={href}>{children}</Link>
    ),
  // Never render images from arbitrary hosts inline (tracking pixels); show them as links instead. The guide's own
  // screenshots (same origin) are the exception.
  image: ({ src, alt }) =>
    src.startsWith(HELP_IMAGES) && !src.includes('..') ? (
      <Link href={src} target="_blank" label={alt || undefined}>
        {/* eslint-disable-next-line @next/next/no-img-element -- static screenshot, sized by the article column */}
        <img
          src={src}
          alt={alt}
          loading="lazy"
          className="my-4 block h-auto max-w-full rounded-(--radius-container) border border-(--color-border)"
        />
      </Link>
    ) : safeUrl(src) ? (
      <Link href={safeUrl(src)} target="_blank" rel="nofollow">
        {alt || src}
      </Link>
    ) : null,
};

/** Markdown whose headings carry the user guide's anchors (`#raise-a-ticket`, also in Chinese and Japanese). */
function AnchoredMarkdown({ children, className }: { children: string; className?: string }) {
  // Astryx gives each root heading an ASCII id; the guide's links use GitHub-style anchors (every script kept).
  const outline = useOutlineFromMarkdown(children);
  const anchorOf = useMemo(() => {
    const slug = createSlugger();
    return new Map(outline.map((h) => [h.id, slug(h.label)]));
  }, [outline]);
  const withAnchors = useMemo<Components>(
    () => ({
      ...components,
      heading: ({ level, id, children: label }) => (
        <Heading level={level} id={(id && anchorOf.get(id)) || id} className="scroll-mt-20">
          {label}
        </Heading>
      ),
    }),
    [anchorOf],
  );
  return (
    <AstryxMarkdown contentWidth="100%" className={cn('wrap-anywhere', className)} components={withAnchors}>
      {children}
    </AstryxMarkdown>
  );
}

/**
 * Renders user-authored Markdown (GitHub flavour) safely with Astryx `Markdown`: raw HTML is never rendered, URLs are
 * restricted to http(s)/mailto/relative, and images become links (except the guide's screenshots under `/help/`).
 * `anchors` gives headings ids for `#section` links (articles and other long reads).
 */
export function Markdown({
  children,
  className,
  anchors = false,
}: {
  children: string;
  className?: string;
  anchors?: boolean;
}) {
  if (anchors) return <AnchoredMarkdown className={className}>{children}</AnchoredMarkdown>;
  return (
    <AstryxMarkdown contentWidth="100%" className={cn('wrap-anywhere', className)} components={components}>
      {children}
    </AstryxMarkdown>
  );
}
