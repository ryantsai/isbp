import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '../lib/utils';

/** Only web links, in-app paths, anchors and mail links survive; anything else (javascript:, data:) is dropped. */
export function safeUrl(url: string): string {
  const u = url.trim();
  if (/^(https?:|mailto:)/i.test(u) || u.startsWith('/') || u.startsWith('#')) return u;
  return '';
}

const components: Components = {
  a: ({ href, children, ...props }) => {
    const external = !!href && /^https?:/i.test(href);
    return (
      <a
        {...props}
        href={href}
        className="font-medium text-primary underline underline-offset-4 hover:no-underline"
        {...(external ? { target: '_blank', rel: 'noopener noreferrer nofollow' } : {})}
      >
        {children}
      </a>
    );
  },
  table: ({ children }) => (
    <div className="my-4 w-full overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b bg-muted/50 px-3 py-2 text-left font-medium">{children}</th>,
  td: ({ children }) => <td className="border-b px-3 py-2 align-top last:border-b-0">{children}</td>,
  // Never render images from arbitrary hosts inline (tracking pixels); show them as links instead.
  img: ({ src, alt }) =>
    typeof src === 'string' && safeUrl(src) ? (
      <a
        href={safeUrl(src)}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="text-primary underline"
      >
        {alt || src}
      </a>
    ) : null,
};

/**
 * Renders user-authored Markdown (GitHub flavour) safely: raw HTML is never rendered (react-markdown
 * escapes it), URLs are restricted to http(s)/mailto/relative, and images become links.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div
      className={cn(
        'max-w-none text-sm leading-relaxed wrap-anywhere text-foreground',
        '[&_h1]:mt-6 [&_h1]:mb-3 [&_h1]:text-xl [&_h1]:font-semibold',
        '[&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold',
        '[&_h3]:mt-5 [&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-semibold',
        '[&_p]:my-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6',
        '[&_li]:my-1 [&_li>p]:my-1 [&_blockquote]:my-4 [&_blockquote]:border-l-2 [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground',
        '[&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em]',
        '[&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-4 [&_pre_code]:bg-transparent [&_pre_code]:p-0',
        '[&_hr]:my-6 [&_hr]:border-border [&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} urlTransform={safeUrl}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
