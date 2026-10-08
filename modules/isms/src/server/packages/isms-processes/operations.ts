/**
 * IT operations: the monthly server room and system/backup inspections, the backup plan and its yearly restore
 * test, yearly equipment maintenance, patch exceptions and the half-yearly password change of critical devices.
 * Abnormal results raise a service desk incident ("Equipment and resource anomaly"), whose resolution an ISMS
 * approver signs off.
 */
import type { Condition, FieldDef } from '@isbp/sdk';
import {
  afterToday,
  any,
  authorityStep,
  CATEGORIES,
  date,
  elements,
  eq,
  GROUPS,
  heading,
  isIn,
  type ItemTemplate,
  neq,
  NORMAL,
  notEmpty,
  number,
  OK_ISSUE,
  opt,
  type Plain,
  plain,
  type PlainText,
  raiseTicket,
  record,
  remind,
  requestProcess,
  rows,
  rule,
  select,
  t,
  text,
  textarea,
  user,
} from './build';

const required = { required: true };
const half = { required: true, width: 'half' as const };
const OTHER = opt('other', t('Other', '其他', 'その他'));

/** A device or system: its name, and the CI when it is in the CMDB. */
const deviceColumns = (label = t('Device or system', '設備／系統', 'デバイス・システム')): FieldDef[] => [
  text('device', label, required),
  record('ci', t('CI (if registered)', '組態項目（如已登錄）', '構成アイテム (登録済みの場合)'), ['cmdb.ci']),
];

const anomalyTicket = (title: PlainText, description: Plain, when: Condition, groupRef?: string) =>
  raiseTicket(
    'raise-anomaly',
    'submitted',
    t('Raise an incident for what is abnormal', '異常時開立事件單', '異常があればインシデントを起票'),
    {
      categoryRef: CATEGORIES.resourceAnomaly.ref,
      ...(groupRef ? { groupRef } : {}),
      title,
      description,
      when,
    },
  );

const review = (name: string, label: PlainText) => ({
  name,
  label,
  description: plain('An ISMS approver reviews the record', '由權責主管覆核紀錄', 'ISMS 承認者が記録を確認'),
  steps: [authorityStep()],
});

/* ───────────── 8. Server room inspection ───────────── */

const CHECKS = [
  {
    key: 'monitoring',
    label: t(
      'The monitoring console shows the hardware healthy',
      '監控主機顯示硬體狀態正常',
      '監視コンソールでハードウェアが正常',
    ),
  },
  {
    key: 'racks',
    label: t(
      'Racks are locked and hold no non-business equipment',
      '機櫃已上鎖，且無非業務用設備',
      'ラックは施錠され、業務外の機器がない',
    ),
  },
  {
    key: 'tidiness',
    label: t(
      'The room is tidy and nothing inappropriate is stored',
      '機房環境整潔，未存放不當物品',
      'サーバー室は整頓され、不適切な物が置かれていない',
    ),
  },
  {
    key: 'spares',
    label: t(
      'Spare equipment and standby PCs are locked away',
      '備品及備用電腦已上鎖保管',
      '予備機器と予備 PC は施錠して保管されている',
    ),
  },
];

