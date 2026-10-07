/**
 * Settings of a ServiceDesk Plus (on-premises) connection (`sdp.server`), shared by the connector (server) and
 * its settings form (the `integrations.connector-config.sdp.server` slot). Pure Zod and data: no server imports.
 */
import { z } from 'zod';

/** Builds the connector targets: 16000 (2026-09-23); the asset API it uses needs 15100. */
export const SDP_TARGET_BUILD = 16000;
export const SDP_MINIMUM_BUILD = 15100;

/**
 * Payload of the webhook an admin configures in ServiceDesk Plus (Admin → Developer Space → Webhooks) and runs
 * from a custom trigger, one per module (`request`, `problem` or `change`). `ID` stands for the record id
 * variable: type `$` in the payload editor and pick the ID field. The hub only learns *which* record changed and
 * re-reads it.
 */
export const WEBHOOK_TEMPLATE = '{ "module": "request", "id": ID }';

/**
 * An `http://` or `https://` server address, without credentials, query or fragment (the connector appends
 * `/api/v3/…` itself). Whether plain HTTP may be used is the connection's "Allow insecure HTTP" switch, enforced
 * by the kernel's `conn.http` (422 `INSECURE_HTTP`), not by this schema.
 */
export function isServerUrl(value: string): boolean {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return false;
  }
  if (u.username || u.password || u.search || u.hash) return false;
  return u.protocol === 'https:' || u.protocol === 'http:';
}

/** A product type's API name (Setup → Customization → Asset Management → Product Type), e.g. `asset_servers`. */
export const ASSET_API_NAME_RE = /^[a-z][a-z0-9_]{0,99}$/;

/**
 * Where new assets are created, per ServiceDesk Plus product type: since build 15100 assets are added through
 * their product type's API (`/api/v3/<API name>`); `/api/v3/asset_assets` reads, updates and deletes every type
 * but can't add. `asset_computers`, `asset_servers`, `asset_access_points` and `asset_firewalls` are documented;
 * the others follow the same naming and are unconfirmed. A connection's `assetEndpoints` overrides entries (an
 * empty value removes one); a product type without an entry can't be created from ISBP.
 */
export const DEFAULT_ASSET_ENDPOINTS: Readonly<Record<string, string>> = {
  Workstation: 'asset_computers',
  Laptop: 'asset_computers',
  Server: 'asset_servers',
  'Access Point': 'asset_access_points',
  Firewall: 'asset_firewalls',
  Switch: 'asset_switches',
  Router: 'asset_routers',
  Printer: 'asset_printers',
  'Smart Phone': 'asset_smart_phones',
  Tablet: 'asset_tablets',
};

/** Non-secret settings. */
export const sdpConfigSchema = z.object({
  /**
   * The server's address as technicians open it, e.g. `https://sdp.contoso.local:8443` (a path is kept, for
   * servers behind a reverse proxy). The REST API lives at `<baseUrl>/api/v3/`.
   */
  baseUrl: z.string().trim().max(500).refine(isServerUrl, {
    message: 'Use an http:// or https:// URL without credentials, query or fragment',
  }),
  /**
   * The service desk instance (portal) id, for installations with several instances (ESM): sent as the
   * `PORTALID` header. Leave empty for a single instance (the header is then not sent).
   */
  portalId: z
    .string()
    .trim()
    .regex(/^\d{1,20}$/, { message: 'A portal id is a number' })
    .optional(),
  /** Product type → API name used to create assets, over {@link DEFAULT_ASSET_ENDPOINTS} (`''` removes one). */
  assetEndpoints: z
    .record(
      z.string().trim().min(1).max(100),
      z.union([
        z.literal(''),
        z.string().trim().regex(ASSET_API_NAME_RE, { message: 'An API name such as asset_servers' }),
      ]),
    )
    .optional(),
});
export type SdpConfig = z.output<typeof sdpConfigSchema>;

/** Sealed at rest, never returned by the API. */
export const sdpSecretsSchema = z.object({
  /** A technician's API key (Profile → Generate API key / Authtoken), sent as the `authtoken` header. */
  apiKey: z.string().trim().min(1).max(200),
});
export type SdpSecrets = z.output<typeof sdpSecretsSchema>;

/** The server root without a trailing slash. */
export function serverRoot(config: Pick<SdpConfig, 'baseUrl'>): string {
  return config.baseUrl.trim().replace(/\/+$/, '');
}

/** The effective product type → API name map of a connection. */
export function assetEndpointsOf(config: Pick<SdpConfig, 'assetEndpoints'>): Record<string, string> {
  const merged: Record<string, string> = { ...DEFAULT_ASSET_ENDPOINTS };
  for (const [type, api] of Object.entries(config.assetEndpoints ?? {})) {
    if (api) merged[type] = api;
    else delete merged[type];
  }
  return merged;
}

/** `asset_computers` → `asset_computer`, `asset_switches` → `asset_switch`: the key of one record in bodies. */
export function singularOf(apiName: string): string {
  if (/(ch|sh|x|ss)es$/.test(apiName)) return apiName.slice(0, -2);
  if (/ies$/.test(apiName)) return `${apiName.slice(0, -3)}y`;
  return apiName.endsWith('s') ? apiName.slice(0, -1) : apiName;
}

/** Remote object types of the connector (`manifest.connectors[0].objects`). */
export const SDP_OBJECT_TYPES = ['request', 'problem', 'change', 'asset', 'solution'] as const;
export type SdpObjectType = (typeof SDP_OBJECT_TYPES)[number];
