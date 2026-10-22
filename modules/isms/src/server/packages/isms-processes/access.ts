/**
 * Access control: account and access requests (new, changed, disabled), disabling accounts with a delayed deletion,
 * and shared accounts with their custodian and members.
 */
import {
  action,
  any,
  authorityStep,
  date,
  elements,
  eq,
  GROUPS,
  groupStep,
  heading,
  isIn,
  type ItemTemplate,
  managerStep,
  mustTick,
  notEmpty,
  opt,
  plain,
  PRIVILEGES,
  ref,
  remind,
  requestProcess,
  rows,
  rule,
  select,
  t,
  text,
  textarea,
  user,
  afterToday,
  boolean,
} from './build';

const OTHER = opt('other', t('Other', '其他', 'その他'));
const required = { required: true };

/** The IS step that carries out an account request, with what it did. */
const itHandling = groupStep('it', GROUPS.it.key, t('IS handling', '資訊部門處理', 'IS 部門の対応'), {
  instructions: t(
    'Create, change or disable the accounts listed, then record the result.',
    '請依申請內容建立、異動或停用帳號，並填寫處理結果。',
    '申請どおりにアカウントを作成・変更・停止し、結果を記録してください。',
  ),
  fields: [
    select(
      'result',
      t('Result', '處理結果', '結果'),
      [opt('done', t('Done', '已完成', '完了')), opt('not_done', t('Not done', '未完成', '未完了'))],
      required,
    ),
    textarea('notDoneReason', t('Why not', '未完成原因', '未完了の理由'), {
      required: true,
      visibleWhen: eq('result', 'not_done'),
    }),
    textarea('notes', t('Notes', '備註', 'メモ')),
  ],
});

/* ───────────── 1. Account and access request ───────────── */

const SYSTEMS = [
  opt('eforms', t('Electronic forms', '電子表單系統', '電子フォーム システム')),
  opt('vpn', t('VPN', 'VPN', 'VPN')),
  opt('network_device', t('Network device', '網路設備', 'ネットワーク デバイス')),
  opt('server', t('Server', '伺服器', 'サーバー')),
  opt('server_room', t('Server room access', '機房門禁', 'サーバー室の入室')),
  OTHER,
];