const serverRoomInspection = requestProcess(
  {
    key: 'isms-server-room-inspection',
    name: t('Server room inspection', '機房巡檢紀錄', 'サーバー室の点検'),
    description: t(
      'Monthly checklist of the server room; anything abnormal raises an incident',
      '每月機房巡檢，異常項目會自動開立事件單',
      '毎月のサーバー室点検。異常があればインシデントを起票',
    ),
    icon: 'server',
    category: 'security',
    audience: [GROUPS.serverRoom.key],
    schema: {
      elements: elements(
        date('inspectedOn', t('Inspected on', '巡檢日期', '点検日'), half),
        heading('h-checks', t('Checks', '檢查項目', '点検項目')),
        ...CHECKS.flatMap((c) => [
          select(c.key, c.label, NORMAL, { required: true, width: 'half' }),
          text(`${c.key}Note`, t('Note', '說明', 'メモ'), { width: 'half' }),
        ]),
        textarea('notes', t('Other observations', '其他說明', 'その他の所見')),
      ),
      rules: CHECKS.map((c) =>
        rule(
          `${c.key}-note`,
          notEmpty(`${c.key}Note`),
          t('Describe what is abnormal', '請說明異常情形', '異常の内容を入力してください'),
          { when: eq(c.key, 'abnormal'), fields: [`${c.key}Note`] },
        ),
      ),
      actions: [
        anomalyTicket(
          plain(
            'Server room inspection found an issue: {{request.reference}}',
            '機房巡檢發現異常：{{request.reference}}',
            'サーバー室の点検で問題が見つかりました: {{request.reference}}',
          ),
          plain(
            'Inspected on {{data.inspectedOn}}.\nMonitoring: {{answers.monitoring}} {{data.monitoringNote}}\nRacks: {{answers.racks}} {{data.racksNote}}\nTidiness: {{answers.tidiness}} {{data.tidinessNote}}\nSpares: {{answers.spares}} {{data.sparesNote}}\n{{data.notes}}\n\n{{request.url}}',
            '巡檢日期：{{data.inspectedOn}}\n監控主機：{{answers.monitoring}} {{data.monitoringNote}}\n機櫃：{{answers.racks}} {{data.racksNote}}\n環境整潔：{{answers.tidiness}} {{data.tidinessNote}}\n備品：{{answers.spares}} {{data.sparesNote}}\n{{data.notes}}\n\n{{request.url}}',
            '点検日: {{data.inspectedOn}}\n監視: {{answers.monitoring}} {{data.monitoringNote}}\nラック: {{answers.racks}} {{data.racksNote}}\n整理整頓: {{answers.tidiness}} {{data.tidinessNote}}\n予備機器: {{answers.spares}} {{data.sparesNote}}\n{{data.notes}}\n\n{{request.url}}',
          ),
          any(...CHECKS.map((c) => eq(`data.${c.key}`, 'abnormal'))),
        ),
      ],
    },
  },
  review(
    'serverRoomInspection',
    plain('Server room inspection review', '機房巡檢覆核', 'サーバー室点検の確認'),
  ),
);

/* ───────────── 9. System and backup inspection ───────────── */

const systemBackupInspection = requestProcess(
  {
    key: 'isms-system-backup-inspection',
    name: t('System and backup inspection', '系統及備份巡檢紀錄', 'システムとバックアップの点検'),
    description: t(
      'Monthly check of backups, updates, time sync and antivirus; problems raise an incident',
      '每月檢查備份、系統更新、時間同步及防毒，異常會自動開立事件單',
      '毎月のバックアップ・更新・時刻同期・ウイルス対策の点検。問題があればインシデントを起票',
    ),
    icon: 'database-backup',
    category: 'security',
    audience: [GROUPS.serverRoom.key],
    schema: {
      elements: elements(
        date('inspectedOn', t('Inspected on', '巡檢日期', '点検日'), half),
        rows(
          'backups',
          t('Backups', '備份結果', 'バックアップ'),
          [
            ...deviceColumns(t('Backup target', '備份標的', 'バックアップ対象')),
            select(
              'result',
              t('Result', '結果', '結果'),
              [
                opt('success', t('Succeeded', '成功', '成功')),
                opt('partial', t('Partly succeeded', '部分成功', '一部成功')),
                opt('failed', t('Failed', '失敗', '失敗')),
              ],
              required,
            ),
            date('lastSuccessOn', t('Last successful backup', '最近一次成功日期', '最後に成功した日')),
            text('note', t('Note', '備註', 'メモ')),
          ],
          { required: true, max: 50 },
        ),
        select(
          'osUpdates',
          t('Operating system updates', '作業系統更新', 'OS の更新'),
          [
            opt('up_to_date', t('Up to date', '已更新', '最新')),
            opt('pending', t('Pending', '待更新', '保留中')),
            opt('exception', t('Exception approved', '例外核備', '例外承認済み')),
          ],
          half,
        ),
        text('osUpdatesNote', t('Updates note', '更新說明', '更新のメモ'), { width: 'half' }),
        select('timeSync', t('Time synchronisation', '時間同步', '時刻同期'), NORMAL, half),
        select(
          'antivirus',
          t(
            'Antivirus signatures and detections reviewed',
            '防毒病毒碼與偵測紀錄檢視',
            'ウイルス対策の定義ファイルと検出記録',
          ),
          NORMAL,
          half,
        ),
        textarea('notes', t('Other observations', '其他說明', 'その他の所見')),
      ),
      rules: [
        rule(
          'updates-note',
          notEmpty('osUpdatesNote'),
          t(
            'Say which updates are pending or excepted, and why',
            '請說明待更新或例外的項目及原因',
            '保留中または例外の更新とその理由を入力してください',
          ),
          { when: neq('osUpdates', 'up_to_date'), fields: ['osUpdatesNote'] },
        ),
        rule(
          'abnormal-notes',
          notEmpty('notes'),
          t('Describe what is abnormal', '請說明異常情形', '異常の内容を入力してください'),
          { when: any(eq('timeSync', 'abnormal'), eq('antivirus', 'abnormal')), fields: ['notes'] },
        ),
      ],
      actions: [
        anomalyTicket(
          plain(
            'System and backup inspection found an issue: {{request.reference}}',
            '系統及備份巡檢發現異常：{{request.reference}}',
            'システムとバックアップの点検で問題が見つかりました: {{request.reference}}',
          ),
          plain(
            'Inspected on {{data.inspectedOn}}.\n{{answers.backups}}\nUpdates: {{answers.osUpdates}} {{data.osUpdatesNote}}\nTime sync: {{answers.timeSync}}\nAntivirus: {{answers.antivirus}}\n{{data.notes}}\n\n{{request.url}}',
            '巡檢日期：{{data.inspectedOn}}\n{{answers.backups}}\n系統更新：{{answers.osUpdates}} {{data.osUpdatesNote}}\n時間同步：{{answers.timeSync}}\n防毒：{{answers.antivirus}}\n{{data.notes}}\n\n{{request.url}}',
            '点検日: {{data.inspectedOn}}\n{{answers.backups}}\n更新: {{answers.osUpdates}} {{data.osUpdatesNote}}\n時刻同期: {{answers.timeSync}}\nウイルス対策: {{answers.antivirus}}\n{{data.notes}}\n\n{{request.url}}',
          ),
          any(
            isIn('data.backups.result', ['failed', 'partial']),
            eq('data.timeSync', 'abnormal'),
            eq('data.antivirus', 'abnormal'),
          ),
        ),
      ],
    },
  },
  review(
    'systemBackupInspection',
    plain('System and backup inspection review', '系統及備份巡檢覆核', 'システムとバックアップ点検の確認'),
  ),
);

