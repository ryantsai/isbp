import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { scaleRouteRateLimits } from '../../src/kernel/http/route-rate-limit';

/** An app with a global limit and one route allowing two requests a minute, with its limits multiplied by `scale`. */
async function appWithScale(scale: number) {
  const app = Fastify();
  if (scale !== 1) app.addHook('onRoute', scaleRouteRateLimits(scale));
  await app.register(rateLimit, { global: true, max: 1000, timeWindow: '1 minute' });
  app.post('/limited', { config: { rateLimit: { max: 2, timeWindow: '1 minute' } } }, async () => ({
    ok: true,
  }));
  return app;
}

async function statusesOf(app: Awaited<ReturnType<typeof appWithScale>>, url: string, count: number) {
  const statuses: number[] = [];
  for (let i = 0; i < count; i++) statuses.push((await app.inject({ method: 'POST', url })).statusCode);
  return statuses;
}

describe('per-route rate limits', () => {
  it('stay as the route declares them without a scale', async () => {
    const app = await appWithScale(1);
    expect(await statusesOf(app, '/limited', 3)).toEqual([200, 200, 429]);
    await app.close();
  });

  it('are multiplied by RATE_LIMIT_ROUTE_SCALE', async () => {
    const app = await appWithScale(2);
    expect(await statusesOf(app, '/limited', 5)).toEqual([200, 200, 200, 200, 429]);
    await app.close();
  });

  it('scale each route once even when routes share one config object', async () => {
    const app = Fastify();
    app.addHook('onRoute', scaleRouteRateLimits(2));
    await app.register(rateLimit, { global: true, max: 1000, timeWindow: '1 minute' });
    const config = { rateLimit: { max: 2, timeWindow: '1 minute' } };
    app.post('/first', { config }, async () => ({ ok: true }));
    app.post('/second', { config }, async () => ({ ok: true }));
    expect(await statusesOf(app, '/first', 5)).toEqual([200, 200, 200, 200, 429]);
    expect(await statusesOf(app, '/second', 5)).toEqual([200, 200, 200, 200, 429]);
    expect(config.rateLimit.max).toBe(2);
    await app.close();
  });
});
