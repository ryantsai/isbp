import type { TourContent, TourShot } from './types';

const shot = (name: string, alt: string, w = 1280, h = 800): TourShot => ({ name, alt, w, h });

/**
 * Architecture, AI gateway and security: the design in docs/architecture.md (§1 shape of the system, §5 decisions,
 * §6 security model, §9.1 AI gateway, §16 and deployment.md), told for people rather than for developers.
 */
export const architecture: TourContent['architecture'] = {
  title: '架構：一個小而穩的核心，加上同一套 SDK 建成的模組',
  lead: 'ISBP 是模組化單體：一個可水平擴充的 API 程序（加上同一映像的 worker），承載精簡的核心與任意數量的模組。我們出貨的每個功能也都是模組，沒有特權後門。',
  stack: {
    title: '系統全貌',
    lead: '從瀏覽器到資料庫，一次看完每一層做什麼。',
    scale:
      'api 與 worker 都是無狀態的，可以各自水平擴充；請求不依賴任何本機狀態，所有副本共用同一個 PostgreSQL 與 Redis。',
    layers: [
      {
        id: 'clients',
        icon: 'monitor',
        name: '使用者與外部系統',
        tech: '瀏覽器 · REST · MCP',
        items: [
          { label: '瀏覽器', note: 'Next.js 應用程式外殼，三種語言、淺色與深色' },
          { label: '外部應用程式', note: '透過角色查詢 API 與 REST 查詢誰擁有哪些角色' },
          { label: 'AI 代理程式', note: '透過 MCP 使用與 UI 相同的工具與權限檢查' },
        ],
      },
      {
        id: 'web',
        icon: 'globe',
        name: '入口：web',
        tech: 'Next.js 16（App Router）',
        items: [
          { label: '外殼與頁面', note: '伺服器端轉譯、i18n、模組頁面由同一個主機路由載入' },
          { label: '/api 代理', note: '執行時轉送到 API：Cookie 同網域、沒有 CORS、一個映像適用所有環境' },
          { label: '安全標頭', note: '每個請求一個新的 CSP nonce，禁止被他人嵌入框架' },
        ],
      },
      {
        id: 'api',
        icon: 'server',
        name: '核心與模組：api',
        tech: 'Fastify 5 · 無狀態',
        items: [
          {
            label: '核心（Kernel）',
            note: '登入、工作階段、CSRF、限流、權限引擎、稽核、設定、模組註冊、搜尋、OpenAPI',
          },
          { label: '模組', note: '18 個模組共用同一個 SDK：內建與自訂模組沒有差別' },
          { label: 'AI 閘道', note: '遮罩個資、記錄用量、語意索引、工具註冊表與 MCP' },
        ],
      },
      {
        id: 'worker',
        icon: 'cpu',
        name: '背景處理：worker',
        tech: 'BullMQ · 可水平擴充',
        items: [
          { label: 'Outbox 中繼', note: '以 LISTEN/NOTIFY 與 SKIP LOCKED 把已提交的事件送進佇列' },
          { label: '事件處理器', note: '通知、搜尋索引、流程動作與同步，各自重試與退避' },
          { label: '排程與目錄同步', note: '定期工作、存取到期、與公司目錄的同步' },
        ],
      },
      {
        id: 'data',
        icon: 'database',
        name: '資料與外部服務',
        tech: 'PostgreSQL 18 · Redis · 身分提供者',
        items: [
          { label: 'PostgreSQL', note: '每個模組一個 schema；pgvector 提供語意索引' },
          { label: 'Redis', note: '佇列、權限快取、限流與 pub/sub' },
          { label: '身分提供者', note: 'Entra ID（OIDC／SAML）與 LDAP／AD' },
        ],
      },
    ],
  },
  request: {
    title: '一個請求的旅程',
    lead: '以「更新一位人員」為例：從按下儲存到全平台知道這件事，每一步都有人把關，而且資料與事件一起提交。',
    lanes: [
      { id: 'browser', label: '瀏覽器', note: '使用者' },
      { id: 'web', label: 'Next.js', note: 'proxy.ts' },
      { id: 'api', label: 'Fastify', note: '核心' },
      { id: 'redis', label: 'Redis', note: '快取' },
      { id: 'pg', label: 'PostgreSQL', note: '資料' },
      { id: 'worker', label: 'worker', note: '背景' },
    ],
    steps: [
      {
        from: 'browser',
        to: 'web',
        title: '送出請求',
        body: '瀏覽器帶著工作階段 Cookie 與 CSRF 權杖，發出 PATCH /api/v1/users/:id。Next.js 的 proxy 在執行時把 /api 轉送給 API，所以 Cookie 同網域、不需要 CORS。',
      },
      {
        from: 'web',
        to: 'api',
        title: '進入核心',
        body: '請求原樣轉送。Fastify 先指派 requestId、開啟追蹤 span，並套用限流。',
      },
      {
        from: 'api',
        to: 'pg',
        title: '驗證工作階段',
        body: '以權杖的 SHA-256 查詢工作階段（資料庫裡沒有原始權杖），再核對 CSRF 權杖。',
      },
      {
        from: 'api',
        to: 'redis',
        title: '取得權限快照',
        body: '從 Redis 取出這位使用者的權限快照；快取沒有時，才由資料庫合併個人與群組的角色指派，再寫回快取。快取以全域版本號失效，所有副本一致。',
      },
      {
        from: 'api',
        to: 'api',
        title: '檢查路由權限',
        body: '路由守衛檢查 core.users.update 以及範圍（全域、部門或單一紀錄）。預設拒絕：每個路由都要宣告所需的權限，除非明確標為公開。',
      },
      {
        from: 'api',
        to: 'pg',
        title: '同一個交易寫入',
        body: '在一個交易中更新資料、寫入稽核日誌與 Outbox 事件，然後提交。資料與事件不可能只成功一半。',
      },
      {
        from: 'api',
        to: 'browser',
        title: '回應',
        body: '以 Zod 序列化的 JSON 回應；同一份結構也用於驗證、OpenAPI 與前端表單。',
      },
      {
        from: 'pg',
        to: 'worker',
        title: 'Outbox 中繼',
        body: 'worker 的 Outbox 中繼收到通知，把剛提交的事件送進 BullMQ。',
      },
      {
        from: 'worker',
        to: 'worker',
        title: '事件處理',
        body: '各模組的事件處理器各自重試與退避：寄出通知、更新搜尋索引、啟動流程動作，並寫回同步結果。',
      },
    ],
  },
  modules: {
    title: '一切皆模組',
    lead: '18 個模組全部以同一個 SDK 宣告自己的權限、路由、導覽、事件、通知、工作流程觸發器、記錄類型與 AI 工具。',
    groups: [
      { id: 'core', label: '核心' },
      { id: 'service', label: '服務管理' },
      { id: 'delivery', label: '資產、發行與資安' },
      { id: 'work', label: '專案與協作' },
      { id: 'data', label: '資料與自動化' },
      { id: 'integration', label: '整合' },
      { id: 'ai', label: 'AI' },
    ],
    items: [
      { id: 'core', group: 'core', name: '核心平台', note: '身分、存取控制、稽核與模組系統' },
      {
        id: 'itsm',
        group: 'service',
        name: '服務台',
        note: '事件、服務請求、問題與變更，含 SLA',
        dependsOn: ['cmdb'],
      },
      { id: 'cmdb', group: 'service', name: 'CMDB', note: '組態項目、相依關係與影響範圍' },
      { id: 'knowledge', group: 'service', name: '知識庫', note: '給所有人的解答，給服務台的疑難排解' },
      {
        id: 'helpdesk-ai',
        group: 'service',
        name: '服務台 AI',
        note: 'AI 分派、相似工單、回覆草稿與自助客服',
        dependsOn: ['itsm', 'knowledge'],
      },
      { id: 'announcements', group: 'service', name: '公告', note: '服務通知、維護時段與事故更新' },
      {
        id: 'alm',
        group: 'delivery',
        name: '應用程式',
        note: '應用程式、環境、發行與部署',
        dependsOn: ['cmdb', 'itsm'],
      },
      {
        id: 'itam',
        group: 'delivery',
        name: '資產',
        note: '硬體、軟體授權、合約與廠商',
        dependsOn: ['cmdb'],
      },
      { id: 'isms', group: 'delivery', name: '資訊安全', note: '資訊資產清冊、盤點、共用帳號與帳號清查' },
      { id: 'projects', group: 'work', name: '專案', note: '工作項目、看板、時程、工作負載與狀態回報' },
      { id: 'meetings', group: 'work', name: '會議', note: '會議記錄、決議與待辦事項' },
      {
        id: 'etl',
        group: 'data',
        name: '資料 API 與 ETL',
        note: 'SQL 發佈成 REST 端點，以及資料庫之間的管線',
      },
      { id: 'scheduler', group: 'data', name: '排程作業', note: 'HTTP、SQL、指令碼與模組工作，含重試與紀錄' },
      {
        id: 'dbaccess',
        group: 'data',
        name: '資料庫存取',
        note: '有期限的資料庫角色：簽核、佈建、審查與漂移偵測',
      },
      {
        id: 'integrations',
        group: 'integration',
        name: '整合',
        note: '連線、同步規則、欄位對應、雙向同步與衝突',
      },
      {
        id: 'sdp',
        group: 'integration',
        name: 'ServiceDesk Plus',
        note: '連接器：請求、問題、變更、資產與解決方案',
      },
      {
        id: 'azdo',
        group: 'integration',
        name: 'Azure DevOps Server',
        note: '連接器：團隊專案、工作項目與 Git 儲存庫',
      },
      { id: 'assistant', group: 'ai', name: '助理', note: '以變更集客製平台的 AI 代理程式' },
    ],
    dependsOn: '依賴',
    toggleTitle: '已安裝，不等於已啟用',
    toggleBody:
      '模組透過產生的註冊表編譯進程式（已安裝）；是否啟用則是資料庫裡的旗標，並由 Redis 即時通知每個副本。管理員在**系統管理 → 模組**切換，不必重新部署。',
    toggleShot: shot('modules', '系統管理 → 模組：每個模組一個開關，核心平台標示為系統'),
    toggleMarks: [
      { x: 556, y: 166, label: '核心平台不能關閉', side: 'bottom' },
      { x: 880, y: 166, label: '其他模組隨時啟用或停用', side: 'bottom' },
    ],
    rule: '模組之間不互相直接呼叫：跨模組只經過事件、AI 工具註冊表與介面插槽。模組可以讀取它所依賴的模組的資料表，但絕不寫入。',
  },
  config: {
    title: '設定與程式：流程是設定，能力是程式',
    lead: '一個組織拿 ISBP 做什麼是**設定**；ISBP 能做什麼是**程式**。這條界線讓新的 IS 流程不需要開發。',
    configTitle: '設定（管理員與助理建立）',
    configItems: [
      { title: '流程', body: '申請表單、簽核流程與後續動作；週期性的工作再加上定期的表單指派。' },
      {
        title: '流程範本套件',
        body: '一整套流程與它需要的群組、類別、欄位與排程，整套安裝，全部成功或全部不做。',
      },
      { title: '變更集', body: '所有設定變更先試跑、經人檢閱，再一次套用，也能一次回復。' },
    ],
    codeTitle: '程式（開發人員交付）',
    codeItems: [
      { title: '積木', body: '任何流程都能使用的能力，例如表格欄位、提醒、指派資產的動作。' },
      { title: '紀錄類型', body: '組織長期保管、有狀態與頁面的東西，例如工單、資產、資訊資產。' },
      { title: '連接器', body: 'ISBP 讀取或操作另一個系統的方式，例如 ServiceDesk Plus。' },
    ],
    rule: '一項新的 IS 流程就是設定。做不到時，缺的是積木、紀錄類型或連接器，而且要以它「做什麼」命名，不以提出需求的流程或組織命名。',
    shot: shot('processes-form-builder', '表單設計工具，含一個選取組態項目的紀錄欄位'),
  },
  deploy: {
    title: '部署與維運',
    lead: '兩個映像、兩種部署方式；沒有 Docker 的開發者也能在自己的電腦上跑完整的平台。',
    items: [
      {
        icon: 'package',
        title: '兩個映像',
        body: 'isbp-api（api、worker、migrate、seed 同一映像、不同指令）與 isbp-web（Next.js standalone）。以非 root 身分執行，可使用唯讀根檔案系統。',
      },
      {
        icon: 'layers',
        title: 'Docker Compose 與 Helm',
        body: '正式環境使用 Helm chart，也提供 Docker Compose；沒有 Docker 時，一個指令啟動內嵌的 PostgreSQL 與 Redis 即可開發。',
      },
      {
        icon: 'database',
        title: '相依服務自行管理',
        body: 'PostgreSQL 18（pg_trgm、pgvector）與 Redis 8（noeviction，供佇列使用）不隨 Helm chart 打包，由您的團隊維運。',
      },
      {
        icon: 'cpu',
        title: '可選的模型服務',
        body: '文件解析、嵌入與對話模型可以在 CPU 或 GPU 上自行架設，預設關閉；沒有它們，AI 功能仍以內建模式運作。',
      },
      {
        icon: 'gauge',
        title: '可觀測性',
        body: 'OpenTelemetry 追蹤、結構化記錄與 Prometheus 指標；指標在獨立的內部連接埠，不經過 ingress。',
      },
    ],
  },
};

