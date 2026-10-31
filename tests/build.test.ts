import { describe, it, expect } from 'vitest';
import { buildIssuePayload, normalizeDate } from '../src/lib/mapping/build';
import { JiraFieldMeta } from '../src/lib/jira/meta';
import { MappingConfig } from '../src/lib/mapping/types';

describe('Mapping & Payload Builder', () => {
  const mockMetas: JiraFieldMeta[] = [
    {
      id: 'summary',
      name: 'Summary',
      required: true,
      hasDefaultValue: false,
      schema: { type: 'string' },
    },
    {
      id: 'description',
      name: 'Description',
      required: false,
      hasDefaultValue: false,
      schema: { type: 'string' },
    },
    {
      id: 'customfield_num',
      name: 'Score',
      required: false,
      hasDefaultValue: false,
      schema: { type: 'number' },
    },
    {
      id: 'duedate',
      name: 'Due Date',
      required: false,
      hasDefaultValue: false,
      schema: { type: 'date' },
    },
    {
      id: 'priority',
      name: 'Priority',
      required: false,
      hasDefaultValue: false,
      schema: { type: 'priority' },
      allowedValues: [
        { id: '1', name: 'High' },
        { id: '2', name: 'Medium' },
        { id: '3', name: 'Low' },
      ],
    },
    {
      id: 'labels',
      name: 'Labels',
      required: false,
      hasDefaultValue: false,
      schema: { type: 'array', items: 'string' },
    },
    {
      id: 'customfield_select',
      name: 'Category',
      required: false,
      hasDefaultValue: false,
      schema: { type: 'option' },
      allowedValues: [
        { id: '101', value: 'Backend' },
        { id: '102', value: 'Frontend' },
      ],
    },
  ];

  const baseConfig: MappingConfig = {
    projectKey: 'TEST',
    issueTypeId: '10001',
    fields: [
      { fieldId: 'summary', columnName: 'Title', transform: 'trim' },
      { fieldId: 'description', columnName: 'Details', transform: 'none' },
      { fieldId: 'customfield_num', columnName: 'Points', transform: 'none' },
      { fieldId: 'duedate', columnName: 'Due', transform: 'none' },
      { fieldId: 'priority', columnName: 'Prio', transform: 'none' },
      { fieldId: 'labels', columnName: 'Tags', transform: 'none' },
      { fieldId: 'customfield_select', columnName: 'Dept', transform: 'none' },
    ],
    attachment: { columnName: null },
  };

  it('builds standard fields correctly', async () => {
    const row = {
      Title: ' Fix auth issue ',
      Details: 'Step 1\nStep 2',
      Points: 42,
      Due: '2026-12-31',
      Prio: 'high',
      Tags: 'bug, security; bug',
      Dept: 'backend',
    };

    const res = await buildIssuePayload(row, baseConfig, mockMetas);
    expect(res.errors).toHaveLength(0);
    expect(res.fields.summary).toBe('Fix auth issue');
    expect(res.fields.description.type).toBe('doc');
    expect(res.fields.customfield_num).toBe(42);
    expect(res.fields.duedate).toBe('2026-12-31');
    expect(res.fields.priority).toEqual({ id: '1' });
    expect(res.fields.labels).toEqual(['bug', 'security']);
    expect(res.fields.customfield_select).toEqual({ value: 'Backend' });
  });

  it('reports error on missing required field without default', async () => {
    const row = {
      Title: '   ', // blank
    };

    const res = await buildIssuePayload(row, baseConfig, mockMetas);
    expect(res.errors.length).toBeGreaterThan(0);
    expect(res.errors[0]).toContain('Required field "Summary" (summary) is missing');
  });

  it('rejects NaN numbers', async () => {
    const row = {
      Title: 'Valid title',
      Points: 'not-a-number',
    };

    const res = await buildIssuePayload(row, baseConfig, mockMetas);
    expect(res.errors).toContain('Field "Score" requires a number; got "not-a-number".');
  });

  it('handles Excel date serials and strings in date normalizer', () => {
    // 45657 is around late Dec 2024 / early 2025
    expect(normalizeDate('2026-05-15')).toBe('2026-05-15');
    const dateObj = new Date('2026-08-20T10:00:00Z');
    expect(normalizeDate(dateObj)).toBe('2026-08-20');
  });
});
