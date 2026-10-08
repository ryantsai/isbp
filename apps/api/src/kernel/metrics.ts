import { createServer, type Server } from 'node:http';
import { Counter, collectDefaultMetrics, Histogram, Registry } from '@prometheus-io/client';

export const registry = new Registry();
collectDefaultMetrics({ register: registry, prefix: 'isbp_' });

export const httpDuration = new Histogram({
  name: 'isbp_http_request_duration_seconds',
  help: 'HTTP request latency by route',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

export const loginCounter = new Counter({
  name: 'isbp_auth_logins_total',
  help: 'Login attempts by provider type and result',
  labelNames: ['provider', 'result'] as const,
  registers: [registry],
});

export const eventsCounter = new Counter({
  name: 'isbp_events_total',
  help: 'Domain events relayed / handled',
  labelNames: ['stage', 'name', 'status'] as const,
  registers: [registry],
});

export const jobsCounter = new Counter({
  name: 'isbp_jobs_total',
  help: 'Background jobs by queue and outcome',
  labelNames: ['queue', 'name', 'status'] as const,
  registers: [registry],
});

/**
 * Internal-only server (never exposed by the ingress) for Prometheus scraping and probes of
 * processes without a public HTTP port (the worker).
 */
export function startMetricsServer(port: number, ready: () => Promise<boolean>): Server {
  const server = createServer(async (req, res) => {
    if (req.url === '/metrics') {
      res.setHeader('content-type', registry.contentType);
      res.end(await registry.metrics());
    } else if (req.url === '/healthz') {
      res.end('ok');
    } else if (req.url === '/readyz') {
      const ok = await ready().catch(() => false);
      res.statusCode = ok ? 200 : 503;
      res.end(ok ? 'ready' : 'not ready');
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  server.listen(port, '0.0.0.0');
  return server;
}
