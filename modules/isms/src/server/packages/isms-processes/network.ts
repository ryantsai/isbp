/**
 * Network security: firewall rule changes (evaluated and configured by the network administrators, reminded before
 * they expire), the network device rule and backup check, and network access for visitors.
 */
import {
  any,
  authorityStep,
  CATEGORIES,
  date,
  elements,
  eq,
  GROUPS,
  groupStep,
  type ItemTemplate,
  managerStep,
  NORMAL,
  notBefore,
  notEmpty,
  opt,
  paragraph,
  plain,
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
  withinDays,
} from './build';

const OTHER = opt('other', t('Other', '其他', 'その他'));
const required = { required: true };
const half = { required: true, width: 'half' as const };
/** CIs of the CMDB's network device class. */
const NETWORK_DEVICE = eq('class', 'network-device');

/* ───────────── 4. Firewall rule change ───────────── */

const firewallRule = requestProcess(
  {
    key: 'isms-firewall-rule',
    name: t('Firewall rule change request', '防火牆規則異動申請', 'ファイアウォール ルール変更の申請'),
    description: t(
      'Open, change or close firewall rules for at most a year',
      '新增、變更或終止防火牆規則，有效期間最長一年',
      'ファイアウォール ルールの追加・変更・終了 (有効期間は最長 1 年)',
    ),
    icon: 'brick-wall',
    category: 'changes',
    schema: {
      elements: elements(
        select(
          'reasonType',
          t('Reason', '申請原因', '申請理由'),
          [
            opt('project', t('Project', '專案需求', 'プロジェクト')),
            opt('internal_test', t('Internal test', '內部測試', '社内テスト')),
            OTHER,
          ],
          half,
        ),
        select(
          'request',
          t('Request', '申請項目', '申請内容'),
          [
            opt('add', t('Add rules', '新增', '追加')),
            opt('end', t('End rules', '終止', '終了')),
            opt('change', t('Change rules', '變更', '変更')),
            OTHER,
          ],
          half,
        ),
        textarea('reason', t('Describe the need', '需求說明', '必要な理由'), required),
        date('validFrom', t('Valid from', '生效日', '有効期間の開始'), half),
        date('validUntil', t('Valid until', '到期日', '有効期間の終了'), {
          ...half,
          help: t(
            'At most a year after the start. You and the network administrators are reminded two weeks before.',
            '最長為生效日起一年。到期前兩週會提醒您與網路管理人員。',
            '開始日から最長 1 年です。終了の 2 週間前にあなたとネットワーク管理者に通知されます。',
          ),
        }),
        rows(
          'rules',
          t('Rules', '規則明細', 'ルール'),
          [
            record('device', t('Firewall or device', '設備', 'デバイス'), ['cmdb.ci'], {
              where: NETWORK_DEVICE,
              help: t(
                'Leave empty if you don’t know: the network administrators choose it.',
                '若不確定可留空，由網路管理人員判斷。',
                '不明な場合は空欄のままで構いません。ネットワーク管理者が選びます。',
              ),
            }),
            text(
              'source',
              t('Source (IP or network)', '來源 IP／網段', '送信元 (IP・ネットワーク)'),
              required,
            ),
            text(
              'destination',
              t('Destination (IP or network)', '目的 IP／網段', '宛先 (IP・ネットワーク)'),
              required,
            ),
            text('port', t('Port and protocol', '服務埠及協定', 'ポートとプロトコル'), {
              required: true,
              placeholder: t('443/tcp', '443/tcp', '443/tcp'),
              validation: { maxLength: 100 },
            }),
            select(
              'decision',
              t('Allow or deny', '允許／拒絕', '許可・拒否'),
              [opt('allow', t('Allow', '允許', '許可')), opt('deny', t('Deny', '拒絕', '拒否'))],
              { required: true, defaultValue: 'allow' },
            ),
          ],
          { required: true, min: 1, max: 50 },
        ),
      ),
      rules: [
        rule(
          'until-after-from',
          notBefore('validUntil', 'validFrom'),
          t('The end can’t be before the start', '到期日不可早於生效日', '終了日は開始日以降にしてください'),
          { fields: ['validUntil'] },
        ),
        rule(
          'at-most-a-year',
          withinDays('validUntil', 'validFrom', 365),
          t(
            'Firewall rules are valid for at most a year: request a renewal before they end',
            '防火牆規則有效期間最長一年，到期前請重新申請',
            'ファイアウォール ルールの有効期間は最長 1 年です。期限前に更新を申請してください',
          ),
          { fields: ['validUntil'] },
        ),
      ],
      actions: [
        remind(
          'remind-expiry',
          t('Remind two weeks before expiry', '到期前兩週提醒', '期限の 2 週間前に通知'),
          {
            dateField: 'validUntil',
            offsetDays: -14,
            groupKeys: [GROUPS.network.key],
            title: plain(
              'Firewall rules end on {{data.validUntil}}: {{request.reference}}',
              '防火牆規則將於 {{data.validUntil}} 到期：{{request.reference}}',
              '{{data.validUntil}} に期限を迎えるファイアウォール ルール: {{request.reference}}',
            ),
            message: plain(
              'Renew the request or remove the rules.\n{{answers.rules}}\n{{request.url}}',
              '請重新申請或移除規則。\n{{answers.rules}}\n{{request.url}}',
              '申請を更新するか、ルールを削除してください。\n{{answers.rules}}\n{{request.url}}',
            ),
          },
        ),
      ],
    },
  },
  {
    name: 'firewallRule',
    label: plain('Firewall rule change approval', '防火牆規則異動簽核', 'ファイアウォール ルール変更の承認'),
    description: plain(
      'Manager, the network administrators evaluate, an ISMS approver signs off, then the network administrators configure the rules',
      '主管簽核、網路管理人員評估、權責主管簽核，再由網路管理人員設定規則',
      '上長の承認、ネットワーク管理者の評価、ISMS 承認者の承認の後、ネットワーク管理者がルールを設定',
    ),
    steps: [
      managerStep(),
      groupStep(
        'evaluation',
        GROUPS.network.key,
        t('Network evaluation', '網路管理人員評估', 'ネットワーク管理者の評価'),
        {
          instructions: t(
            'Check the rules are needed, as narrow as possible and on the right device. Reject with the reason if not.',
            '請評估規則的必要性、範圍是否最小化及設備是否正確；不符合時請退回並說明原因。',
            'ルールの必要性、範囲が最小限か、デバイスが正しいかを確認してください。問題があれば理由を添えて却下してください。',
          ),
          fields: [textarea('evaluation', t('Evaluation', '評估意見', '評価'))],
        },
      ),
      authorityStep(),
      groupStep(
        'configure',
        GROUPS.network.key,
        t('Network configuration', '網路管理人員設定', 'ネットワーク管理者による設定'),
        {
          instructions: t(
            'Configure the rules on the device, then record the date.',
            '請於設備完成設定後填寫設定日期。',
            'デバイスにルールを設定してから日付を記録してください。',
          ),
          fields: [
            date('configuredOn', t('Configured on', '設定完成日', '設定日'), required),
            textarea('notes', t('Notes', '備註', 'メモ')),
          ],
        },
      ),
    ],
  },
);

