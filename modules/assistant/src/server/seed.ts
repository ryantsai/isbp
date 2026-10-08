import type { ModuleContext } from '@isbp/sdk/server';

/** Demo change sets are created after every module's seed (`seedPhase6` in apps/api), when the kinds exist. */
export async function seed(_ctx: ModuleContext): Promise<void> {}
