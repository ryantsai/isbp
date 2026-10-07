/** Pure upload policy helpers (no I/O), shared by the file store, routes and the core manifest. */

/** Executables, scripts and active web content: refused by default (admins can edit the list). */
export const DEFAULT_BLOCKED_EXTENSIONS = [
  'exe',
  'dll',
  'com',
  'bat',
  'cmd',
  'msi',
  'msp',
  'scr',
  'pif',
  'cpl',
  'ps1',
  'psm1',
  'vbs',
  'vbe',
  'js',
  'jse',
  'mjs',
  'wsf',
  'wsh',
  'hta',
  'jar',
  'sh',
  'app',
  'lnk',
  'reg',
  'html',
  'htm',
  'xhtml',
  'svg',
  'php',
  'asp',
  'aspx',
  'jsp',
] as const;

/** Sniffed types refused whatever the file is called. */
export const DANGEROUS_MIME = new Set([
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/vnd.microsoft.portable-executable',
  'application/x-executable',
  'application/x-elf',
  'application/x-mach-binary',
  'application/x-sharedlib',
  'application/x-msi',
  'text/html',
  'image/svg+xml',
  'application/xhtml+xml',
]);

/** Content types for text formats `file-type` can't sniff (served as attachments with `nosniff`). */
export const TEXT_TYPES: Record<string, string> = {
  txt: 'text/plain',
  log: 'text/plain',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  md: 'text/markdown',
  json: 'application/json',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  ics: 'text/calendar',
};

/** Raster images the browser may show inline (`?inline=1`). */
export const PREVIEWABLE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export interface FilePolicy {
  maxBytes: number;
  blockedExtensions: string[];
}

/** Strips paths and control characters; keeps the extension when shortening. */
export function sanitizeFileName(raw: string): string {
  const base = raw.normalize('NFC').split(/[\\/]/).pop() ?? '';
  let name = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '_')
    .replace(/[. ]+$/, '')
    .trim();
  name = name.replace(/^\.+/, '');
  if (!name) return 'file';
  if (name.length <= 200) return name;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 && name.length - dot <= 16 ? name.slice(dot) : '';
  return name.slice(0, 200 - ext.length) + ext;
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** `Content-Disposition` with an ASCII fallback and the UTF-8 name (RFC 6266 / 5987). */
export function contentDisposition(kind: 'attachment' | 'inline', name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  // RFC 5987 attr-chars: encodeURIComponent leaves ' ( ) * ! unescaped.
  const encoded = encodeURIComponent(name).replace(
    /['()*!]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
