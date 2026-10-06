import type { Kernel } from '../kernel/kernel';

/**
 * Core is the platform's own module and needs kernel internals (sessions, RBAC cache, registry) that
 * ordinary modules never see. The kernel binds itself here right after it is created.
 */
let kernel: Kernel | undefined;

export function bindKernel(k: Kernel) {
  kernel = k;
}

export function getKernel(): Kernel {
  if (!kernel) throw new Error('Kernel is not bound yet');
  return kernel;
}
