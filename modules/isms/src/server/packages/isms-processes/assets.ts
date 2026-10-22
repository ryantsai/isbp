/**
 * Information assets and devices: asset changes (raised as a change for the CAB), device checkout with the security
 * agreement and return with its data retention, software installation, portable media exceptions and instant
 * messaging exceptions.
 */
import {
  action,
  afterToday,
  all,
  any,
  authorityStep,
  boolean,
  date,
  elements,
  eq,
  GROUPS,
  groupStep,
  heading,
  isIn,
  type ItemTemplate,
  managerStep,
  multiselect,
  mustTick,
  NORMAL,
  notBefore,
  notEmpty,
  number,
  opt,
  paragraph,
  plain,
  raiseTicket,
  record,
  ref,
  remind,
  requestProcess,
  rows,
  rule,
  select,
  t,
  text,
  textarea,
  url,
  user,
} from './build';

const required = { required: true };
const half = { required: true, width: 'half' as const };
const OTHER = opt('other', t('Other', '其他', 'その他'));
const NONE = opt('none', t('None', '無', 'なし'));

/* ───────────── 6. Information asset change ───────────── */

const DOC_DIAGRAM = 'network_diagram';
const DOC_RACKS = 'rack_layout';
const DOC_REGISTER = 'asset_register';

