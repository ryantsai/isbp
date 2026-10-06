import { X509Certificate } from 'node:crypto';
import type { SamlConfig } from '@isbp/db/schema';
import { type Profile, SAML } from '@node-saml/node-saml';
import type { ExternalIdentity, IdpRow } from './provisioning';

const CLAIM = {
  email: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
  name: 'http://schemas.microsoft.com/identity/claims/displayname',
  upn: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name',
  givenName: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname',
  surname: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname',
  groups: 'http://schemas.microsoft.com/ws/2008/06/identity/claims/groups',
};

export function samlEndpoints(publicUrl: string, key: string) {
  const base = `${publicUrl}/api/v1/auth/sso/${key}`;
  return { acsUrl: `${base}/acs`, metadataUrl: `${base}/metadata`, entityId: `${base}/metadata` };
}

function normalizeCert(cert: string): string {
  return cert.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '');
}

export function samlClient(idp: IdpRow, publicUrl: string): SAML {
  const cfg = idp.config as SamlConfig;
  return new SAML({
    entryPoint: cfg.entryPoint,
    issuer: cfg.issuer,
    callbackUrl: samlEndpoints(publicUrl, idp.key).acsUrl,
    idpCert: normalizeCert(cfg.idpCertificate),
    audience: cfg.issuer,
    wantAssertionsSigned: cfg.wantAssertionsSigned ?? true,
    wantAuthnResponseSigned: false,
    signatureAlgorithm: 'sha256',
    disableRequestedAuthnContext: true,
    acceptedClockSkewMs: 60_000,
  });
}

function attr(profile: Profile, name: string | undefined): string | null {
  if (!name) return null;
  const v = profile[name];
  if (Array.isArray(v)) return v.length ? String(v[0]) : null;
  return typeof v === 'string' && v ? v : null;
}

export function samlProfileToIdentity(idp: IdpRow, profile: Profile): ExternalIdentity {
  const cfg = idp.config as SamlConfig;
  const a = cfg.attributes ?? {};
  const groupsRaw = profile[a.groups ?? CLAIM.groups];
  const email = attr(profile, a.email) ?? attr(profile, CLAIM.email) ?? profile.email ?? profile.mail ?? null;
  return {
    subject: profile.nameID,
    email: typeof email === 'string' ? email : null,
    displayName: attr(profile, a.name) ?? attr(profile, CLAIM.name),
    username: attr(profile, a.username) ?? attr(profile, CLAIM.upn),
    givenName: attr(profile, CLAIM.givenName),
    familyName: attr(profile, CLAIM.surname),
    groups: Array.isArray(groupsRaw)
      ? groupsRaw.map(String)
      : typeof groupsRaw === 'string'
        ? [groupsRaw]
        : [],
  };
}

export function testSaml(idp: IdpRow) {
  const cfg = idp.config as SamlConfig;
  const pem = `-----BEGIN CERTIFICATE-----\n${normalizeCert(cfg.idpCertificate)
    .match(/.{1,64}/g)
    ?.join('\n')}\n-----END CERTIFICATE-----`;
  const cert = new X509Certificate(pem);
  const validTo = new Date(cert.validTo);
  return {
    subject: cert.subject,
    issuer: cert.issuer,
    validTo: validTo.toISOString(),
    expired: validTo.getTime() < Date.now(),
  };
}
