import { describe, it, expect } from 'vitest';
import { seal, open } from '../src/lib/crypto';

describe('Crypto module (AES-256-GCM)', () => {
  it('seals and opens plaintext correctly', () => {
    const secret = 'my-super-secret-jira-api-token-12345';
    const encrypted = seal(secret);
    expect(encrypted).not.toBe(secret);
    
    const decrypted = open(encrypted);
    expect(decrypted).toBe(secret);
  });

  it('rejects tampered ciphertext', () => {
    const encrypted = seal('test-token');
    const buf = Buffer.from(encrypted, 'base64');
    // Tamper with one byte in the ciphertext portion
    buf[buf.length - 1] ^= 0xff;
    const tampered = buf.toString('base64');

    expect(() => open(tampered)).toThrow();
  });

  it('rejects truncated ciphertext', () => {
    expect(() => open(Buffer.from('short').toString('base64'))).toThrow('too short');
  });
});