const assetChange = requestProcess(
  {
    key: 'isms-asset-change',
    name: t('Information asset change request', '資訊資產變更作業申請', '情報資産の変更作業申請'),
    description: t(
      'Hardware or software changes to systems; approved requests become a change for the CAB',
      '系統硬體或軟體變更作業，核准後開立變更單送變更諮詢委員會審查',
      'システムのハードウェア・ソフトウェア変更。承認後に変更として CAB に提出',
    ),
    icon: 'file-pen-line',
    category: 'changes',
    schema: {
      elements: elements(
        text('systemName', t('System', '系統名稱', 'システム名'), required),
        textarea('description', t('What will change', '變更內容說明', '変更内容'), required),
        select(
          'hardwareNeed',
          t('Hardware', '硬體需求', 'ハードウェア'),
          [
            opt('new', t('New', '新增', '新規')),
            opt('change', t('Change', '異動', '変更')),
            opt('maintenance', t('Maintenance', '維護', '保守')),
            OTHER,
            NONE,
          ],
          half,
        ),
        select(
          'softwareNeed',
          t('Software', '軟體需求', 'ソフトウェア'),
          [
            opt('new', t('New', '新增', '新規')),
            opt('change', t('Change', '異動', '変更')),
            opt('program_change', t('Program change', '程式變更', 'プログラム変更')),
            opt('maintenance', t('Maintenance', '維護', '保守')),
            OTHER,
            NONE,
          ],
          half,
        ),
        record(
          'cis',
          t('Configuration items affected', '受影響的組態項目', '影響を受ける構成アイテム'),
          ['cmdb.ci'],
          {
            multiple: true,
            help: t(
              'The change raised on approval is linked to them.',
              '核准後開立的變更單會連結這些組態項目。',
              '承認後に起票される変更はこれらの構成アイテムにリンクされます。',
            ),
          },
        ),
        record(
          'assets',
          t('Information assets affected', '受影響的資訊資產', '影響を受ける情報資産'),
          ['isms.asset'],
          { multiple: true },
        ),
        textarea('impact', t('Impact', '影響評估', '影響'), required),
        number(
          'downtimeMinutes',
          t('Expected downtime (minutes)', '預計停機時間（分鐘）', '想定停止時間 (分)'),
          {
            ...half,
            defaultValue: 0,
            validation: { min: 0 },
          },
        ),
        boolean(
          'notifyAffected',
          t('Tell affected users beforehand', '事先通知受影響人員', '影響を受けるユーザーに事前通知'),
          {
            width: 'half',
          },
        ),
        date('plannedStart', t('Planned start', '預計開始日', '開始予定日'), half),
        date('plannedEnd', t('Planned end', '預計完成日', '終了予定日'), half),
        textarea('rollbackPlan', t('Rollback plan', '回復計畫', 'ロールバック計画'), {
          help: t(
            'Required when there is downtime or the hardware changes.',
            '有停機或硬體異動時必填。',
            '停止時間がある場合やハードウェアを変更する場合は必須です。',
          ),
        }),
        multiselect('docsToUpdate', t('Documents to update', '需更新的文件', '更新する文書'), [
          opt(DOC_DIAGRAM, t('Network diagram', '網路架構圖', 'ネットワーク構成図')),
          opt(DOC_RACKS, t('Rack layout', '機櫃配置圖', 'ラック配置図')),
          opt(DOC_REGISTER, t('Asset register', '資產清冊', '資産台帳')),
        ]),
      ),
      rules: [
        rule(
          'end-after-start',
          notBefore('plannedEnd', 'plannedStart'),
          t(
            'The end can’t be before the start',
            '預計完成日不可早於開始日',
            '終了予定日は開始予定日以降にしてください',
          ),
          { fields: ['plannedEnd'] },
        ),
        rule(
          'rollback',
          notEmpty('rollbackPlan'),
          t(
            'Give a rollback plan for a change with downtime or a hardware change',
            '有停機或硬體異動的變更，請填寫回復計畫',
            '停止時間やハードウェア変更がある場合はロールバック計画を入力してください',
          ),
          {
            when: any({ fact: 'downtimeMinutes', op: 'gt', value: 0 }, eq('hardwareNeed', 'change')),
            fields: ['rollbackPlan'],
          },
        ),
      ],
      actions: [
        action(
          'raise-change',
          'approved',
          'itsm.create-change',
          t('Raise the change', '開立變更單', '変更を起票'),
          {
            title: plain(
              '{{data.systemName}}: {{request.form}} ({{request.reference}})',
              '{{data.systemName}}：{{request.form}}（{{request.reference}}）',
              '{{data.systemName}}: {{request.form}} ({{request.reference}})',
            ),
            description: plain(
              '{{data.description}}\n\nHardware: {{answers.hardwareNeed}} · Software: {{answers.softwareNeed}}\nImpact: {{data.impact}}\nDowntime: {{data.downtimeMinutes}} min\n\nRaised from request {{request.reference}} ({{request.url}}).',
              '{{data.description}}\n\n硬體需求：{{answers.hardwareNeed}} · 軟體需求：{{answers.softwareNeed}}\n影響評估：{{data.impact}}\n停機時間：{{data.downtimeMinutes}} 分鐘\n\n由申請單 {{request.reference}} 開立（{{request.url}}）。',
              '{{data.description}}\n\nハードウェア: {{answers.hardwareNeed}} · ソフトウェア: {{answers.softwareNeed}}\n影響: {{data.impact}}\n停止時間: {{data.downtimeMinutes}} 分\n\n申請 {{request.reference}} から起票 ({{request.url}})。',
            ),
            changeType: 'normal',
            risk: 'medium',
            ciField: 'cis',
            plannedStartField: 'plannedStart',
            plannedEndField: 'plannedEnd',
            backoutPlan: '{{data.rollbackPlan}}',
            submit: true,
          },
        ),
        action(
          'tell-network',
          'approved',
          'core.notify',
          t('Tell the network administrators', '通知網路管理人員', 'ネットワーク管理者に通知'),
          {
            toRequester: false,
            groups: [ref(GROUPS.network.ref)],
            title: plain(
              'Update the network diagram or rack layout: {{data.systemName}} ({{request.reference}})',
              '請更新網路架構圖或機櫃配置圖：{{data.systemName}}（{{request.reference}}）',
              'ネットワーク構成図またはラック配置図の更新: {{data.systemName}} ({{request.reference}})',
            ),
            message: '{{answers.docsToUpdate}}\n{{data.description}}\n{{request.url}}',
          },
          isIn('data.docsToUpdate', [DOC_DIAGRAM, DOC_RACKS]),
        ),
        action(
          'tell-it',
          'approved',
          'core.notify',
          t('Tell IS operations', '通知資訊部門', 'IS 運用に通知'),
          {
            toRequester: false,
            groups: [ref(GROUPS.it.ref)],
            title: plain(
              'Update the asset register: {{data.systemName}} ({{request.reference}})',
              '請更新資產清冊：{{data.systemName}}（{{request.reference}}）',
              '資産台帳の更新: {{data.systemName}} ({{request.reference}})',
            ),
            message: '{{data.description}}\n{{request.url}}',
          },
          eq('data.docsToUpdate', DOC_REGISTER),
        ),
      ],
    },
  },
  {
    name: 'assetChange',
    label: plain('Information asset change approval', '資訊資產變更作業簽核', '情報資産変更作業の承認'),
    description: plain(
      'Manager, then an ISMS approver; the change it raises goes through its own CAB authorization',
      '主管簽核後由權責主管簽核；核准後開立的變更單另經變更諮詢委員會（CAB）審查',
      '上長、ISMS 承認者の順に承認。起票された変更は別途 CAB の承認を受けます',
    ),
    steps: [managerStep(), authorityStep()],
  },
);

