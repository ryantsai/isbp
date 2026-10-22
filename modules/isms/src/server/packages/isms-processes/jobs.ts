/**
 * The recurring checklists: scheduled jobs of type `core.assign-form` that open one assignment per period for the
 * group that fills the form in (Asia/Taipei). Each run is idempotent per form, group and period.
 */
import { GROUPS, type ItemTemplate, plain, type PlainText, ref } from './build';

const TIME_ZONE = 'Asia/Taipei';

type Group = (typeof GROUPS)[keyof typeof GROUPS];

function job(opts: {
  ref: string;
  /** Name, description, the assignment's title (`{{period}}` is the period) and note: in the installer's language. */
  name: PlainText;
  description: PlainText;
  formKey: string;
  group: Group;
  period: 'month' | 'quarter' | 'year';
  cron: string;
  title: PlainText;
  note: PlainText;
  /** Days after the run it is due; the end of the period when left out. */
  dueDays?: number;
}): ItemTemplate {
  return {
    ref: opts.ref,
    kind: 'scheduler.job',
    op: 'create',
    value: {
      name: opts.name,
      description: opts.description,
      ownerGroupId: ref(opts.group.ref),
      type: 'core.assign-form',
      config: {
        formKey: opts.formKey,
        assignee: { type: 'group', groupKey: opts.group.key },
        period: opts.period,
        due: opts.dueDays ? { type: 'days', days: opts.dueDays } : { type: 'end-of-period' },
        title: opts.title,
        note: opts.note,
      },
      trigger: { kind: 'cron', cron: opts.cron, timezone: TIME_ZONE },
      timeoutSeconds: 60,
      retries: { maxAttempts: 3, backoff: 'exponential', delaySeconds: 60 },
      concurrency: 'skip',
      alerts: { onFailure: true, channels: false, autoDisableAfter: 0 },
    },
  };
}