export const ai: TourContent['ai'] = {
  title: 'AI 閘道：所有模型呼叫都走同一條路',
  lead: 'ISBP 裡沒有任何模組自行連線到 AI 供應商。所有功能——詢問 IS、服務台 AI、會議整理、助理——都經過核心的閘道，因此各處套用相同的隱私規則、用量紀錄與預算。',
  pipeline: [
    {
      id: 'modules',
      icon: 'puzzle',
      title: '模組呼叫閘道',
      body: '模組只呼叫 ctx.ai 的聊天、串流與嵌入，從不接觸供應商 SDK。',
    },
    {
      id: 'mask',
      icon: 'lock',
      title: '遮罩個人資料',
      body: '電子郵件、電話、IP、身分證字號、信用卡與 API 金鑰在送出前換成佔位符，回應時再還原。',
    },
    {
      id: 'provider',
      icon: 'brain-circuit',
      title: '選擇供應商',
      body: '內建（離線）、Anthropic，或任何 OpenAI 相容端點：OpenAI、Azure、Ollama、vLLM 等。',
    },
    {
      id: 'usage',
      icon: 'gauge',
      title: '用量與預算',
      body: '每次呼叫記錄功能、模型、token、成本與延遲；用完每月預算就拒絕。',
    },
    {
      id: 'index',
      icon: 'book-open',
      title: '語意索引',
      body: '向量與關鍵字混合搜尋；每個片段都帶有存取控制，結果以呼叫者的權限過濾。',
    },
    {
      id: 'tools',
      icon: 'cable',
      title: '工具註冊表',
      body: '跨模組動作只能經過它：每個工具強制檢查權限，破壞性工具需要確認並寫入稽核。',
    },
  ],
  mask: {
    title: '看得見的遮罩',
    lead: '供應商看到的是佔位符，不是真實的人與機器。',
    labels: { original: '您輸入的', masked: '送給模型的', reply: '模型的回覆', restored: '回到您畫面的' },
    original: '請協助 amy.lin@contoso.com 重設 VPN，伺服器是 10.20.30.40。',
    masked: '請協助 [EMAIL_1] 重設 VPN，伺服器是 [IP_1]。',
    reply: '已為 [EMAIL_1] 重設 VPN，請她重新連線到 [IP_1]。',
    restored: '已為 amy.lin@contoso.com 重設 VPN，請她重新連線到 10.20.30.40。',
  },
  modes: {
    title: '兩種模式，畫面上誠實標示',
    builtin: {
      title: '內建模式（預設）',
      body: '不需要任何語言模型：以檢索與擷取式摘要作答，內建嵌入器離線運作，對中日文也有效。畫面上標示**基本模式**。',
    },
    model: {
      title: '模型模式',
      body: '管理員新增 Anthropic Claude 或任何 OpenAI 相容模型後，才啟用生成式的回答、草擬與助理對話。',
    },
  },
};

