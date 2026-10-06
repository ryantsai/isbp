import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalJson, SecretBox } from '../../src/kernel/crypto';

const key = () => randomBytes(32).toString('base64');

describe('SecretBox (AES-256-GCM envelopes)', () => {
  it('round-trips and never stores plaintext', () => {
    const box = new SecretBox(key());
    const envelope = box.encrypt('s3cret-bind-password');
    expect(envelope).not.toContain('s3cret');
    expect(envelope.startsWith('v1.')).toBe(true);
    expect(box.decrypt(envelope)).toBe('s3cret-bind-password');
  });

  it('uses a fresh IV per encryption', () => {
    const box = new SecretBox(key());
    expect(box.encrypt('x')).not.toBe(box.encrypt('x'));
  });

  it('detects tampering', () => {
    const box = new SecretBox(key());
    const parts = box.encrypt('payload').split('.');
    parts[4] = Buffer.from('tampered').toString('base64url');
    expect(() => box.decrypt(parts.join('.'))).toThrow();
  });

  it('supports key rotation through the previous key', () => {
    const oldKey = key();
    const legacy = new SecretBox(oldKey).encrypt('rotate-me');
    const rotated = new SecretBox(key(), oldKey);
    expect(rotated.decrypt(legacy)).toBe('rotate-me');
    expect(() => new SecretBox(key()).decrypt(legacy)).toThrow(/unknown key/);
  });

  it('rejects keys that are not 32 bytes', () => {
    expect(() => new SecretBox(Buffer.from('short').toString('base64'))).toThrow();
  });
});

describe('canonicalJson', () => {
  it('is stable regardless of key order and skips undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: undefined, c: [2, 1] } })).toBe(
      canonicalJson({ a: { c: [2, 1] }, b: 1 }),
    );
  });
});
