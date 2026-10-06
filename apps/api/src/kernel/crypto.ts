import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 256-bit URL-safe random token. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Deterministic JSON (sorted keys) for hashing. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

interface Key {
  id: string;
  key: Buffer;
}

function parseKey(b64: string): Key {
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) throw new Error('Master keys must be base64-encoded 32-byte values');
  return { id: sha256Hex(key).slice(0, 8), key };
}

/**
 * AES-256-GCM envelope for secrets at rest: `v1.<keyId>.<iv>.<tag>.<ciphertext>` (base64url parts).
 * The key id lets us rotate: new writes use the current key, reads accept the previous one.
 */
export class SecretBox {
  private readonly current: Key;
  private readonly keys: Map<string, Key>;

  constructor(currentKeyB64: string, previousKeyB64?: string) {
    this.current = parseKey(currentKeyB64);
    this.keys = new Map([[this.current.id, this.current]]);
    if (previousKeyB64) {
      const prev = parseKey(previousKeyB64);
      this.keys.set(prev.id, prev);
    }
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.current.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      'v1',
      this.current.id,
      iv.toString('base64url'),
      tag.toString('base64url'),
      ct.toString('base64url'),
    ].join('.');
  }

  decrypt(envelope: string): string {
    const [version, keyId, iv, tag, ct] = envelope.split('.');
    if (version !== 'v1' || !keyId || !iv || !tag || ct === undefined)
      throw new Error('Malformed secret envelope');
    const key = this.keys.get(keyId);
    if (!key) throw new Error(`Secret was encrypted with an unknown key (${keyId})`);
    const decipher = createDecipheriv('aes-256-gcm', key.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
  }

  encryptJson(value: Record<string, string>): string {
    return this.encrypt(JSON.stringify(value));
  }

  decryptJson(envelope: string | null | undefined): Record<string, string> {
    if (!envelope) return {};
    return JSON.parse(this.decrypt(envelope)) as Record<string, string>;
  }
}
