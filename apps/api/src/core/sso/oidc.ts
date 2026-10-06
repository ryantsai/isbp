import type { OidcConfig } from '@isbp/db/schema';
import * as client from 'openid-client';
import type { ExternalIdentity, IdpRow } from './provisioning';

const cache = new Map<string, { key: string; config: client.Configuration }>();

/** Discovers (and caches per IdP revision) the OpenID configuration. */
export async function oidcConfiguration(
  idp: IdpRow,
  clientSecret: string | undefined,
): Promise<client.Configuration> {
  const cfg = idp.config as OidcConfig;
  const cacheKey = `${idp.updatedAt.getTime()}`;
  const hit = cache.get(idp.id);
  if (hit && hit.key === cacheKey) return hit.config;
  const issuer = new URL(cfg.issuer);
  const config = await client.discovery(
    issuer,
    cfg.clientId,
    clientSecret ? { client_secret: clientSecret } : undefined,
    clientSecret ? client.ClientSecretPost(clientSecret) : client.None(),
    issuer.protocol === 'http:' ? { execute: [client.allowInsecureRequests], timeout: 10 } : { timeout: 10 },
  );
  cache.set(idp.id, { key: cacheKey, config });
  return config;
}

export interface OidcState {
  codeVerifier: string;
  nonce: string;
}

export async function oidcAuthorizationUrl(
  idp: IdpRow,
  clientSecret: string | undefined,
  redirectUri: string,
  state: string,
) {
  const cfg = idp.config as OidcConfig;
  const config = await oidcConfiguration(idp, clientSecret);
  const codeVerifier = client.randomPKCECodeVerifier();
  const nonce = client.randomNonce();
  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri,
    scope: cfg.scopes || 'openid profile email',
    code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
    code_challenge_method: 'S256',
    state,
    nonce,
    ...(cfg.preset === 'entra' ? { response_mode: 'query' } : {}),
  });
  return { url: url.href, checks: { codeVerifier, nonce } satisfies OidcState };
}

function claimString(claims: Record<string, unknown>, name: string | undefined): string | null {
  if (!name) return null;
  const v = claims[name];
  return typeof v === 'string' && v ? v : null;
}

export async function oidcCallback(
  idp: IdpRow,
  clientSecret: string | undefined,
  currentUrl: URL,
  expectedState: string,
  checks: OidcState,
): Promise<ExternalIdentity> {
  const cfg = idp.config as OidcConfig;
  const config = await oidcConfiguration(idp, clientSecret);
  const tokens = await client.authorizationCodeGrant(config, currentUrl, {
    pkceCodeVerifier: checks.codeVerifier,
    expectedNonce: checks.nonce,
    expectedState,
    idTokenExpected: true,
  });
  const claims = (tokens.claims() ?? {}) as Record<string, unknown>;
  const names = {
    email: cfg.claims?.email ?? 'email',
    name: cfg.claims?.name ?? 'name',
    username: cfg.claims?.username ?? 'preferred_username',
    groups: cfg.claims?.groups ?? 'groups',
  };
  // Entra ID: `oid` is stable across app registrations; `sub` is pairwise per app.
  const subject = (cfg.preset === 'entra' ? claimString(claims, 'oid') : null) ?? String(claims.sub);
  const email =
    claimString(claims, names.email) ??
    (cfg.preset === 'entra' ? claimString(claims, 'preferred_username') : null);
  if (email && cfg.allowedDomains?.length) {
    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain || !cfg.allowedDomains.map((d) => d.toLowerCase()).includes(domain)) {
      throw new Error(`Email domain "${domain}" is not allowed for this provider`);
    }
  }
  const rawGroups = claims[names.groups];
  return {
    subject,
    email,
    displayName: claimString(claims, names.name),
    username: claimString(claims, names.username),
    givenName: claimString(claims, 'given_name'),
    familyName: claimString(claims, 'family_name'),
    groups: Array.isArray(rawGroups) ? rawGroups.map(String) : [],
  };
}

export async function testOidc(idp: IdpRow, clientSecret: string | undefined) {
  cache.delete(idp.id);
  const config = await oidcConfiguration(idp, clientSecret);
  const meta = config.serverMetadata();
  return {
    issuer: meta.issuer,
    authorizationEndpoint: meta.authorization_endpoint,
    tokenEndpoint: meta.token_endpoint,
    pkce: meta.code_challenge_methods_supported?.includes('S256') ?? null,
  };
}
