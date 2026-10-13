/**
 * Phase 11 demo data that spans modules: meeting minutes (`seedMeetings` in the meetings module). It runs after every
 * module's own seed, so the network project's weekly sync links to NET and its action items become NET tasks; without
 * Projects the meetings are created unlinked. Idempotent: does nothing once a meeting exists.
 */
import type { Kernel } from './kernel/kernel';

export async function seedPhase11Links(kernel: Kernel): Promise<void> {
  if (!kernel.registry.get('meetings')) return;
  const { seedMeetings } = await import('@isbp/module-meetings/server');
  await seedMeetings(kernel.registry.context('meetings'));
}