/* ───────────── 12. Device checkout and security agreement ───────────── */

const COMMITMENTS = t(
  [
    'With the device I will:',
    '1. Set a power-on password and lock the screen when I step away.',
    '2. Keep disk encryption on.',
    '3. Keep confidential data only in the company’s cloud storage.',
    '4. Install only approved software.',
    '5. Connect through the VPN on public networks.',
    '6. Never turn off the antivirus or remove the monitoring software.',
    '7. Keep it safe and never leave it unattended in a car or public place.',
    '8. Use a privacy screen outside the office.',
    '9. Report loss, damage or infection within 24 hours.',
    '10. Return it on my last working day.',
    '11. Take it off site only with my manager’s approval.',
    '12. Accept random compliance checks.',
  ].join('\n'),
  [
    '使用本設備時，本人同意：',
    '1. 設定開機密碼，離開座位時鎖定螢幕。',
    '2. 保持磁碟加密開啟。',
    '3. 機敏資料僅存放於公司雲端儲存空間。',
    '4. 僅安裝經核准的軟體。',
    '5. 使用公共網路時須連線 VPN。',
    '6. 不得關閉防毒軟體或移除監控軟體。',
    '7. 妥善保管設備，不得置於車內或公共場所無人看管。',
    '8. 於公司外使用時加裝防窺片。',
    '9. 設備遺失、損壞或中毒時，於 24 小時內通報。',
    '10. 離職時於最後工作日歸還設備。',
    '11. 攜出公司須經主管核准。',
    '12. 接受不定期的使用情形抽查。',
  ].join('\n'),
  [
    'デバイスの利用にあたり、次のことを守ります:',
    '1. 起動パスワードを設定し、離席時は画面をロックする。',
    '2. ディスクの暗号化を有効にしておく。',
    '3. 機密データは会社のクラウド ストレージにのみ保存する。',
    '4. 承認されたソフトウェアのみをインストールする。',
    '5. 公衆ネットワークでは VPN 経由で接続する。',
    '6. ウイルス対策ソフトを無効にしたり、監視ソフトウェアを削除したりしない。',
    '7. 大切に保管し、車内や公共の場所に放置しない。',
    '8. 社外では覗き見防止フィルターを使う。',
    '9. 紛失・破損・ウイルス感染は 24 時間以内に報告する。',
    '10. 最終出社日に返却する。',
    '11. 社外への持ち出しは上長の承認を得てから行う。',
    '12. 遵守状況の抜き打ち確認に応じる。',
  ].join('\n'),
);