/* ───────────── 5. Network device rule and backup check ───────────── */

const networkDeviceCheck = requestProcess(
  {
    key: 'isms-network-device-check',
    name: t(
      'Network device rule and backup check',
      '網路設備政策規則及備份檢核',
      'ネットワーク デバイスのポリシー・ルールとバックアップの点検',
    ),
    description: t(
      'Quarterly configuration backups and the yearly firewall rule review',
      '每季設定檔備份與每年防火牆規則檢視',
      '四半期ごとの構成バックアップと年次のファイアウォール ルール見直し',
    ),
    icon: 'router',
    category: 'security',
    audience: [GROUPS.network.key],
    schema: {
      elements: elements(
        date('checkedOn', t('Checked on', '檢核日期', '点検日'), half),
        rows(
          'devices',
          t('Devices', '設備清單', 'デバイス'),
          [
            select(
              'category',
              t('Type', '設備類別', '種類'),
              [
                opt('firewall', t('Firewall', '防火牆', 'ファイアウォール')),
                opt('router', t('Router', '路由器', 'ルーター')),
                opt(
                  'wireless_controller',
                  t('Wireless controller', '無線控制器', 'ワイヤレス コントローラー'),
                ),
                opt('core_switch', t('Core switch', '核心交換器', 'コア スイッチ')),
              ],
              required,
            ),
            text('device', t('Device', '設備名稱', 'デバイス'), required),
            record('ci', t('CI', '組態項目', '構成アイテム'), ['cmdb.ci'], { where: NETWORK_DEVICE }),
            select(
              'ruleCheck',
              t('Rules', '規則檢視', 'ルール'),
              [
                opt('unchanged', t('Unchanged', '無異動', '変更なし')),
                opt('adjusted', t('Adjusted', '已調整', '調整済み')),
              ],
              required,
            ),
            select('securityCheck', t('Security settings', '安全設定', 'セキュリティ設定'), NORMAL, required),
            select('accessPolicy', t('Access policy', '存取政策', 'アクセス ポリシー'), NORMAL, required),
            select(
              'configBackup',
              t('Configuration backup', '設定檔備份', '構成のバックアップ'),
              [
                opt('done', t('Backed up', '已備份', 'バックアップ済み')),
                opt('failed', t('Failed', '備份失敗', '失敗')),
              ],
              required,
            ),
            text('note', t('Note', '備註', 'メモ')),
          ],
          { required: true, max: 50 },
        ),
        paragraph(
          'evidence',
          t(
            'After sending, attach the configuration backups or screenshots to the request as evidence.',
            '送出後，請於申請單附上設定檔備份或畫面截圖作為佐證。',
            '送信後、構成のバックアップや画面のスクリーンショットを証跡として申請に添付してください。',
          ),
        ),
      ),
      actions: [
        raiseTicket(
          'raise-anomaly',
          'submitted',
          t(
            'Raise an incident for abnormal devices',
            '設備異常時開立事件單',
            '異常なデバイスのインシデントを起票',
          ),
          {
            categoryRef: CATEGORIES.resourceAnomaly.ref,
            groupRef: GROUPS.network.ref,
            title: plain(
              'Network device check found an issue: {{request.reference}}',
              '網路設備檢核發現異常：{{request.reference}}',
              'ネットワーク デバイスの点検で問題が見つかりました: {{request.reference}}',
            ),
            description: plain(
              'Checked on {{data.checkedOn}}.\n{{answers.devices}}\n\n{{request.url}}',
              '檢核日期：{{data.checkedOn}}\n{{answers.devices}}\n\n{{request.url}}',
              '点検日: {{data.checkedOn}}\n{{answers.devices}}\n\n{{request.url}}',
            ),
            when: any(
              eq('data.devices.securityCheck', 'abnormal'),
              eq('data.devices.accessPolicy', 'abnormal'),
              eq('data.devices.configBackup', 'failed'),
            ),
          },
        ),
      ],
    },
  },
  {
    name: 'networkDeviceCheck',
    label: plain('Network device check review', '網路設備檢核覆核', 'ネットワーク デバイス点検の確認'),
    description: plain(
      'An ISMS approver reviews the check',
      '由權責主管覆核檢核結果',
      'ISMS 承認者が点検内容を確認',
    ),
    steps: [authorityStep()],
  },
);

