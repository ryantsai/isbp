import type { TourJourney, TourShot } from './types';

const shot = (name: string, alt: string, w = 1280, h = 800): TourShot => ({ name, alt, w, h });

/**
 * The scenarios of `docs/guide/zh-TW/how-it-fits-our-work.md`, told as pictures. Each step names the person, says what
 * they do (labels as the screen shows them) and shows a real capture of the screen involved.
 */
export const journeys: TourJourney[] = [
  {
    id: 'new-joiner',
    icon: 'users',
    nav: '新進人員報到',
    title: '新進人員週一報到',
    intro:
      '業務部的新同事下週到職：HR 建立帳號，主管訂購筆電並申請存取權，第一天就能登入，設備與權限都到位。',
    guide: { slug: 'how-it-fits-our-work', anchor: '情境新進人員週一報到', label: '新進人員週一報到' },
    steps: [
      {
        title: '預先建立帳號',
        who: 'HR 夥伴',
        body: 'HR 在**系統管理 → 人員**選擇**新增人員**，填寫部門與主管，**初始狀態**選**預先建立**：帳號已存在，但還不能登入。',
        shot: shot('administrators-add-person', '「新增人員」面板，填寫身分與組織資料', 512, 800),
      },
      {
        title: '申請存取權',
        who: '主管',
        body: '主管在**申請 → 申請權限**選擇角色，**誰需要此權限？** 選**其他人**並挑選新進人員；確認步驟會顯示由誰簽核。',
        shot: shot('employees-access-request', '權限申請精靈中選擇要申請的權限'),
      },
      {
        title: '簽核者做決定',
        who: '簽核者',
        body: '簽核者在**簽核**中核准。最後一位核准後，系統自動授予角色並設定到期日，角色會在到職啟用後生效。',
        shot: shot('employees-approvals', '簽核收件匣中等待決定的申請'),
      },
      {
        title: '配發筆電',
        who: '資產管理員',
        body: '資產管理員在**資產 → 硬體**找到**庫存中**的筆電，選擇**配發**並選擇新進人員，筆電變為**使用中**。',
        shot: shot('assets-asset', '資產頁面，含詳細資料、財務與配發資訊'),
      },
      {
        title: '到職啟用',
        who: 'HR 夥伴',
        body: '到職第一天，HR 在該人員的頁面選擇**到職啟用**。新進人員可以登入，存取權立即可用，也會出現在角色查詢 API 的結果中。',
        shot: shot('people', '人員清單'),
      },
    ],
  },
  {
    id: 'laptop',
    icon: 'package',
    nav: '超過 6 萬的筆電',
    title: '超過新台幣 60,000 元的筆電',
    intro:
      '部門主管簽核每一份筆電申請；金額超過新台幣 60,000 元時，還需要 IS 資產管理簽核。核准後由服務台完成，最後成為配發給申請人的資產。',
    guide: {
      slug: 'how-it-fits-our-work',
      anchor: '情境超過新台幣-60000-元的筆電',
      label: '超過新台幣 60,000 元的筆電',
    },
    steps: [
      {
        title: '送出筆電申請',
        who: '員工',
        body: '員工在**申請**選擇**筆電申請**，選擇**機型**、輸入**預估金額（新台幣）**與**申請原因**，然後選擇**送出**。',
        shot: shot('employees-portal', '申請頁面，含我的申請、取得協助卡片與申請表單'),
      },
      {
        title: '兩段簽核',
        who: '部門主管 · 資產管理員',
        body: '先是**部門主管簽核**；金額超過新台幣 60,000 元時，再由資產管理員決定 **IS 資產管理**步驟。兩者都在**簽核**中決定。',
        shot: shot('employees-approvals', '簽核收件匣中等待決定的申請'),
      },
      {
        title: '成為服務請求',
        who: '服務台專員',
        body: '核准後，申請成為**硬體 › 筆電**類別的服務請求工單，交給服務台處理；申請人的頁面顯示**處理中**。',
        shot: shot('service-desk-workspace', '服務台工作區與其佇列'),
      },
      {
        title: '配發資產',
        who: '資產管理員',
        body: '資產管理員從庫存**配發**一台筆電，並在工單的**連結的紀錄**下連結該資產。',
        shot: shot('assets-asset', '資產頁面，含詳細資料、財務與配發資訊'),
      },
      {
        title: '完成，出現在我的設備',
        who: '員工',
        body: '處理人員在工單上選擇**完成**；申請頁顯示**已完成**，筆電出現在員工的**我的設備**。',
        shot: shot('my-devices', '我的設備'),
      },
    ],
  },
  {
    id: 'vpn',
    icon: 'life-buoy',
    nav: 'VPN 一直斷線',
    title: '「我的 VPN 一直斷線」',
    intro:
      '在家工作的員工每隔幾分鐘就斷一次 VPN。多半一篇知識文章就能解決；否則由服務台處理，而這次的解法會讓下一次的回答更好。',
    guide: { slug: 'how-it-fits-our-work', anchor: '情境我的-vpn-一直斷線', label: '「我的 VPN 一直斷線」' },
    steps: [
      {
        title: '先問詢問 IS',
        who: '員工',
        body: '員工開啟**詢問 IS** 輸入「VPN 一直斷線」。詢問 IS 依據知識庫回答，並把文章列在**參考來源**下。',
        shot: shot('employees-ask-it', '詢問 IS 虛擬客服與建議的問題'),
      },
      {
        title: '沒解決，轉成工單',
        who: '員工',
        body: '步驟有效就選**是，謝謝**，不需要工單；否則依序選擇**否，建立工單**與**建立工單**，事件出現在**服務台 → 工單**，SLA 開始計時。',
        shot: shot('service-desk-workspace', '服務台工作區與其佇列'),
      },
      {
        title: 'AI 輔助與已知錯誤',
        who: '服務台專員',
        body: '服務台 AI 建議類別、指派群組與優先順序，並顯示相似的已解決工單。處理人員發現符合**問題**中的已知錯誤，套用暫時解法並解決。',
        shot: shot('service-desk-ticket', '包含 SLA 計時與 AI 輔助面板的事件'),
      },
      {
        title: '把解法留給下一個人',
        who: '處理人員 · 知識庫編輯者',
        body: '知識庫還沒有這個解法時，處理人員可以將工單轉成文章草稿，由編輯者審閱並發佈，詢問 IS 就能回答下一個人。',
        shot: shot('service-desk-knowledge-article', '含翻譯版本與版本歷程的知識文章'),
      },
    ],
  },
  {
    id: 'release',
    icon: 'rocket',
    nav: '正式環境發行',
    title: '正式環境發行',
    intro:
      'Finance ERP 團隊要升級到 12.1 版：工作在專案中規劃，版本以發行版本追蹤，正式環境需要一項經 CAB 核准的變更，部署則由管線記錄。',
    guide: { slug: 'how-it-fits-our-work', anchor: '情境正式環境發行', label: '正式環境發行' },
    steps: [
      {
        title: '在專案中規劃',
        who: '專案經理',
        body: '**ERP upgrade to v12** 專案有一個工作項目 **Change request for the production cutover**，並可連結到變更與發行版本。',
        shot: shot('projects-board', '專案看板，含欄位與工作項目卡片'),
      },
      {
        title: '檢查發行就緒',
        who: '發行經理',
        body: '**正式環境就緒檢查**列出：**已連結核准的變更**、**已在測試或預備環境成功部署**、**已撰寫發行說明**、**沒有失敗的正式環境部署**。',
        shot: shot('changes-release-readiness', '發行版本 12.1.0 的就緒檢查清單'),
      },
      {
        title: 'CAB 核准變更',
        who: '變更經理 · CAB',
        body: '**變更授權**簽核流程先問**變更經理**，風險高或涉及關鍵組態項目時再問 **CAB**；變更顯示**等待 CAB 簽核**，接著變為**已排程**。',
        shot: shot('changes-cab-approval', '等待 CAB 簽核的變更與其簽核流程'),
      },
      {
        title: '部署與交付指標',
        who: 'CI/CD 管線',
        body: '管線透過 API 在 ISBP 記錄部署，平台檢查變更政策：沒有經核准、且在時段內的變更，部署會被拒絕。發行**已發行**後，**交付指標**納入這次部署。',
        shot: shot('changes-application', 'Finance ERP 應用程式的環境與交付指標'),
      },
    ],
  },
  {
    id: 'erp-data',
    icon: 'database',
    nav: 'ERP 資料介接',
    title: 'ERP 資料介接',
    intro:
      '財務部門希望每四小時把銷售數據匯入資料倉儲，報表團隊則想以 API 取得 ERP 資料；資料介接失敗時，負責人要被通知。',
    guide: { slug: 'how-it-fits-our-work', anchor: '情境erp-資料介接', label: 'ERP 資料介接' },
    steps: [
      {
        title: '登錄資料庫連線',
        who: '資料庫連線管理員',
        body: '管理員在**系統管理 → 資料庫連線**登錄 ERP 資料庫與資料倉儲，認證資訊加密儲存，用途設為**資料**。',
        shot: shot('data-and-automation-connections', '資料庫連線清單，含引擎、用途與狀態'),
      },
      {
        title: '發佈資料 API',
        who: '資料工程師',
        body: '資料工程師以含參數的 SQL 發佈資料 API、測試，並允許可以呼叫它的 API 用戶端。',
        shot: shot('data-and-automation-endpoint-test', '資料 API 的測試主控台，含結果與繫結後的 SQL'),
      },
      {
        title: '建立管線',
        who: '資料工程師',
        body: '在**資料與自動化 → 管線**建立管線，把資料列從 ERP 複製到資料倉儲。',
        shot: shot('etl-pipelines', '管線清單'),
      },
      {
        title: '排程執行，失敗必知',
        who: '作業擁有者',
        body: '排程作業每四小時執行管線並設定重試；最後一次重試仍失敗時，擁有者與擁有群組收到通知，並在**執行紀錄**閱讀記錄檔。',
        shot: shot('data-and-automation-job-runs', '失敗中排程作業的執行紀錄'),
      },
    ],
  },
];