const deviceCheckout = requestProcess(
  {
    key: 'isms-device-checkout',
    name: t(
      'Device checkout and security agreement',
      '資訊資產領用暨安全保密切結',
      'デバイスの貸与とセキュリティ誓約',
    ),
    description: t(
      'A company laptop or smartphone, with the security commitments that come with it',
      '領用公司筆記型電腦或智慧型手機，並簽署安全保密切結',
      '会社のノート PC やスマートフォンの貸与とセキュリティ誓約',
    ),
    icon: 'laptop',
    category: 'hardware',
    schema: {
      elements: elements(
        select(
          'deviceType',
          t('Device', '設備類型', 'デバイス'),
          [
            opt('laptop', t('Laptop', '筆記型電腦', 'ノート PC')),
            opt('smartphone', t('Smartphone', '智慧型手機', 'スマートフォン')),
          ],
          half,
        ),
        boolean('offsite', t('I will take it off site', '需攜出公司使用', '社外に持ち出す'), {
          width: 'half',
        }),
        textarea('purpose', t('What it is for', '領用用途', '用途'), required),
        heading('h-agreement', t('Security commitments', '安全保密切結事項', 'セキュリティ誓約事項')),
        paragraph('commitments', COMMITMENTS),
        mustTick(
          'agree',
          t(
            'I have read these commitments and will follow them',
            '本人已詳閱並同意遵守上述規定',
            '上記の事項を読み、遵守します',
          ),
        ),
      ),
      actions: [
        action(
          'assign',
          'approved',
          'itam.assign-asset',
          t('Hand the device to the requester', '將設備指派給申請人', 'デバイスを申請者に割り当て'),
          {
            assetField: 'step',
            assetStepField: 'issue.asset',
            assignTo: 'requester',
            note: plain(
              'Issued with {{request.reference}} ({{request.form}}) on {{steps.issue.issuedOn}}; security agreement accepted.',
              '依 {{request.reference}}（{{request.form}}）於 {{steps.issue.issuedOn}} 發放；已簽署安全保密切結。',
              '{{request.reference}} ({{request.form}}) により {{steps.issue.issuedOn}} に貸与。セキュリティ誓約に同意済み。',
            ),
          },
        ),
      ],
    },
  },
  {
    name: 'deviceCheckout',
    label: plain('Device checkout approval', '資訊資產領用簽核', 'デバイス貸与の承認'),
    description: plain(
      'Manager, then IS picks the device, checks its security baseline and hands it over',
      '主管簽核後，由資訊部門選擇設備、確認安全基準設定並發放',
      '上長の承認の後、IS 部門がデバイスを選び、セキュリティ基準を確認して貸与',
    ),
    steps: [
      managerStep(),
      groupStep(
        'issue',
        GROUPS.it.key,
        t('IS issues the device', '資訊部門發放設備', 'IS 部門によるデバイスの貸与'),
        {
          instructions: t(
            'Pick the device, check its security baseline and record when you hand it over.',
            '請選擇發放的設備，逐項確認安全基準設定，並填寫發放日期。',
            'デバイスを選び、セキュリティ基準を確認して、貸与日を記録してください。',
          ),
          fields: [
            record('asset', t('Device', '發放設備', 'デバイス'), ['itam.asset'], {
              required: true,
              where: all(isIn('category', ['laptop', 'phone']), eq('status', 'in_stock')),
            }),
            mustTick(
              'mdmEnrolled',
              t(
                'Enrolled in device management and bound to the user',
                '已納入行動裝置管理並綁定使用者',
                'デバイス管理に登録し、ユーザーに紐付け済み',
              ),
            ),
            mustTick('diskEncryption', t('Disk encryption on', '已啟用磁碟加密', 'ディスクの暗号化が有効')),
            mustTick(
              'antivirus',
              t('Antivirus installed', '已安裝防毒軟體', 'ウイルス対策ソフトをインストール済み'),
            ),
            mustTick(
              'monitoringAgent',
              t('Monitoring agent installed', '已安裝監控代理程式', '監視エージェントをインストール済み'),
            ),
            mustTick('vpnConfigured', t('VPN configured', '已設定 VPN', 'VPN を設定済み')),
            mustTick('osUpdated', t('Operating system up to date', '作業系統已更新', 'OS を最新に更新済み')),
            date('issuedOn', t('Handed over on', '發放日期', '貸与日'), required),
          ],
        },
      ),
    ],
  },
);

/* ───────────── 13. Device return ───────────── */

const returnCondition = plain(
  'Returned with {{request.reference}} on {{data.returnedOn}}. Data check: {{steps.receive.dataCheck}} {{steps.receive.dataCheckNote}}. Appearance: {{steps.receive.appearance}} {{steps.receive.appearanceNote}}. Stored at: {{steps.receive.storedAt}}. {{data.note}}',
  '依 {{request.reference}} 於 {{data.returnedOn}} 歸還。資料檢查：{{steps.receive.dataCheck}} {{steps.receive.dataCheckNote}}。外觀：{{steps.receive.appearance}} {{steps.receive.appearanceNote}}。存放位置：{{steps.receive.storedAt}}。{{data.note}}',
  '{{request.reference}} により {{data.returnedOn}} に返却。データの確認: {{steps.receive.dataCheck}} {{steps.receive.dataCheckNote}}。外観: {{steps.receive.appearance}} {{steps.receive.appearanceNote}}。保管場所: {{steps.receive.storedAt}}。{{data.note}}',
);

const takeBack = (
  id: string,
  toStatus: 'in_stock' | 'in_repair',
  name: ReturnType<typeof t>,
  appearance: string,
) =>
  action(
    id,
    'approved',
    'itam.return-asset',
    name,
    {
      assetField: 'field:asset',
      toStatus,
      condition: returnCondition,
      retentionFrom: 'step',
      retentionStepField: 'receive.retainUntil',
    },
    eq('steps.receive.appearance', appearance),
  );