const accountRequest = requestProcess(
  {
    key: 'isms-account-request',
    name: t('Account and access request', '帳號權限申請／異動／停用', 'アカウント権限の申請・変更・停止'),
    description: t(
      'New accounts and permissions, changes and removals for joiners, movers and leavers',
      '新進、調動、離職等人員異動時，申請新增、異動或停用系統帳號與權限',
      '入社・異動・退職などに伴うアカウントと権限の追加・変更・停止',
    ),
    icon: 'user-cog',
    category: 'access',
    schema: {
      elements: elements(
        user('subject', t('Person the accounts are for', '帳號使用人員', '対象ユーザー'), {
          required: true,
          help: t(
            'You, or the person you ask for.',
            '您本人或代為申請的人員。',
            'ご自身、または代理で申請する相手。',
          ),
        }),
        select(
          'reason',
          t('Reason', '申請原因', '申請理由'),
          [
            opt('new_hire', t('New hire', '新進人員', '新入社員')),
            opt('leaving', t('Leaving', '離職', '退職')),
            opt('transfer', t('Department transfer', '部門調動', '部署異動')),
            opt('contractor_to_employee', t('Contractor to employee', '約聘轉正職', '契約社員から正社員へ')),
            opt('unpaid_leave', t('Unpaid leave', '留職停薪', '休職')),
            opt('secondment', t('Secondment', '借調', '出向')),
            opt('posting', t('Posting abroad or return', '外派／回任', '海外赴任・帰任')),
            OTHER,
          ],
          required,
        ),
        date('leavingOn', t('Last working day', '離職日', '最終出社日'), {
          required: true,
          visibleWhen: eq('reason', 'leaving'),
          width: 'half',
        }),
        text('fromDepartment', t('From department', '原部門', '異動元の部署'), {
          required: true,
          visibleWhen: eq('reason', 'transfer'),
          width: 'half',
        }),
        text('toDepartment', t('To department', '新部門', '異動先の部署'), {
          required: true,
          visibleWhen: eq('reason', 'transfer'),
          width: 'half',
        }),
        date('leaveFrom', t('Leave starts on', '留職停薪起日', '休職開始日'), {
          required: true,
          visibleWhen: eq('reason', 'unpaid_leave'),
          width: 'half',
        }),
        date('secondmentStart', t('Secondment starts', '借調起日', '出向開始日'), {
          required: true,
          visibleWhen: eq('reason', 'secondment'),
          width: 'half',
        }),
        date('secondmentEnd', t('Secondment ends', '借調迄日', '出向終了日'), {
          required: true,
          visibleWhen: eq('reason', 'secondment'),
          width: 'half',
        }),
        text('branch', t('Seconded to', '借調單位', '出向先'), {
          required: true,
          visibleWhen: eq('reason', 'secondment'),
        }),
        text('otherReason', t('Describe the reason', '請說明原因', '理由の説明'), {
          required: true,
          visibleWhen: eq('reason', 'other'),
        }),
        heading('h-new', t('Accounts and permissions to add', '新增帳號與權限', '追加するアカウントと権限')),
        rows(
          'newAccounts',
          t('New accounts', '新增帳號', '新しいアカウント'),
          [
            select('system', t('System', '系統', 'システム'), SYSTEMS, required),
            text('target', t('System or device name', '系統／設備名稱', 'システム・デバイス名'), required),
            text('account', t('Account', '帳號', 'アカウント')),
            select('privilege', t('Privilege', '權限', '権限'), PRIVILEGES, {
              required: true,
              defaultValue: 'user',
            }),
          ],
          { max: 20 },
        ),
        heading(
          'h-changes',
          t('Accounts to change or disable', '異動或停用帳號', '変更・停止するアカウント'),
        ),
        rows(
          'changes',
          t('Changes', '帳號異動', 'アカウントの変更'),
          [
            select(
              'system',
              t('System', '系統', 'システム'),
              [opt('ad', t('Domain (AD) account', 'AD 網域帳號', 'ドメイン (AD) アカウント')), ...SYSTEMS],
              required,
            ),
            text('target', t('System or device name', '系統／設備名稱', 'システム・デバイス名'), required),
            text('account', t('Account', '帳號', 'アカウント'), required),
            select(
              'action',
              t('Action', '處理方式', '処理'),
              [
                opt('delete', t('Delete', '刪除', '削除')),
                opt('disable', t('Disable', '停用', '停止')),
                opt('change', t('Change privilege', '權限異動', '権限の変更')),
              ],
              required,
            ),
            select('fromPrivilege', t('From privilege', '原權限', '変更前の権限'), PRIVILEGES),
            select('toPrivilege', t('To privilege', '新權限', '変更後の権限'), PRIVILEGES),
          ],
          { max: 20 },
        ),
        textarea(
          'privilegedReason',
          t('Why administrator privileges are needed', '申請管理者權限的理由', '管理者権限が必要な理由'),
          {
            help: t(
              'Required when a line asks for administrator privileges; they also need a security review.',
              '任一列申請管理者權限時必填，並需經資訊安全複審。',
              'いずれかの行で管理者権限を申請する場合は必須です。セキュリティ レビューも必要になります。',
            ),
          },
        ),
        boolean(
          'secondAccount',
          t(
            'A second account is needed (e.g. a separate administrator account)',
            '需要第二組帳號（例如管理專用帳號）',
            '2 つ目のアカウントが必要 (管理用の別アカウントなど)',
          ),
        ),
        textarea(
          'secondAccountReason',
          t('Why a second account', '第二組帳號的申請理由', '2 つ目のアカウントが必要な理由'),
          {
            required: true,
            visibleWhen: eq('secondAccount', true),
          },
        ),
      ),
      rules: [
        rule(
          'some-account',
          any(notEmpty('newAccounts'), notEmpty('changes')),
          t(
            'Add at least one account to create, change or disable',
            '請至少填寫一筆新增、異動或停用的帳號',
            '追加・変更・停止するアカウントを 1 件以上入力してください',
          ),
          { fields: ['newAccounts', 'changes'] },
        ),
        rule(
          'privileged-reason',
          notEmpty('privilegedReason'),
          t(
            'Explain why administrator privileges are needed',
            '請說明需要管理者權限的理由',
            '管理者権限が必要な理由を入力してください',
          ),
          {
            when: any(eq('newAccounts.privilege', 'admin'), eq('changes.toPrivilege', 'admin')),
            fields: ['privilegedReason'],
          },
        ),
      ],
      actions: [
        action(
          'tell-server-room',
          'approved',
          'core.notify',
          t('Tell the server room administrators', '通知機房管理員', 'サーバー室管理者に通知'),
          {
            toRequester: false,
            groups: [ref(GROUPS.serverRoom.ref)],
            title: plain(
              'Server room access to set up: {{request.reference}}',
              '待設定機房門禁：{{request.reference}}',
              'サーバー室の入室設定: {{request.reference}}',
            ),
            message: plain(
              '{{answers.subject}} ({{answers.reason}})\n{{answers.newAccounts}}\n{{answers.changes}}\n{{request.url}}',
              '{{answers.subject}}（{{answers.reason}}）\n{{answers.newAccounts}}\n{{answers.changes}}\n{{request.url}}',
              '{{answers.subject}} ({{answers.reason}})\n{{answers.newAccounts}}\n{{answers.changes}}\n{{request.url}}',
            ),
          },
          any(eq('data.newAccounts.system', 'server_room'), eq('data.changes.system', 'server_room')),
        ),
      ],
    },
  },
  {
    name: 'accountRequest',
    label: plain('Account and access request approval', '帳號權限申請簽核', 'アカウント権限申請の承認'),
    description: plain(
      'Manager, ISMS approver, a security review when a line asks for administrator privileges, then IS carries it out',
      '主管與權責主管簽核；任一列申請管理者權限時再經資訊安全複審，最後由資訊部門處理',
      '上長、ISMS 承認者の承認、管理者権限を申請する行があればセキュリティ レビュー、その後 IS 部門が対応',
    ),
    steps: [
      managerStep(),
      authorityStep(),
      groupStep(
        'security',
        GROUPS.securityReview.key,
        t('Security review', '資訊安全複審', 'セキュリティ レビュー'),
        {
          when: any(eq('data.newAccounts.privilege', 'admin'), eq('data.changes.toPrivilege', 'admin')),
          instructions: t(
            'Administrator privileges were asked for: check that they are needed and limited to what the reason says.',
            '本申請含管理者權限：請確認確有需要，且範圍僅限申請理由所述。',
            '管理者権限が申請されています。必要性と、理由に書かれた範囲に限られていることを確認してください。',
          ),
        },
      ),
      itHandling,
    ],
  },
);

