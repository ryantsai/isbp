/**
 * What the processes stand on: the five groups their approvals and checklists name, the service desk categories
 * their findings are filed under, the resolution sign-off for equipment anomalies and the hardening check on changes.
 * Groups are created empty: members are each site's people, added on the group's page after applying.
 */
import { CATEGORIES, eq, GROUPS, type ItemTemplate, plain, type PlainText, ref, t } from './build';

/** Group names and descriptions are plain text (one language): created in the installer's. */
const group = (
  g: (typeof GROUPS)[keyof typeof GROUPS],
  name: PlainText,
  description: PlainText,
): ItemTemplate => ({
  ref: g.ref,
  kind: 'core.group',
  op: 'create',
  value: { key: g.key, name, description, attributes: {} },
});

export const groups: ItemTemplate[] = [
  group(
    GROUPS.authority,
    plain('ISMS approvers', '權責主管', 'ISMS 承認者'),
    plain(
      'Managers responsible for information security who sign off ISMS requests and records. Add them after applying the ISMS process pack.',
      '負責資訊安全的主管，簽核 ISMS 申請與紀錄。套用 ISMS 流程範本套件後，請加入成員。',
      'ISMS の申請と記録を承認する、情報セキュリティの責任者。ISMS プロセス パックを適用した後にメンバーを追加してください。',
    ),
  ),
  group(
    GROUPS.it,
    plain('IS operations', '資訊部門', 'IS 運用'),
    plain(
      'Creates and removes accounts, issues and takes back devices, keeps the backup plan and runs restore tests.',
      '建立與移除帳號、發放與收回設備、維護備份計畫並執行備份資料回存測試。',
      'アカウントの作成と削除、デバイスの貸与と回収、バックアップ計画の管理、リストア テストを担当します。',
    ),
  ),
  group(
    GROUPS.network,
    plain('Network administrators', '網路管理人員', 'ネットワーク管理者'),
    plain(
      'Evaluate and configure firewall rules and visitor network access, check network devices and their passwords.',
      '評估並設定防火牆規則與外部人員網路使用，檢核網路設備及其密碼。',
      'ファイアウォール ルールと来訪者のネットワーク利用を評価・設定し、ネットワーク デバイスとそのパスワードを点検します。',
    ),
  ),
  group(
    GROUPS.serverRoom,
    plain('Server room administrators', '機房管理員', 'サーバー室管理者'),
    plain(
      'Inspect the server room, systems and backups every month and handle equipment and resource anomalies.',
      '每月巡檢機房、系統及備份，並處理設備資源異常。',
      'サーバー室、システム、バックアップを毎月点検し、機器・リソースの異常に対応します。',
    ),
  ),
  group(
    GROUPS.securityReview,
    plain('Security reviewers', '資訊安全複審', 'セキュリティ レビュー担当'),
    plain(
      'Review privileged access and software before installation, and handle security incident reports.',
      '複審管理者權限申請及安裝前的軟體，並處理資安異常通報。',
      '特権アクセスとインストール前のソフトウェアをレビューし、セキュリティ インシデントの報告に対応します。',
    ),
  ),
];

const category = (
  c: (typeof CATEGORIES)[keyof typeof CATEGORIES],
  name: ReturnType<typeof t>,
  groupRef: string,
  sortOrder: number,
): ItemTemplate => ({
  ref: c.ref,
  kind: 'itsm.category',
  op: 'create',
  value: {
    key: c.key,
    name,
    parentId: null,
    ticketTypes: ['incident'],
    defaultGroupId: ref(groupRef),
    sortOrder,
  },
});

export const categories: ItemTemplate[] = [
  category(
    CATEGORIES.resourceAnomaly,
    t('Equipment and resource anomaly', '設備資源異常', '機器・リソースの異常'),
    GROUPS.serverRoom.ref,
    900,
  ),
  category(
    CATEGORIES.threatIntel,
    t('Security threat intelligence', '資安威脅情資', 'セキュリティ脅威情報'),
    GROUPS.network.ref,
    910,
  ),
  category(
    CATEGORIES.securityReport,
    t('Security incident report', '資安事件通報', 'セキュリティ インシデントの報告'),
    GROUPS.securityReview.ref,
    920,
  ),
];

/**
 * Resolving an equipment or resource anomaly waits for an ISMS approver's sign-off. It becomes the default
 * `itsm.resolution` workflow; tickets of other categories skip the step and are resolved at once.
 */
export const resolutionSignOff: ItemTemplate = {
  ref: 'workflow-resolution-sign-off',
  kind: 'core.workflow',
  op: 'create',
  label: plain(
    'Equipment anomaly resolution sign-off',
    '設備資源異常結案簽核',
    '機器・リソース異常の解決の承認',
  ),
  value: {
    name: 'isms.packages.processes.workflows.resolutionSignOff',
    description: plain(
      'An ISMS approver signs off the resolution of tickets in the "Equipment and resource anomaly" category before they are resolved. Other tickets are resolved at once.',
      '「設備資源異常」類別的工單須經權責主管簽核後才會解決；其他工單直接解決。',
      '「機器・リソースの異常」カテゴリのチケットは、ISMS 承認者の承認を経てから解決されます。その他のチケットはすぐに解決されます。',
    ),
    triggerKey: 'itsm.resolution',
    isDefault: true,
    graph: {
      steps: [
        {
          id: 'sign-off',
          type: 'approval',
          name: t('ISMS approver sign-off', '權責主管簽核', 'ISMS 承認者の承認'),
          when: eq('ticket.category', CATEGORIES.resourceAnomaly.key),
          approvers: [{ type: 'group', groupKey: GROUPS.authority.key }],
          mode: 'any',
          instructions: t(
            'Check that the anomaly is fixed and the resolution notes say how, then approve. Rejecting sends the ticket back to work with your reason.',
            '確認異常已排除，且處理說明寫明如何處理後再核准。退回時工單會帶著您的原因回到處理中。',
            '異常が解消され、解決メモに対応内容が書かれていることを確認してから承認してください。却下するとチケットは理由を添えて対応中に戻ります。',
          ),
        },
      ],
    },
  },
};

/**
 * A hardening check on tickets (custom fields can't be shown by ticket type, so it is optional and its help says it
 * is for changes).
 */
export const hardeningField: ItemTemplate = {
  ref: 'field-hardening',
  kind: 'core.custom-field',
  op: 'create',
  value: {
    entityType: 'itsm.ticket',
    field: {
      key: 'defaultPasswordsChanged',
      type: 'boolean',
      label: t(
        'Default passwords changed and unneeded accounts removed',
        '已變更預設密碼並關閉不必要帳號',
        '既定のパスワードを変更し、不要なアカウントを無効化済み',
      ),
      help: t(
        'For changes that add or rebuild a system or device: confirm before the change is closed.',
        '適用於新增或重建系統、設備的變更：請於變更結案前確認。',
        'システムやデバイスを追加・再構築する変更向け: 変更をクローズする前に確認してください。',
      ),
    },
  },
};
