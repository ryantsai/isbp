import { readFileSync } from 'node:fs';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  dependencies: Record<string, string>;
};

const config: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  // Workspace packages (incl. every installed module) ship TypeScript source.
  transpilePackages: Object.keys(pkg.dependencies).filter((d) => d.startsWith('@isbp/')),
  outputFileTracingRoot: new URL('../..', import.meta.url).pathname,
  typedRoutes: false,
  experimental: {
    // proxy.ts buffers request bodies it forwards to the API (default 10 MB, then *truncated*). Attachments
    // may be up to 50 MB (the API enforces the configured limit), plus multipart overhead.
    proxyClientMaxBodySize: '52mb',
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
        ],
      },
    ];
  },
};

export default createNextIntlPlugin('./src/i18n/request.ts')(config);