/* ───────────── 2. Account disable and delayed deletion ───────────── */

const accountRetention = requestProcess(
  {
    key: 'isms-account-retention',
    name: t(
      'Account disable and delayed deletion',
      '系統帳號停用／延遲刪除申請',
      'アカウントの停止・削除延期の申請',
    ),
    description: t(
      'Keep a leaver’s accounts disabled instead of deleting them, until a set date',
      '離職或留停人員的帳號先停用、暫不刪除，並訂定刪除日期',
      '退職者などのアカウントを削除せずに停止し、削除日を決めて保持',
    ),
    icon: 'user-x',
    category: 'access',
    schema: {
      elements: elements(
        user('subject', t('Person the accounts belong to', '帳號使用人員', '対象ユーザー'), required),
        select(
          'reason',
          t('Reason', '原因', '理由'),
          [
            opt('leaving', t('Leaving', '離職', '退職')),
            opt('unpaid_leave', t('Unpaid leave', '留職停薪', '休職')),
            OTHER,
          ],
          required,
        ),
        date('effectiveOn', t('Effective date', '生效日', '発効日'), {
          required: true,
          visibleWhen: isIn('reason', ['leaving', 'unpaid_leave']),
          width: 'half',
        }),
        text('otherReason', t('Describe the reason', '請說明原因', '理由の説明'), {
          required: true,
          visibleWhen: eq('reason', 'other'),
        }),
        rows(
          'accounts',
          t('Accounts', '帳號清單', 'アカウント'),
          [
            select(
              'system',
              t('System', '系統', 'システム'),
              [
                opt('domain_email', t('Domain and email', '網域及電子郵件', 'ドメインとメール')),
                opt('network_device', t('Network device', '網路設備', 'ネットワーク デバイス')),
                opt('server', t('Server', '伺服器', 'サーバー')),
                OTHER,
              ],
              required,
            ),
            text('target', t('System or device name', '系統／設備名稱', 'システム・デバイス名'), required),
            text('account', t('Account', '帳號', 'アカウント'), required),
          ],
          { required: true, max: 30 },
        ),
        select(
          'keepReason',
          t('Why keep the accounts', '保留帳號的原因', 'アカウントを保持する理由'),
          [
            opt('unpaid_leave', t('Unpaid leave', '留職停薪', '休職')),
            opt('investigation', t('Investigation', '調查需要', '調査のため')),
            opt('integration', t('System integration', '系統整合需要', 'システム連携のため')),
            OTHER,
          ],
          required,
        ),
        text('keepReasonOther', t('Describe the reason', '請說明原因', '理由の説明'), {
          required: true,
          visibleWhen: eq('keepReason', 'other'),
        }),
        date('deleteOn', t('Delete the accounts on', '預定刪除日', '削除予定日'), {
          required: true,
          help: t(
            'IS and you are reminded a week before and on the day.',
            '資訊部門與您會在一週前及當天收到提醒。',
            'IS 部門とあなたに 1 週間前と当日に通知されます。',
          ),
        }),
      ),
      rules: [
        rule(
          'delete-later',
          afterToday('deleteOn'),
          t(
            'The deletion date must be after today',
            '預定刪除日須晚於今天',
            '削除予定日は明日以降にしてください',
          ),
          { fields: ['deleteOn'] },
        ),
      ],
      actions: [
        remind('remind-week', t('Remind a week before deletion', '刪除前一週提醒', '削除の 1 週間前に通知'), {
          dateField: 'deleteOn',
          offsetDays: -7,
          groupKeys: [GROUPS.it.key],
          title: plain(
            'Accounts to delete on {{data.deleteOn}}: {{request.reference}}',
            '{{data.deleteOn}} 預定刪除帳號：{{request.reference}}',
            '{{data.deleteOn}} に削除するアカウント: {{request.reference}}',
          ),
          message: '{{answers.subject}}\n{{answers.accounts}}\n{{request.url}}',
        }),
        remind('remind-day', t('Remind on the deletion date', '刪除當日提醒', '削除日に通知'), {
          dateField: 'deleteOn',
          groupKeys: [GROUPS.it.key],
          title: plain(
            'Delete the accounts today: {{request.reference}}',
            '今日請刪除帳號：{{request.reference}}',
            '本日アカウントを削除してください: {{request.reference}}',
          ),
          message: '{{answers.subject}}\n{{answers.accounts}}\n{{request.url}}',
        }),
      ],
    },
  },
  {
    name: 'accountRetention',
    label: plain(
      'Account disable and delayed deletion approval',
      '系統帳號停用／延遲刪除簽核',
      'アカウント停止・削除延期の承認',
    ),
    description: plain(
      'Manager, ISMS approver, then IS disables the accounts and confirms the checks',
      '主管與權責主管簽核後，由資訊部門停用帳號並逐項確認',
      '上長、ISMS 承認者の承認の後、IS 部門がアカウントを停止して確認項目をチェック',
    ),
    steps: [
      managerStep(),
      authorityStep(),
      groupStep('it', GROUPS.it.key, t('IS handling', '資訊部門處理', 'IS 部門の対応'), {
        instructions: t(
          'Disable the accounts (do not delete them yet) and tick each check.',
          '請停用帳號（暫不刪除），並逐項勾選確認。',
          'アカウントを停止し (まだ削除しない)、各項目を確認してください。',
        ),
        fields: [
          mustTick(
            'passwordChanged',
            t(
              'Password changed to a new, strong one',
              '已變更並強化密碼',
              'パスワードを新しい強固なものに変更済み',
            ),
          ),
          mustTick(
            'disabledNotDeleted',
            t(
              'Accounts disabled, not deleted',
              '帳號已停用（未刪除）',
              'アカウントを停止済み (削除していない)',
            ),
          ),
          mustTick('vpnRemoved', t('VPN access removed', '已移除 VPN 權限', 'VPN アクセスを削除済み')),
        ],
      }),
    ],
  },
);

