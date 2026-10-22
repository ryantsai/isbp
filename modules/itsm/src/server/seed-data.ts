/**
 * Demo content for the ITSM seed: categories, calendars, SLA policies and hand-written tickets that
 * match the CMDB's services, with recurring themes so similar-ticket search and AI triage have signal.
 */
import type { Condition, LocalizedText } from '@isbp/sdk';
import type { ResolutionCode, WorkingHours } from '../contracts';

const t3 = (en: string, zh: string, ja: string): LocalizedText => ({ en, 'zh-TW': zh, 'ja-JP': ja });

export interface CategorySeed {
  key: string;
  name: LocalizedText;
  group: string;
  children?: CategorySeed[];
}

export const CATEGORIES: CategorySeed[] = [
  {
    key: 'hardware',
    name: t3('Hardware', '硬體', 'ハードウェア'),
    group: 'service-desk',
    children: [
      { key: 'hardware-laptop', name: t3('Laptop', '筆電', 'ノート PC'), group: 'service-desk' },
      { key: 'hardware-printer', name: t3('Printer', '印表機', 'プリンター'), group: 'service-desk' },
      {
        key: 'hardware-peripherals',
        name: t3('Monitor & peripherals', '螢幕與周邊設備', 'モニター・周辺機器'),
        group: 'service-desk',
      },
    ],
  },
  {
    key: 'network',
    name: t3('Network', '網路', 'ネットワーク'),
    group: 'network-team',
    children: [
      { key: 'network-vpn', name: t3('VPN', 'VPN', 'VPN'), group: 'network-team' },
      { key: 'network-wifi', name: t3('Wi-Fi', '無線網路', 'Wi-Fi'), group: 'network-team' },
      {
        key: 'network-wired',
        name: t3('Wired network', '有線網路', '有線ネットワーク'),
        group: 'network-team',
      },
    ],
  },
  {
    key: 'collaboration',
    name: t3('Email & collaboration', '電子郵件與協作', 'メール・コラボレーション'),
    group: 'it-admins',
    children: [
      { key: 'collaboration-outlook', name: t3('Outlook', 'Outlook', 'Outlook'), group: 'it-admins' },
      {
        key: 'collaboration-teams',
        name: t3('Teams & meetings', 'Teams 與會議', 'Teams・会議'),
        group: 'it-admins',
      },
    ],
  },
  {
    key: 'accounts',
    name: t3('Accounts & access', '帳號與存取權', 'アカウント・アクセス'),
    group: 'service-desk',
    children: [
      {
        key: 'accounts-password',
        name: t3('Password & MFA', '密碼與多重要素驗證', 'パスワード・MFA'),
        group: 'service-desk',
      },
      {
        key: 'accounts-access',
        name: t3('Access request', '存取權申請', 'アクセス申請'),
        group: 'security-team',
      },
    ],
  },
  {
    key: 'software',
    name: t3('Software', '軟體', 'ソフトウェア'),
    group: 'service-desk',
    children: [
      { key: 'software-install', name: t3('Installation', '安裝', 'インストール'), group: 'service-desk' },
      { key: 'software-license', name: t3('License', '授權', 'ライセンス'), group: 'service-desk' },
      {
        key: 'software-error',
        name: t3('Crash or error', '當機或錯誤', 'クラッシュ・エラー'),
        group: 'service-desk',
      },
    ],
  },
  {
    key: 'business-apps',
    name: t3('Business applications', '業務應用系統', '業務アプリケーション'),
    group: 'it-admins',
    children: [
      { key: 'business-apps-erp', name: t3('Finance ERP', '財務 ERP', '財務 ERP'), group: 'dba-team' },
      { key: 'business-apps-hr', name: t3('HR Portal', '人資入口網站', '人事ポータル'), group: 'it-admins' },
    ],
  },
  {
    key: 'security',
    name: t3('Security', '資訊安全', 'セキュリティ'),
    group: 'security-team',
    children: [
      { key: 'security-phishing', name: t3('Phishing', '網路釣魚', 'フィッシング'), group: 'security-team' },
      { key: 'security-malware', name: t3('Malware', '惡意程式', 'マルウェア'), group: 'security-team' },
    ],
  },
  { key: 'other', name: t3('Other', '其他', 'その他'), group: 'service-desk' },
];

