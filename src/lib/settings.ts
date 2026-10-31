import { getDb, DbSettings } from './db';
import { seal, open } from './crypto';

export interface PublicSettings {
  baseUrl: string;
  email: string;
  hasToken: boolean;
  tokenHint: string;
  updatedAt: string | null;
}

export interface InternalSettings extends PublicSettings {
  apiToken: string | null;
}

export function validateBaseUrl(rawUrl: string): string {
  let urlStr = rawUrl.trim();
  if (!urlStr.startsWith('http://') && !urlStr.startsWith('https://')) {
    urlStr = 'https://' + urlStr;
  }

  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error('Invalid Jira URL format.');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Jira URL must use HTTPS.');
  }

  const allowCustom = process.env.ALLOW_CUSTOM_JIRA_HOST === '1';
  if (!allowCustom) {
    if (!parsed.hostname.endsWith('.atlassian.net')) {
      throw new Error('Jira Cloud host must end with .atlassian.net (or set ALLOW_CUSTOM_JIRA_HOST=1 in environment).');
    }
  }

  // Normalize origin without trailing slash
  return `${parsed.protocol}//${parsed.host}`;
}

export function getPublicSettings(): PublicSettings {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM settings WHERE id = 1');
  const row = stmt.get() as unknown as DbSettings | undefined;

  if (!row) {
    return {
      baseUrl: '',
      email: '',
      hasToken: false,
      tokenHint: '',
      updatedAt: null,
    };
  }

  return {
    baseUrl: row.base_url,
    email: row.email,
    hasToken: Boolean(row.token_enc),
    tokenHint: row.token_hint,
    updatedAt: row.updated_at,
  };
}

export function getInternalSettings(): InternalSettings {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM settings WHERE id = 1');
  const row = stmt.get() as unknown as DbSettings | undefined;

  if (!row) {
    return {
      baseUrl: '',
      email: '',
      hasToken: false,
      tokenHint: '',
      updatedAt: null,
      apiToken: null,
    };
  }

  let apiToken: string | null = null;
  if (row.token_enc) {
    try {
      apiToken = open(row.token_enc);
    } catch (err) {
      console.error('[Settings] Failed to decrypt Jira API token:', err);
    }
  }

  return {
    baseUrl: row.base_url,
    email: row.email,
    hasToken: Boolean(apiToken),
    tokenHint: row.token_hint,
    updatedAt: row.updated_at,
    apiToken,
  };
}

export function saveSettings(input: {
  baseUrl: string;
  email: string;
  apiToken?: string;
}): PublicSettings {
  const normalizedUrl = validateBaseUrl(input.baseUrl);
  const email = input.email.trim();
  if (!email || !email.includes('@')) {
    throw new Error('A valid email address is required.');
  }

  const db = getDb();
  const existing = db.prepare('SELECT * FROM settings WHERE id = 1').get() as unknown as DbSettings | undefined;
  const now = new Date().toISOString();

  let tokenEnc = existing?.token_enc || '';
  let tokenHint = existing?.token_hint || '';

  if (input.apiToken && input.apiToken.trim().length > 0) {
    const rawToken = input.apiToken.trim();
    tokenEnc = seal(rawToken);
    tokenHint = rawToken.length >= 4 ? rawToken.slice(-4) : rawToken;
  } else if (!existing) {
    throw new Error('API token is required when configuring Jira credentials.');
  }

  if (existing) {
    const updateStmt = db.prepare(`
      UPDATE settings
      SET base_url = ?, email = ?, token_enc = ?, token_hint = ?, updated_at = ?
      WHERE id = 1
    `);
    updateStmt.run(normalizedUrl, email, tokenEnc, tokenHint, now);
  } else {
    const insertStmt = db.prepare(`
      INSERT INTO settings (id, base_url, email, token_enc, token_hint, updated_at)
      VALUES (1, ?, ?, ?, ?, ?)
    `);
    insertStmt.run(normalizedUrl, email, tokenEnc, tokenHint, now);
  }

  return {
    baseUrl: normalizedUrl,
    email,
    hasToken: Boolean(tokenEnc),
    tokenHint,
    updatedAt: now,
  };
}
