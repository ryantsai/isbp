/**
 * Guards that keep the simulator away from stacks it doesn't own: the demo database and stack (`isbp`, ports
 * 3000/4000) and the integration test databases (`*_test`).
 */

/** Database names the simulator may create, drop, set up personas in or read counts from. */
export function assertSimDatabase(name: string): void {
  if (!name || name === 'isbp' || name === 'postgres' || name.endsWith('_test'))
    throw new Error(
      `Refusing to use database "${name}": the flow simulator needs its own database (default isbp_sim)`,
    );
}

/** The demo stack (web :3000, API :4000) is someone else's: the simulator never sets up personas there. */
export function assertSimApi(api: string, allowAny: boolean): void {
  if (allowAny) return;
  const url = new URL(api);
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  if (port === '3000' || port === '4000')
    throw new Error(
      `Refusing to run against ${url.origin}: that is the demo stack. Start the simulator's own stack ` +
        '(pnpm sim:stack) or pass --allow-any-stack if you really mean it.',
    );
}
