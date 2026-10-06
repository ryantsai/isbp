import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { clientGrants, generateSecret, ipAllowed, ROLE_QUERY_PERMISSION } from '../../src/kernel/api-clients';
import {
  type OutboundMessage,
  renderEmail,
  slackPayload,
  teamsPayload,
  webhookSignature,
} from '../../src/kernel/notifications/channels';
import { notificationKey, renderNotification } from '../../src/kernel/notifications/render';
import { resolveChannels } from '../../src/kernel/notifications/service';
import { coreManifest } from '../../src/core/manifest';
import { PermissionSet } from '@isbp/sdk';

const message: OutboundMessage = {
  type: 'core.approval.assigned',
  title: 'Approval needed: <b>REQ-01042</b>',
  body: 'Line one\n\nLine & two',
  url: 'https://isbp.example/approvals',
  productName: 'IS Big Platform',
  locale: 'en',
};

describe('notification rendering', () => {
  it('maps types to catalog keys by convention', () => {
    expect(notificationKey('core.access-request.approved')).toEqual({
      moduleId: 'core',
      key: 'notifications.access_request_approved',
    });
    expect(notificationKey('announcements.post.published')).toEqual({
      moduleId: 'announcements',
      key: 'notifications.post_published',
    });
  });

  it('renders in the recipient language with ICU, dates in their time zone and localized params', async () => {
    const params = {
      reference: 'REQ-01042',
      role: 'AP clerk',
      permanent: 'no',
      expiresAt: new Date('2026-12-31T16:30:00Z'),
    };
    const en = await renderNotification('core.access-request.approved', params, {
      locale: 'en',
      timezone: 'Asia/Taipei',
    });
    expect(en.title).toBe('Approved: AP clerk (REQ-01042)');
    expect(en.body).toContain('2027');
    const zh = await renderNotification('core.access-request.approved', params, {
      locale: 'zh-TW',
      timezone: 'Asia/Taipei',
    });
    expect(zh.title).toBe('已核准：AP clerk（REQ-01042）');
    const ja = await renderNotification(
      'core.approval.assigned',
      { requester: '佐藤', subject: 'REQ-1', step: { en: 'Manager approval', 'ja-JP': '上長の承認' } },
      { locale: 'ja-JP' },
    );
    expect(ja.body).toContain('上長の承認');
  });

  it('falls back to the type when a module has no text', async () => {
    expect((await renderNotification('nope.thing.happened', {}, { locale: 'en' })).title).toBe(
      'nope.thing.happened',
    );
  });
});

describe('notification channels', () => {
  it('resolves personal channels from defaults, preferences and mandatory flags', () => {
    const def = { type: 'core.x.y', defaultChannels: ['inApp', 'email'] as ('inApp' | 'email')[] };
    expect(resolveChannels(def, undefined, true)).toEqual({ inApp: true, email: true });
    expect(resolveChannels(def, { inApp: false, email: true }, true)).toEqual({ inApp: false, email: true });
    expect(resolveChannels(def, undefined, false)).toEqual({ inApp: true, email: false });
    expect(resolveChannels({ ...def, mandatory: true }, { inApp: false, email: false }, true)).toEqual({
      inApp: true,
      email: true,
    });
  });

  it('builds Teams adaptive cards and Slack blocks with an open button', () => {
    const teams = JSON.stringify(teamsPayload(message));
    expect(teams).toContain('AdaptiveCard');
    expect(teams).toContain('https://isbp.example/approvals');
    const slack = slackPayload(message);
    expect(JSON.stringify(slack)).toContain('&lt;b&gt;REQ-01042&lt;/b&gt;');
  });

  it('signs generic webhooks so receivers can verify them', () => {
    const body = '{"a":1}';
    const sig = webhookSignature('whsec_test', body, 1_700_000_000_000);
    const [t, v1] = sig.split(',').map((p) => p.split('=')[1]);
    expect(t).toBe('1700000000');
    expect(v1).toBe(createHmac('sha256', 'whsec_test').update(`${t}.${body}`).digest('hex'));
  });

  it('escapes email HTML and keeps a text part', () => {
    const { html, text } = renderEmail(message, 'https://isbp.example/settings#notifications');
    expect(html).not.toContain('<b>REQ');
    expect(html).toContain('&lt;b&gt;REQ-01042&lt;/b&gt;');
    expect(html).toContain('Line &amp; two');
    expect(text).toContain('Open: https://isbp.example/approvals');
  });
});

describe('API client credentials', () => {
  it('generates prefixed high-entropy secrets stored as hashes', () => {
    const a = generateSecret();
    const b = generateSecret();
    expect(a.secret).toMatch(/^isbp_sk_[A-Za-z0-9_-]{43}$/);
    expect(a.hash).toHaveLength(64);
    expect(a.secret).not.toBe(b.secret);
    expect(a.secret.startsWith(a.prefix)).toBe(true);
  });

  it('turns a client into record-scoped Role Query grants plus its platform permissions', () => {
    const grants = clientGrants({
      applicationIds: ['app-1'],
      allApplications: false,
      permissions: ['core.users.read'],
    });
    const set = new PermissionSet(grants);
    expect(set.can(ROLE_QUERY_PERMISSION, { recordType: 'application', recordId: 'app-1' })).toBe(true);
    expect(set.can(ROLE_QUERY_PERMISSION, { recordType: 'application', recordId: 'app-2' })).toBe(false);
    expect(set.can('core.users.read')).toBe(true);
    const narrow = new PermissionSet(
      clientGrants({ applicationIds: [], allApplications: true, permissions: ['core.users.read'] }, [
        'role-query',
      ]),
    );
    expect(narrow.can(ROLE_QUERY_PERMISSION, { recordType: 'application', recordId: 'any' })).toBe(true);
    expect(narrow.can('core.users.read')).toBe(false);
  });

  it('checks IP allow-lists (IPv4, IPv6, mapped addresses)', () => {
    expect(ipAllowed([], '1.2.3.4')).toBe(true);
    expect(ipAllowed(['10.0.0.0/8'], '10.20.30.40')).toBe(true);
    expect(ipAllowed(['10.0.0.0/8'], '::ffff:10.1.1.1')).toBe(true);
    expect(ipAllowed(['10.0.0.0/8'], '192.168.1.1')).toBe(false);
    expect(ipAllowed(['2001:db8::/32'], '2001:db8::1')).toBe(true);
    expect(ipAllowed(['203.0.113.7'], '203.0.113.7')).toBe(true);
  });
});

describe('core manifest', () => {
  it('declares a valid default access-request workflow and notification types with catalog text', async () => {
    const trigger = coreManifest.workflows!.find((w) => w.key === 'core.access-request')!;
    expect(trigger.required).toBe(true);
    expect(trigger.defaultGraph!.steps.map((s) => s.id)).toEqual(['manager', 'security', 'owner']);
    for (const n of coreManifest.notifications!) {
      const { title } = await renderNotification(n.type, {}, { locale: 'en' });
      expect(title, n.type).not.toBe(n.type);
    }
  });
});