const weekdays = (start: string, end: string): WorkingHours => ({
  days: [[], [{ start, end }], [{ start, end }], [{ start, end }], [{ start, end }], [{ start, end }], []],
});

export const TAIPEI_HOURS = weekdays('09:00', '18:00');
export const ALWAYS: WorkingHours = { days: [[], [], [], [], [], [], []] };

/** 2026 public holidays in Taiwan (observed weekdays). */
export const TAIWAN_HOLIDAYS_2026 = [
  { date: '2026-01-01', name: 'New Year’s Day' },
  { date: '2026-02-16', name: 'Lunar New Year’s Eve' },
  { date: '2026-02-17', name: 'Lunar New Year' },
  { date: '2026-02-18', name: 'Lunar New Year' },
  { date: '2026-02-19', name: 'Lunar New Year' },
  { date: '2026-02-20', name: 'Lunar New Year (bridge)' },
  { date: '2026-02-27', name: 'Peace Memorial Day (observed)' },
  { date: '2026-04-03', name: 'Children’s Day (observed)' },
  { date: '2026-04-06', name: 'Tomb Sweeping Day (observed)' },
  { date: '2026-05-01', name: 'Labour Day' },
  { date: '2026-06-19', name: 'Dragon Boat Festival' },
  { date: '2026-09-25', name: 'Mid-Autumn Festival' },
  { date: '2026-09-28', name: 'Teachers’ Day' },
  { date: '2026-10-09', name: 'National Day (observed)' },
  { date: '2026-10-26', name: 'Taiwan Retrocession Day (observed)' },
  { date: '2026-12-25', name: 'Constitution Day' },
];

const same = (responseMinutes: number, resolutionMinutes: number) => ({ responseMinutes, resolutionMinutes });
const p1: Condition = { fact: 'ticket.priority', op: 'eq', value: 1 };

export const POLICIES = [
  {
    name: 'Critical incidents (24×7)',
    label: t3('Critical incidents (24×7)', '重大事件（24×7）', '重大インシデント (24×7)'),
    description: 'P1 incidents are worked around the clock.',
    ticketTypes: ['incident' as const],
    condition: p1,
    targets: { '1': same(15, 240), '2': same(15, 240), '3': same(15, 240), '4': same(15, 240) },
    calendar: '24x7',
    pauseStatuses: [],
    warnAt: 0.75,
    sortOrder: 10,
  },
  {
    name: 'Incidents',
    label: t3('Incidents', '事件', 'インシデント'),
    description: 'Business-hours targets by priority; the clock stops while a ticket is on hold.',
    ticketTypes: ['incident' as const],
    condition: null,
    targets: { '1': same(30, 240), '2': same(60, 480), '3': same(240, 1440), '4': same(480, 2400) },
    calendar: 'taipei',
    pauseStatuses: ['on_hold' as const],
    warnAt: 0.75,
    sortOrder: 20,
  },
  {
    name: 'Service requests',
    label: t3('Service requests', '服務請求', 'サービス要求'),
    description: 'Four business hours to respond, three business days to fulfil.',
    ticketTypes: ['service_request' as const],
    condition: null,
    targets: { '1': same(240, 1620), '2': same(240, 1620), '3': same(240, 1620), '4': same(240, 1620) },
    calendar: 'taipei',
    pauseStatuses: ['on_hold' as const, 'pending_approval' as const],
    warnAt: 0.8,
    sortOrder: 30,
  },
];

export const CATALOG = [
  {
    formKey: 'equipment-request',
    category: 'hardware-peripherals',
    group: 'service-desk',
    priority: 3,
    fulfilOn: 'approved' as const,
  },
  {
    formKey: 'software-request',
    category: 'software-install',
    group: 'service-desk',
    priority: 3,
    fulfilOn: 'approved' as const,
  },
  {
    formKey: 'lost-device',
    category: 'security',
    group: 'service-desk',
    priority: 2,
    fulfilOn: 'submitted' as const,
  },
];

/* ───────────────────────────── tickets ───────────────────────────── */

