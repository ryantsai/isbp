import { readFile } from 'node:fs/promises';
import type { SandboxRequest } from '@isbp/sdk/server';
import { Agent, request } from 'undici';
import { bootstrapCommand, LineSplitter, type Runner, SCRIPT_ENV, sleep } from './common';

export interface KubernetesOptions {
  api: string;
  namespace: string;
  tokenFile: string;
  caFile: string;
}

const label = (v: string) =>
  v
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .slice(0, 63)
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');

/**
 * A Job in the sandbox namespace: non-root, read-only root filesystem, no capabilities, seccomp
 * RuntimeDefault, no service-account token, a deadline and TTL. Egress is denied by the namespace's
 * NetworkPolicy unless the pod is labelled `isbp.io/egress: allowed` (Helm chart).
 */
export function kubernetesJobSpec(req: SandboxRequest, name: string, secretName: string) {
  const labels = {
    'app.kubernetes.io/managed-by': 'isbp',
    'isbp.io/sandbox': 'true',
    'isbp.io/egress': (req.network ?? 'none') === 'egress' ? 'allowed' : 'none',
    ...Object.fromEntries(
      Object.entries(req.labels ?? {}).map(([k, v]) => [`isbp.io/${label(k)}`, label(v)]),
    ),
  };
  const cpu = `${Math.round((req.cpu ?? 0.5) * 1000)}m`;
  const memory = `${req.memoryMb ?? 256}Mi`;
  const env = [
    { name: SCRIPT_ENV, valueFrom: { secretKeyRef: { name: secretName, key: 'script' } } },
    ...Object.keys(req.env ?? {}).map((k, i) => ({
      name: k,
      valueFrom: { secretKeyRef: { name: secretName, key: `env${i}` } },
    })),
  ];
  return {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: { name, labels },
    spec: {
      backoffLimit: 0,
      activeDeadlineSeconds: Math.max(1, Math.ceil(req.timeoutMs / 1000)),
      ttlSecondsAfterFinished: 600,
      template: {
        metadata: { labels },
        spec: {
          restartPolicy: 'Never',
          automountServiceAccountToken: false,
          enableServiceLinks: false,
          securityContext: {
            runAsNonRoot: true,
            runAsUser: 65534,
            runAsGroup: 65534,
            fsGroup: 65534,
            seccompProfile: { type: 'RuntimeDefault' },
          },
          containers: [
            {
              name: 'script',
              image: req.image,
              command: bootstrapCommand(req.language),
              env,
              workingDir: '/tmp',
              resources: { limits: { cpu, memory }, requests: { cpu, memory } },
              securityContext: {
                allowPrivilegeEscalation: false,
                readOnlyRootFilesystem: true,
                capabilities: { drop: ['ALL'] },
              },
              volumeMounts: [{ name: 'tmp', mountPath: '/tmp' }],
            },
          ],
          volumes: [{ name: 'tmp', emptyDir: { sizeLimit: '64Mi' } }],
        },
      },
    },
  };
}

export function kubernetesSecretSpec(req: SandboxRequest, name: string) {
  const data: Record<string, string> = {
    script: Buffer.from(Buffer.from(req.script, 'utf8').toString('base64')).toString('base64'),
  };
  Object.values(req.env ?? {}).forEach(
    (v, i) => (data[`env${i}`] = Buffer.from(v, 'utf8').toString('base64')),
  );
  return {
    apiVersion: 'v1',
    kind: 'Secret',
    metadata: { name, labels: { 'app.kubernetes.io/managed-by': 'isbp', 'isbp.io/sandbox': 'true' } },
    type: 'Opaque',
    data,
  };
}

/** Kubernetes API with the worker's service account (a Role limited to the sandbox namespace). */
export class KubernetesRunner implements Runner {
  readonly isolated = true;
  private agent: Agent | null = null;

  constructor(private readonly opts: KubernetesOptions) {}

  private async dispatcher() {
    if (!this.agent) {
      const ca = await readFile(this.opts.caFile, 'utf8').catch(() => undefined);
      this.agent = new Agent({ connect: ca ? { ca } : {} });
    }
    return this.agent;
  }