/* ───────────── 10. Backup plan ───────────── */

const backupPlan = requestProcess(
  {
    key: 'isms-backup-plan',
    name: t('Backup plan', '備份計畫', 'バックアップ計画'),
    description: t(
      'What is backed up, how, where and how often; reviewed every year',
      '備份項目、方式、存放位置及頻率，每年檢視',
      '何を・どのように・どこへ・どの頻度でバックアップするか。毎年見直し',
    ),
    icon: 'archive',
    category: 'security',
    audience: [GROUPS.it.key],
    schema: {
      elements: elements(
        date('effectiveFrom', t('Effective from', '生效日', '適用開始日'), half),
        rows(
          'items',
          t('Backup items', '備份項目', 'バックアップ項目'),
          [
            text('item', t('Item', '備份項目', '項目'), required),
            text('content', t('Content', '備份內容', '内容')),
            select(
              'device',
              t('Backup device', '備份設備', 'バックアップ デバイス'),
              [
                opt('tape', t('Tape', '磁帶', 'テープ')),
                opt('file_server', t('File server', '檔案伺服器', 'ファイル サーバー')),
                OTHER,
              ],
              required,
            ),
            text('target', t('Destination', '備份目的地', 'バックアップ先')),
            select(
              'method',
              t('Method', '備份方式', '方式'),
              [
                opt('full', t('Full', '完整備份', '完全')),
                opt('differential', t('Differential', '差異備份', '差分')),
                opt('incremental', t('Incremental', '增量備份', '増分')),
              ],
              required,
            ),
            select(
              'mode',
              t('Run', '執行方式', '実行方法'),
              [opt('automatic', t('Automatic', '自動', '自動')), opt('manual', t('Manual', '手動', '手動'))],
              required,
            ),
            user('operator', t('Operator', '執行人員', '担当者')),
            select(
              'location',
              t('Stored at', '存放地點', '保管場所'),
              [
                opt('primary', t('Primary site', '主要機房', 'メイン サイト')),
                opt('dr', t('Disaster recovery site', '異地備援機房', '災害対策サイト')),
              ],
              required,
            ),
            select(
              'frequency',
              t('Frequency', '頻率', '頻度'),
              [
                opt('daily', t('Daily', '每日', '毎日')),
                opt('weekly', t('Weekly', '每週', '毎週')),
                opt('monthly', t('Monthly', '每月', '毎月')),
                opt('on_change', t('On change', '異動時', '変更時')),
              ],
              required,
            ),
          ],
          { required: true, max: 50 },
        ),
        textarea(
          'changeNote',
          t('What changed since the last plan', '與前版差異說明', '前回の計画からの変更点'),
        ),
      ),
    },
  },
  {
    name: 'backupPlan',
    label: plain('Backup plan approval', '備份計畫簽核', 'バックアップ計画の承認'),
    description: plain(
      'An ISMS approver approves the plan',
      '由權責主管核准備份計畫',
      'ISMS 承認者が計画を承認',
    ),
    steps: [authorityStep()],
  },
);

