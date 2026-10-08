# Glossary

The terms used in IS Big Platform and in these guides, in English, 繁體中文 and 日本語, as they appear on screen. Use it
to find the label you're looking for in another language, or to check what a term means in our work.

## What you can do here

- Look up a term in the [table of terms](#terms), sorted alphabetically by the English term
- Follow the links in [How it connects](#how-it-connects) to the guides that use them

## Terms

| English                  | 繁體中文              | 日本語                 | Meaning                                                                                                                                                                       |
| ------------------------ | --------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Access review            | 存取審查              | アクセス レビュー      | A campaign in which reviewers confirm (**Keep**) or remove (**Revoke**) people's database access                                                                              |
| API client               | API 用戶端            | API クライアント       | A system or script (not a person) that calls the ISBP API with a key or OAuth credentials and its own permissions                                                             |
| Application              | 應用程式              | アプリケーション       | A system we run or use (Finance ERP, HR Portal). In **Applications** it has environments, releases and deployments; in **Administration → Applications** it has its own roles |
| Apply (change set)       | 套用                  | 適用                   | Make a change set's changes live, all in one transaction                                                                                                                      |
| Approval                 | 簽核                  | 承認                   | A decision someone must make before work goes ahead. Approvers decide in **Approvals**                                                                                        |
| Approval path            | 簽核路徑              | 承認ルート             | The steps of a request's approval, who decided each step and who it's waiting for                                                                                             |
| Approval workflow        | 簽核流程              | 承認ワークフロー       | The rules that decide who approves what, in which order and by when; designed in **Administration → Workflows**                                                               |
| Approve, approved        | 核准、已核准          | 承認、承認済み         | The decision itself and its result. The person deciding is the approver (簽核者, 承認者)                                                                                      |
| Ask IT                   | 詢問 IT               | IT に質問              | The virtual agent for employees: answers from the knowledge base, and prepares a ticket when it can't help                                                                    |
| Asset disposal           | 資產報廢              | 資産の廃棄             | Getting rid of a retired asset, approved by the asset manager (and information security for data-bearing devices)                                                             |
| Assistant                | 助理                  | アシスタント           | The built-in AI agent in the header. It works with your permissions and prepares configuration changes as change sets                                                         |
| Attachments              | 附件                  | 添付ファイル           | Files added to a record (a ticket, contract, asset, release…), checked before they're stored                                                                                  |
| Audience                 | 適用對象              | 対象ユーザー           | Who sees a request form in the portal: **Everyone** or **Specific groups**                                                                                                    |
| Audit log                | 稽核日誌              | 監査ログ               | The tamper-evident record of every change, sign-in and access decision                                                                                                        |
| Business calendar        | 營業行事曆            | 営業カレンダー         | Working hours, time zone and holidays that SLA timers count in                                                                                                                |
| Business service         | 業務服務              | ビジネス サービス      | A service the business uses (for example Remote Access (VPN)), modelled in the CMDB with what it depends on                                                                   |
| CAB                      | 變更諮詢委員會（CAB） | 変更諮問委員会 (CAB)   | The Change Advisory Board: approves high-risk changes and changes that touch critical configuration items                                                                     |
| Change                   | 變更                  | 変更                   | A planned modification to a service or system, with a plan, a window and an approval (`CHG-…`)                                                                                |
| Change set               | 變更集                | 変更セット             | A group of configuration changes prepared with the assistant, with a diff and a dry run; applied, reviewed and rolled back as a whole (`CS-…`)                                |
| Configuration item       | 組態項目              | 構成アイテム           | Something we manage in the CMDB (a server, a switch, an application) with its relationships                                                                                   |
| Conflict (sync)          | 同步衝突              | 同期の競合             | A field changed both in ISBP and in the connected system since the last sync; a person or a rule decides which value to keep                                                  |
| Connection (integration) | 連線                  | 接続                   | The link to one ServiceDesk Plus or Azure DevOps Server, with its address, credentials and health                                                                             |
| Contract                 | 合約                  | 契約                   | A support, lease or licence agreement with a vendor, with renewal dates and reminders                                                                                         |
| Custom field             | 自訂欄位              | カスタム フィールド    | A field our administrators added (for example a cost centre) to people, groups, departments or module records                                                                 |
| Customisation            | 自訂                  | カスタマイズ           | A part of the configuration the assistant can change through change sets: workflows, forms, custom fields, roles, SLA policies and more                                       |
| Dashboard                | 儀表板                | ダッシュボード         | The home page: your approvals and open requests, plus cards from the areas you work in                                                                                        |
| Data API                 | 資料 API              | データ API             | A REST endpoint published from parameterised SQL on a database connection                                                                                                     |
| Database access          | 資料庫存取            | データベース アクセス  | Self-service, time-bound roles on databases, with approval, automatic accounts, expiry and access reviews                                                                     |
| Database connection      | 資料庫連線            | データベース接続       | A registered SQL Server, Oracle, PostgreSQL or MySQL database with encrypted credentials and a purpose (data or account administration)                                       |
| Delivery metrics         | 交付指標              | デリバリー メトリック  | DORA metrics of an application: deployment frequency, lead time for changes, change failure rate, time to restore                                                             |
| Department               | 部門                  | 部署                   | A unit of the organisation chart. Roles can be limited to a department and the departments under it                                                                           |
| Deployment               | 部署                  | デプロイ               | A version installed in an environment, recorded by a person or a CI/CD pipeline                                                                                               |
| Dry run                  | 試行                  | ドライ ラン            | Trying every change of a change set without saving anything, to see whether it would work                                                                                     |
| Environment              | 環境                  | 環境                   | Where an application runs: development, test, staging, production…                                                                                                            |
| ETL pipeline             | ETL 管線              | ETL パイプライン       | A job that copies rows from one database to another, with transformations                                                                                                     |
| Field mapping            | 欄位對應              | フィールド マッピング  | How a field of a remote record corresponds to a field in ISBP in a sync profile                                                                                               |
| Form (request form)      | 申請表單              | 申請フォーム           | A form in **Requests** that asks what IT needs to know and can carry an approval workflow                                                                                     |
| Group                    | 群組                  | グループ               | A set of people (a team) that roles, approvals and form audiences can refer to                                                                                                |
| Guided templates         | 引導式範本            | ガイド付きテンプレート | The assistant's question-and-answer forms, used when no AI chat model is configured                                                                                           |
| Hand over                | 轉交                  | 委任                   | Pass one approval to a colleague. For a period away, use out of office                                                                                                        |
| Hardware asset           | 硬體資產              | ハードウェア資産       | A laptop, phone, server or other device tracked from order to disposal                                                                                                        |
| Helpdesk AI              | 服務台 AI             | ヘルプデスク AI        | AI help for agents: triage suggestions, similar tickets, reply drafts, summaries and knowledge drafts                                                                         |
| Impact                   | 影響範圍              | 影響度                 | How widely an issue affects the business; with urgency it sets the priority                                                                                                   |
| Incident                 | 事件                  | インシデント           | Something broken that needs restoring (`INC-…`)                                                                                                                               |
| Knowledge article        | 知識文章              | ナレッジ記事           | A reviewed how-to or fix in the knowledge base, in up to three languages                                                                                                      |
| Known error              | 已知錯誤              | 既知のエラー           | A problem whose cause is known, usually with a workaround agents can apply                                                                                                    |
| Linked records           | 連結的紀錄            | 関連レコード           | Records of any area linked to each other, such as a release and its change                                                                                                    |
| Major incident           | 重大事件              | 重大インシデント       | An incident with wide impact that is handled with extra urgency and communication                                                                                             |
| MCP                      | 外部代理程式（MCP）   | 外部エージェント (MCP) | Model Context Protocol: how outside AI agents (such as Claude Code) use ISBP, through an API client                                                                           |
| Notification             | 通知                  | 通知                   | A message about something that concerns you, in the app and optionally by email                                                                                               |
| Notification channel     | 通知通道              | 通知チャネル           | A Microsoft Teams or Slack channel or a webhook that receives selected notifications                                                                                          |
| Offboard                 | 離職停用              | オフボーディング       | Disable a leaver's sign-in and sessions and remove their access                                                                                                               |
| Onboard                  | 到職啟用              | オンボーディング       | Activate a pre-boarded person so they can sign in                                                                                                                             |
| Out of office            | 不在辦公室            | 不在設定               | A period when your new approvals go to a colleague you choose                                                                                                                 |
| Permission               | 權限                  | アクセス許可           | The right to do one thing (for example read tickets). Roles bundle permissions                                                                                                |
| Pre-boarded              | 預先建立              | 事前登録               | A person whose account exists but can't sign in until they're onboarded                                                                                                       |
| Priority                 | 優先順序              | 優先度                 | How soon a ticket must be handled, from impact and urgency; drives the SLA targets                                                                                            |
| Problem                  | 問題                  | 問題                   | The underlying cause of one or more incidents (`PRB-…`)                                                                                                                       |
| Project                  | 專案                  | プロジェクト           | A piece of IT work with members, milestones, tasks and health updates                                                                                                         |
| Project proposal         | 專案提案              | プロジェクト提案       | A large project that needs approval before it starts                                                                                                                          |
| Release                  | 發行版本              | リリース               | A version of an application, with release notes, a readiness checklist and its deployments                                                                                    |
| Request                  | 申請                  | 申請                   | Anything you ask for in **Requests**: access, a form, a ticket, database access (`REQ-…` for access and form requests)                                                        |
| Request access           | 申請權限              | アクセスの申請         | Ask for a role in **Requests → Request access**, for yourself or someone else; it goes through an approval                                                                    |
| Requestable              | 可申請                | 申請可能               | A role people can ask for in **Request access**, with an owner, a risk level and a maximum duration                                                                           |
| Role                     | 角色                  | ロール                 | A named set of permissions, given to people or groups, sometimes only for a department or a record, sometimes until a date                                                    |
| Role Query               | 角色查詢              | ロール クエリ          | The API business applications call to ask which roles and permissions a person has in them                                                                                    |
| Roll back                | 回復                  | ロールバック           | Undo an applied change set in one step, unless the objects changed since (a deployment that was rolled back shows 已回復 / ロールバック済み)                                  |
| Runs                     | 執行紀錄              | 実行 / 実行履歴        | The list of a job's, pipeline's or sync profile's executions, each with its status and log                                                                                    |
| Scheduled job            | 排程作業              | スケジュール ジョブ    | Work that runs on a schedule (cron, interval or after other jobs): HTTP calls, SQL, scripts, pipelines                                                                        |
| Service catalog          | 服務目錄              | サービス カタログ      | The request forms the service desk fulfils as tickets                                                                                                                         |
| Service request          | 服務請求              | サービス要求           | A ticket for something someone needs, such as equipment (`SR-…`)                                                                                                              |
| Sessions                 | 工作階段              | セッション             | The devices and browsers signed in to your account                                                                                                                            |
| SLA                      | SLA                   | SLA                    | Service level agreement: response and resolution targets, counted in business hours                                                                                           |
| Sync profile             | 同步設定檔            | 同期プロファイル       | What an integration syncs with ServiceDesk Plus or Azure DevOps Server, in which direction, with which field mappings                                                         |
| Task                     | 工作項目              | タスク                 | A piece of work in a project, on the board and the timeline                                                                                                                   |
| Ticket                   | 工單                  | チケット               | A service desk record: an incident, a service request, a problem or a change                                                                                                  |
| Unmanaged access         | 未受管理的存取        | 管理外のアクセス       | Database access found on a server that wasn't granted through ISBP                                                                                                            |
| Workload                 | 工作負載              | 作業負荷               | Planned hours per person per week, compared with their capacity                                                                                                               |

> **Tip:** In 繁體中文, 簽核 names the approval process (**簽核**, 簽核流程, 簽核路徑, 待簽核, 簽核者) and 核准 the
> decision itself (核准, 已核准). 紀錄 is a record or log entry (執行紀錄, 連結的紀錄) and 記錄 the verb ("recorded in
> the audit log"); a run's log file is 記錄檔. 回復 is rolling back a change set or a deployment, 復原 is undoing. In
> 日本語, a permission is アクセス許可, and 権限 appears only in fixed terms such as 最小権限 (least privilege). Role names
> follow the reader's language; roles your organisation creates keep the name they were given. A few screens still
> differ slightly, for example 実行 and 実行履歴 for runs in 日本語. When a guide quotes a label, it uses the exact words
> of that screen.

## How it connects

- Where each term lives in our work: [How ISBP fits our work](how-it-fits-our-work.md).
- Start: [Start here](README.md). Questions: [FAQ](faq.md).
