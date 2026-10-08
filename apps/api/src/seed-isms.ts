/**
 * Information security demo access (module `isms`, docs/architecture.md §15.8a): who maintains the asset register,
 * who signs off stocktakes and account reviews, and who reads them. Everyone already holds `isms-participant`
 * (granted by default), so asset managers, custodians and reviewers can do their part. Granted before the module
 * seeds, which act as these people.
 */
import type { Kernel } from './kernel/kernel';
import { type Grant, grantDemoRoles } from './seed-phase2';

const GRANTS: Grant[] = [
  { role: 'isms-asset-manager', groups: ['it-admins'] },
  { role: 'isms-security-officer', groups: ['security-team'] },
  { role: 'isms-viewer', groups: ['network-team', 'dba-team', 'service-desk'], users: ['auditor'] },
  { role: 'isms-admin', users: ['admin'] },
];

export async function seedIsmsAccess(kernel: Kernel): Promise<void> {
  if (!kernel.registry.get('isms')) return;
  await grantDemoRoles(kernel, GRANTS, 'Information security demo access');
}