/* ───────────── 11. Backup restore test ───────────── */

const restoreTest = requestProcess(
  {
    key: 'isms-restore-test',
    name: t('Backup restore test', '備份資料回存測試紀錄', 'バックアップのリストア テスト'),
    description: t(
      'Yearly test that backups can be restored; a failed test raises an incident',
      '每年測試備份資料可正確回存，失敗會自動開立事件單',
      'バックアップを復元できるかの年次テスト。失敗するとインシデントを起票',
    ),
    icon: 'history',
    category: 'security',
    audience: [GROUPS.it.key],
    schema: {
      elements: elements(
        date('testedOn', t('Tested on', '測試日期', 'テスト日'), half),
        rows(
          'tests',
          t('Tests', '測試結果', 'テスト'),
          [
            ...deviceColumns(t('System', '系統', 'システム')),
            date('backupDate', t('Backup date', '備份資料日期', 'バックアップの日付'), required),
            text('restoredTo', t('Restored to', '回存位置', '復元先'), required),
            select(
              'result',
              t('Result', '結果', '結果'),
              [opt('success', t('Succeeded', '成功', '成功')), opt('failed', t('Failed', '失敗', '失敗'))],
              required,
            ),
            number('minutes', t('Minutes taken', '所需時間（分鐘）', '所要時間 (分)'), {
              validation: { min: 0 },
            }),
            text('note', t('Note', '備註', 'メモ')),
          ],
          { required: true, max: 50 },
        ),
      ),
      actions: [
        anomalyTicket(
          plain(
            'Backup restore test failed: {{request.reference}}',
            '備份資料回存測試失敗：{{request.reference}}',
            'バックアップのリストア テストが失敗しました: {{request.reference}}',
          ),
          plain(
            'Tested on {{data.testedOn}}.\n{{answers.tests}}\n\n{{request.url}}',
            '測試日期：{{data.testedOn}}\n{{answers.tests}}\n\n{{request.url}}',
            'テスト日: {{data.testedOn}}\n{{answers.tests}}\n\n{{request.url}}',
          ),
          eq('data.tests.result', 'failed'),
          GROUPS.it.ref,
        ),
      ],
    },
  },
  review('restoreTest', plain('Restore test review', '備份資料回存測試覆核', 'リストア テストの確認')),
);

/* ───────────── 19. Yearly equipment maintenance ───────────── */

const maintenance = requestProcess(
  {
    key: 'isms-maintenance',
    name: t('Yearly equipment maintenance', '年度設備保養維護紀錄', '年次の機器保守記録'),
    description: t(
      'Yearly maintenance of servers, network and facility equipment; issues raise an incident',
      '每年伺服器、網路及機房設施保養維護，發現問題會自動開立事件單',
      'サーバー・ネットワーク・設備の年次保守。問題があればインシデントを起票',
    ),
    icon: 'wrench',
    category: 'hardware',
    audience: [GROUPS.serverRoom.key],
    schema: {
      elements: elements(
        rows(
          'items',
          t('Equipment', '保養設備', '機器'),
          [
            ...deviceColumns(t('Equipment', '設備', '機器')),
            select(
              'hardwareSpace',
              t('Hardware and space', '硬體與空間', 'ハードウェアと容量'),
              OK_ISSUE,
              required,
            ),
            select(
              'services',
              t('Services and performance', '服務與效能', 'サービスと性能'),
              OK_ISSUE,
              required,
            ),
            select('security', t('Security settings', '安全設定', 'セキュリティ設定'), OK_ISSUE, required),
            text('vendor', t('Vendor', '維護廠商', '保守業者')),
            date('date', t('Date', '保養日期', '実施日')),
            text('note', t('Note', '備註', 'メモ')),
          ],
          { required: true, max: 50 },
        ),
      ),
      actions: [
        anomalyTicket(
          plain(
            'Equipment maintenance found an issue: {{request.reference}}',
            '設備保養維護發現異常：{{request.reference}}',
            '機器保守で問題が見つかりました: {{request.reference}}',
          ),
          '{{answers.items}}\n\n{{request.url}}',
          any(
            eq('data.items.hardwareSpace', 'issue'),
            eq('data.items.services', 'issue'),
            eq('data.items.security', 'issue'),
          ),
        ),
      ],
    },
  },
  review('maintenance', plain('Equipment maintenance review', '年度設備保養維護覆核', '年次機器保守の確認')),
);