/* ───────────── 3. Shared account ───────────── */

const sharedAccount = requestProcess(
  {
    key: 'isms-shared-account',
    name: t('Shared account request', '共用帳號申請暨授權管理', '共有アカウントの申請'),
    description: t(
      'An account several people use, with a custodian who keeps its password',
      '多人共同使用的帳號，指定保管人負責密碼管理',
      '複数の人が使うアカウント。パスワードは管理者が保管',
    ),
    icon: 'users',
    category: 'access',
    schema: {
      elements: elements(
        select(
          'purpose',
          t('Purpose', '用途', '用途'),
          [opt('project', t('Project', '專案使用', 'プロジェクト')), OTHER],
          required,
        ),
        text(
          'purposeDetail',
          t('Project or purpose', '專案名稱或用途說明', 'プロジェクト名または用途'),
          required,
        ),
        text('target', t('System or device', '系統／設備', 'システム・デバイス'), required),
        text('accountName', t('Account name', '帳號名稱', 'アカウント名'), required),
        user('custodian', t('Custodian', '保管人', '管理者'), {
          required: true,
          help: t(
            'Keeps the password and changes it when a member leaves or moves.',
            '負責保管密碼，並於成員離職或調動時變更密碼。',
            'パスワードを保管し、メンバーの退職・異動時に変更します。',
          ),
        }),
        rows(
          'members',
          t('People using it', '使用人員', '利用者'),
          [
            user('person', t('Person', '人員', 'ユーザー'), required),
            text('title', t('Job title', '職稱', '役職')),
          ],
          { required: true, max: 30 },
        ),
        textarea(
          'reason',
          t('Why a shared account', '共用帳號的必要性', '共有アカウントが必要な理由'),
          required,
        ),
        heading('h-consents', t('Commitments', '使用承諾', '確認事項')),
        mustTick(
          'consentEncrypted',
          t(
            'The custodian keeps the password encrypted',
            '保管人以加密方式保存密碼',
            '管理者はパスワードを暗号化して保管する',
          ),
        ),
        mustTick(
          'consentChange',
          t(
            'The password is changed the day a member leaves or moves',
            '成員離職或調動當日即變更密碼',
            'メンバーの退職・異動当日にパスワードを変更する',
          ),
        ),
        mustTick(
          'consentLog',
          t(
            'Key operations with the account are logged',
            '使用帳號進行的重要操作均留存紀錄',
            'アカウントによる重要な操作は記録する',
          ),
        ),
      ),
      actions: [
        action(
          'register',
          'approved',
          'isms.register-shared-account',
          t('Register the shared account', '登錄共用帳號', '共有アカウントを登録'),
          {
            accountName: '{{data.accountName}}',
            targetSystem: '{{data.target}}',
            custodianField: 'custodian',
            membersFields: ['members.person'],
            purpose: '{{data.reason}}',
            project: '{{data.purposeDetail}}',
          },
        ),
      ],
    },
  },
  {
    name: 'sharedAccount',
    label: plain('Shared account approval', '共用帳號申請簽核', '共有アカウント申請の承認'),
    description: plain(
      'Manager, then an ISMS approver; the account is registered with its custodian and members',
      '主管簽核後由權責主管簽核；核准後登錄共用帳號及其保管人與使用人員',
      '上長、ISMS 承認者の順に承認。承認後、アカウントを管理者と利用者とともに登録',
    ),
    steps: [managerStep(), authorityStep()],
  },
);

export const accessProcesses: ItemTemplate[] = [...accountRequest, ...accountRetention, ...sharedAccount];