export const jobs: ItemTemplate[] = [
  job({
    ref: 'job-server-room-inspection',
    name: plain('ISMS: monthly server room inspection', 'ISMS：每月機房巡檢', 'ISMS: 毎月のサーバー室点検'),
    description: plain(
      'Asks the server room administrators to fill in the server room inspection on the 1st of each month.',
      '每月 1 日請機房管理員填寫機房巡檢紀錄。',
      '毎月 1 日に、サーバー室管理者にサーバー室の点検の記入を依頼します。',
    ),
    formKey: 'isms-server-room-inspection',
    group: GROUPS.serverRoom,
    period: 'month',
    cron: '0 9 1 * *',
    title: plain('Server room inspection {{period}}', '機房巡檢 {{period}}', 'サーバー室の点検 {{period}}'),
    note: plain(
      'Check each item and describe anything abnormal: an abnormal result raises a service desk incident.',
      '請逐項檢查並說明異常情形；結果異常時會開立服務台事件單。',
      '各項目を点検し、異常があれば内容を記入してください。異常な結果があるとサービス デスクのインシデントが起票されます。',
    ),
  }),
  job({
    ref: 'job-system-backup-inspection',
    name: plain(
      'ISMS: monthly system and backup inspection',
      'ISMS：每月系統及備份巡檢',
      'ISMS: 毎月のシステムとバックアップの点検',
    ),
    description: plain(
      'Asks the server room administrators to check backups, updates, time sync and antivirus every month.',
      '每月請機房管理員檢查備份、系統更新、時間同步及防毒。',
      '毎月、サーバー室管理者にバックアップ、更新、時刻同期、ウイルス対策の点検を依頼します。',
    ),
    formKey: 'isms-system-backup-inspection',
    group: GROUPS.serverRoom,
    period: 'month',
    cron: '0 9 1 * *',
    title: plain(
      'System and backup inspection {{period}}',
      '系統及備份巡檢 {{period}}',
      'システムとバックアップの点検 {{period}}',
    ),
    note: plain(
      'List every backup with its result; failed or partial backups raise a service desk incident.',
      '請列出每項備份及其結果；備份失敗或部分成功時會開立服務台事件單。',
      'すべてのバックアップと結果を記入してください。失敗または一部成功のバックアップがあるとサービス デスクのインシデントが起票されます。',
    ),
  }),
  job({
    ref: 'job-network-config-backup',
    name: plain(
      'ISMS: quarterly network device configuration backup',
      'ISMS：每季網路設備設定檔備份',
      'ISMS: 四半期ごとのネットワーク デバイス構成のバックアップ',
    ),
    description: plain(
      'Asks the network administrators to back up and check the configuration of network devices each quarter.',
      '每季請網路管理人員備份並檢核網路設備的設定檔。',
      '四半期ごとに、ネットワーク管理者にネットワーク デバイスの構成のバックアップと点検を依頼します。',
    ),
    formKey: 'isms-network-device-check',
    group: GROUPS.network,
    period: 'quarter',
    cron: '0 9 1 1,4,7,10 *',
    title: plain(
      'Network device configuration backup {{period}}',
      '網路設備設定檔備份 {{period}}',
      'ネットワーク デバイス構成のバックアップ {{period}}',
    ),
    note: plain(
      'Back up each device’s configuration and attach the evidence to the request.',
      '請備份每台設備的設定檔，並將佐證附加於申請單。',
      '各デバイスの構成をバックアップし、証跡を申請に添付してください。',
    ),
  }),
  job({
    ref: 'job-firewall-rule-review',
    name: plain(
      'ISMS: yearly firewall rule review',
      'ISMS：年度防火牆規則檢視',
      'ISMS: 年次のファイアウォール ルール見直し',
    ),
    description: plain(
      'Asks the network administrators to review every firewall and network device rule in January.',
      '每年 1 月請網路管理人員檢視所有防火牆及網路設備規則。',
      '毎年 1 月に、ネットワーク管理者にすべてのファイアウォールとネットワーク デバイスのルールの見直しを依頼します。',
    ),
    formKey: 'isms-network-device-check',
    group: GROUPS.network,
    period: 'year',
    cron: '0 9 2 1 *',
    title: plain(
      'Firewall rule review {{period}}',
      '防火牆規則檢視 {{period}}',
      'ファイアウォール ルールの見直し {{period}}',
    ),
    note: plain(
      'Review every rule: remove expired or unneeded ones and record what was adjusted.',
      '請檢視每條規則，移除已到期或不需要的規則，並記錄調整內容。',
      'すべてのルールを見直し、期限切れや不要なルールを削除して、調整内容を記録してください。',
    ),
    dueDays: 30,
  }),
  job({
    ref: 'job-device-password',
    name: plain(
      'ISMS: half-yearly device password change',
      'ISMS：每半年重要設備密碼變更',
      'ISMS: 半年ごとのデバイスのパスワード変更',
    ),
    description: plain(
      'Asks the network administrators to change and confirm the passwords of critical devices in January and July.',
      '每年 1 月及 7 月請網路管理人員變更並確認重要設備的密碼。',
      '毎年 1 月と 7 月に、ネットワーク管理者に重要なデバイスのパスワードの変更と確認を依頼します。',
    ),
    formKey: 'isms-device-password',
    group: GROUPS.network,
    period: 'month',
    cron: '0 9 1 1,7 *',
    title: plain(
      'Critical device password change {{period}}',
      '重要設備密碼變更 {{period}}',
      '重要なデバイスのパスワード変更 {{period}}',
    ),
    note: plain(
      'Change the password of each critical device and record the date.',
      '請變更每台重要設備的密碼並記錄變更日期。',
      '重要なデバイスごとにパスワードを変更し、日付を記録してください。',
    ),
  }),
  job({
    ref: 'job-backup-plan-review',
    name: plain(
      'ISMS: yearly backup plan review',
      'ISMS：年度備份計畫檢視',
      'ISMS: 年次のバックアップ計画の見直し',
    ),
    description: plain(
      'Asks IS operations to review the backup plan every February.',
      '每年 2 月請資訊部門檢視備份計畫。',
      '毎年 2 月に、IS 運用にバックアップ計画の見直しを依頼します。',
    ),
    formKey: 'isms-backup-plan',
    group: GROUPS.it,
    period: 'year',
    cron: '0 9 1 2 *',
    title: plain(
      'Backup plan review {{period}}',
      '備份計畫檢視 {{period}}',
      'バックアップ計画の見直し {{period}}',
    ),
    note: plain(
      'Review what is backed up, how and where, and describe what changed.',
      '請檢視備份項目、方式及存放地點，並說明異動內容。',
      'バックアップの対象、方法、保管場所を見直し、変更点を記入してください。',
    ),
    dueDays: 30,
  }),
  job({
    ref: 'job-restore-test',
    name: plain(
      'ISMS: yearly backup restore test',
      'ISMS：年度備份資料回存測試',
      'ISMS: 年次のバックアップのリストア テスト',
    ),
    description: plain(
      'Asks IS operations to test restoring backups every March.',
      '每年 3 月請資訊部門測試備份資料回存。',
      '毎年 3 月に、IS 運用にバックアップのリストア テストを依頼します。',
    ),
    formKey: 'isms-restore-test',
    group: GROUPS.it,
    period: 'year',
    cron: '0 9 1 3 *',
    title: plain(
      'Backup restore test {{period}}',
      '備份資料回存測試 {{period}}',
      'バックアップのリストア テスト {{period}}',
    ),
    note: plain(
      'Restore a backup of each critical system and record the result; a failure raises a service desk incident.',
      '請回存每個重要系統的備份並記錄結果；測試失敗時會開立服務台事件單。',
      '重要なシステムごとにバックアップを復元し、結果を記録してください。失敗するとサービス デスクのインシデントが起票されます。',
    ),
    dueDays: 30,
  }),
  job({
    ref: 'job-maintenance',
    name: plain('ISMS: yearly equipment maintenance', 'ISMS：年度設備保養維護', 'ISMS: 年次の機器保守'),
    description: plain(
      'Asks the server room administrators to record the yearly maintenance of their equipment, from April.',
      '每年 4 月起請機房管理員記錄設備的年度保養維護。',
      '毎年 4 月から、サーバー室管理者に機器の年次保守の記録を依頼します。',
    ),
    formKey: 'isms-maintenance',
    group: GROUPS.serverRoom,
    period: 'year',
    cron: '0 9 1 4 *',
    title: plain('Equipment maintenance {{period}}', '設備保養維護 {{period}}', '機器保守 {{period}}'),
    note: plain(
      'Record the maintenance of each device; issues found raise a service desk incident.',
      '請記錄每台設備的保養維護情形；發現問題時會開立服務台事件單。',
      '機器ごとに保守内容を記録してください。問題が見つかるとサービス デスクのインシデントが起票されます。',
    ),
    dueDays: 90,
  }),
];
