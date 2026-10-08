/**
 * Threats and incidents: the record of how a piece of threat intelligence was assessed and handled (followed up as a
 * service desk incident for the network administrators), and the security incident report anyone can send.
 */
import {
  authorityStep,
  CATEGORIES,
  date,
  elements,
  GROUPS,
  type ItemTemplate,
  notBefore,
  opt,
  paragraph,
  plain,
  raiseTicket,
  record,
  remind,
  requestProcess,
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

/* ───────────── 7. Threat intelligence handling record ───────────── */

const threatIntel = requestProcess(
  {
    key: 'isms-threat-intel',
    name: t('Threat intelligence handling record', '威脅情資處理紀錄', '脅威インテリジェンス対応記録'),
    description: t(
      'How a threat notice or advisory was assessed, who handles it and by when',
      '記錄威脅情資或資安通報的評估結果、處理人員及完成期限',
      '脅威情報やセキュリティ勧告の評価、担当者、期限の記録',
    ),
    icon: 'radar',
    category: 'security',
    audience: [GROUPS.network.key, GROUPS.securityReview.key, GROUPS.it.key],
    schema: {
      elements: elements(
        date('reviewedOn', t('Assessed on', '評估日期', '評価日'), half),
        select(
          'source',
          t('Source', '情資來源', '情報源'),
          [
            opt(
              'group_notice',
              t('Group or head office notice', '集團／總部通報', 'グループ・本社からの通知'),
            ),
            opt(
              'external_feed',
              t('External feed (CERT, ISAC)', '外部情資來源（CERT、ISAC）', '外部の情報源 (CERT、ISAC)'),
            ),
            opt('vendor_advisory', t('Vendor advisory', '廠商公告', 'ベンダーの勧告')),
            OTHER,
          ],
          half,
        ),
        text('sourceDetail', t('Source details', '來源說明', '情報源の詳細'), {
          help: t(
            'Notice number, link or sender.',
            '通報編號、連結或來源單位。',
            '通知番号、リンク、送信元など。',
          ),
        }),
        textarea('content', t('What the intelligence says', '情資內容', '情報の内容'), required),
        textarea(
          'scope',
          t('Affected systems and impact', '影響範圍評估', '影響を受けるシステムと影響'),
          required,
        ),
        record(
          'cis',
          t('Configuration items affected', '受影響的組態項目', '影響を受ける構成アイテム'),
          ['cmdb.ci'],
          {
            multiple: true,
          },
        ),
        text('ownerDepartment', t('Responsible unit', '權責單位', '担当部署'), { width: 'half' }),
        user('handler', t('Handled by', '處理人員', '担当者'), { required: true, width: 'half' }),
        textarea('plannedAction', t('Planned action', '預計處理方式', '対応予定'), required),
        date('dueOn', t('Due on', '預計完成日', '完了予定日'), {
          ...half,
          help: t(
            'The handler is reminded on the day.',
            '處理人員會於當日收到提醒。',
            '担当者に当日通知されます。',
          ),
        }),
      ),
      rules: [
        rule(
          'due-after-review',
          notBefore('dueOn', 'reviewedOn'),
          t(
            'The due date can’t be before the assessment',
            '預計完成日不可早於評估日期',
            '完了予定日は評価日以降にしてください',
          ),
          { fields: ['dueOn'] },
        ),
      ],
      actions: [
        raiseTicket(
          'raise-incident',
          'approved',
          t(
            'Raise an incident for the network administrators',
            '開立事件單給網路管理人員',
            'ネットワーク管理者向けにインシデントを起票',
          ),
          {
            categoryRef: CATEGORIES.threatIntel.ref,
            groupRef: GROUPS.network.ref,
            title: plain(
              'Threat intelligence ({{answers.source}}): {{request.reference}}',
              '威脅情資（{{answers.source}}）：{{request.reference}}',
              '脅威インテリジェンス ({{answers.source}}): {{request.reference}}',
            ),
            description: plain(
              '{{data.content}}\n\nSource: {{answers.source}} {{data.sourceDetail}}\nScope: {{data.scope}}\nPlanned action: {{data.plannedAction}}\nHandled by: {{answers.handler}}, due {{data.dueOn}}\n\n{{request.url}}',
              '{{data.content}}\n\n情資來源：{{answers.source}} {{data.sourceDetail}}\n影響範圍：{{data.scope}}\n預計處理方式：{{data.plannedAction}}\n處理人員：{{answers.handler}}，預計完成日 {{data.dueOn}}\n\n{{request.url}}',
              '{{data.content}}\n\n情報源: {{answers.source}} {{data.sourceDetail}}\n影響範囲: {{data.scope}}\n対応予定: {{data.plannedAction}}\n担当者: {{answers.handler}} (完了予定日 {{data.dueOn}})\n\n{{request.url}}',
            ),
          },
        ),
        remind(
          'remind-due',
          t('Remind the handler on the due date', '於完成期限提醒處理人員', '完了予定日に担当者へ通知'),
          {
            dateField: 'dueOn',
            toRequester: false,
            userFields: ['handler'],
            title: plain(
              'Threat intelligence action due today: {{request.reference}}',
              '威脅情資處理今日到期：{{request.reference}}',
              '本日が期限の脅威インテリジェンス対応: {{request.reference}}',
            ),
            message: '{{data.plannedAction}}\n{{request.url}}',
          },
        ),
      ],
    },
  },
  {
    name: 'threatIntel',
    label: plain('Threat intelligence review', '威脅情資處理覆核', '脅威インテリジェンス対応の確認'),
    description: plain(
      'An ISMS approver reviews the assessment; the follow-up is a service desk incident',
      '由權責主管覆核評估結果；後續處理以服務台事件單追蹤',
      'ISMS 承認者が評価を確認。その後の対応はサービス デスクのインシデントで追跡',
    ),
    steps: [authorityStep()],
  },
);

/* ───────────── 18. Security incident report ───────────── */

const securityReport = requestProcess({
  key: 'isms-security-report',
  name: t('Security incident report', '資安異常通報', 'セキュリティ異常の報告'),
  description: t(
    'Report a lost device, a suspicious message, malware or anything else that looks wrong',
    '設備遺失、可疑郵件、惡意程式或其他異常狀況通報',
    'デバイスの紛失、不審なメッセージ、マルウェアなどの異常を報告',
  ),
  icon: 'siren',
  category: 'security',
  schema: {
    elements: elements(
      paragraph(
        'when-to-report',
        t(
          'Report within 24 hours of noticing it. Don’t delete suspicious messages or switch off an infected device: disconnect it from the network and wait for the security team.',
          '發現後請於 24 小時內通報。請勿刪除可疑郵件或關閉疑似中毒的設備，先中斷網路連線並等候資安人員處理。',
          '気付いてから 24 時間以内に報告してください。不審なメッセージを削除したり、感染が疑われるデバイスの電源を切ったりせず、ネットワークから切断してセキュリティ担当者の対応を待ってください。',
        ),
      ),
      select(
        'type',
        t('What happened', '異常類型', '事象'),
        [
          opt('lost_device', t('Device lost or stolen', '設備遺失或遭竊', 'デバイスの紛失・盗難')),
          opt(
            'suspicious_message',
            t('Suspicious email or message', '可疑郵件或訊息', '不審なメールやメッセージ'),
          ),
          opt(
            'system_error',
            t('System error or strange screen', '系統錯誤或畫面異常', 'システム エラーや画面の異常'),
          ),
          opt(
            'account_anomaly',
            t('Account or permission anomaly', '帳號權限異常', 'アカウント・権限の異常'),
          ),
          opt('malware', t('Malware', '惡意程式', 'マルウェア')),
          OTHER,
        ],
        required,
      ),
      date('occurredOn', t('Noticed on', '發生日期', '発生日'), half),
      text('occurredAt', t('Time', '發生時間', '時刻'), {
        width: 'half',
        placeholder: t('09:30', '09:30', '09:30'),
      }),
      record('device', t('Device (if any)', '相關設備（如有）', '関係するデバイス (ある場合)'), [
        'itam.asset',
      ]),
      textarea('description', t('What you noticed', '異常情形說明', '気付いた内容'), required),
      textarea('actionsTaken', t('What you have done so far', '已採取的處置', 'これまでに行った対応')),
    ),
    actions: [
      raiseTicket(
        'raise-incident',
        'submitted',
        t(
          'Raise a high-priority incident for the security reviewers',
          '開立高優先事件單給資訊安全複審人員',
          'セキュリティ レビュー担当に優先度高のインシデントを起票',
        ),
        {
          priority: '2',
          categoryRef: CATEGORIES.securityReport.ref,
          groupRef: GROUPS.securityReview.ref,
          title: plain(
            'Security report: {{answers.type}} ({{request.reference}})',
            '資安異常通報：{{answers.type}}（{{request.reference}}）',
            'セキュリティ異常の報告: {{answers.type}} ({{request.reference}})',
          ),
          description: plain(
            '{{data.description}}\n\nNoticed on {{data.occurredOn}} {{data.occurredAt}}\nDone so far: {{data.actionsTaken}}\nReported by {{requester.displayName}} ({{requester.email}})\n\n{{request.url}}',
            '{{data.description}}\n\n發生時間：{{data.occurredOn}} {{data.occurredAt}}\n已採取的處置：{{data.actionsTaken}}\n通報人：{{requester.displayName}}（{{requester.email}}）\n\n{{request.url}}',
            '{{data.description}}\n\n発生日時: {{data.occurredOn}} {{data.occurredAt}}\nこれまでの対応: {{data.actionsTaken}}\n報告者: {{requester.displayName}} ({{requester.email}})\n\n{{request.url}}',
          ),
        },
      ),
    ],
  },
});

export const incidentProcesses: ItemTemplate[] = [...threatIntel, ...securityReport];
