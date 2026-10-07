import { createHmac } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import type { ChannelType } from '@isbp/db/schema';
import nodemailer, { type Transporter } from 'nodemailer';

export interface OutboundMessage {
  type: string;
  title: string;
  body: string | null;
  /** Absolute URL to open (PUBLIC_URL + href). */
  url: string | null;
  productName: string;
  locale: string;
}

/* ───────────────────────────── SSRF guard ───────────────────────────── */

// One list per family: BlockList matches IPv4 addresses against IPv6 rules like `::ffff:0:0/96`, so a
// shared list would treat every IPv4 address as private.
const privateV4 = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
] as const)
  privateV4.addSubnet(net, prefix, 'ipv4');
const privateV6 = new BlockList();
for (const [net, prefix] of [
  ['::1', 128],
  ['::', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['::ffff:0:0', 96],
] as const)
  privateV6.addSubnet(net, prefix, 'ipv6');

export const isPrivateAddress = (address: string, family: number) =>
  family === 6 ? privateV6.check(address, 'ipv6') : privateV4.check(address, 'ipv4');

export class WebhookTargetError extends Error {}

/**
 * Rejects webhook URLs that are not HTTPS (HTTP only when private targets are allowed, i.e. dev/test)
 * or that resolve to loopback, link-local or private networks — admins must not be able to make the
 * platform call internal services (SSRF).
 */
export async function assertWebhookTarget(raw: string, allowPrivate: boolean): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new WebhookTargetError('Invalid URL');
  }
  if (url.protocol !== 'https:' && !(allowPrivate && url.protocol === 'http:'))
    throw new WebhookTargetError('Webhook URLs must use https://');
  if (url.username || url.password) throw new WebhookTargetError('Credentials in URLs are not allowed');
  if (allowPrivate) return url;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true });
  for (const a of addresses) {
    if (isPrivateAddress(a.address, a.family))
      throw new WebhookTargetError('Webhook URL resolves to a private network address');
  }
  return url;
}

/* ───────────────────────────── payloads ───────────────────────────── */

const OPEN_LABEL: Record<string, string> = { en: 'Open', 'zh-TW': '開啟', 'ja-JP': '開く' };

export function teamsPayload(m: OutboundMessage) {
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            { type: 'TextBlock', text: m.productName, size: 'Small', isSubtle: true, wrap: true },
            { type: 'TextBlock', text: m.title, weight: 'Bolder', size: 'Medium', wrap: true },
            ...(m.body ? [{ type: 'TextBlock', text: m.body, wrap: true }] : []),
          ],
          actions: m.url
            ? [{ type: 'Action.OpenUrl', title: OPEN_LABEL[m.locale] ?? 'Open', url: m.url }]
            : [],
        },
      },
    ],
  };
}

const slackEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function slackPayload(m: OutboundMessage) {
  return {
    text: m.title,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${slackEscape(m.title)}*${m.body ? `\n${slackEscape(m.body)}` : ''}`,
        },
      },
      ...(m.url
        ? [
            {
              type: 'actions',
              elements: [
                {
                  type: 'button',
                  text: { type: 'plain_text', text: OPEN_LABEL[m.locale] ?? 'Open' },
                  url: m.url,
                },
              ],
            },
          ]
        : []),
      { type: 'context', elements: [{ type: 'mrkdwn', text: slackEscape(m.productName) }] },
    ],
  };
}

export function webhookPayload(m: OutboundMessage) {
  return {
    type: m.type,
    title: m.title,
    body: m.body,
    url: m.url,
    locale: m.locale,
    occurredAt: new Date().toISOString(),
  };
}

/** `t=<unix>,v1=<hex hmac-sha256 of "<t>.<body>">` — receivers recompute it to verify origin and freshness. */
export function webhookSignature(secret: string, body: string, now = Date.now()): string {
  const t = Math.floor(now / 1000);
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}

export async function postWebhook(
  type: ChannelType,
  target: { url: string; signingSecret?: string },
  message: OutboundMessage,
  allowPrivate: boolean,
): Promise<void> {
  const url = await assertWebhookTarget(target.url, allowPrivate);
  const payload =
    type === 'teams'
      ? teamsPayload(message)
      : type === 'slack'
        ? slackPayload(message)
        : webhookPayload(message);
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'user-agent': 'IS-Big-Platform/1.0',
  };
  if (type === 'webhook') {
    headers['x-isbp-event'] = message.type;
    if (target.signingSecret) headers['x-isbp-signature'] = webhookSignature(target.signingSecret, body);
  }
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status < 200 || res.status >= 300) {
    const text = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`Webhook responded ${res.status}${text ? `: ${text}` : ''}`);
  }
}

/* ───────────────────────────── email ───────────────────────────── */

export interface EmailSettings {
  enabled: boolean;
  host: string | null;
  port: number;
  secure: boolean;
  username: string | null;
  password: string | null;
  from: string | null;
}

export type TransportFactory = (s: EmailSettings) => Transporter;

export const smtpTransport: TransportFactory = (s) =>
  nodemailer.createTransport({
    host: s.host ?? undefined,
    port: s.port,
    secure: s.secure,
    requireTLS: !s.secure && s.port !== 25,
    auth: s.username ? { user: s.username, pass: s.password ?? '' } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const FOOTER: Record<string, string> = {
  en: 'You receive this because of your notification preferences.',
  'zh-TW': '您收到此郵件是因為您的通知偏好設定。',
  'ja-JP': '通知設定に基づいてこのメールをお送りしています。',
};
const PREFS: Record<string, string> = {
  en: 'Manage notifications',
  'zh-TW': '管理通知',
  'ja-JP': '通知を管理',
};

/** A small, client-safe HTML email (inline styles, no remote assets) plus a plain-text part. */
export function renderEmail(m: OutboundMessage, preferencesUrl: string | null) {
  const open = OPEN_LABEL[m.locale] ?? 'Open';
  const paragraphs = (m.body ?? '')
    .split(/\n{2,}/)
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 12px;line-height:1.55">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
  const html = `<!doctype html><html lang="${escapeHtml(m.locale)}"><body style="margin:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans TC','Noto Sans JP','Hiragino Sans',sans-serif;color:#1f2430">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e3e5ea">
<tr><td style="padding:20px 28px;border-bottom:1px solid #eceef2;font-size:13px;font-weight:600;color:#4b5263">${escapeHtml(m.productName)}</td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 14px;font-size:19px;line-height:1.35">${escapeHtml(m.title)}</h1>
${paragraphs}
${m.url ? `<p style="margin:22px 0 4px"><a href="${escapeHtml(m.url)}" style="display:inline-block;background:#3b5bdb;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;font-size:14px">${escapeHtml(open)}</a></p>` : ''}
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #eceef2;font-size:12px;color:#6b7280">${escapeHtml(FOOTER[m.locale] ?? FOOTER.en!)}${preferencesUrl ? ` <a href="${escapeHtml(preferencesUrl)}" style="color:#3b5bdb">${escapeHtml(PREFS[m.locale] ?? PREFS.en!)}</a>` : ''}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [m.title, '', m.body ?? '', '', m.url ? `${open}: ${m.url}` : '', '', `— ${m.productName}`]
    .filter((l, i, a) => l !== '' || a[i - 1] !== '')
    .join('\n');
  return { html, text };
}