const deviceReturn = requestProcess(
  {
    key: 'isms-device-return',
    name: t('Device return', '資訊資產歸還申請', 'デバイスの返却'),
    description: t(
      'Return a company device; IS checks it and keeps its data until a set date',
      '歸還公司設備，由資訊部門點收並保留資料至指定日期',
      '会社のデバイスを返却。IS 部門が確認し、データを期限まで保持',
    ),
    icon: 'undo-2',
    category: 'hardware',
    schema: {
      elements: elements(
        record('asset', t('Device', '歸還設備', 'デバイス'), ['itam.asset'], required),
        date('returnedOn', t('Returned on', '歸還日期', '返却日'), half),
        text('returnTime', t('Time', '歸還時間', '時刻'), {
          width: 'half',
          placeholder: t('14:30', '14:30', '14:30'),
          validation: { pattern: '([01]?\\d|2[0-3]):[0-5]\\d' },
        }),
        textarea('note', t('Note', '備註', 'メモ')),
      ),
      actions: [
        takeBack(
          'return-stock',
          'in_stock',
          t('Take the device back to stock', '設備歸還入庫', 'デバイスを在庫に戻す'),
          'good',
        ),
        takeBack(
          'return-repair',
          'in_repair',
          t('Take the damaged device back for repair', '損壞設備送修', '破損したデバイスを修理へ'),
          'damaged',
        ),
      ],
    },
  },
  {
    name: 'deviceReturn',
    label: plain('Device return handling', '資訊資產歸還簽核', 'デバイス返却の処理'),
    description: plain(
      'IS receives the device and records its checks and data retention, then an ISMS approver signs off',
      '資訊部門點收設備並記錄檢查結果與資料保留期限，再由權責主管簽核',
      'IS 部門がデバイスを受領して確認結果とデータの保持期限を記録し、ISMS 承認者が承認',
    ),
    steps: [
      groupStep('receive', GROUPS.it.key, t('IS receives the device', '資訊部門點收', 'IS 部門による受領'), {
        instructions: t(
          'Check the data and the device, and set how long its data is kept. The data wipe is due a few months after that date.',
          '請檢查資料與設備外觀，並設定資料保留期限；資料清除期限為保留期限後數個月。',
          'データとデバイスを確認し、データの保持期限を設定してください。データ消去の期限はその数か月後です。',
        ),
        fields: [
          date('receivedOn', t('Received on', '點收日期', '受領日'), required),
          select('dataCheck', t('Data check', '資料檢查', 'データの確認'), NORMAL, required),
          text('dataCheckNote', t('Data check note', '資料檢查說明', 'データ確認のメモ')),
          select(
            'appearance',
            t('Appearance', '外觀', '外観'),
            [opt('good', t('Good', '良好', '良好')), opt('damaged', t('Damaged', '損壞', '破損'))],
            required,
          ),
          text('appearanceNote', t('Appearance note', '外觀說明', '外観のメモ')),
          date('retainUntil', t('Keep the data until', '資料保留期限', 'データの保持期限'), required),
          text('storedAt', t('Stored at', '存放位置', '保管場所')),
          boolean('factoryReset', t('Factory reset done', '已回復原廠設定', '初期化済み')),
        ],
      }),
      authorityStep(),
    ],
  },
);

/* ───────────── 14. Software installation ───────────── */

