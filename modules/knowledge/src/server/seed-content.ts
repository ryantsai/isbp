import type { LocalizedText } from '@isbp/sdk';
import type { ArticleAudience, ArticleLocale, ArticleStatus } from '../contracts';

/** Demo data for the knowledge base: categories and real, step-by-step help-desk articles. */

export interface SeedCategory {
  key: string;
  icon: string;
  name: LocalizedText;
  description: LocalizedText;
}

const t3 = (en: string, zh: string, ja: string): LocalizedText => ({ en, 'zh-TW': zh, 'ja-JP': ja });

export const SEED_CATEGORIES: SeedCategory[] = [
  {
    key: 'accounts-passwords',
    icon: 'key-round',
    name: t3('Accounts & passwords', '帳號與密碼', 'アカウントとパスワード'),
    description: t3(
      'Sign-in, password resets and multi-factor authentication.',
      '登入、密碼重設與多重要素驗證。',
      'サインイン、パスワードのリセット、多要素認証。',
    ),
  },
  {
    key: 'network-vpn',
    icon: 'wifi',
    name: t3('Network & VPN', '網路與 VPN', 'ネットワークと VPN'),
    description: t3(
      'Wi-Fi, remote access and connectivity problems.',
      'Wi-Fi、遠端存取與連線問題。',
      'Wi-Fi、リモート アクセス、接続の問題。',
    ),
  },
  {
    key: 'email-calendar',
    icon: 'mail',
    name: t3('Email & calendar', '電子郵件與行事曆', 'メールと予定表'),
    description: t3(
      'Outlook, shared mailboxes and meeting rooms.',
      'Outlook、共用信箱與會議室。',
      'Outlook、共有メールボックス、会議室。',
    ),
  },
  {
    key: 'hardware-printers',
    icon: 'printer',
    name: t3('Hardware & printers', '硬體與印表機', 'ハードウェアとプリンター'),
    description: t3(
      'Laptops, docks, monitors and printing.',
      '筆電、擴充座、螢幕與列印。',
      'ノート PC、ドック、モニター、印刷。',
    ),
  },
  {
    key: 'software-licenses',
    icon: 'app-window',
    name: t3('Software & licenses', '軟體與授權', 'ソフトウェアとライセンス'),
    description: t3(
      'Installing approved software and business applications.',
      '安裝核准軟體與商務應用程式。',
      '承認済みソフトウェアと業務アプリケーション。',
    ),
  },
  {
    key: 'security',
    icon: 'shield-check',
    name: t3('Security', '資訊安全', 'セキュリティ'),
    description: t3(
      'Phishing, lost devices and keeping data safe.',
      '網路釣魚、遺失裝置與資料保護。',
      'フィッシング、デバイスの紛失、データの保護。',
    ),
  },
  {
    key: 'new-joiners',
    icon: 'user-plus',
    name: t3('New joiners', '新進人員', '新入社員'),
    description: t3(
      'Everything you need in your first week.',
      '到職第一週需要的一切。',
      '入社 1 週目に必要なことのすべて。',
    ),
  },
];

/** Who owns an article in the demo (resolved to seeded IT staff). */
export type SeedOwner = 'servicedesk' | 'network' | 'security' | 'apps' | 'lead';

export interface SeedTranslation {
  locale: ArticleLocale;
  title: string;
  summary: string;
  body: string;
}

export interface SeedArticle {
  slug: string;
  category: string;
  title: string;
  summary: string;
  body: string;
  tags: string[];
  audience?: ArticleAudience;
  status?: ArticleStatus;
  owner: SeedOwner;
  /** Days since first publish (published / retired articles). */
  publishedDaysAgo?: number;
  /** Review date relative to today (negative = overdue). */
  reviewInDays?: number;
  views?: number;
  helpful?: number;
  notHelpful?: number;
  /** Older published texts (the current text is the latest version). */
  previousVersions?: { daysAgo: number; title?: string; summary?: string; body: string }[];
  translations?: SeedTranslation[];
}

