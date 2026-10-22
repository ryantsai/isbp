/**
 * The ISMS process pack (`isms/isms-processes`): an ISO 27001-style IS security process set — access control,
 * network security, IS operations, information assets and devices, threats and incidents — as one change set. It
 * creates the groups first (empty: members are added after applying), then the service desk categories and the
 * resolution sign-off, then each request form after its approval workflow, and last the scheduled jobs that assign
 * the recurring checklists. Generic: no organisation, site, address or person is named.
 *
 * Built for the installer's language: what the kinds keep as plain text (group and job names, workflow descriptions,
 * reminder, notification and ticket texts, item labels) is written with `plain()` in three languages and resolved
 * here; text the kinds keep in every language (`t()`: form, field and step labels) stays in all three.
 */
import type { ChangeSetPackage, Locale } from '@isbp/sdk';
import { accessProcesses } from './access';
import { assetProcesses } from './assets';
import { inLocale, type ItemTemplate, t } from './build';
import { categories, groups, hardeningField, resolutionSignOff } from './foundation';
import { incidentProcesses } from './incidents';
import { jobs } from './jobs';
import { networkProcesses } from './network';
import { operationsProcesses } from './operations';

export const ISMS_PROCESSES_KEY = 'isms-processes';

/** The pack's items in order: groups, categories, the sign-off and field, the processes, then the jobs. */
const items: ItemTemplate[] = [
  ...groups,
  ...categories,
  resolutionSignOff,
  hardeningField,
  ...accessProcesses,
  ...networkProcesses,
  ...operationsProcesses,
  ...assetProcesses,
  ...incidentProcesses,
  ...jobs,
];

/** The ISMS process pack for an installer whose language is `locale`. */
export const ismsProcesses = (locale: Locale): ChangeSetPackage => ({
  format: 'isbp.change-set-package',
  version: 1,
  key: ISMS_PROCESSES_KEY,
  title: t('ISMS process pack', 'ISMS 流程範本套件', 'ISMS プロセス パック'),
  summary: t(
    'Request forms, approval workflows and recurring checklists of an ISO 27001-style IS security process set: accounts and access, firewall rules and network access, server room and backup inspections, device checkout and return, software, exceptions and incident reports. It creates five groups (add their members after applying), three service desk categories, a sign-off before equipment anomalies are resolved and the scheduled jobs that assign the checklists.',
    'ISO 27001 架構的資訊安全流程：帳號與權限、防火牆規則與網路使用、機房與備份巡檢、資訊資產領用與歸還、軟體安裝、各類例外及資安通報的申請表單、簽核流程與定期檢核表。套件會建立五個群組（套用後請加入成員）、三個服務台類別、設備異常結案前的簽核，以及指派定期檢核表的排程作業。',
    'ISO 27001 型の IS セキュリティ プロセス一式 (アカウントと権限、ファイアウォール ルールとネットワーク利用、サーバー室とバックアップの点検、デバイスの貸与と返却、ソフトウェア、例外、インシデント報告) の申請フォーム、承認ワークフロー、定期チェックリスト。5 つのグループ (適用後にメンバーを追加)、3 つのサービス デスク カテゴリ、機器異常の解決前の承認、チェックリストを割り当てるスケジュール ジョブを作成します。',
  ),
  // Besides core, ITSM and Scheduled jobs (the kinds' modules): the record types and actions the forms use.
  requires: { modules: ['isms', 'itam', 'cmdb'] },
  items: items.map((item) => inLocale(item, locale)),
});
