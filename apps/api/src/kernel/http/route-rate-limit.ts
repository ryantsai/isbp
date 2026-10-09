import type { onRouteHookHandler } from 'fastify';

/**
 * An `onRoute` hook that multiplies every route's own rate limit (`config.rateLimit`, such as 60 uploads a minute) by
 * `scale`. The rate-limit plugin reads the route's limit when the route is added, so this hook must be added before it.
 * `RATE_LIMIT_ROUTE_SCALE` is 1 in production (the hook is not installed); the flow simulator's stack raises it, as it
 * raises `RATE_LIMIT_MAX`, so a simulation measures the product rather than its limits.
 */
export function scaleRouteRateLimits(scale: number): onRouteHookHandler {
  return (route) => {
    const limit = route.config?.rateLimit;
    if (!limit || typeof limit !== 'object' || typeof limit.max !== 'number') return;
    // A new config object: route configs are often shared between routes, and must not be changed for all of them.
    route.config = {
      ...route.config,
      rateLimit: { ...limit, max: Math.max(1, Math.floor(limit.max * scale)) },
    };
  };
}
