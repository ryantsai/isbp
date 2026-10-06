import pino, { type LoggerOptions } from 'pino';
import type { Config } from './config';

/** Structured JSON logs; secrets and credentials are redacted at the source. */
export function loggerOptions(config: Config, name = 'isbp-api'): LoggerOptions {
  return {
    name,
    level: config.LOG_LEVEL,
    base: { service: name },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    redact: {
      paths: [
        'req.headers.cookie',
        'req.headers.authorization',
        'req.headers["x-csrf-token"]',
        '*.password',
        '*.newPassword',
        '*.currentPassword',
        '*.clientSecret',
        '*.bindPassword',
        '*.secrets',
      ],
      censor: '[redacted]',
    },
    ...(config.logPretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service' },
          },
        }
      : {}),
  };
}

export function createLogger(config: Config, name?: string) {
  return pino(loggerOptions(config, name));
}