const softwareInstall = requestProcess(
  {
    key: 'isms-software-install',
    name: t('Software installation request', '軟體安裝與使用申請', 'ソフトウェアのインストールと使用の申請'),
    description: t(
      'Install software that isn’t on the approved list yet',
      '安裝尚未列入核准清單的軟體',
      '承認済みリストにないソフトウェアのインストール',
    ),
    icon: 'package-plus',
    category: 'software',
    schema: {
      elements: elements(
        record('device', t('Device', '安裝設備', 'デバイス'), ['itam.asset'], required),
        text('softwareName', t('Software', '軟體名稱', 'ソフトウェア名'), half),
        text('version', t('Version', '版本', 'バージョン'), { width: 'half' }),
        text('publisher', t('Publisher', '發行廠商', '発行元'), { width: 'half' }),
        url('website', t('Website', '官方網站', 'Web サイト'), { width: 'half' }),
        select(
          'licenceType',
          t('Licence', '授權類型', 'ライセンス'),
          [
            opt('free', t('Free', '免費軟體', 'フリーウェア')),
            opt('open_source', t('Open source', '開放原始碼', 'オープン ソース')),
            opt('shareware', t('Shareware or trial', '共享軟體／試用版', 'シェアウェア・試用版')),
            opt('paid', t('Paid licence to buy', '需購買授權', '購入が必要なライセンス')),
          ],
          half,
        ),
        url('downloadUrl', t('Download link', '下載網址', 'ダウンロード URL'), { width: 'half' }),
        textarea('purpose', t('What it is for', '使用目的', '用途'), required),
        select(
          'usage',
          t('Use', '使用期間', '使用期間'),
          [
            opt('permanent', t('Permanent', '長期使用', '継続的に使用')),
            opt('short_term', t('Short term', '短期使用', '短期間のみ')),
          ],
          half,
        ),
        date('until', t('Use until', '使用迄日', '使用終了日'), {
          ...half,
          visibleWhen: eq('usage', 'short_term'),
          help: t(
            'You and IS are reminded a week before.',
            '到期前一週會提醒您與資訊部門。',
            '1 週間前にあなたと IS 部門に通知されます。',
          ),
        }),
      ),
      rules: [
        rule(
          'until-later',
          afterToday('until'),
          t('The end must be after today', '使用迄日須晚於今天', '使用終了日は明日以降にしてください'),
          { when: eq('usage', 'short_term'), fields: ['until'] },
        ),
      ],
      actions: [
        action(
          'approve',
          'approved',
          'itam.approve-software',
          t('Add it to the approved software list', '加入核准軟體清單', '承認済みソフトウェアに追加'),
          {
            title: '{{data.softwareName}}',
            publisher: '{{data.publisher}}',
            version: '{{data.version}}',
            licenseModel: 'free',
            licenseModelField: 'field:licenceType',
            scope: 'department',
            validUntilFrom: 'field:until',
            notes: plain(
              'Approved with {{request.reference}} ({{requester.displayName}}): {{data.purpose}}',
              '依 {{request.reference}}（{{requester.displayName}}）核准：{{data.purpose}}',
              '{{request.reference}} ({{requester.displayName}}) により承認: {{data.purpose}}',
            ),
          },
        ),
        remind(
          'remind-end',
          t(
            'Remind a week before short-term use ends',
            '短期使用到期前一週提醒',
            '短期使用終了の 1 週間前に通知',
          ),
          {
            dateField: 'until',
            offsetDays: -7,
            groupKeys: [GROUPS.it.key],
            title: plain(
              'Short-term use of {{data.softwareName}} ends on {{data.until}} ({{request.reference}})',
              '{{data.softwareName}} 短期使用將於 {{data.until}} 到期（{{request.reference}}）',
              '{{data.softwareName}} の短期使用は {{data.until}} に終了 ({{request.reference}})',
            ),
            message: plain(
              'Uninstall it, or ask again to keep using it.\n{{request.url}}',
              '請移除軟體，或重新申請以繼續使用。\n{{request.url}}',
              'アンインストールするか、引き続き使用する場合は再度申請してください。\n{{request.url}}',
            ),
            when: eq('data.usage', 'short_term'),
          },
        ),
        raiseTicket(
          'buy-licence',
          'approved',
          t('Ask to buy the licence', '開立授權採購需求', 'ライセンス購入を依頼'),
          {
            type: 'service_request',
            groupRef: GROUPS.it.ref,
            title: plain(
              'Buy licence: {{data.softwareName}} {{data.version}} ({{request.reference}})',
              '採購授權：{{data.softwareName}} {{data.version}}（{{request.reference}}）',
              'ライセンスの購入: {{data.softwareName}} {{data.version}} ({{request.reference}})',
            ),
            description: plain(
              'Publisher: {{data.publisher}}\nWebsite: {{data.website}}\nFor: {{requester.displayName}}\n{{data.purpose}}\n\n{{request.url}}',
              '發行廠商：{{data.publisher}}\n官方網站：{{data.website}}\n使用人員：{{requester.displayName}}\n{{data.purpose}}\n\n{{request.url}}',
              '発行元: {{data.publisher}}\nWeb サイト: {{data.website}}\n利用者: {{requester.displayName}}\n{{data.purpose}}\n\n{{request.url}}',
            ),
            when: eq('data.licenceType', 'paid'),
          },
        ),
      ],
    },
  },
  {
    name: 'softwareInstall',
    label: plain('Software installation approval', '軟體安裝與使用簽核', 'ソフトウェア インストールの承認'),
    description: plain(
      'Manager, then a security reviewer checks the software before it is approved',
      '主管簽核後，由資訊安全複審人員檢查軟體後再核准',
      '上長の承認の後、セキュリティ レビュー担当がソフトウェアを確認してから承認',
    ),
    steps: [
      managerStep(),
      groupStep(
        'review',
        GROUPS.securityReview.key,
        t('Security review', '資訊安全複審', 'セキュリティ レビュー'),
        {
          instructions: t(
            'Scan the installer, check it works with the current environment and that the licence allows this use.',
            '請掃描安裝檔，並確認與現行環境相容、授權符合使用方式。',
            'インストーラーをスキャンし、現在の環境との互換性と、ライセンスがこの用途を認めていることを確認してください。',
          ),
          fields: [
            mustTick(
              'noMalware',
              t(
                'Scanned: no known malicious signatures',
                '已掃描，無已知惡意特徵',
                'スキャン済み: 既知の悪意あるシグネチャなし',
              ),
            ),
            mustTick(
              'compatible',
              t('Compatible with the current environment', '與現行環境相容', '現在の環境と互換性あり'),
            ),
            mustTick(
              'licenceCompliant',
              t('Licence terms are met', '授權合法合規', 'ライセンス条件を満たしている'),
            ),
            select(
              'cloudService',
              t('Cloud service assessment', '雲端服務評估', 'クラウド サービスの評価'),
              [
                opt('not_needed', t('Not needed', '不需要', '不要')),
                opt('completed', t('Completed', '已完成', '完了')),
                opt('other', t('Other', '其他', 'その他')),
              ],
              required,
            ),
            text('cloudServiceNote', t('Explain', '說明', '説明'), {
              required: true,
              visibleWhen: eq('cloudService', 'other'),
            }),
          ],
        },
      ),
    ],
  },
);