export const security: TourContent['security'] = {
  title: '安全：每個請求都要過八道關',
  lead: '安全是預設值，不是選配：每個路由都需要工作階段或 API 憑證，並宣告所需的權限。',
  pass: '通過',
  gates: [
    {
      icon: 'key-round',
      title: '登入',
      body: '本機帳號使用 argon2id；也可連接 Microsoft Entra ID（OIDC）、SAML 2.0 或 LDAP／AD。重複失敗會暫時鎖定帳號。',
    },
    {
      icon: 'lock',
      title: '工作階段',
      body: '256 位元隨機權杖，資料庫只存 SHA-256；HttpOnly Cookie。登出、停權與離職停用時立即撤銷。',
    },
    {
      icon: 'shield-check',
      title: 'CSRF 與限流',
      body: '以 Cookie 驗證的變更請求都需要工作階段專屬的 CSRF 權杖；登入依 IP 與帳號限流。',
    },
    {
      icon: 'users',
      title: '權限（RBAC）',
      body: '權限格式為 module.resource.action；角色可指派給人或群組，範圍為全域、部門或單一紀錄，並可設定到期日。',
    },
    {
      icon: 'scroll-text',
      title: '稽核日誌',
      body: '每次變更、登入與存取決定都記錄；只能新增，以雜湊值串連並由資料庫觸發器保護。',
    },
    {
      icon: 'key-round',
      title: '機密',
      body: '連線認證與授權金鑰以 AES-256-GCM 加密儲存，API 絕不回傳。',
    },
    {
      icon: 'globe',
      title: '瀏覽器防護',
      body: '每個請求一個新的 CSP nonce、HSTS，並禁止被他人嵌入框架。',
    },
    {
      icon: 'brain-circuit',
      title: '資料不外流',
      body: 'AI 呼叫前遮罩個資；對外 HTTP 一律經過防 SSRF 的出口；指令碼在容器沙盒中執行。',
    },
  ],
  shot: shot('administrators-roles', '具有部門範圍、紀錄範圍與結束日期的角色指派'),
  shotNote: '角色指派可以限定部門、單一紀錄與結束日期：最小權限，而且會自動到期。',
};
