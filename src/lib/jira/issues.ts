import { jiraFetch } from './client';
import { getInternalSettings } from '../settings';

export interface CreateIssueResult {
  id: string;
  key: string;
  self: string;
  url: string;
}

export async function createIssue(fields: Record<string, any>): Promise<CreateIssueResult> {
  const settings = getInternalSettings();
  const res = await jiraFetch<{ id: string; key: string; self: string }>({
    method: 'POST',
    path: '/rest/api/3/issue',
    body: { fields },
  });

  const url = `${settings.baseUrl}/browse/${res.key}`;
  return {
    id: res.id,
    key: res.key,
    self: res.self,
    url,
  };
}

export function escapeJqlString(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export interface DuplicateIssueMatch {
  key: string;
  summary: string;
  status: string;
}

export async function searchSummaries(
  projectKey: string,
  summaries: string[]
): Promise<Map<string, DuplicateIssueMatch>> {
  const matches = new Map<string, DuplicateIssueMatch>();
  const cleanSummaries = Array.from(new Set(summaries.map((s) => s.trim()).filter(Boolean)));
  if (cleanSummaries.length === 0) return matches;

  // Chunk summaries ~20 per request
  const chunkSize = 20;
  for (let i = 0; i < cleanSummaries.length; i += chunkSize) {
    const chunk = cleanSummaries.slice(i, i + chunkSize);
    const jqlList = chunk.map((s) => `"${escapeJqlString(s)}"`).join(', ');
    const jql = `project = "${escapeJqlString(projectKey)}" AND summary in (${jqlList})`;

    try {
      const res = await jiraFetch<{
        issues: Array<{
          key: string;
          fields: {
            summary: string;
            status?: { name: string };
          };
        }>;
      }>({
        method: 'POST',
        path: '/rest/api/3/search/jql',
        body: {
          jql,
          fields: ['summary', 'status'],
          maxResults: 100,
        },
      });

      if (res.issues) {
        for (const issue of res.issues) {
          const s = issue.fields.summary.trim().toLowerCase();
          matches.set(s, {
            key: issue.key,
            summary: issue.fields.summary,
            status: issue.fields.status?.name || 'Unknown',
          });
        }
      }
    } catch (err) {
      console.warn('[Jira] Duplicate search chunk failed:', err);
    }
  }

  return matches;
}
