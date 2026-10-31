import { getInternalSettings } from '../settings';

export interface JiraRequestOptions {
  method?: string;
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  isMultipart?: boolean;
}

export class JiraFatalError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'JiraFatalError';
    this.status = status;
  }
}

export class JiraClientError extends Error {
  status: number;
  data: unknown;
  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.name = 'JiraClientError';
    this.status = status;
    this.data = data;
  }
}

// Global pacing mutex to ensure minimum interval between requests
let lastRequestTime = 0;
const requestLock = {
  queue: Promise.resolve(),
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function paceRequest(minIntervalMs: number): Promise<void> {
  const currentLock = requestLock.queue;
  let release: () => void;
  requestLock.queue = new Promise<void>((resolve) => {
    release = resolve;
  });

  await currentLock;
  try {
    const now = Date.now();
    const elapsed = now - lastRequestTime;
    if (elapsed < minIntervalMs) {
      await sleep(minIntervalMs - elapsed);
    }
    lastRequestTime = Date.now();
  } finally {
    release!();
  }
}

export function getPacingInterval(): number {
  const val = process.env.JIRA_MIN_INTERVAL_MS;
  if (val) {
    const num = parseInt(val, 10);
    if (!isNaN(num) && num >= 0) return num;
  }
  return 300;
}

export function getJiraConcurrency(): number {
  const val = process.env.JIRA_CONCURRENCY;
  if (val) {
    const num = parseInt(val, 10);
    if (!isNaN(num) && num > 0) return num;
  }
  return 2;
}

export function normalizeJiraError(status: number, data: any): string {
  if (status === 401) {
    return 'Authentication failed — check the API token in Settings.';
  }
  if (status === 403) {
    return 'The account lacks permission to create issues or perform this action in this project.';
  }
  if (status === 404) {
    return 'Project or issue type no longer exists in Jira.';
  }
  if (status === 413) {
    return 'Attachment too large for this Jira instance.';
  }

  if (data && typeof data === 'object') {
    const parts: string[] = [];
    if (Array.isArray(data.errorMessages) && data.errorMessages.length > 0) {
      parts.push(...data.errorMessages);
    }
    if (data.errors && typeof data.errors === 'object') {
      for (const [field, msg] of Object.entries(data.errors)) {
        parts.push(`${field}: ${msg}`);
      }
    }
    if (parts.length > 0) {
      return parts.join('; ');
    }
    if (data.message) {
      return String(data.message);
    }
  }

  return `Jira request failed with HTTP ${status}`;
}

export async function jiraFetch<T = any>(options: JiraRequestOptions): Promise<T> {
  const settings = getInternalSettings();
  if (!settings.baseUrl || !settings.email || !settings.apiToken) {
    throw new JiraFatalError('Jira credentials are not configured. Please visit Settings.', 401);
  }

  const minInterval = getPacingInterval();
  const maxAttempts = 3;
  const authHeader = 'Basic ' + Buffer.from(`${settings.email}:${settings.apiToken}`).toString('base64');

  const url = `${settings.baseUrl}${options.path.startsWith('/') ? '' : '/'}${options.path}`;
  const method = options.method || 'GET';

  let attempt = 0;
  let delay = 1000;

  while (attempt < maxAttempts) {
    attempt++;
    await paceRequest(minInterval);

    const headers: Record<string, string> = {
      Authorization: authHeader,
      Accept: 'application/json',
      ...options.headers,
    };

    let body: any = options.body;
    if (body && !options.isMultipart && typeof body === 'object') {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, {
        method,
        headers,
        body,
      });

      if (response.ok) {
        if (response.status === 204) {
          return null as T;
        }
        const text = await response.text();
        return text ? (JSON.parse(text) as T) : (null as T);
      }

      // Check for rate limit (429)
      if (response.status === 429) {
        const retryAfterHeader = response.headers.get('Retry-After');
        let waitMs = delay;
        if (retryAfterHeader) {
          const parsedSeconds = parseInt(retryAfterHeader, 10);
          if (!isNaN(parsedSeconds)) {
            waitMs = parsedSeconds * 1000;
          }
        }
        if (attempt < maxAttempts) {
          console.warn(`[JiraClient] 429 Rate limited. Waiting ${waitMs}ms before attempt ${attempt + 1}...`);
          await sleep(waitMs);
          delay *= 2;
          continue;
        }
      }

      // Check for server errors (5xx)
      if (response.status >= 500 && attempt < maxAttempts) {
        console.warn(`[JiraClient] HTTP ${response.status} Server error. Waiting ${delay}ms before attempt ${attempt + 1}...`);
        await sleep(delay);
        delay *= 2;
        continue;
      }

      // Parse error response
      let errorData: any = null;
      try {
        errorData = await response.json();
      } catch {
        errorData = await response.text();
      }

      const errorMessage = normalizeJiraError(response.status, errorData);

      if (response.status === 401 || response.status === 403 || response.status === 404) {
        throw new JiraFatalError(errorMessage, response.status);
      }

      throw new JiraClientError(errorMessage, response.status, errorData);
    } catch (err: any) {
      if (err instanceof JiraFatalError || err instanceof JiraClientError) {
        throw err;
      }

      // Network error retry
      if (attempt < maxAttempts) {
        console.warn(`[JiraClient] Network error on attempt ${attempt}: ${err.message}. Retrying in ${delay}ms...`);
        await sleep(delay);
        delay *= 2;
        continue;
      }
      throw new JiraClientError(`Network connection to Jira failed: ${err.message}`, 0);
    }
  }

  throw new JiraClientError('Exhausted retry attempts to Jira.', 0);
}