export type SeedLocale = 'en' | 'zh-TW' | 'ja-JP';

export interface TicketTemplate {
  type: 'incident' | 'service_request';
  category: string;
  cis?: string[];
  locale?: SeedLocale;
  title: string;
  description: string;
  resolution: string;
  code?: ResolutionCode;
  impact?: number;
  urgency?: number;
  /** Incidents caused by a seeded problem. */
  problem?: 'vpn-macos' | 'erp-timeouts' | 'outlook-large' | 'wifi-roaming';
  /** How many tickets to raise from this template. */
  times?: number;
}

const VPN = ['Remote Access (VPN)', 'vpn-gw-01'];

export const TEMPLATES: TicketTemplate[] = [
  // ── VPN (recurring) ──
  {
    type: 'incident',
    category: 'network-vpn',
    cis: VPN,
    title: 'VPN client crashes as soon as I connect (macOS)',
    description:
      'Since updating to VPN client 5.2 on my MacBook (macOS 15), the client quits a few seconds after I click Connect. Reinstalling did not help. I can only work from the office at the moment.',
    resolution:
      'Known issue with VPN client 5.2 on macOS 15 (PRB). Rolled the client back to 5.1.8 from Self Service and disabled auto-update; connection is stable again.',
    code: 'workaround',
    urgency: 1,
    problem: 'vpn-macos',
    times: 5,
  },
  {
    type: 'incident',
    category: 'network-vpn',
    cis: VPN,
    title: 'VPN keeps disconnecting every few minutes',
    description:
      'Working from home today and the VPN drops every 5–10 minutes. Each time I have to sign in again with MFA. My home internet is fine (video calls without VPN work). MacBook Pro, client version 5.2.',
    resolution:
      'Matched the VPN 5.2 / macOS 15 known error. Downgraded to 5.1.8 and the tunnel has been stable for a full day.',
    code: 'workaround',
    problem: 'vpn-macos',
    times: 3,
  },
  {
    type: 'incident',
    category: 'network-vpn',
    cis: VPN,
    title: 'VPN disconnects during Teams calls',
    description:
      'Every time I share my screen in a Teams call over VPN, the VPN drops and the call freezes. Happens on Windows 11 with the latest client.',
    resolution:
      'Enabled split tunnelling for Microsoft 365 media traffic on the VPN profile; Teams calls no longer go through the tunnel and the connection is stable.',
    times: 2,
  },
  {
    type: 'incident',
    category: 'network-vpn',
    cis: VPN,
    locale: 'zh-TW',
    title: 'VPN 一直斷線，無法連回公司',
    description:
      '在家工作時 VPN 每隔幾分鐘就斷線，重新連線後又要再做一次 MFA 驗證。家裡網路正常，其他網站都可以開。',
    resolution: '已將 VPN 用戶端降版為 5.1.8 並關閉自動更新，使用者確認連線穩定。',
    code: 'workaround',
    problem: 'vpn-macos',
  },
  {
    type: 'incident',
    category: 'network-vpn',
    cis: VPN,
    locale: 'ja-JP',
    title: 'VPN が頻繁に切断される',
    description:
      '自宅から VPN に接続すると 10 分ほどで切断されます。再接続のたびに MFA が必要で作業になりません。',
    resolution: 'VPN クライアント 5.2 の既知の問題でした。5.1.8 に戻し、接続が安定したことを確認しました。',
    code: 'workaround',
  },
  {
    type: 'incident',
    category: 'network-vpn',
    cis: VPN,
    title: "Can't connect to VPN from hotel Wi-Fi: 'gateway unreachable'",
    description:
      'On a business trip in Osaka. The VPN client says "gateway unreachable" on the hotel Wi-Fi. Mobile hotspot works.',
    resolution:
      'The hotel network blocks UDP 4501. Switched the user to the TCP/443 fallback profile, which connects from restrictive networks.',
    code: 'workaround',
  },
  // ── Passwords & MFA (recurring) ──
  {
    type: 'incident',
    category: 'accounts-password',
    cis: ['Single Sign-On'],
    title: 'Account locked after password change',
    description:
      'I changed my password this morning and now my account is locked. I think my phone still has the old password for email.',
    resolution:
      'Unlocked the account and removed the old password from the phone’s mail profile; the stale device was causing the lockouts.',
    urgency: 1,
    times: 4,
  },
  {
    type: 'incident',
    category: 'accounts-password',
    cis: ['Single Sign-On'],
    title: 'MFA prompts not arriving on my new phone',
    description:
      'I moved to a new phone over the weekend. The authenticator app is installed but push notifications never arrive, so I cannot sign in to anything.',
    resolution:
      'Reset the MFA registration after verifying identity by video call; the user re-enrolled the authenticator on the new phone.',
    urgency: 1,
    times: 3,
  },
  {
    type: 'incident',
    category: 'accounts-password',
    cis: ['Single Sign-On'],
    locale: 'zh-TW',
    title: '密碼過期後無法登入',
    description: '今天早上顯示密碼已過期，修改後還是無法登入電腦和 Email，一直顯示帳號或密碼錯誤。',
    resolution: '協助使用者在網域內重設密碼並更新快取的認證資訊，已可正常登入。',
    urgency: 1,
  },
  {
    type: 'incident',
    category: 'accounts-password',
    cis: ['Single Sign-On'],
    locale: 'ja-JP',
    title: 'MFA の再登録が必要です',
    description: 'スマートフォンを機種変更したため、認証アプリが使えずサインインできません。',
    resolution: '本人確認の上で MFA 登録をリセットし、新しい端末で再登録していただきました。',
    urgency: 1,
  },
  // ── Printers (recurring) ──
  {
    type: 'incident',
    category: 'hardware-printer',
    cis: ['Printing', 'print-srv-01'],
    title: 'Printer on 5F shows offline',
    description:
      'The big multifunction printer next to the 5F pantry shows as offline for everyone on our team.',
    resolution:
      'The printer had lost its DHCP reservation after a firmware update. Re-applied the reservation and restarted it.',
    times: 3,
  },
  {
    type: 'incident',
    category: 'hardware-printer',
    cis: ['Printing', 'print-srv-01'],
    title: 'Print jobs stuck in the queue',
    description:
      'My print jobs sit in the queue as "Spooling" and never come out. Colleagues have the same problem.',
    resolution:
      'Restarted the print spooler on print-srv-01 and cleared the stuck jobs; printing resumed for the floor.',
    times: 3,
  },
  {
    type: 'incident',
    category: 'hardware-printer',
    cis: ['Printing'],
    locale: 'zh-TW',
    title: '印表機一直卡紙',
    description: '7 樓影印機每印幾張就卡紙，已經清過紙匣還是一樣。',
    resolution: '更換送紙滾輪並校正紙匣，測試列印 50 張皆正常。',
  },
  // ── Outlook & email ──
  {
    type: 'incident',
    category: 'collaboration-outlook',
    cis: ['Email & Calendar'],
    title: "Outlook stuck on 'Updating inbox'",
    description:
      'Outlook on my laptop has been showing "Updating inbox" since yesterday. New mail shows up on my phone but not in Outlook.',
    resolution:
      'Rebuilt the Outlook profile and reduced the cached-mode window to 12 months; sync completed within the hour.',
    problem: 'outlook-large',
    times: 3,
  },
  {
    type: 'incident',
    category: 'collaboration-outlook',
    cis: ['Email & Calendar'],
    title: 'Shared mailbox not showing in Outlook',
    description:
      'I was given access to the finance-ap shared mailbox last week but it never appeared in Outlook.',
    resolution:
      'Automapping was disabled for the grant. Re-added the permission with automapping; the mailbox appeared after restart.',
    times: 2,
  },
  {
    type: 'incident',
    category: 'collaboration-outlook',
    cis: ['Email & Calendar'],
    locale: 'ja-JP',
    title: 'Outlook の予定表が同期されない',
    description: 'スマートフォンで追加した予定が PC の Outlook に表示されません。',
    resolution: 'Outlook のキャッシュをクリアし、予定表フォルダーを再同期しました。',
  },
  // ── Wi-Fi ──
  {
    type: 'incident',
    category: 'network-wifi',
    cis: ['Wi-Fi', 'wlc-01'],
    title: 'Wi-Fi drops in meeting room 7A',
    description:
      'In meeting room 7A the Wi-Fi drops every few minutes, which kills our video calls. Fine elsewhere on the floor.',
    resolution:
      'The 7A access point was on a congested channel. Moved it to a clean 5 GHz channel and raised the minimum data rate.',
    problem: 'wifi-roaming',
    times: 2,
  },
  {
    type: 'incident',
    category: 'network-wifi',
    cis: ['Wi-Fi'],
    title: "Can't join CORP Wi-Fi after laptop reimage",
    description:
      'My laptop was reimaged yesterday and now it will not connect to CORP — it keeps asking for a certificate.',
    resolution:
      'The device certificate had not been re-enrolled after the reimage. Triggered enrolment; CORP connects automatically now.',
    times: 2,
  },
  // ── Teams ──
  {
    type: 'incident',
    category: 'collaboration-teams',
    title: 'Teams does not detect my camera',
    description: 'Teams shows "No camera available" although the camera works in the Windows Camera app.',
    resolution:
      'A privacy setting blocked desktop apps from using the camera after a Windows update. Re-enabled it.',
    code: 'user_error',
    times: 2,
  },
  {
    type: 'incident',
    category: 'collaboration-teams',
    title: 'Echo in Teams meetings from the 3F board room',
    description: 'Remote participants hear a strong echo whenever the 3F board room joins a Teams meeting.',
    resolution:
      'Replaced the faulty ceiling microphone array and recalibrated the room system’s echo cancellation.',
  },
  // ── Finance ERP ──
  {
    type: 'incident',
    category: 'business-apps-erp',
    cis: ['Finance ERP', 'erp-app-01'],
    title: 'ERP session times out after a few minutes',
    description:
      'The Finance ERP logs me out after 3–5 minutes even while I am typing an invoice. I lose the unsaved entry each time.',
    resolution:
      'Linked to the ERP session timeout problem. Applied the interim workaround (pinning the session to one application node) for this user.',
    code: 'workaround',
    urgency: 1,
    problem: 'erp-timeouts',
    times: 3,
  },
  {
    type: 'incident',
    category: 'business-apps-erp',
    cis: ['Finance ERP', 'erp-db-01'],
    title: 'Finance ERP very slow at month-end close',
    description:
      'Posting journals takes over a minute per entry today. The whole AP team is affected during month-end.',
    resolution:
      'A missing index on the GL detail table caused full scans during close. DBA added the index; posting is back to 2 seconds.',
    impact: 2,
    urgency: 1,
  },
  {
    type: 'incident',
    category: 'business-apps-erp',
    cis: ['Finance ERP'],
    locale: 'zh-TW',
    title: 'ERP 報表匯出 Excel 失敗',
    description: '在財務 ERP 匯出應付帳款報表時出現錯誤代碼 EXP-500，其他報表正常。',
    resolution: '報表範本中有一個已停用的欄位，移除後即可正常匯出。',
  },
  // ── HR Portal ──
  {
    type: 'incident',
    category: 'business-apps-hr',
    cis: ['HR Portal', 'hr-app-01'],
    title: 'HR Portal shows the wrong leave balance',
    description: 'My annual leave balance in the HR Portal is 3 days lower than my payslip says.',
    resolution:
      'A leave request cancelled in August was still counted. HR corrected the record and the balance is right now.',
    code: 'no_fault_found',
  },
  {
    type: 'incident',
    category: 'business-apps-hr',
    cis: ['HR Portal'],
    locale: 'ja-JP',
    title: '人事ポータルに書類をアップロードできない',
    description: '扶養控除の書類（PDF）をアップロードすると「ファイル形式が不正です」と表示されます。',
    resolution: 'ファイル名に全角記号が含まれていたことが原因でした。名前を変更してアップロードできました。',
    code: 'user_error',
  },
  // ── Laptops & peripherals ──
  {
    type: 'incident',
    category: 'hardware-laptop',
    title: 'Laptop battery drains in two hours',
    description:
      'My laptop battery used to last a day; now it is empty after about two hours, even with the screen dimmed.',
    resolution: 'Battery health was at 41%. Replaced the battery under warranty.',
    times: 2,
  },
  {
    type: 'incident',
    category: 'hardware-laptop',
    title: 'Blue screen when docking the laptop',
    description:
      'The laptop crashes with a blue screen (DRIVER_POWER_STATE_FAILURE) whenever I plug in the USB-C dock.',
    resolution: 'Updated the dock firmware and the Thunderbolt driver; docking no longer crashes.',
  },
  {
    type: 'incident',
    category: 'hardware-peripherals',
    title: 'External monitor flickers on the dock',
    description: 'My second monitor flickers black every few seconds when connected through the desk dock.',
    resolution: 'Replaced the DisplayPort cable; the flicker stopped.',
  },
  {
    type: 'incident',
    category: 'network-wired',
    cis: ['tpe-sw-core-01'],
    title: 'Network port at desk 12-034 not working',
    description:
      'Nothing happens when I plug the cable into the floor port at my desk. The light on the laptop stays off.',
    resolution: 'The port was not patched in the floor cabinet. Patched it to the user VLAN.',
  },
  {
    type: 'incident',
    category: 'software-error',
    title: 'Excel crashes when opening large CSV exports',
    description: 'Excel closes without an error when I open the 300 MB CSV export from the data warehouse.',
    resolution:
      'Installed 64-bit Office (the user had 32-bit) and showed how to load the file through Power Query.',
    code: 'user_error',
  },
  {
    type: 'incident',
    category: 'other',
    cis: ['Corporate Website'],
    title: 'Contact form on the corporate website returns an error',
    description:
      'Customers tell us the "Contact sales" form on the website shows "Something went wrong" after submitting.',
    resolution:
      'The form’s mail relay credentials had expired. Rotated the secret; test submissions arrive again.',
    impact: 2,
  },
  {
    type: 'incident',
    category: 'accounts-access',
    cis: ['File Sharing', 'nas-01'],
    title: "Can't open the Finance shared drive",
    description:
      'Since this morning I get "Access denied" on the F: drive (Finance share). I could open it yesterday.',
    resolution: 'The user’s group membership was removed by an HR data sync error. Restored the membership.',
    times: 2,
  },
  // ── Security ──
  {
    type: 'incident',
    category: 'security-phishing',
    title: 'Suspicious email asking me to re-validate my mailbox',
    description:
      'I received an email that looks like it comes from IS asking me to "re-validate my mailbox" with a link. I did not click it.',
    resolution: 'Confirmed phishing. Purged the message from all mailboxes and blocked the sender domain.',
    times: 3,
  },
  {
    type: 'incident',
    category: 'security-phishing',
    locale: 'zh-TW',
    title: '不小心點了可疑的連結',
    description: '收到一封假冒物流公司的信件，不小心點了連結並輸入了帳號密碼。',
    resolution: '已強制重設密碼並撤銷所有工作階段，檢查登入紀錄未發現異常存取。',
    urgency: 1,
  },
  {
    type: 'incident',
    category: 'security-malware',
    title: 'Antivirus quarantined a file on my laptop',
    description:
      'Defender showed an alert and quarantined a file from my Downloads folder. Is my laptop safe?',
    resolution: 'The file was a bundled adware installer. Full scan was clean; no further action needed.',
    code: 'no_fault_found',
  },
  // ── Service requests ──
  {
    type: 'service_request',
    category: 'software-install',
    title: 'Install Microsoft Visio',
    description: 'I need Visio to update the network diagrams for the office move.',
    resolution: 'Assigned a Visio license and installed it through Software Center.',
    times: 3,
  },
  {
    type: 'service_request',
    category: 'software-license',
    title: 'Power BI Pro license',
    description:
      'Please assign me a Power BI Pro license so I can publish the sales dashboard to the team workspace.',
    resolution: 'Power BI Pro license assigned.',
    times: 3,
  },
  {
    type: 'service_request',
    category: 'accounts-access',
    cis: ['Email & Calendar'],
    title: 'Access to the sales-tw shared mailbox',
    description: 'I joined the Taipei sales team and need access to the sales-tw shared mailbox.',
    resolution: 'Full access granted with automapping.',
    times: 3,
  },
  {
    type: 'service_request',
    category: 'accounts-access',
    cis: VPN,
    title: 'VPN access for a new contractor',
    description: 'Our new contractor starts on Monday and needs VPN access to the development network.',
    resolution: 'Added the contractor to the vpn-users group with an end date matching the contract.',
    times: 2,
  },
  {
    type: 'service_request',
    category: 'hardware-peripherals',
    title: 'Second monitor for my desk',
    description: 'Could I get a second 27" monitor? I work with large spreadsheets all day.',
    resolution: 'Delivered and set up a 27" monitor.',
    times: 3,
  },
  {
    type: 'service_request',
    category: 'hardware-peripherals',
    title: 'Replacement headset',
    description: 'The microphone on my headset broke. I need a replacement for calls.',
    resolution: 'Replacement headset handed over at the service desk.',
    times: 2,
  },
  {
    type: 'service_request',
    category: 'collaboration-outlook',
    cis: ['Email & Calendar'],
    title: 'New distribution list for the project team',
    description: 'Please create a distribution list "proj-phoenix" with the 12 people in the attached list.',
    resolution: 'Created proj-phoenix@ and added the members; the requester is the owner.',
    times: 2,
  },
  {
    type: 'service_request',
    category: 'software-install',
    locale: 'zh-TW',
    title: '申請安裝 Adobe Acrobat Pro',
    description: '需要編輯合約 PDF，請協助安裝 Adobe Acrobat Pro。',
    resolution: '已指派授權並透過軟體中心完成安裝。',
    times: 2,
  },
  {
    type: 'service_request',
    category: 'software-license',
    locale: 'ja-JP',
    title: 'Figma のライセンス申請',
    description: '新しいポータルの画面設計のため Figma のエディター権限が必要です。',
    resolution: 'Figma のエディターシートを割り当てました。',
  },
  {
    type: 'service_request',
    category: 'business-apps-erp',
    cis: ['Finance ERP'],
    title: 'New cost center in the Finance ERP',
    description:
      'Please create cost center CC-4120 (Customer Success Tokyo) in the ERP, effective next month.',
    resolution: 'Cost center CC-4120 created and mapped to the Tokyo legal entity.',
    times: 2,
  },
  {
    type: 'service_request',
    category: 'collaboration-teams',
    title: 'Teams room setup for the 9F training room',
    description:
      'We are turning the 9F training room into a Teams room. Please register the device and add it to the room list.',
    resolution: 'Registered the room account and the device; it is bookable in Outlook now.',
  },
];

