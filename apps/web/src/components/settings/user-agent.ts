export type DeviceKind = 'desktop' | 'mobile' | 'tablet' | 'cli' | 'unknown';

export interface ParsedAgent {
  /** Product names are not translated (Chrome, Safari, Windows …); `null` when unrecognised. */
  browser: string | null;
  os: string | null;
  kind: DeviceKind;
}

const BROWSERS: [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\b(?:OPR|Opera)\//, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\b(?:Firefox|FxiOS)\//, 'Firefox'],
  [/\b(?:Chrome|CriOS|Chromium)\//, 'Chrome'],
  [/\bVersion\/[\d.]+.*\bSafari\//, 'Safari'],
  [/^curl\//, 'curl'],
  [/^Wget\//, 'Wget'],
  [/^PostmanRuntime\//, 'Postman'],
  [/^(?:python-requests|python-httpx|aiohttp)\//, 'Python'],
  [/^node-fetch|^undici|^axios\//, 'Node.js'],
];

const SYSTEMS: [RegExp, string][] = [
  [/\biPhone\b/, 'iOS'],
  [/\biPad\b/, 'iPadOS'],
  [/\bAndroid\b/, 'Android'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bWindows NT\b/, 'Windows'],
  [/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
  [/\bLinux\b/, 'Linux'],
];

/** Deliberately simple user-agent parsing — enough to recognise "Chrome on macOS". */
export function parseUserAgent(ua: string | null | undefined): ParsedAgent {
  if (!ua) return { browser: null, os: null, kind: 'unknown' };
  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1] ?? null;
  const os = SYSTEMS.find(([re]) => re.test(ua))?.[1] ?? null;
  const cli = /^(?:curl|Wget|PostmanRuntime|python-|node-fetch|undici|axios|aiohttp)/i.test(ua);
  const kind: DeviceKind = cli
    ? 'cli'
    : /\biPad\b|\bTablet\b|Android(?!.*Mobile)/.test(ua)
      ? 'tablet'
      : /\bMobi|\biPhone\b|Android.*Mobile/.test(ua)
        ? 'mobile'
        : browser || os
          ? 'desktop'
          : 'unknown';
  return { browser, os, kind };
}