/* ───────────── 16. Portable media and sensitive data exception ───────────── */

const mediaException = requestProcess(
  {
    key: 'isms-media-exception',
    name: t(
      'Portable media and sensitive data exception',
      '可攜式媒體與機敏資料攜出例外申請',
      'リムーバブル メディアと機密データ持ち出しの例外申請',
    ),
    description: t(
      'Store or take sensitive data on portable media when the policy doesn’t allow it',
      '依規定不得進行的可攜式媒體儲存或機敏資料攜出之例外申請',
      '規定で認められないリムーバブル メディアへの保存や機密データの持ち出しの例外',
    ),
    icon: 'usb',
    category: 'security',
    schema: {
      elements: elements(
        select(
          'type',
          t('Exception', '例外類型', '例外の種類'),
          [
            opt(
              'store_confidential',
              t(
                'Store Strictly Confidential data on portable media',
                '以可攜式媒體儲存極機密資料',
                '極秘データをリムーバブル メディアに保存',
              ),
            ),
            opt(
              'unencrypted_offsite',
              t(
                'Take unencrypted media off site',
                '攜出未加密的媒體',
                '暗号化されていないメディアを社外に持ち出す',
              ),
            ),
            opt(
              'backup_media',
              t('Lend or copy backup media', '借出或複製備份媒體', 'バックアップ メディアの貸し出し・複製'),
            ),
          ],
          required,
        ),
        record('media', t('Media (if registered)', '媒體（如已登錄）', 'メディア (登録済みの場合)'), [
          'itam.asset',
        ]),
        text('mediaDescription', t('Media', '媒體說明', 'メディアの説明'), required),
        textarea('data', t('Data', '資料內容', 'データの内容'), required),
        select(
          'classification',
          t('Classification', '資料機密等級', '機密区分'),
          [
            opt('strictly-confidential', t('Strictly Confidential', '極機密', '極秘')),
            opt('customer-confidential', t('Customer Confidential', '客戶機密', '顧客機密')),
            opt('confidential', t('Confidential', '機密', '機密')),
            opt('internal-use-only', t('Internal Use Only', '限內部使用', '社内限り')),
          ],
          half,
        ),
        select(
          'encryption',
          t('Encryption', '加密', '暗号化'),
          [
            opt('encrypted', t('Encrypted', '已加密', '暗号化済み')),
            opt('cannot_encrypt', t('Can’t be encrypted', '無法加密', '暗号化できない')),
          ],
          half,
        ),
        textarea('encryptionReason', t('Why it can’t be encrypted', '無法加密的原因', '暗号化できない理由'), {
          visibleWhen: eq('encryption', 'cannot_encrypt'),
        }),
        text('destination', t('Where it goes', '攜出地點／用途', '持ち出し先'), required),
        date('from', t('From', '起日', '開始日'), half),
        date('until', t('Until', '迄日', '終了日'), half),
      ),
      rules: [
        rule(
          'encryption-reason',
          notEmpty('encryptionReason'),
          t(
            'Explain why it can’t be encrypted',
            '請說明無法加密的原因',
            '暗号化できない理由を入力してください',
          ),
          { when: eq('encryption', 'cannot_encrypt'), fields: ['encryptionReason'] },
        ),
        rule(
          'until-after-from',
          notBefore('until', 'from'),
          t('The end can’t be before the start', '迄日不可早於起日', '終了日は開始日以降にしてください'),
          { fields: ['until'] },
        ),
      ],
      actions: [
        remind('remind-end', t('Remind when the exception ends', '例外到期提醒', '例外の終了時に通知'), {
          dateField: 'until',
          title: plain(
            'Portable media exception ends today: {{request.reference}}',
            '可攜式媒體例外今日到期：{{request.reference}}',
            '本日でリムーバブル メディアの例外が終了: {{request.reference}}',
          ),
          message: plain(
            'Return the media or delete the data from it.\n{{data.mediaDescription}}\n{{request.url}}',
            '請歸還媒體或刪除其中的資料。\n{{data.mediaDescription}}\n{{request.url}}',
            'メディアを返却するか、メディアからデータを削除してください。\n{{data.mediaDescription}}\n{{request.url}}',
          ),
        }),
      ],
    },
  },
  {
    name: 'mediaException',
    label: plain(
      'Portable media exception approval',
      '可攜式媒體與機敏資料攜出例外簽核',
      'リムーバブル メディア持ち出し例外の承認',
    ),
    description: plain(
      'Manager, then an ISMS approver',
      '主管簽核後由權責主管簽核',
      '上長、ISMS 承認者の順に承認',
    ),
    steps: [managerStep(), authorityStep()],
  },
);

