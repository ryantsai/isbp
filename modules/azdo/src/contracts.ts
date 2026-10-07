import { z } from 'zod';

/**
 * REST API versions of the on-premises Azure DevOps Server releases the connector supports: 7.2 (Azure DevOps
 * Server, 2025 and later: the default), 7.1 (2022.1 and 2022.2), 7.0 (2022), 6.0 (2020), 5.1 (2019 Update 1)
 * and 5.0 (2019, the minimum). A server refuses versions newer than its own.
 */
export const API_VERSIONS = ['7.2', '7.1', '7.0', '6.0', '5.1', '5.0'] as const;
export type ApiVersion = (typeof API_VERSIONS)[number];
export const DEFAULT_API_VERSION: ApiVersion = '7.2';

/**
 * Why a collection URL can't be used, or null: it must be an absolute `http://` or `https://` URL without
 * credentials, query or fragment. Whether plain HTTP may be used is the connection's "Allow insecure HTTP"
 * switch, enforced by the platform (422 `INSECURE_HTTP`), not this schema.
 */
export function collectionUrlIssue(value: string): 'invalid' | 'credentials' | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'invalid';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'invalid';
  if (url.username || url.password) return 'credentials';
  if (url.search || url.hash || !url.hostname) return 'invalid';
  return null;
}

/** The collection URL without a trailing slash: `https://ado.contoso.local/tfs/DefaultCollection`. */
export const normalizeCollectionUrl = (value: string) => value.trim().replace(/\/+$/, '');

/** Non-secret settings of an `azdo.server` connection. */
export const azdoConfigSchema = z.object({
  /** `https://<server>[:port]/tfs/<collection>` or `https://<server>[:port]/<collection>`. */
  collectionUrl: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .superRefine((value, ctx) => {
      const issue = collectionUrlIssue(value);
      if (issue)
        ctx.addIssue({
          code: 'custom',
          message:
            issue === 'credentials'
              ? 'Leave credentials out of the URL'
              : 'Enter the collection URL, e.g. https://ado.contoso.local/tfs/DefaultCollection',
        });
    }),
  apiVersion: z.enum(API_VERSIONS).default(DEFAULT_API_VERSION),
});
export type AzdoConfig = z.output<typeof azdoConfigSchema>;

/** Secret settings: a personal access token (Basic auth). */
export const azdoSecretsSchema = z.object({
  pat: z.string().trim().min(1).max(500),
});
export type AzdoSecrets = z.output<typeof azdoSecretsSchema>;

/** Remote object types of the connector. */
export const OBJECT_TYPES = ['project', 'work-item', 'repository'] as const;
export type ObjectType = (typeof OBJECT_TYPES)[number];
