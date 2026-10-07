import { randomUUID } from 'node:crypto';
import {
  ErrorCodes,
  HttpError,
  type SandboxRequest,
  type SandboxResult,
  type SandboxRunner,
  type SandboxService,
} from '@isbp/sdk/server';
import type { Config } from '../../config';
import type { Runner } from './common';
import { DockerRunner } from './docker';
import { KubernetesRunner } from './kubernetes';
import { LocalRunner } from './local';

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
export const SANDBOX_LIMITS = {
  scriptBytes: 64 * 1024,
  envVars: 50,
  timeoutMs: 60 * 60_000,
  cpu: 2,
  memoryMb: 2048,
};

/** `ctx.sandbox`: the configured script runner, with the image allow-list and resource limits enforced. */
export class Sandbox {
  private readonly runner: Runner | null;

  constructor(
    private readonly kind: SandboxRunner,
    private readonly images: readonly string[],
    runner?: Runner | null,
  ) {
    this.runner = runner === undefined ? null : runner;
  }

  static fromConfig(config: Config): Sandbox {
    const kind = config.sandboxRunner;
    const runner =
      kind === 'local'
        ? new LocalRunner()
        : kind === 'docker'
          ? new DockerRunner(config.SANDBOX_DOCKER_HOST)
          : kind === 'kubernetes'
            ? new KubernetesRunner({
                api: config.SANDBOX_K8S_API,
                namespace: config.SANDBOX_K8S_NAMESPACE,
                tokenFile: config.SANDBOX_K8S_TOKEN_FILE,
                caFile: config.SANDBOX_K8S_CA_FILE,
              })
            : null;
    return new Sandbox(kind, config.sandboxImages, runner);
  }

  validate(req: Pick<SandboxRequest, 'image' | 'script' | 'env' | 'timeoutMs' | 'cpu' | 'memoryMb'>) {
    const refuse = (reason: string, message: string) => {
      throw new HttpError(422, ErrorCodes.SANDBOX_UNAVAILABLE, message, { reason });
    };
    if (!this.images.includes(req.image)) refuse('image', `Image ${req.image} is not on the allow-list`);
    if (Buffer.byteLength(req.script, 'utf8') > SANDBOX_LIMITS.scriptBytes)
      refuse('script', 'Script is larger than 64 KB');
    const env = Object.keys(req.env ?? {});
    if (env.length > SANDBOX_LIMITS.envVars) refuse('env', 'Too many environment variables');
    for (const k of env)
      if (!ENV_NAME.test(k) || k.toUpperCase().startsWith('ISBP_'))
        refuse('env', `Invalid environment variable ${k}`);
    if (req.timeoutMs < 1_000 || req.timeoutMs > SANDBOX_LIMITS.timeoutMs)
      refuse('timeout', 'Timeout out of range');
    if ((req.cpu ?? 0.5) <= 0 || (req.cpu ?? 0.5) > SANDBOX_LIMITS.cpu)
      refuse('cpu', 'CPU limit out of range');
    if ((req.memoryMb ?? 256) < 32 || (req.memoryMb ?? 256) > SANDBOX_LIMITS.memoryMb)
      refuse('memory', 'Memory limit out of range');
  }

  service(): SandboxService {
    return {
      status: () => ({
        runner: this.kind,
        isolated: this.runner?.isolated ?? false,
        images: [...this.images],
      }),
      run: async (req): Promise<SandboxResult> => {
        if (!this.runner)
          throw new HttpError(422, ErrorCodes.SANDBOX_UNAVAILABLE, 'No script runner is configured', {
            reason: 'runner',
          });
        this.validate(req);
        const started = performance.now();
        const result = await this.runner.run(req, randomUUID().slice(0, 13));
        return { ...result, durationMs: Math.round(performance.now() - started) };
      },
    };
  }
}