/* ───────────── 20. Patch exception ───────────── */

const patchException = requestProcess(
  {
    key: 'isms-patch-exception',
    name: t('Patch exception', '修補程式例外核備', '修正プログラム適用の例外'),
    description: t(
      'A system that can’t take a patch yet, with compensating controls until a date',
      '系統暫無法安裝修補程式時，說明補償措施並訂定期限',
      '修正プログラムをまだ適用できないシステムの補完策と期限',
    ),
    icon: 'shield-alert',
    category: 'security',
    schema: {
      elements: elements(
        record('system', t('System', '系統', 'システム'), ['cmdb.ci'], required),
        text('patch', t('Patch or update', '修補程式', '修正プログラム'), required),
        textarea('reason', t('Why it can’t be installed', '無法安裝的原因', '適用できない理由'), required),
        textarea('compensatingControls', t('Compensating controls', '補償措施', '補完的な対策'), required),
        date('until', t('Exception until', '例外期限', '例外の期限'), {
          required: true,
          help: t(
            'You are reminded a week before.',
            '期限前一週會提醒您。',
            '期限の 1 週間前に通知されます。',
          ),
        }),
      ),
      rules: [
        rule(
          'until-later',
          afterToday('until'),
          t('The exception must end after today', '例外期限須晚於今天', '例外の期限は明日以降にしてください'),
          { fields: ['until'] },
        ),
      ],
      actions: [
        remind(
          'remind-end',
          t('Remind a week before the exception ends', '例外到期前一週提醒', '例外終了の 1 週間前に通知'),
          {
            dateField: 'until',
            offsetDays: -7,
            title: plain(
              'Patch exception ends on {{data.until}}: {{data.patch}} ({{request.reference}})',
              '修補程式例外將於 {{data.until}} 到期：{{data.patch}}（{{request.reference}}）',
              '{{data.until}} に修正プログラム適用の例外が終了: {{data.patch}} ({{request.reference}})',
            ),
            message: plain(
              'Install the patch or ask for a new exception.\n{{request.url}}',
              '請安裝修補程式，或重新申請例外。\n{{request.url}}',
              '修正プログラムを適用するか、新しい例外を申請してください。\n{{request.url}}',
            ),
          },
        ),
      ],
    },
  },
  {
    name: 'patchException',
    label: plain('Patch exception approval', '修補程式例外簽核', '修正プログラム適用例外の承認'),
    description: plain(
      'An ISMS approver approves the exception',
      '由權責主管核准例外',
      'ISMS 承認者が例外を承認',
    ),
    steps: [authorityStep()],
  },
);

/* ───────────── 21. Critical device password change ───────────── */

const devicePassword = requestProcess(
  {
    key: 'isms-device-password',
    name: t('Critical device password change', '重要設備密碼變更確認', '重要なデバイスのパスワード変更確認'),
    description: t(
      'Half-yearly confirmation that the passwords of critical devices were changed',
      '每半年確認重要設備密碼已完成變更',
      '重要なデバイスのパスワード変更を半年ごとに確認',
    ),
    icon: 'key-round',
    category: 'security',
    audience: [GROUPS.network.key],
    schema: {
      elements: elements(
        rows(
          'devices',
          t('Devices', '設備清單', 'デバイス'),
          [
            ...deviceColumns(),
            date('changedOn', t('Changed on', '變更日期', '変更日'), required),
            text('note', t('Note', '備註', 'メモ')),
          ],
          { required: true, max: 50 },
        ),
      ),
    },
  },
  review(
    'devicePassword',
    plain('Device password change review', '重要設備密碼變更覆核', '重要なデバイスのパスワード変更の確認'),
  ),
);

export const operationsProcesses: ItemTemplate[] = [
  ...serverRoomInspection,
  ...systemBackupInspection,
  ...backupPlan,
  ...restoreTest,
  ...maintenance,
  ...patchException,
  ...devicePassword,
];