/* ───────────── 17. Instant messaging exception ───────────── */

const imException = requestProcess(
  {
    key: 'isms-im-exception',
    name: t(
      'Instant messaging exception',
      '即時通訊軟體例外使用申請',
      'インスタント メッセージングの例外使用申請',
    ),
    description: t(
      'Use an instant messaging app the policy doesn’t allow, for a project and a period',
      '因專案需要，於限定期間使用規定外的即時通訊軟體',
      'プロジェクトのため、規定外のインスタント メッセージング アプリを期間限定で使用',
    ),
    icon: 'message-square-warning',
    category: 'software',
    schema: {
      elements: elements(
        text('software', t('App', '軟體名稱', 'アプリ名'), half),
        text('project', t('Project', '專案名稱', 'プロジェクト'), half),
        rows(
          'users',
          t('People using it', '使用人員', '利用者'),
          [user('person', t('Person', '人員', 'ユーザー'), required)],
          { required: true, max: 30 },
        ),
        date('from', t('From', '起日', '開始日'), half),
        date('until', t('Until', '迄日', '終了日'), half),
        textarea('reason', t('Why it is needed', '使用理由', '必要な理由'), required),
      ),
      rules: [
        rule(
          'until-after-from',
          notBefore('until', 'from'),
          t('The end can’t be before the start', '迄日不可早於起日', '終了日は開始日以降にしてください'),
          { fields: ['until'] },
        ),
      ],
      actions: [
        action(
          'approve',
          'approved',
          'itam.approve-software',
          t('Allow the app until the end date', '核准使用至迄日', '終了日まで使用を許可'),
          {
            title: '{{data.software}}',
            licenseModel: 'free',
            scope: 'department',
            validUntilFrom: 'field:until',
            notes: plain(
              'Instant messaging exception for {{data.project}} ({{request.reference}}).',
              '{{data.project}} 的即時通訊軟體例外使用（{{request.reference}}）。',
              '{{data.project}} のインスタント メッセージングの例外使用 ({{request.reference}})。',
            ),
          },
        ),
        remind('remind-end', t('Remind when the exception ends', '例外到期提醒', '例外の終了時に通知'), {
          dateField: 'until',
          title: plain(
            'Instant messaging exception for {{data.software}} ends today: {{request.reference}}',
            '{{data.software}} 即時通訊軟體例外今日到期：{{request.reference}}',
            '本日で {{data.software}} のインスタント メッセージングの例外が終了: {{request.reference}}',
          ),
          message: plain(
            'Stop using it, or ask again.\n{{request.url}}',
            '請停止使用，或重新申請。\n{{request.url}}',
            '使用を停止するか、再度申請してください。\n{{request.url}}',
          ),
        }),
      ],
    },
  },
  {
    name: 'imException',
    label: plain(
      'Instant messaging exception approval',
      '即時通訊軟體例外使用簽核',
      'インスタント メッセージング例外使用の承認',
    ),
    description: plain(
      'Manager, then an ISMS approver',
      '主管簽核後由權責主管簽核',
      '上長、ISMS 承認者の順に承認',
    ),
    steps: [managerStep(), authorityStep()],
  },
);

export const assetProcesses: ItemTemplate[] = [
  ...assetChange,
  ...deviceCheckout,
  ...deviceReturn,
  ...softwareInstall,
  ...mediaException,
  ...imException,
];
