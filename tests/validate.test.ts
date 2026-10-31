import { describe, it, expect } from 'vitest';
import { escapeJqlString } from '../src/lib/jira/issues';

describe('Duplicate Search & Validation', () => {
  it('escapes quotes and backslashes in JQL strings', () => {
    const raw = 'Bug: \\"Crash\\" in login';
    const escaped = escapeJqlString(raw);
    expect(escaped).toBe('Bug: \\\\\\"Crash\\\\\\" in login');
  });

  it('handles empty or normal strings', () => {
    expect(escapeJqlString('Simple Summary')).toBe('Simple Summary');
  });
});