  private async call(method: string, path: string, body?: unknown, ok: number[] = [200, 201, 202]) {
    const token = (await readFile(this.opts.tokenFile, 'utf8')).trim();
    const res = await request(`${this.opts.api}${path}`, {
      method: method as never,
      dispatcher: await this.dispatcher(),
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.body.text();
    if (!ok.includes(res.statusCode))
      throw new Error(`Kubernetes ${method} ${path}: ${res.statusCode} ${text.slice(0, 300)}`);
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  }

  async run(req: SandboxRequest, id: string) {
    const ns = encodeURIComponent(this.opts.namespace);
    const name = `isbp-${label(id).toLowerCase()}`.slice(0, 52);
    const secret = `${name}-env`;
    let timedOut = false;
    let cancelled = false;
    const deadline = Date.now() + req.timeoutMs + 60_000; // scheduling and image pull on top of the run
    const remove = async () => {
      await this.call(
        'DELETE',
        `/apis/batch/v1/namespaces/${ns}/jobs/${name}?propagationPolicy=Background`,
        undefined,
        [200, 202, 404],
      ).catch(() => undefined);
    };
    const onAbort = () => {
      cancelled = true;
      void remove();
    };
    req.signal?.addEventListener('abort', onAbort, { once: true });
    await this.call('POST', `/api/v1/namespaces/${ns}/secrets`, kubernetesSecretSpec(req, secret));
    try {
      await this.call('POST', `/apis/batch/v1/namespaces/${ns}/jobs`, kubernetesJobSpec(req, name, secret));
      // Wait for the pod to start (or finish), then follow its log.
      let pod: string | null = null;
      while (!pod && Date.now() < deadline && !cancelled) {
        const list = await this.call(
          'GET',
          `/api/v1/namespaces/${ns}/pods?labelSelector=${encodeURIComponent(`job-name=${name}`)}`,
        );
        const item = (
          list.items as { metadata: { name: string }; status?: { phase?: string } }[] | undefined
        )?.[0];
        if (item && ['Running', 'Succeeded', 'Failed'].includes(item.status?.phase ?? ''))
          pod = item.metadata.name;
        else await sleep(1_000);
      }
      if (pod) {
        const token = (await readFile(this.opts.tokenFile, 'utf8')).trim();
        const out = new LineSplitter((l) => req.onLog?.(l, 'stdout'));
        const logs = await request(
          `${this.opts.api}/api/v1/namespaces/${ns}/pods/${encodeURIComponent(pod)}/log?follow=true&container=script`,
          { dispatcher: await this.dispatcher(), headers: { authorization: `Bearer ${token}` } },
        );
        for await (const chunk of logs.body) out.push(Buffer.from(chunk as Uint8Array).toString('utf8'));
        out.flush();
      }
      // The job's final state and the container's exit code.
      for (;;) {
        const job = await this.call(
          'GET',
          `/apis/batch/v1/namespaces/${ns}/jobs/${name}`,
          undefined,
          [200, 404],
        );
        const status = (job.status ?? {}) as {
          succeeded?: number;
          failed?: number;
          conditions?: { type: string; reason?: string }[];
        };
        if (status.conditions?.some((c) => c.reason === 'DeadlineExceeded')) timedOut = true;
        if (status.succeeded || status.failed || cancelled || !job.metadata || Date.now() > deadline) {
          if (Date.now() > deadline) timedOut = true;
          let exitCode: number | null = status.succeeded ? 0 : null;
          if (pod) {
            const p = await this.call(
              'GET',
              `/api/v1/namespaces/${ns}/pods/${encodeURIComponent(pod)}`,
              undefined,
              [200, 404],
            );
            const term = (
              p.status as
                { containerStatuses?: { state?: { terminated?: { exitCode?: number } } }[] } | undefined
            )?.containerStatuses?.[0]?.state?.terminated;
            if (term?.exitCode !== undefined) exitCode = term.exitCode;
          }
          return { exitCode, timedOut, cancelled };
        }
        await sleep(1_000);
      }
    } finally {
      req.signal?.removeEventListener('abort', onAbort);
      if (timedOut || cancelled) await remove();
      await this.call(
        'DELETE',
        `/api/v1/namespaces/${ns}/secrets/${secret}`,
        undefined,
        [200, 202, 404],
      ).catch(() => undefined);
    }
  }
}
