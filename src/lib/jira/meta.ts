import { jiraFetch } from './client';

export interface JiraProject {
  id: string;
  key: string;
  name: string;
  avatarUrls?: Record<string, string>;
}

export interface JiraIssueType {
  id: string;
  name: string;
  description?: string;
  iconUrl?: string;
  subtask: boolean;
}

export interface JiraFieldMeta {
  id: string;
  name: string;
  required: boolean;
  hasDefaultValue: boolean;
  schema?: {
    type: string;
    custom?: string;
    items?: string;
  };
  allowedValues?: Array<{
    id?: string;
    value?: string;
    name?: string;
    [key: string]: any;
  }>;
}

export interface JiraUser {
  accountId: string;
  displayName: string;
  emailAddress?: string;
  avatarUrl?: string;
}

// In-memory TTL cache
interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}
const cache = new Map<string, CacheEntry<any>>();
const TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (entry && entry.expiresAt > Date.now()) {
    return entry.data as T;
  }
  return null;
}

function setCached<T>(key: string, data: T): void {
  cache.set(key, {
    data,
    expiresAt: Date.now() + TTL_MS,
  });
}

export async function testConnection(): Promise<{
  displayName: string;
  accountId: string;
  emailAddress?: string;
  latencyMs: number;
}> {
  const start = Date.now();
  const myself = await jiraFetch<{
    displayName: string;
    accountId: string;
    emailAddress?: string;
  }>({
    path: '/rest/api/3/myself',
  });
  const latencyMs = Date.now() - start;

  return {
    displayName: myself.displayName,
    accountId: myself.accountId,
    emailAddress: myself.emailAddress,
    latencyMs,
  };
}

export async function getProjects(): Promise<JiraProject[]> {
  const cacheKey = 'projects';
  const cached = getCached<JiraProject[]>(cacheKey);
  if (cached) return cached;

  const projects: JiraProject[] = [];
  let startAt = 0;
  let isLast = false;

  while (!isLast) {
    const res = await jiraFetch<{
      values: JiraProject[];
      isLast: boolean;
      total: number;
    }>({
      path: `/rest/api/3/project/search?maxResults=100&startAt=${startAt}`,
    });

    if (res.values) {
      projects.push(...res.values);
    }
    isLast = res.isLast ?? (projects.length >= (res.total || 0));
    startAt += (res.values?.length || 100);
    if (!res.values || res.values.length === 0) break;
  }

  setCached(cacheKey, projects);
  return projects;
}

export async function getIssueTypes(projectKey: string): Promise<JiraIssueType[]> {
  const cacheKey = `issuetypes:${projectKey}`;
  const cached = getCached<JiraIssueType[]>(cacheKey);
  if (cached) return cached;

  const res = await jiraFetch<{
    values: JiraIssueType[];
  }>({
    path: `/rest/api/3/issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes`,
  });

  const issueTypes = (res.values || []).filter((it) => !it.subtask);
  setCached(cacheKey, issueTypes);
  return issueTypes;
}

export async function getCreatemetaFields(
  projectKey: string,
  issueTypeId: string
): Promise<JiraFieldMeta[]> {
  const cacheKey = `createmeta:${projectKey}:${issueTypeId}`;
  const cached = getCached<JiraFieldMeta[]>(cacheKey);
  if (cached) return cached;

  const fields: JiraFieldMeta[] = [];
  let startAt = 0;
  let isLast = false;

  while (!isLast) {
    const res = await jiraFetch<{
      values: Array<{
        fieldId: string;
        name: string;
        required: boolean;
        hasDefaultValue?: boolean;
        schema?: {
          type: string;
          custom?: string;
          items?: string;
        };
        allowedValues?: any[];
      }>;
      isLast?: boolean;
      total?: number;
    }>({
      path: `/rest/api/3/issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes/${encodeURIComponent(issueTypeId)}?startAt=${startAt}&maxResults=50`,
    });

    const values = res.values || [];
    for (const f of values) {
      // Exclude project and issuetype from mapping since they are fixed by the run config
      if (f.fieldId === 'project' || f.fieldId === 'issuetype') {
        continue;
      }
      fields.push({
        id: f.fieldId,
        name: f.name,
        required: f.required ?? false,
        hasDefaultValue: f.hasDefaultValue ?? false,
        schema: f.schema,
        allowedValues: f.allowedValues,
      });
    }

    if (res.isLast !== undefined) {
      isLast = res.isLast;
    } else {
      isLast = values.length < 50;
    }
    startAt += values.length;
    if (values.length === 0) break;
  }

  // Sort fields: required first, then standard, then custom
  fields.sort((a, b) => {
    if (a.required !== b.required) {
      return a.required ? -1 : 1;
    }
    const aIsCustom = a.id.startsWith('customfield_');
    const bIsCustom = b.id.startsWith('customfield_');
    if (aIsCustom !== bIsCustom) {
      return aIsCustom ? 1 : -1;
    }
    return a.name.localeCompare(b.name);
  });

  setCached(cacheKey, fields);
  return fields;
}

export async function searchUsers(query: string): Promise<JiraUser[]> {
  const cacheKey = `users:${query.trim().toLowerCase()}`;
  const cached = getCached<JiraUser[]>(cacheKey);
  if (cached) return cached;

  const res = await jiraFetch<{
    users: Array<{
      accountId: string;
      displayName: string;
      emailAddress?: string;
      avatarUrl?: string;
    }>;
  }>({
    path: `/rest/api/3/user/picker?query=${encodeURIComponent(query)}`,
  });

  const users: JiraUser[] = (res.users || []).map((u) => ({
    accountId: u.accountId,
    displayName: u.displayName,
    emailAddress: u.emailAddress,
    avatarUrl: u.avatarUrl,
  }));

  setCached(cacheKey, users);
  return users;
}
