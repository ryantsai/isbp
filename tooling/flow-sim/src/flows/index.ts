/**
 * Every flow the simulator knows, in `--list` order. Add yours here after writing it in `./<area>.ts`.
 */
import type { FlowDefinition } from '../flow';
import { accessRequest, configChangeRequest, ticketLifecycle } from './core';
import {
  itamContractsVendors,
  itamDeviceRequest,
  itamDiscovery,
  itamHardwareLifecycle,
  itamLicenceSeats,
} from './assets';
import { dbaccessRequest, dbaccessReview } from './dbaccess';
import { ismsAccountReview, ismsAssetRegister, ismsSharedAccount, ismsStocktake } from './isms';
import { assistantGuidedChange, ismsPack, mcpEndpoint } from './assistant';
import { etlDataApi, integrationSync, recurringChecklist, scheduledJobs } from './automation';
import { peopleLifecycle, processActions, requestForms, requestRecords } from './platform';
import { almReleaseDeploy, projectProposal } from './delivery';
import {
  announcementPublish,
  askIt,
  changeNormalCab,
  changeStandardEmergency,
  cmdbImpact,
  incidentDesk,
  knowledgeArticle,
  problemKnownError,
  serviceRequestCatalog,
} from './service-desk';

export const FLOWS: FlowDefinition[] = [
  accessRequest,
  configChangeRequest,
  ticketLifecycle,
  // Assets, information security and database access.
  itamHardwareLifecycle,
  itamDeviceRequest,
  itamLicenceSeats,
  itamContractsVendors,
  itamDiscovery,
  ismsAssetRegister,
  ismsStocktake,
  ismsSharedAccount,
  ismsAccountReview,
  dbaccessRequest,
  dbaccessReview,
  // Service desk and delivery.
  incidentDesk,
  serviceRequestCatalog,
  problemKnownError,
  changeNormalCab,
  changeStandardEmergency,
  knowledgeArticle,
  cmdbImpact,
  askIt,
  announcementPublish,
  projectProposal,
  almReleaseDeploy,
  // Platform core, automation and the assistant.
  requestForms,
  requestRecords,
  processActions,
  peopleLifecycle,
  recurringChecklist,
  scheduledJobs,
  integrationSync,
  etlDataApi,
  assistantGuidedChange,
  ismsPack,
  mcpEndpoint,
];

const names = new Set<string>();
for (const f of FLOWS) {
  if (names.has(f.name)) throw new Error(`Two flows are called ${f.name}`);
  names.add(f.name);
}
