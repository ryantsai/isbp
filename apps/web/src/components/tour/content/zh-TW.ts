import { areas } from './zh-TW.areas';
import { ai, architecture, security } from './zh-TW.architecture';
import { journeys } from './zh-TW.journeys';
import type { TourContent, TourShot } from './types';

const shot = (name: string, alt: string, w = 1280, h = 800, locale?: TourShot['locale']): TourShot => ({
  name,
  alt,
  w,
  h,
  ...(locale ? { locale } : {}),
});

/**
 * The product tour in Traditional Chinese (Taiwan IT vocabulary, like the user guide). Numbers in `overview.stats`
 * come from the generated reference (docs/ai/reference.md): `packages/guide/test/tour.test.ts` fails when they drift.
 */
export const zhTW: TourContent = {
  locale: 'zh-TW',
  meta: {
    title: '產品導覽',
    description:
      '以真實的畫面與動畫，帶您走過 IS Big Platform 的十二個功能區域、系統架構、AI 閘道與安全模型。',
  },
  chrome: {
    brand: 'IS Big Platform',
    back: '回到 ISBP',
    menuAreas: '功能區域',
    progress: '導覽進度',
    skip: '跳到主要內容',
    openLarge: '放大檢視畫面',
    closeLarge: '關閉',
    where: '位置',
    who: '適用對象',
    guideCta: '閱讀完整指南',
    step: '步驟',
    of: '／',
    play: '播放',
    pause: '暫停',
    previous: '上一步',
    next: '下一步',
    replay: '重新播放',
    demoNote: '畫面擷取自示範資料',
  },
  hero: {
    kicker: '產品導覽',
    title: '一個平台，承載所有 IT 工作',
    lead: '從員工的一張申請，到服務台、變更、資產、專案、資料整合與 AI 助理——同一套權限、同一份稽核紀錄、同一個收件匣。這份導覽以真實的畫面，帶您走過十二個功能區域與背後的架構。',
    start: '開始導覽',
    openProduct: '前往首頁',
    openGuide: '閱讀使用指南',
    note: '所有畫面皆擷取自 ISBP 示範資料（繁體中文介面）。',
    chips: ['真實畫面', '架構與資料流', '端到端情境'],
    shots: [
      shot('readme-dashboard', '首頁，左側為側邊欄，頂端為頁首'),
      shot('service-desk-ticket', '包含 SLA 計時與 AI 輔助面板的事件'),
      shot('changes-application', 'Finance ERP 應用程式的環境與交付指標'),
    ],
  },
  sections: [
    { id: 'overview', nav: '總覽' },
    { id: 'areas', nav: '功能區域' },
    { id: 'architecture', nav: '架構' },
    { id: 'ai-gateway', nav: 'AI 閘道' },
    { id: 'security-model', nav: '安全' },
    { id: 'journeys', nav: '情境' },
    { id: 'start', nav: '開始使用' },
  ],
  overview: {
    title: '十二個功能區域，同一個平台',
    lead: '每個區域都是獨立的模組，卻共用同一組基礎元件：申請與簽核、通知、紀錄連結、附件、自訂欄位、角色與權限、稽核日誌與 AI。學會一處，到哪裡都適用。',
    mapTitle: '功能地圖',
    mapHint: '選擇任一區域，直接跳到它的導覽。',
    coreLabel: 'ISBP 核心',
    coreNote: '身分 · 權限 · 稽核 · 簽核',
    open: '開始看這個區域',
    stats: [
      { key: 'modules', value: 18, label: '個模組', hint: '核心加上 17 個功能模組，共用同一個 SDK' },
      { key: 'permissions', value: 121, label: '項權限', hint: '格式為 module.resource.action' },
      { key: 'roles', value: 62, label: '個內建角色', hint: '可指派給人或群組，並設有範圍與到期日' },
      { key: 'events', value: 224, label: '種領域事件', hint: '與資料在同一個交易中發出' },
      { key: 'aiTools', value: 59, label: '項 AI 工具', hint: '與 UI 套用相同的權限檢查' },
      { key: 'notifications', value: 93, label: '種通知', hint: '站內、電子郵件、Teams、Slack 或 Webhook' },
    ],
    shared: {
      title: '所有區域共用的基礎元件',
      lead: '這些元件只做一次，每個模組都直接使用。',
      items: [
        {
          icon: 'workflow',
          title: '申請與簽核',
          body: '凡是需要決定的事項，都走同一套簽核流程；簽核者在同一個收件匣決定，申請人看得到簽核路徑。',
        },
        {
          icon: 'bell',
          title: '通知',
          body: '頁首的鈴鐺，以及電子郵件、Microsoft Teams、Slack 或 Webhook；內容以收件人的語言撰寫。',
        },
        {
          icon: 'link',
          title: '紀錄與連結',
          body: '工單、變更、資產、組態項目、發行版本與工作項目可以跨區域互相連結，而且只顯示您有權開啟的。',
        },
        {
          icon: 'paperclip',
          title: '附件',
          body: '螢幕截圖、合約與文件放在紀錄的附件面板，檔案在儲存前先經過檢查。',
        },
        {
          icon: 'list-checks',
          title: '自訂欄位',
          body: '管理員可以為人員、群組、部門與模組紀錄新增自己的欄位；表單也使用同一種欄位。',
        },
        {
          icon: 'key-round',
          title: '角色與權限',
          body: '您看得到與做得到的一切都來自角色：可限定範圍，也可以設定到期日。',
        },
        {
          icon: 'scroll-text',
          title: '稽核日誌',
          body: '每一次變更、登入與存取決定都留下無法編輯的紀錄。',
        },
        {
          icon: 'sparkles',
          title: 'AI 與助理',
          body: '詢問 IT、服務台 AI 與助理都以您的權限運作，並在資料離開平台前遮罩個人資料。',
        },
      ],
    },
  },
  areasIntro: {
    title: '十二個區域，逐一走過',
    lead: '每個區域都用同樣的方式介紹：它解決什麼問題、誰會用、在側邊欄的哪裡，以及真實的畫面。向下捲動，畫面會跟著步驟切換；圖上的圓點標出重點。',
  },
  areas,
  architecture,
  ai,
  security,
  journeys: {
    title: '端到端情境：一件事怎麼走過整個平台',
    lead: '單一功能再強，真正的價值在於它們接得起來。以下五段情境與示範資料一致，每一步都是真實的畫面。',
    items: journeys,
    guideCta: '在指南中閱讀完整情境',
  },
  polish: {
    title: '三種語言、淺色與深色，一視同仁',
    lead: '整個平台、平台寄出的電子郵件與使用指南都提供 English、繁體中文與日本語；語言與佈景主題跟著帳號走。',
    langs: [
      {
        locale: 'en',
        label: 'English',
        shot: shot('readme-dashboard', 'English 介面的首頁', 1280, 800, 'en'),
      },
      {
        locale: 'zh-TW',
        label: '繁體中文',
        shot: shot('readme-dashboard', '繁體中文介面的首頁', 1280, 800, 'zh-TW'),
      },
      {
        locale: 'ja-JP',
        label: '日本語',
        shot: shot('readme-dashboard', '日本語介面的首頁', 1280, 800, 'ja-JP'),
      },
    ],
    dark: { label: '深色佈景主題', shot: shot('dashboard-dark', '深色佈景主題的首頁') },
    points: [
      {
        icon: 'globe',
        title: '三種語言',
        body: '介面、通知、電子郵件與使用指南；每個人的語言設定跟著帳號走。',
      },
      {
        icon: 'monitor',
        title: '淺色、深色與跟隨系統',
        body: '佈景主題在頭像選單切換，立即生效，並同步到其他裝置。',
      },
      {
        icon: 'gauge',
        title: '無障礙與動態',
        body: '符合 WCAG 2.1 AA、鍵盤可操作、狀態不只靠顏色；尊重「減少動態效果」設定；手機寬度也能使用。',
      },
    ],
  },
  roles: {
    title: '下一步：選擇適合您角色的指南',
    lead: '導覽看過全貌之後，每個角色都有一份專屬的任務式指南，說明每個畫面怎麼操作。',
    items: [
      {
        who: '想了解全貌：哪個區域負責哪項 IT 實務',
        guide: { slug: 'how-it-fits-our-work', label: 'ISBP 如何融入我們的工作' },
      },
      { who: '員工、主管或簽核者', guide: { slug: 'employees', label: '員工、主管與簽核者' } },
      { who: '在服務台工作（工單、SLA、知識庫、CMDB）', guide: { slug: 'service-desk', label: '服務台' } },
      {
        who: '管理變更、擔任 CAB 成員或負責應用程式',
        guide: { slug: 'changes-and-releases', label: '變更與發行' },
      },
      { who: '管理硬體、授權、合約與廠商', guide: { slug: 'assets', label: '資產' } },
      {
        who: '維護資訊資產清冊、盤點、共用帳號與帳號清查',
        guide: { slug: 'information-security', label: '資訊安全' },
      },
      { who: '主持或參與專案', guide: { slug: 'projects', label: '專案' } },
      { who: '召集或參加會議，並追蹤會議的待辦事項', guide: { slug: 'meetings', label: '會議' } },
      {
        who: '建置資料介接、排程作業，或維護資料庫',
        guide: { slug: 'data-and-automation', label: '資料與自動化' },
      },
      {
        who: '將 ISBP 連接到 ServiceDesk Plus 或 Azure DevOps Server',
        guide: { slug: 'integrations', label: '整合' },
      },
      {
        who: '想了解 AI 會做什麼，或想透過代理程式自訂平台',
        guide: { slug: 'assistant-and-ai', label: '助理與 AI' },
      },
      {
        who: '管理人員、存取權、登入、簽核流程、表單或模組',
        guide: { slug: 'administrators', label: '管理員' },
      },
      {
        who: '將 IT 流程轉為含簽核與動作的申請表單',
        guide: { slug: 'build-a-process', label: '建立您自己的流程' },
      },
      { who: '需要查詢某個詞彙在三種語言中的說法', guide: { slug: 'glossary', label: '詞彙表' } },
      { who: '遇到問題，或有簡短的疑問', guide: { slug: 'faq', label: '常見問題與疑難排解' } },
    ],
  },
  closing: {
    title: '準備好了，就從首頁開始',
    lead: '遇到不熟的地方，隨時選擇頁首的問號，就會開啟您所在區域的指南；也可以直接**詢問 IT**。',
    actions: [
      { label: '前往首頁', kind: 'product' },
      { label: '閱讀使用指南', kind: 'guide', slug: 'start-here' },
      { label: '常見問題與疑難排解', kind: 'guide', slug: 'faq' },
    ],
    footnote: '本導覽的畫面皆擷取自 ISBP 示範資料；在您的環境中，可見的頁面與資料會依您的角色而不同。',
  },
};