/* ───────────── 15. Network access for visitors ───────────── */

const externalNetwork = requestProcess(
  {
    key: 'isms-external-network',
    name: t('Network access for visitors', '外部人員網路使用申請', '外部の方のネットワーク利用申請'),
    description: t(
      'Guest or internal network access for visitors and contractors, for at most 90 days',
      '訪客或外部廠商使用訪客網路或內部網路，期間最長 90 天',
      '来訪者や協力会社のゲスト・社内ネットワーク利用 (最長 90 日)',
    ),
    icon: 'wifi',
    category: 'access',
    schema: {
      elements: elements(
        text('visitorName', t('Visitor', '使用人員姓名', '利用者名'), half),
        text('company', t('Company', '所屬公司', '会社名'), half),
        user('sponsor', t('Host', '接待人員', '受け入れ担当者'), required),
        textarea('purpose', t('Purpose', '使用目的', '利用目的'), required),
        select(
          'connection',
          t('Network', '使用網路', 'ネットワーク'),
          [
            opt('guest', t('Guest network', '訪客網路', 'ゲスト ネットワーク')),
            opt('internal', t('Internal network', '內部網路', '社内ネットワーク')),
          ],
          { required: true, defaultValue: 'guest' },
        ),
        textarea(
          'internalReason',
          t('Why the internal network', '使用內部網路的理由', '社内ネットワークが必要な理由'),
          {
            visibleWhen: eq('connection', 'internal'),
          },
        ),
        rows(
          'devices',
          t('Devices', '使用設備', 'デバイス'),
          [
            text('type', t('Device type', '設備類型', 'デバイスの種類'), required),
            text(
              'identifier',
              t('MAC address or identifier', 'MAC 位址或識別碼', 'MAC アドレスまたは識別子'),
              required,
            ),
          ],
          { max: 20 },
        ),
        date('from', t('From', '使用起日', '開始日'), half),
        date('until', t('Until', '使用迄日', '終了日'), half),
      ),
      rules: [
        rule(
          'internal-reason',
          notEmpty('internalReason'),
          t(
            'Explain why the internal network is needed',
            '請說明需要使用內部網路的理由',
            '社内ネットワークが必要な理由を入力してください',
          ),
          { when: eq('connection', 'internal'), fields: ['internalReason'] },
        ),
        rule(
          'until-after-from',
          notBefore('until', 'from'),
          t('The end can’t be before the start', '使用迄日不可早於起日', '終了日は開始日以降にしてください'),
          { fields: ['until'] },
        ),
        rule(
          'at-most-90-days',
          withinDays('until', 'from', 90),
          t('Access is for at most 90 days', '使用期間最長 90 天', '利用期間は最長 90 日です'),
          { fields: ['until'] },
        ),
      ],
      actions: [
        remind(
          'remind-close',
          t('Remind to close the access', '到期提醒關閉網路權限', 'アクセス終了の通知'),
          {
            dateField: 'until',
            groupKeys: [GROUPS.network.key],
            title: plain(
              'Close network access for {{data.visitorName}} ({{data.company}}): {{request.reference}}',
              '請關閉 {{data.visitorName}}（{{data.company}}）的網路權限：{{request.reference}}',
              '{{data.visitorName}} ({{data.company}}) のネットワーク アクセスを終了: {{request.reference}}',
            ),
            message: '{{answers.connection}}\n{{answers.devices}}\n{{request.url}}',
          },
        ),
      ],
    },
  },
  {
    name: 'externalNetwork',
    label: plain(
      'Visitor network access approval',
      '外部人員網路使用簽核',
      '外部の方のネットワーク利用の承認',
    ),
    description: plain(
      'Manager, then the network administrators set up the access',
      '主管簽核後，由網路管理人員開通網路',
      '上長の承認の後、ネットワーク管理者がアクセスを設定',
    ),
    steps: [
      managerStep(),
      groupStep(
        'setup',
        GROUPS.network.key,
        t('Network configuration', '網路管理人員設定', 'ネットワーク管理者による設定'),
        {
          instructions: t(
            'Set up the access for the dates asked, then record how and when.',
            '請依申請期間開通網路，並填寫開通方式與日期。',
            '申請された期間のアクセスを設定し、方法と日付を記録してください。',
          ),
          fields: [
            text('method', t('How access was given', '開通方式', '設定方法'), required),
            date('doneOn', t('Done on', '完成日期', '完了日'), required),
          ],
        },
      ),
    ],
  },
);

export const networkProcesses: ItemTemplate[] = [...firewallRule, ...networkDeviceCheck, ...externalNetwork];