export const PROBLEMS = [
  {
    key: 'vpn-macos' as const,
    title: 'VPN client 5.2 crashes on macOS 15',
    description:
      'Since VPN client 5.2 was pushed on 2 September, Mac users on macOS 15 report that the client quits or drops the tunnel every few minutes. Windows clients are not affected.',
    status: 'known_error' as const,
    rootCause:
      'VPN client 5.2 uses a new network extension that conflicts with the macOS 14 content filter used by our endpoint agent; the extension is killed when the filter reloads.',
    workaround:
      'Install VPN client 5.1.8 from Self Service and turn off client auto-update. The vendor fix is expected in 5.2.3.',
    cis: VPN,
    category: 'network-vpn',
  },
  {
    key: 'erp-timeouts' as const,
    title: 'Intermittent ERP session timeouts',
    description:
      'Finance ERP users are logged out after a few minutes of activity, mostly in the afternoon. Load balancer and application logs show sessions moving between nodes.',
    status: 'investigating' as const,
    rootCause: '',
    workaround:
      'Pin affected users to erp-app-01 through the load balancer while the session replication is analysed.',
    cis: ['Finance ERP', 'erp-app-01'],
    category: 'business-apps-erp',
  },
  {
    key: 'outlook-large' as const,
    title: 'Outlook sync stalls for mailboxes over 50 GB',
    description: 'Large mailboxes stop syncing in cached mode after the September Office update.',
    status: 'known_error' as const,
    rootCause: 'The new sync engine times out on folders with more than 100,000 items.',
    workaround: 'Reduce the cached-mode window to 12 months, or archive old folders.',
    cis: ['Email & Calendar'],
    category: 'collaboration-outlook',
  },
  {
    key: 'wifi-roaming' as const,
    title: 'Wi-Fi roaming failures between access points on 5F–7F',
    description: 'Laptops lose connectivity for 10–30 seconds when moving between meeting rooms on 5F–7F.',
    status: 'investigating' as const,
    rootCause: '',
    workaround: '',
    cis: ['Wi-Fi', 'wlc-01'],
    category: 'network-wifi',
  },
  {
    key: 'print-spooler' as const,
    title: 'Print spooler hangs on print-srv-01 every night',
    description:
      'The spooler service stops responding around 02:00 and jobs queue until someone restarts it.',
    status: 'resolved' as const,
    rootCause: 'A third-party label printer driver leaked memory in the spooler process.',
    workaround: 'Restart the spooler service.',
    cis: ['Printing', 'print-srv-01'],
    category: 'hardware-printer',
  },
  {
    key: 'mfa-android' as const,
    title: 'MFA push notifications delayed for some Android users',
    description: 'A handful of Android users report MFA pushes arriving minutes late. Under review.',
    status: 'new' as const,
    rootCause: '',
    workaround: 'Use the 6-digit code from the authenticator app instead of the push.',
    cis: ['Single Sign-On'],
    category: 'accounts-password',
  },
];