export const SEED_ARTICLES: SeedArticle[] = [
  {
    slug: 'password-reset',
    category: 'accounts-passwords',
    owner: 'servicedesk',
    title: 'Reset your password with self-service password reset',
    summary:
      'Forgot your password or locked out? Reset it yourself in about two minutes — no ticket needed, any time of day.',
    tags: ['password', 'sspr', 'locked out', 'sign-in'],
    publishedDaysAgo: 210,
    reviewInDays: 120,
    views: 4820,
    helpful: 412,
    notHelpful: 23,
    body: `## Before you start

You need **one of the verification methods you registered** when you joined: the Microsoft Authenticator app, your mobile phone number or your personal email address. If you never registered any, ask the Service Desk to reset the password for you (bring your staff ID).

## Reset your password

1. Go to [aka.ms/sspr](https://aka.ms/sspr) from any browser — your own phone works too.
2. Enter your work email address and complete the "I'm not a robot" check.
3. Choose a verification method and enter the code you receive.
4. Type your new password twice and select **Finish**.
5. On a company laptop, **lock the screen (Windows + L) and unlock it with the new password** while you are on the office network or VPN, so Windows picks it up.

## Password rules

| Rule | Requirement |
| --- | --- |
| Length | At least 12 characters (a passphrase is easiest: \`blue-coffee-rain-42\`) |
| Reuse | None of your last 10 passwords |
| Content | Must not contain your name or username |
| Expiry | Every 180 days — you get a reminder 14 days before |

## After the reset

- Update the password on your phone (Outlook and Teams ask you to sign in again).
- If you are **locked out**, the reset also unlocks your account; wait 5 minutes before signing in.
- Wi-Fi on your phone may keep using the old password: forget the *Corp-WiFi* network and join it again.

> **Tip:** The Service Desk will never ask for your password. If someone does, report it as phishing.

Still stuck? [Report an issue](/itsm/report) and choose *Account & sign-in*.`,
    translations: [
      {
        locale: 'zh-TW',
        title: '使用自助式密碼重設來重設密碼',
        summary: '忘記密碼或帳號被鎖定？兩分鐘內即可自行重設，免開工單，全天候可用。',
        body: `## 開始之前

您需要使用到職時**登記過的其中一種驗證方式**：Microsoft Authenticator App、手機號碼或個人電子郵件。若從未登記，請攜帶員工證至服務台請人員協助重設。

## 重設密碼

1. 以任何瀏覽器（手機也可以）前往 [aka.ms/sspr](https://aka.ms/sspr)。
2. 輸入公司電子郵件地址並完成「我不是機器人」驗證。
3. 選擇驗證方式並輸入收到的驗證碼。
4. 輸入兩次新密碼，然後選取 **完成**。
5. 在公司筆電上，請於公司網路或 VPN 連線時**鎖定畫面（Windows + L）再以新密碼解鎖**，讓 Windows 同步新密碼。

## 密碼規則

| 規則 | 要求 |
| --- | --- |
| 長度 | 至少 12 個字元（使用片語最容易記：\`blue-coffee-rain-42\`） |
| 重複使用 | 不可與最近 10 組密碼相同 |
| 內容 | 不可包含姓名或帳號 |
| 期限 | 每 180 天更換，到期前 14 天會提醒 |

## 重設之後

- 更新手機上的密碼（Outlook 與 Teams 會要求重新登入）。
- 若帳號**被鎖定**，重設密碼也會一併解除鎖定；請等待 5 分鐘後再登入。
- 手機的 Wi-Fi 可能仍使用舊密碼：請刪除 *Corp-WiFi* 網路後重新連線。

> **提示：** 服務台絕不會詢問您的密碼。若有人詢問，請當作網路釣魚回報。

仍無法解決？請 [回報問題](/itsm/report) 並選擇「帳號與登入」。`,
      },
      {
        locale: 'ja-JP',
        title: 'セルフサービス パスワード リセットでパスワードをリセットする',
        summary:
          'パスワードを忘れた、またはロックアウトされた場合も、チケット不要で約 2 分、24 時間いつでも自分でリセットできます。',
        body: `## 始める前に

入社時に登録した**確認方法のいずれか**（Microsoft Authenticator アプリ、携帯電話番号、個人のメール アドレス）が必要です。登録していない場合は、社員証を持ってサービス デスクにリセットを依頼してください。

## パスワードをリセットする

1. 任意のブラウザー（スマートフォンでも可）で [aka.ms/sspr](https://aka.ms/sspr) を開きます。
2. 会社のメール アドレスを入力し、「ロボットではありません」の確認を完了します。
3. 確認方法を選び、届いたコードを入力します。
4. 新しいパスワードを 2 回入力し、**完了** を選択します。
5. 会社の PC では、社内ネットワークまたは VPN に接続した状態で**画面をロック (Windows + L) し、新しいパスワードでロックを解除**して、Windows に反映させます。

## パスワードのルール

| ルール | 要件 |
| --- | --- |
| 長さ | 12 文字以上（パスフレーズが簡単です: \`blue-coffee-rain-42\`） |
| 再利用 | 直近 10 個のパスワードは使用不可 |
| 内容 | 氏名やユーザー名を含めない |
| 有効期限 | 180 日ごと（期限の 14 日前に通知） |

## リセットした後

- スマートフォンのパスワードも更新します（Outlook と Teams で再サインインが求められます）。
- **ロックアウト**されていた場合もリセットで解除されます。5 分待ってからサインインしてください。
- スマートフォンの Wi-Fi が古いパスワードを使い続けることがあります。*Corp-WiFi* を削除して接続し直してください。

> **ヒント:** サービス デスクがパスワードを尋ねることはありません。尋ねられたらフィッシングとして報告してください。

解決しない場合は [問題を報告](/itsm/report) し、「アカウントとサインイン」を選択してください。`,
      },
    ],
  },
  {
    slug: 'mfa-authenticator',
    category: 'accounts-passwords',
    owner: 'security',
    title: 'Set up multi-factor authentication (MFA) with the Authenticator app',
    summary:
      'Register Microsoft Authenticator as your sign-in method so you can approve sign-ins from your phone — required for all staff.',
    tags: ['mfa', 'authenticator', '2fa', 'sign-in', 'security'],
    publishedDaysAgo: 160,
    reviewInDays: 60,
    views: 3105,
    helpful: 268,
    notHelpful: 19,
    body: `## Why MFA?

A stolen password alone can't open your account when a sign-in also needs your phone. MFA is **mandatory** for every account that reaches email, VPN or business applications from outside the office.

## What you need

- Your work laptop (to show the QR code) and your smartphone (iOS 16+ or Android 10+).
- About 5 minutes.

## Set it up

1. On your phone, install **Microsoft Authenticator** from the App Store or Google Play.
2. On your laptop, open [aka.ms/mfasetup](https://aka.ms/mfasetup) and sign in.
3. Select **Add sign-in method → Authenticator app**, then **Next** until a QR code appears.
4. In the app, tap **+ → Work or school account → Scan QR code** and scan it.
5. Approve the test notification on your phone and type the number shown on the laptop.
6. Back on the laptop, set **Authenticator – notification** as the *default sign-in method*.

## Add a backup method

Add your **mobile number** as a second method on the same page. If you lose your phone, you can still sign in with a text message while you get a new one.

## Changing phones

| Situation | What to do |
| --- | --- |
| New phone, old one still works | Install Authenticator on the new phone, add the account again at aka.ms/mfasetup, then delete the old device from the list |
| Old phone lost or wiped | Sign in with your backup phone number, then register the new phone |
| No backup method | Contact the Service Desk with your staff ID — we verify you by video call |

> **Never approve a sign-in you didn't start.** Unexpected prompts mean someone knows your password: deny it, reset your password and report it to Security.`,
    translations: [
      {
        locale: 'zh-TW',
        title: '使用 Authenticator App 設定多重要素驗證 (MFA)',
        summary: '將 Microsoft Authenticator 登記為登入方式，即可用手機核准登入要求——所有人員皆須設定。',
        body: `## 為什麼需要 MFA？

只要登入時還需要您的手機，單靠被盜的密碼就無法開啟您的帳號。凡是從公司外部存取電子郵件、VPN 或商務應用程式的帳號，**一律必須**啟用 MFA。

## 需要準備

- 公司筆電（顯示 QR 碼）與智慧型手機（iOS 16 以上或 Android 10 以上）。
- 約 5 分鐘。

## 設定步驟

1. 在手機上從 App Store 或 Google Play 安裝 **Microsoft Authenticator**。
2. 在筆電上開啟 [aka.ms/mfasetup](https://aka.ms/mfasetup) 並登入。
3. 選取 **新增登入方式 → Authenticator 應用程式**，持續按 **下一步** 直到出現 QR 碼。
4. 在 App 中點選 **+ → 公司或學校帳戶 → 掃描 QR 碼** 並掃描。
5. 在手機上核准測試通知，並輸入筆電上顯示的數字。
6. 回到筆電，將 **Authenticator – 通知** 設為*預設登入方式*。

## 新增備用方式

在同一頁面新增您的**手機號碼**作為第二種方式。手機遺失時，在換新手機前仍可透過簡訊登入。

## 更換手機

| 情況 | 處理方式 |
| --- | --- |
| 換新手機，舊手機仍可使用 | 在新手機安裝 Authenticator，於 aka.ms/mfasetup 重新加入帳號，再從清單刪除舊裝置 |
| 舊手機遺失或已重置 | 先以備用手機號碼登入，再登記新手機 |
| 沒有備用方式 | 請攜帶員工證聯絡服務台，我們會以視訊確認身分 |

> **切勿核准不是您發起的登入。** 收到非預期的要求代表有人知道您的密碼：請拒絕、重設密碼並通報資安團隊。`,
      },
      {
        locale: 'ja-JP',
        title: 'Authenticator アプリで多要素認証 (MFA) を設定する',
        summary:
          'Microsoft Authenticator をサインイン方法として登録し、スマートフォンでサインインを承認できるようにします（全社員必須）。',
        body: `## MFA が必要な理由

サインインにスマートフォンも必要になるため、パスワードが盗まれただけではアカウントを開けません。社外からメール、VPN、業務アプリケーションにアクセスするすべてのアカウントで **必須** です。

## 必要なもの

- 会社の PC（QR コードの表示用）とスマートフォン（iOS 16 以降または Android 10 以降）
- 約 5 分

## 設定手順

1. スマートフォンに App Store または Google Play から **Microsoft Authenticator** をインストールします。
2. PC で [aka.ms/mfasetup](https://aka.ms/mfasetup) を開いてサインインします。
3. **サインイン方法の追加 → 認証アプリ** を選び、QR コードが表示されるまで **次へ** を選択します。
4. アプリで **+ → 職場または学校アカウント → QR コードをスキャン** をタップしてスキャンします。
5. スマートフォンでテスト通知を承認し、PC に表示された番号を入力します。
6. PC に戻り、**Authenticator – 通知** を *既定のサインイン方法* に設定します。

## バックアップ方法を追加する

同じページで **携帯電話番号** を 2 つ目の方法として追加してください。スマートフォンを紛失しても、新しい端末を用意するまで SMS でサインインできます。

## スマートフォンを買い替えるとき

| 状況 | 対応 |
| --- | --- |
| 新しい端末、古い端末もまだ使える | 新しい端末に Authenticator を入れ、aka.ms/mfasetup でアカウントを再登録し、古いデバイスを一覧から削除 |
| 古い端末を紛失、初期化した | バックアップの電話番号でサインインし、新しい端末を登録 |
| バックアップ方法がない | 社員証を用意してサービス デスクへ連絡（ビデオ通話で本人確認します） |

> **自分で開始していないサインインは絶対に承認しないでください。** 想定外の要求は、誰かがパスワードを知っているサインです。拒否してパスワードをリセットし、セキュリティ チームに報告してください。`,
      },
    ],
  },
  {
    slug: 'vpn-connect',
    category: 'network-vpn',
    owner: 'network',
    title: 'Connect to the VPN from home',
    summary:
      'Use the Corp VPN client to reach internal systems (ERP, file shares, intranet) when you work outside the office.',
    tags: ['vpn', 'remote work', 'home', 'corp vpn'],
    publishedDaysAgo: 300,
    reviewInDays: 90,
    views: 5230,
    helpful: 390,
    notHelpful: 41,
    previousVersions: [
      {
        daysAgo: 300,
        body: `## Connect

1. Open **Corp VPN** from the Start menu.
2. Enter \`vpn.corp.example.com\` as the portal and select **Connect**.
3. Sign in with your work account and approve the MFA prompt.

Contact the Service Desk if the client is missing.`,
      },
    ],
    body: `## Before you start

- You need a **company laptop** — personal devices can't connect.
- Your account must be in the *VPN Users* group (everyone in IT, Sales and Operations is added automatically). Others can [request VPN access](/requests).
- Make sure MFA is set up — see *Set up multi-factor authentication*.

## Connect

1. Join your home Wi-Fi or a phone hotspot first.
2. Open **Corp VPN** from the Start menu (Windows) or the menu bar (macOS).
3. The portal is pre-filled as \`vpn.corp.example.com\`. Select **Connect**.
4. Sign in with your work email and approve the Authenticator notification.
5. The shield icon turns **green** with "Connected". Internal sites such as the intranet now open.

## Check it works

| Test | Expected |
| --- | --- |
| Open \`https://intranet.corp.example.com\` | The intranet home page loads |
| Open a file share \`\\\\files\\Teams\` | Your team folders are listed |
| Client status | *Connected — Tunnel: full* |

## Common problems

- **"Gateway unreachable"** — your home network blocks UDP 4501. Switch to the **TCP fallback** under *Settings → Connection*, or try a phone hotspot.
- **Asks for a password again and again** — your password changed recently. Sign out of the client, sign in again, and lock/unlock the laptop.
- **Connected but nothing opens** — restart the laptop; DNS settings are applied at start-up.
- **Keeps dropping** — see *VPN disconnects every few minutes*.

> **Tip:** Teams, Outlook and OneDrive don't need the VPN. Disconnect it in video calls to get better quality.`,
    translations: [
      {
        locale: 'zh-TW',
        title: '在家連線 VPN',
        summary: '在公司外工作時，使用 Corp VPN 用戶端連線內部系統（ERP、檔案共用、內部網站）。',
        body: `## 開始之前

- 必須使用**公司筆電**——個人裝置無法連線。
- 您的帳號必須在 *VPN Users* 群組中（IT、業務與營運部門人員會自動加入）。其他人員可 [申請 VPN 權限](/requests)。
- 請先完成 MFA 設定，參閱〈使用 Authenticator App 設定多重要素驗證〉。

## 連線步驟

1. 先連上家中 Wi-Fi 或手機熱點。
2. 從開始功能表（Windows）或選單列（macOS）開啟 **Corp VPN**。
3. 入口網站已預先填入 \`vpn.corp.example.com\`，選取 **連線**。
4. 以公司電子郵件登入，並在 Authenticator 核准通知。
5. 盾牌圖示變成**綠色**並顯示「已連線」，即可開啟內部網站。

## 確認連線正常

| 測試 | 預期結果 |
| --- | --- |
| 開啟 \`https://intranet.corp.example.com\` | 顯示內部網站首頁 |
| 開啟檔案共用 \`\\\\files\\Teams\` | 列出團隊資料夾 |
| 用戶端狀態 | *已連線 — 通道：完整* |

## 常見問題

- **「無法連線至閘道」**——家用網路封鎖了 UDP 4501。請在 *設定 → 連線* 改用 **TCP 備援**，或改用手機熱點。
- **一直要求輸入密碼**——最近變更過密碼。請登出用戶端後重新登入，並鎖定／解鎖筆電。
- **已連線但無法開啟任何網站**——請重新開機，DNS 設定會在開機時套用。
- **經常斷線**——參閱〈VPN 每隔幾分鐘就斷線〉。

> **提示：** Teams、Outlook 與 OneDrive 不需要 VPN。視訊會議時中斷 VPN 可獲得更好的品質。`,
      },
      {
        locale: 'ja-JP',
        title: '自宅から VPN に接続する',
        summary:
          '社外で作業するときは Corp VPN クライアントで社内システム（ERP、ファイル共有、イントラネット）に接続します。',
        body: `## 始める前に

- **会社の PC** が必要です。個人のデバイスは接続できません。
- アカウントが *VPN Users* グループに入っている必要があります（IT、営業、オペレーション部門は自動で追加されます）。それ以外の方は [VPN アクセスを申請](/requests) してください。
- MFA を設定済みであることを確認してください。「Authenticator アプリで多要素認証 (MFA) を設定する」を参照してください。

## 接続する

1. 先に自宅の Wi-Fi またはスマートフォンのテザリングに接続します。
2. スタート メニュー (Windows) またはメニュー バー (macOS) から **Corp VPN** を開きます。
3. ポータルには \`vpn.corp.example.com\` が入力済みです。**接続** を選択します。
4. 会社のメール アドレスでサインインし、Authenticator の通知を承認します。
5. 盾のアイコンが **緑** になり「接続済み」と表示されれば、イントラネットなどの社内サイトを開けます。

## 動作を確認する

| テスト | 期待される結果 |
| --- | --- |
| \`https://intranet.corp.example.com\` を開く | イントラネットのホーム ページが表示される |
| ファイル共有 \`\\\\files\\Teams\` を開く | チームのフォルダーが表示される |
| クライアントの状態 | *接続済み — トンネル: フル* |

## よくある問題

- **「ゲートウェイに到達できません」** — 自宅のネットワークが UDP 4501 をブロックしています。*設定 → 接続* で **TCP フォールバック** に切り替えるか、テザリングを試してください。
- **何度もパスワードを求められる** — 最近パスワードを変更しました。クライアントからサインアウトして再度サインインし、PC をロック／ロック解除してください。
- **接続済みなのに何も開けない** — PC を再起動してください。DNS 設定は起動時に適用されます。
- **頻繁に切断される** — 「VPN が数分ごとに切断される」を参照してください。

> **ヒント:** Teams、Outlook、OneDrive に VPN は不要です。ビデオ会議中は VPN を切断すると品質が上がります。`,
      },
    ],
  },
  {
    slug: 'vpn-drops',
    category: 'network-vpn',
    owner: 'network',
    title: 'VPN disconnects every few minutes',
    summary:
      'If your VPN keeps dropping or reconnecting, work through these checks — most cases are fixed by switching protocol or power settings.',
    tags: ['vpn', 'disconnect', 'troubleshooting', 'wifi', 'remote work'],
    publishedDaysAgo: 120,
    reviewInDays: 45,
    views: 2210,
    helpful: 164,
    notHelpful: 37,
    body: `## Symptoms

- The VPN connects, then drops after 2–10 minutes and reconnects by itself.
- Teams calls freeze, file copies to shares fail with "network path not found".
- The client log shows \`Tunnel keep-alive timeout\` or \`DPD failure\`.

## Quick checks (5 minutes)

1. **Update the client.** Open Corp VPN → *About*. Anything older than **5.3** — install the latest version from Company Portal. (macOS users on 5.2: see the known error below in your client notes.)
2. **Switch to TCP.** *Settings → Connection → Protocol: TCP (fallback)*. Hotel, café and some home routers drop long-lived UDP sessions.
3. **Move closer to the router or use a cable.** Weak Wi-Fi (one or two bars) causes most drops. A phone hotspot is a good test.
4. **Turn off Wi-Fi power saving** (Windows): *Device Manager → Network adapters → your Wi-Fi adapter → Power Management* → clear *Allow the computer to turn off this device to save power*.

## If it still drops

| Check | How | What to look for |
| --- | --- | --- |
| Router firmware | Router admin page | Updates from the last 12 months |
| Another VPN running | System tray / menu bar | Personal VPNs (NordVPN, etc.) conflict — quit them |
| Sleep timers | *Settings → System → Power* | "Turn off Wi-Fi when asleep" off |
| ISP outage | Status page of your provider | Packet loss or maintenance |

## Collect logs for the Service Desk

1. Corp VPN → *Troubleshooting → Collect logs*. A zip file is saved to your Desktop.
2. Note the **time of the last drop** and your connection type (home Wi-Fi, hotspot, hotel).
3. [Report an issue](/itsm/report) — category *Network & VPN* — and attach the zip.

> **Tip:** If only Teams is affected, disconnect the VPN: Teams works better without it.`,
  },
  {
    slug: 'corp-wifi',
    category: 'network-vpn',
    owner: 'network',
    title: 'Connect a laptop to Corp-WiFi',
    summary: 'Join the secure office Wi-Fi with your work account (802.1X). Guests use Guest-WiFi instead.',
    tags: ['wifi', 'wireless', 'corp-wifi', '802.1x', 'office'],
    publishedDaysAgo: 400,
    reviewInDays: 30,
    views: 2780,
    helpful: 201,
    notHelpful: 15,
    body: `## Which network?

| Network | Who | How you sign in |
| --- | --- | --- |
| **Corp-WiFi** | Staff with a company laptop or phone | Work account (automatic certificate) |
| **Guest-WiFi** | Visitors, personal devices | Daily code from reception |

## Company laptop (Windows or macOS)

Company laptops connect **automatically** — a certificate is installed when the laptop is set up.

1. Select the Wi-Fi icon and choose **Corp-WiFi**.
2. If asked, pick **Connect using a certificate** (Windows) or the certificate starting with your username (macOS).
3. You are online in a few seconds. No password is needed.

## Company phone

1. Open Company Portal and make sure the phone is **compliant**.
2. Choose **Corp-WiFi** in the Wi-Fi settings — the profile pushed by Company Portal signs you in.

## It doesn't connect

- **"Can't connect to this network"** — the laptop certificate may have expired. Connect to Guest-WiFi or a cable, then restart: the certificate renews at start-up.
- **Connected, no internet** — forget Corp-WiFi, restart Wi-Fi and join again.
- **Personal phone** — personal devices are not allowed on Corp-WiFi. Use Guest-WiFi.

> **Tip:** Changed your password? Company laptops are unaffected (they use a certificate), but phones set up manually must be updated.`,
    translations: [
      {
        locale: 'zh-TW',
        title: '將筆電連上 Corp-WiFi',
        summary: '以公司帳號（802.1X）連上安全的辦公室 Wi-Fi。訪客請改用 Guest-WiFi。',
        body: `## 該連哪個網路？

| 網路 | 適用對象 | 登入方式 |
| --- | --- | --- |
| **Corp-WiFi** | 使用公司筆電或手機的人員 | 公司帳號（自動憑證） |
| **Guest-WiFi** | 訪客、個人裝置 | 櫃台提供的每日代碼 |

## 公司筆電（Windows 或 macOS）

公司筆電會**自動**連線——設定筆電時已安裝憑證。

1. 選取 Wi-Fi 圖示並選擇 **Corp-WiFi**。
2. 若出現詢問，選擇 **使用憑證連線**（Windows）或以您帳號開頭的憑證（macOS）。
3. 數秒內即可上網，不需要輸入密碼。

## 公司手機

1. 開啟 Company Portal，確認手機狀態為**符合規範**。
2. 在 Wi-Fi 設定中選擇 **Corp-WiFi**，Company Portal 推送的設定檔會自動登入。

## 無法連線

- **「無法連線到這個網路」**——筆電憑證可能已過期。請先連上 Guest-WiFi 或網路線後重新開機，憑證會在開機時更新。
- **已連線但無法上網**——刪除 Corp-WiFi 後重新啟動 Wi-Fi 並重新連線。
- **個人手機**——個人裝置不得連線 Corp-WiFi，請使用 Guest-WiFi。

> **提示：** 變更密碼了嗎？公司筆電不受影響（使用憑證），但手動設定的手機需要更新密碼。`,
      },
      {
        locale: 'ja-JP',
        title: 'ノート PC を Corp-WiFi に接続する',
        summary:
          '会社のアカウント (802.1X) で安全なオフィスの Wi-Fi に接続します。来訪者は Guest-WiFi を使用します。',
        body: `## どのネットワークを使う？

| ネットワーク | 対象 | サインイン方法 |
| --- | --- | --- |
| **Corp-WiFi** | 会社の PC またはスマートフォンを使う社員 | 会社のアカウント（自動の証明書） |
| **Guest-WiFi** | 来訪者、個人のデバイス | 受付で配布される当日のコード |

## 会社の PC (Windows または macOS)

会社の PC は **自動的に** 接続されます。PC のセットアップ時に証明書がインストールされています。

1. Wi-Fi アイコンを選択し、**Corp-WiFi** を選びます。
2. 確認された場合は **証明書を使用して接続** (Windows) またはユーザー名で始まる証明書 (macOS) を選びます。
3. 数秒で接続されます。パスワードは不要です。

## 会社のスマートフォン

1. Company Portal を開き、端末が **準拠** していることを確認します。
2. Wi-Fi 設定で **Corp-WiFi** を選びます。Company Portal が配布したプロファイルで自動的にサインインします。

## 接続できない場合

- **「このネットワークに接続できません」** — PC の証明書の期限が切れている可能性があります。Guest-WiFi または有線で接続してから再起動すると、起動時に証明書が更新されます。
- **接続済みだがインターネットに出られない** — Corp-WiFi を削除し、Wi-Fi をオフ／オンしてから接続し直します。
- **個人のスマートフォン** — 個人のデバイスは Corp-WiFi に接続できません。Guest-WiFi を使用してください。

> **ヒント:** パスワードを変更した場合、会社の PC は影響を受けません（証明書を使用）が、手動で設定したスマートフォンは更新が必要です。`,
      },
    ],
  },
  {
    slug: 'outlook-sync',
    category: 'email-calendar',
    owner: 'servicedesk',
    title: 'Outlook is not syncing or your mailbox is full',
    summary:
      'New mail not arriving, stuck in the Outbox or a "mailbox is almost full" warning? Fix sync and free up space in minutes.',
    tags: ['outlook', 'email', 'mailbox full', 'sync', 'quota'],
    publishedDaysAgo: 250,
    reviewInDays: 100,
    views: 3390,
    helpful: 255,
    notHelpful: 28,
    body: `## First: is it Outlook or the mailbox?

Open [outlook.office.com](https://outlook.office.com) in a browser. If new mail shows there, the mailbox is fine and only the Outlook app is stuck.

## Outlook app not syncing

1. Check the status bar at the bottom: **Working offline** → *Send / Receive → Work Offline* to turn it off.
2. Close Outlook, wait 10 seconds and open it again.
3. Still stuck? *File → Account Settings → Account Settings → your account → Repair*.
4. As a last resort, rebuild the local cache: close Outlook, delete \`%LOCALAPPDATA%\\Microsoft\\Outlook\\*.ost\` and reopen Outlook. It downloads your mail again (this can take an hour on large mailboxes).

## Mailbox full

Your mailbox holds **50 GB**. At 49 GB you get a warning; at 50 GB you can no longer send.

| Where space goes | Quick fix |
| --- | --- |
| Large attachments | Search \`size:>10MB\`, save files to OneDrive, delete the emails |
| Deleted Items | Right-click *Deleted Items* → **Empty folder** |
| Sent Items | Sort by size and delete old large messages |
| Old mail | Turn on the archive policy: *right-click the folder → Assign policy → 2-year archive* |

Check your usage under *File → Info → Mailbox settings*.

> **Tip:** Share files as OneDrive links instead of attachments — they don't count against anyone's mailbox.

Need more than 50 GB for a business reason? [Request it](/requests) with your manager's approval.`,
  },
  {
    slug: 'shared-mailbox',
    category: 'email-calendar',
    owner: 'servicedesk',
    title: 'Get access to a shared mailbox',
    summary:
      'Request access to team mailboxes such as hr@ or invoices@, and open them in Outlook once approved.',
    tags: ['shared mailbox', 'outlook', 'access', 'email'],
    publishedDaysAgo: 330,
    reviewInDays: -12,
    views: 1460,
    helpful: 98,
    notHelpful: 12,
    body: `## Request access

Shared mailboxes belong to a team. The **mailbox owner** (usually the team lead) approves access.

1. Go to [Requests](/requests) and choose **Shared mailbox access**.
2. Enter the mailbox address (for example \`invoices@corp.example.com\`) and the access you need:
   - **Read and manage** — read, move and delete mail.
   - **Send as** — send mail that appears to come from the mailbox.
3. Submit. You get a notification when the owner approves; access is active within **60 minutes**.

## Open it in Outlook

Outlook adds the mailbox **automatically** after about an hour — look for it under your own folders.

If it doesn't appear:

1. *File → Account Settings → Account Settings → Change → More Settings → Advanced*.
2. Select **Add** and type the mailbox address.
3. Restart Outlook.

## Send from the shared mailbox

1. In a new email, select **From** (enable it under *Options → Show From* if hidden).
2. Choose *Other email address* and type the shared mailbox.

> **Tip:** On Outlook on the web, right-click *Folders* → **Add shared folder or mailbox**.`,
  },
  {
    slug: 'network-printer',
    category: 'hardware-printers',
    owner: 'servicedesk',
    title: 'Add a network printer',
    summary:
      'Install office printers with Follow-Me printing: print to one queue and release the job at any printer with your badge.',
    tags: ['printer', 'printing', 'follow-me', 'badge'],
    publishedDaysAgo: 380,
    reviewInDays: 150,
    views: 1980,
    helpful: 140,
    notHelpful: 9,
    body: `## How printing works here

All office printers share one queue: **Follow-Me**. You print to it from anywhere, then walk to *any* printer and tap your badge to release the job. Jobs that aren't released within **24 hours** are deleted.

## Windows

1. Open **Settings → Bluetooth & devices → Printers & scanners**.
2. Select **Add device**. Wait for *Follow-Me (print.corp.example.com)* to appear and select **Add**.
3. If it doesn't appear: select *The printer that I want isn't listed → Select a shared printer by name* and enter \`\\\\print.corp.example.com\\Follow-Me\`.

## macOS

1. Open **Company Portal → Printers** and install **Follow-Me**.
2. In the print dialog, choose *Follow-Me* and sign in with your work account the first time.

## Release your job

1. Tap your badge on the printer's reader.
2. Select your job(s) and **Print**. Use *Print all* to release everything.

| Option | Default | Change it in |
| --- | --- | --- |
| Colour | Black & white | Printer preferences → Colour |
| Two-sided | On | Printer preferences → Layout |
| Paper | A4 | Printer preferences → Paper |

> **Tip:** Printing from your phone? Email the document to \`print@corp.example.com\` from your work account and release it with your badge.`,
  },
  {
    slug: 'print-queue',
    category: 'hardware-printers',
    owner: 'servicedesk',
    title: 'Clear a stuck print queue',
    summary:
      'Documents stuck "Printing" or "Error" in the queue block everything behind them. Clear the queue in a few steps.',
    tags: ['printer', 'print queue', 'spooler', 'troubleshooting'],
    publishedDaysAgo: 365,
    reviewInDays: -3,
    views: 1210,
    helpful: 77,
    notHelpful: 14,
    body: `## Symptoms

- A document stays at *Printing* or *Error* and nothing else prints.
- The printer is not listed at the badge reader even though you printed.

## Cancel the stuck job

1. Open **Settings → Bluetooth & devices → Printers & scanners → Follow-Me → Open print queue**.
2. Right-click the stuck document → **Cancel**. Wait 30 seconds.

## Restart the print spooler (Windows)

If cancelling doesn't work:

1. Press **Windows + R**, type \`services.msc\` and press Enter.
2. Find **Print Spooler**, right-click → **Stop**.
3. Open \`C:\\Windows\\System32\\spool\\PRINTERS\` and delete everything inside (you may need to confirm as administrator — use *Company Portal → Make me admin* for 15 minutes).
4. Back in Services, right-click **Print Spooler** → **Start**.
5. Print a test page.

## macOS

1. *System Settings → Printers & Scanners → Follow-Me → Printer Queue…*
2. Select the job and click the **×**. If the queue is paused, click **Resume**.

| Still failing? | Try |
| --- | --- |
| Only large PDFs fail | Print as image: *Advanced → Print as image* in Acrobat |
| Every job fails | Remove Follow-Me and add it again (see *Add a network printer*) |
| The printer shows an error | Note the code on the display and [report an issue](/itsm/report) |`,
  },
  {
    slug: 'request-laptop',
    category: 'hardware-printers',
    owner: 'lead',
    title: 'Request a new or replacement laptop',
    summary:
      'Order a laptop for a new starter, a replacement for a broken one or an upgrade at the end of the four-year cycle.',
    tags: ['laptop', 'hardware', 'request', 'replacement'],
    publishedDaysAgo: 200,
    reviewInDays: 160,
    views: 1680,
    helpful: 121,
    notHelpful: 8,
    body: `## Who can request what

| Reason | Who requests | Approval |
| --- | --- | --- |
| New joiner | Hiring manager, at least **10 working days** before the start date | Manager |
| Broken or failing | You | Service Desk confirms the fault |
| End of life (4+ years) | You — you get an email when you're eligible | Automatic |
| Different model (e.g. 32 GB RAM) | You | Manager + cost center owner |

## Place the request

1. Open [Requests](/requests) and choose **New laptop**.
2. Pick the **standard model** (14" business laptop, 16 GB RAM) or the *developer model* if your role needs it.
3. Fill in the reason, the delivery office and — for new joiners — the person's start date.
4. Submit. You can follow approval and delivery under **My requests**.

## When it arrives

1. Sign in with your work account; the laptop installs your apps automatically (about 30 minutes, keep it plugged in and on Corp-WiFi or a cable).
2. Copy files you kept locally — everything in OneDrive syncs by itself.
3. Return the old laptop to the IT desk within **14 days**. We wipe it securely.

> **Tip:** Broken screen or liquid damage? [Report an issue](/itsm/report) first — a loan laptop is available the same day.`,
  },
  {
    slug: 'install-software',
    category: 'software-licenses',
    owner: 'apps',
    title: 'Install approved software from Company Portal',
    summary:
      'Install pre-approved apps yourself in Company Portal; request anything else with a business justification.',
    tags: ['software', 'install', 'company portal', 'license'],
    publishedDaysAgo: 280,
    reviewInDays: 80,
    views: 2950,
    helpful: 230,
    notHelpful: 21,
    body: `## Install from Company Portal

Over 120 approved apps — browsers, PDF tools, Visual Studio Code, Zoom, 7-Zip, Power BI Desktop and more — install without approval.

1. Open **Company Portal** (Start menu on Windows, Applications on macOS).
2. Search for the app and select **Install**.
3. Leave the laptop on; installation runs in the background and you get a notification when it's done.

## Software that needs a license

Some apps have a cost per user (Adobe Acrobat Pro, Visio, Project, Figma). They show **Request** instead of *Install*.

1. Select **Request** and add a business reason.
2. Your manager approves; the license is assigned and the app installs within **one working day**.

## Not in Company Portal?

[Request new software](/requests) with:

- the product name, vendor and version;
- what you need it for and how many people will use it;
- whether it stores company or customer data (Security reviews these).

Reviews take **5–10 working days**. Free tools are not automatically approved: some send data to third parties.

| Don't | Why |
| --- | --- |
| Install from download sites | Bundled malware, no updates |
| Use personal licenses at work | Breaks license terms; the company is liable |
| Ask for admin rights to install | Use *Make me admin* only for approved troubleshooting |`,
  },
  {
    slug: 'report-phishing',
    category: 'security',
    owner: 'security',
    title: 'Report a phishing email',
    summary:
      'Suspicious email? Report it with one click so Security can block it for everyone — and know what to do if you already clicked.',
    tags: ['phishing', 'security', 'email', 'scam'],
    publishedDaysAgo: 240,
    reviewInDays: 110,
    views: 2650,
    helpful: 244,
    notHelpful: 6,
    body: `## Signs of phishing

- Urgency or threats: *"Your mailbox will be deleted in 24 hours"*.
- A sender address that doesn't match the name, or a lookalike domain (\`corp-example.co\`).
- Links whose real address (hover to see it) doesn't match the text.
- Requests for passwords, MFA codes, gift cards or payment changes.
- The yellow **External** banner on mail that claims to be internal.

## Report it

1. In Outlook, select the email and choose **Report → Phishing** on the ribbon (*… → Report → Phishing* in Outlook on the web and mobile).
2. That's it — the message moves out of your inbox and Security reviews it. **Don't forward it** to colleagues.

## Already clicked or replied?

Act quickly — minutes matter.

| What happened | Do this now |
| --- | --- |
| Opened a link, entered nothing | Close the page, report the email |
| Entered your password | [Reset your password](https://aka.ms/sspr) immediately, then call Security on **ext. 4444** |
| Approved an MFA prompt you didn't start | Call Security on **ext. 4444** — they revoke your sessions |
| Opened an attachment | Disconnect from the network (Wi-Fi off) and call ext. 4444 |
| Paid or changed bank details | Call your manager and Finance as well as Security |

> **You won't get in trouble for reporting** — even if you clicked. Reporting early is what stops an attack.`,
    translations: [
      {
        locale: 'zh-TW',
        title: '回報網路釣魚郵件',
        summary: '收到可疑郵件？一鍵回報，資安團隊即可為所有人封鎖——若已點擊，也請了解接下來該怎麼做。',
        body: `## 網路釣魚的徵兆

- 營造急迫感或威脅：*「您的信箱將在 24 小時內刪除」*。
- 寄件者地址與名稱不符，或使用相似網域（\`corp-example.co\`）。
- 連結的實際位址（將滑鼠移到上方即可看到）與文字不符。
- 要求提供密碼、MFA 驗證碼、禮物卡或變更付款資訊。
- 自稱內部郵件卻顯示黃色的**外部**橫幅。

## 回報方式

1. 在 Outlook 中選取該郵件，於功能區選擇 **回報 → 網路釣魚**（網頁版與行動版為 *… → 回報 → 網路釣魚*）。
2. 這樣就完成了——郵件會移出收件匣並由資安團隊審查。**請勿轉寄**給同事。

## 已經點擊或回覆了？

請立即處理——分秒必爭。

| 發生情況 | 立即處理 |
| --- | --- |
| 開啟了連結但未輸入任何資料 | 關閉網頁並回報郵件 |
| 輸入了密碼 | 立即 [重設密碼](https://aka.ms/sspr)，然後撥打資安分機 **4444** |
| 核准了非您發起的 MFA 要求 | 撥打分機 **4444**，資安團隊會撤銷您的工作階段 |
| 開啟了附件 | 中斷網路（關閉 Wi-Fi）並撥打分機 4444 |
| 已付款或變更了銀行資料 | 除了資安團隊，也請聯絡主管與財務部門 |

> **回報不會讓您受罰**——即使已經點擊。及早回報才能阻止攻擊。`,
      },
    ],
  },
  {
    slug: 'lost-device',
    category: 'security',
    owner: 'security',
    title: 'Lost or stolen laptop or phone',
    summary:
      'Report a lost or stolen company device straight away so we can lock and wipe it — here is exactly what to do.',
    tags: ['lost', 'stolen', 'device', 'wipe', 'security'],
    publishedDaysAgo: 190,
    reviewInDays: 140,
    views: 640,
    helpful: 61,
    notHelpful: 3,
    body: `## Do this within one hour

1. **Call the Service Desk on ext. 1234** (or +886 2 1234 5678 from outside, 24/7). Tell them the device type and when you last had it.
2. We **lock the device** and sign you out of every session. If it's not found within 24 hours, we wipe it remotely.
3. **Change your password** at [aka.ms/sspr](https://aka.ms/sspr) from another device.
4. If it was stolen, report it to the police and keep the report number — we need it for insurance.

## What we need from you

| Information | Why |
| --- | --- |
| Where and when you last had it | Decides whether to wait or wipe now |
| Was it locked? | An unlocked device is wiped immediately |
| Police report number | Insurance claim |
| Any files only on the device | We check whether they were in OneDrive |

## Personal phone with work apps

If your personal phone had Outlook or Teams, we remove only the **work data** — your photos and personal apps are untouched.

## Getting a replacement

A loan laptop is ready the same working day at the IT desk. A permanent replacement follows the normal [laptop request](/requests) without cost to you for the first loss.

> **Tip:** Turn on *Find my device* on your company phone in Company Portal — it makes recovery far more likely.`,
  },
  {
    slug: 'new-joiner',
    category: 'new-joiners',
    owner: 'lead',
    title: 'New joiner IT checklist',
    summary:
      'Your first-week IT checklist: sign in, set up MFA, get your laptop ready, join Wi-Fi and find help.',
    tags: ['onboarding', 'new joiner', 'checklist', 'first day'],
    publishedDaysAgo: 150,
    reviewInDays: 170,
    views: 1870,
    helpful: 188,
    notHelpful: 7,
    body: `Welcome! Work through this list on your first day — most of it takes less than an hour.

## Day 1

1. **Collect your laptop and badge** at the IT desk (2F). Bring your ID.
2. **Sign in** with the temporary password from your welcome email. You'll be asked to choose your own (12+ characters).
3. **Set up MFA** with the Authenticator app — see *Set up multi-factor authentication*.
4. **Register a backup method** (mobile number) at [aka.ms/mfasetup](https://aka.ms/mfasetup).
5. **Join Corp-WiFi** — your laptop does it automatically in the office.

## Week 1

| Task | Where |
| --- | --- |
| Install the apps your team uses | Company Portal |
| Add the Follow-Me printer | *Add a network printer* |
| Set up the VPN for working from home | *Connect to the VPN from home* |
| Request team shared mailboxes and folders | [Requests](/requests) |
| Complete the security awareness course (30 min) | The learning portal — mandatory within 14 days |
| Check you can open the intranet and Teams channels | Ask your buddy for the links |

## Good to know

- **Help:** search this knowledge base first, then [report an issue](/itsm/report). The Service Desk is on ext. 1234, 8:00–20:00.
- **Files:** save work in OneDrive or Teams — never only on the laptop.
- **Phishing:** use *Report → Phishing* in Outlook for anything suspicious.
- **Lost device:** call ext. 1234 immediately, day or night.

> **Tip:** Bookmark the [knowledge base](/knowledge) — most questions are answered here in under a minute.`,
  },
  {
    slug: 'erp-session-expired',
    category: 'software-licenses',
    owner: 'apps',
    audience: 'agents',
    title: 'ERP: "Session expired" error after login (agent guide)',
    summary:
      'Internal: users are thrown back to the ERP login with "Session expired (E-4401)". Root cause is a stale SSO cookie or a load-balancer stickiness issue.',
    tags: ['erp', 'session expired', 'e-4401', 'sso', 'agent'],
    publishedDaysAgo: 90,
    reviewInDays: 75,
    views: 410,
    helpful: 52,
    notHelpful: 4,
    body: `## Symptom

The user signs in to the ERP portal, sees the dashboard for a few seconds and is redirected to the login page with **"Session expired (E-4401)"**. It repeats on every attempt.

## Triage (2 minutes)

| Question | If yes |
| --- | --- |
| Several users at once, same site? | Likely load-balancer issue → *Escalate* below |
| Only one user? | Stale SSO cookie → *Fix for one user* |
| User recently changed password? | Stale SSO cookie |
| Happens only on VPN? | Check split-tunnel; ERP must route through the tunnel |

## Fix for one user

1. Ask the user to open a **private / InPrivate window** and sign in. If that works, the cookie is stale.
2. Clear cookies for \`erp.corp.example.com\` and \`login.corp.example.com\` only (not all browsing data).
3. If the user has the ERP desktop client: *Tools → Clear credentials*, then restart it.
4. Ask the user to sign in again. Resolve the ticket with code **Workaround applied** and link this article.

## Escalate

If more than 3 users from the same site report E-4401 within 30 minutes:

1. Link the tickets to a parent incident (*Major incident* if finance closing is running).
2. Assign to **Application Support – ERP** with the user names, sites and times.
3. ERP team checks session persistence on the load balancer (\`erp-lb-01/02\`) and the SSO token lifetime.

> **Never** ask users for their ERP password, and don't reset ERP roles as a fix — it doesn't help and creates access-review noise.`,
  },
  {
    slug: 'vpn-macos-known-error',
    category: 'network-vpn',
    owner: 'network',
    audience: 'agents',
    title: 'Known error: VPN client 5.2 crashes on macOS 15',
    summary:
      'Internal: Corp VPN 5.2.x quits unexpectedly on macOS 15 when the network changes. Workaround: upgrade to 5.3.1 or disable the network extension auto-reconnect.',
    tags: ['vpn', 'macos', 'known error', 'crash', 'agent'],
    publishedDaysAgo: 40,
    reviewInDays: 20,
    views: 380,
    helpful: 47,
    notHelpful: 2,
    body: `## Status

**Known error** — linked problem record tracks the vendor fix. Fixed in **Corp VPN 5.3.1**; 5.2.x is still installed on about 15% of Macs.

## Symptoms

- Corp VPN quits with *"Corp VPN quit unexpectedly"* when the Mac changes network (Wi-Fi to hotspot, wake from sleep).
- After the crash the menu-bar icon is gone and reopening the app shows *"Network extension not responding"*.
- Only macOS 15.x with client **5.2.0 – 5.2.4**.

## Workaround (preferred): upgrade

1. Ask the user to open **Company Portal → Corp VPN** and select **Reinstall** (pulls 5.3.1).
2. Approve the system-extension prompt in *System Settings → Privacy & Security*.
3. Restart the Mac.

## Workaround if the upgrade is blocked

1. Corp VPN → *Settings → Connection* → turn off **Reconnect automatically**.
2. The user reconnects manually after network changes; the crash does not occur.

## Resolving tickets

- Resolution code: **Known error – workaround applied**.
- Link the ticket to the problem record so the impact count stays accurate.
- If the crash also occurs on **5.3.1**, it is a *different* issue: collect logs (*Troubleshooting → Collect logs*) and escalate to the Network Team.`,
  },
  {
    slug: 'teams-av',
    category: 'software-licenses',
    owner: 'servicedesk',
    status: 'in_review',
    title: 'Microsoft Teams: fix camera, microphone and audio problems',
    summary:
      "Others can't hear or see you in Teams? Check device settings, permissions and drivers in this order.",
    tags: ['teams', 'audio', 'camera', 'microphone', 'meetings'],
    views: 0,
    body: `## Check the basics

1. In a meeting, select **More → Settings → Device settings** and pick the right speaker, microphone and camera.
2. Make a **test call**: *Settings → Devices → Make a test call*.
3. Unplug and re-plug USB headsets; prefer the laptop's USB-C port over a dock.

## Permissions

| System | Where |
| --- | --- |
| Windows | Settings → Privacy & security → Camera / Microphone → allow desktop apps |
| macOS | System Settings → Privacy & Security → Camera / Microphone → Microsoft Teams on |

## Still not working

- Close other apps that use the camera (Zoom, browser tabs).
- Update Teams: *… → Check for updates*.
- Restart the laptop — camera drivers often recover after a restart.`,
  },
  {
    slug: 'dock-monitors',
    category: 'hardware-printers',
    owner: 'network',
    status: 'draft',
    title: 'Docking station: external monitors not detected',
    summary: 'Draft: steps when monitors stay black on the USB-C dock.',
    tags: ['dock', 'monitor', 'usb-c', 'display'],
    views: 0,
    body: `## Steps

1. Unplug the dock's power for 30 seconds, then reconnect it before the laptop.
2. Press **Windows + P** and choose *Extend*.
3. Update the dock firmware from Company Portal (*Dock Firmware Updater*).

TODO: add the table of supported resolutions per dock model.`,
  },
  {
    slug: 'anyconnect-legacy',
    category: 'network-vpn',
    owner: 'network',
    status: 'retired',
    title: 'Connect with the legacy AnyConnect VPN',
    summary: 'Retired: the AnyConnect gateway was switched off. Use the Corp VPN client instead.',
    tags: ['vpn', 'anyconnect', 'legacy'],
    publishedDaysAgo: 720,
    views: 6120,
    helpful: 302,
    notHelpful: 88,
    body: `> This gateway was decommissioned. See *Connect to the VPN from home* for the Corp VPN client.

## Connect (legacy)

1. Open Cisco AnyConnect.
2. Enter \`legacy-vpn.corp.example.com\`.
3. Sign in with your work account.`,
  },
];

/** Sample reader feedback (comments shown to owners). */
export const SEED_FEEDBACK: { slug: string; helpful: boolean; comment?: string }[] = [
  {
    slug: 'vpn-drops',
    helpful: false,
    comment: 'Switching to TCP didn’t help on hotel Wi-Fi — still drops every 5 minutes.',
  },
  { slug: 'vpn-drops', helpful: true, comment: 'The power-saving setting was it. Stable all afternoon now!' },
  { slug: 'vpn-drops', helpful: true },
  { slug: 'password-reset', helpful: true, comment: 'Worked from my phone in two minutes.' },
  {
    slug: 'password-reset',
    helpful: false,
    comment: 'I never registered a phone number, so I couldn’t use it.',
  },
  {
    slug: 'print-queue',
    helpful: false,
    comment: 'I can’t delete the spooler files — it asks for admin rights.',
  },
  { slug: 'outlook-sync', helpful: true },
  { slug: 'mfa-authenticator', helpful: true, comment: 'Clear steps, thanks.' },
  { slug: 'shared-mailbox', helpful: false, comment: 'The mailbox still hasn’t appeared after a day.' },
  { slug: 'erp-session-expired', helpful: true },
];
