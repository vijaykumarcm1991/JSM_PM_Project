import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve(process.cwd(), '.data');
const KEY_FILE = path.join(DATA_DIR, 'secret.key');

let cachedKey: Buffer | null = null;

export function getEncryptionKey(): Buffer {
  if (cachedKey) {
    return cachedKey;
  }

  // 1. Check environment variable APP_ENCRYPTION_KEY (must be 64 hex chars = 32 bytes)
  const envKey = process.env.APP_ENCRYPTION_KEY?.trim();
  if (envKey) {
    if (/^[0-9a-fA-F]{64}$/.test(envKey)) {
      cachedKey = Buffer.from(envKey, 'hex');
      return cachedKey;
    }
    throw new Error('APP_ENCRYPTION_KEY must be a 64-character hexadecimal string (32 bytes).');
  }

  // 2. Otherwise load or generate .data/secret.key
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (fs.existsSync(KEY_FILE)) {
    const hex = fs.readFileSync(KEY_FILE, 'utf-8').trim();
    if (/^[0-9a-fA-F]{64}$/.test(hex)) {
      cachedKey = Buffer.from(hex, 'hex');
      return cachedKey;
    }
  }

  // Generate new 32-byte key
  const newKey = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, newKey.toString('hex'), { mode: 0o600 });
  console.warn('[Crypto] Warning: No APP_ENCRYPTION_KEY found. Generated new key in .data/secret.key.');
  cachedKey = newKey;
  return cachedKey;
}

export function seal(plainText: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12); // Standard 12 bytes for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  // iv (12) || tag (16) || ciphertext
  const combined = Buffer.concat([iv, tag, encrypted]);
  return combined.toString('base64');
}

export function open(cipherTextBase64: string): string {
  const key = getEncryptionKey();
  const combined = Buffer.from(cipherTextBase64, 'base64');

  if (combined.length < 28) {
    throw new Error('Invalid ciphertext payload (too short).');
  }

  const iv = combined.subarray(0, 12);
  const tag = combined.subarray(12, 28);
  const encrypted = combined.subarray(28);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}