/** Conversation snippets per language (agent asks, requester answers, agent's internal note). */
export const CHAT: Record<
  SeedLocale,
  { ask: string[]; answer: string[]; note: string[]; hold: string[]; thanks: string[] }
> = {
  en: {
    ask: [
      'Thanks for reporting this. Could you tell me when it started and whether anyone near you has the same problem?',
      'I am looking into it now. Can you send a screenshot of the error message?',
      'Could you restart the device once and let me know if the problem is still there?',
      'Which building and floor are you on? I will send someone over if needed.',
    ],
    answer: [
      'It started yesterday afternoon. My colleague next to me has the same issue.',
      'Screenshot attached — it happens every time.',
      'I restarted it but nothing changed.',
      'Taipei HQ, 5th floor near the pantry.',
    ],
    note: [
      'Checked the logs — no errors on the server side for this user.',
      'Same symptoms as last week’s tickets; checking the known errors.',
      'Escalated internally to the second-line team for a closer look.',
      'User is a VIP for the month-end close — keep them updated.',
    ],
    hold: [
      'Waiting for the user to be back at their desk.',
      'Waiting for a replacement part from the vendor.',
    ],
    thanks: ['Works now, thank you!', 'All good, thanks for the quick help.', 'Confirmed fixed.'],
  },
  'zh-TW': {
    ask: [
      '感謝通報，請問是從什麼時候開始的？身邊的同事也有一樣的狀況嗎？',
      '我正在處理中，可以提供錯誤訊息的截圖嗎？',
    ],
    answer: ['昨天下午開始的，隔壁同事也一樣。', '截圖已附上，每次都會出現。'],
    note: ['伺服器端沒有看到這位使用者的錯誤紀錄。', '與上週的工單症狀相同，正在比對已知錯誤。'],
    hold: ['等待使用者回到座位。'],
    thanks: ['已經可以用了，謝謝！', '問題解決了，感謝協助。'],
  },
  'ja-JP': {
    ask: [
      'ご連絡ありがとうございます。いつ頃から発生していますか？周りの方も同じ状況でしょうか？',
      '確認中です。エラーメッセージのスクリーンショットをお送りいただけますか？',
    ],
    answer: [
      '昨日の午後からです。隣の席の方も同じです。',
      'スクリーンショットを添付しました。毎回発生します。',
    ],
    note: [
      'サーバー側にはこのユーザーのエラーは記録されていない。',
      '先週のチケットと同じ症状。既知のエラーを確認中。',
    ],
    hold: ['ユーザーの在席待ち。'],
    thanks: [
      '使えるようになりました。ありがとうございます！',
      '解決しました。迅速な対応ありがとうございました。',
    ],
  },
};

export const CSAT_COMMENTS = [
  'Quick and friendly, thank you!',
  'Fixed on the first call.',
  'Took a while, but solved.',
  '迅速又專業，謝謝！',
  'とても丁寧な対応でした。',
];
