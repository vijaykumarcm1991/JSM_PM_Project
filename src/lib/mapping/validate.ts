import { JiraFieldMeta } from '../jira/meta';
import { searchSummaries, DuplicateIssueMatch } from '../jira/issues';
import { MappingConfig } from './types';
import { buildIssuePayload } from './build';
import { resolveRowAttachments } from '../attachments/resolve';

export interface RowValidationProblem {
  rowIndex: number;
  summary: string;
  errors: string[];
  warnings: string[];
  duplicateOf?: DuplicateIssueMatch;
}

export interface ValidationSummary {
  total: number;
  readyCount: number;
  invalidCount: number;
  duplicateCount: number;
  attachmentWarningCount: number;
  problems: RowValidationProblem[];
}

export async function validateRowsAndDuplicates(
  rows: Record<number, Record<string, any>>,
  config: MappingConfig,
  fieldMetas: JiraFieldMeta[],
  checkDuplicates: boolean = true
): Promise<ValidationSummary> {
  const problems: RowValidationProblem[] = [];
  const summariesToRows = new Map<string, number[]>(); // summary -> rowIndices[]
  const rowPayloads = new Map<number, { summary: string; errors: string[]; warnings: string[] }>();

  let invalidCount = 0;
  let attachmentWarningCount = 0;

  const sortedRowIndices = Object.keys(rows)
    .map(Number)
    .sort((a, b) => a - b);

  // 1. Build and validate each row
  for (const rIndex of sortedRowIndices) {
    const rowData = rows[rIndex];
    const { fields, errors } = await buildIssuePayload(rowData, config, fieldMetas);
    const warnings: string[] = [];

    // Check attachments if column mapped
    if (config.attachment?.columnName) {
      const attVal = rowData[config.attachment.columnName];
      const attRes = resolveRowAttachments(attVal);
      if (attRes.warnings.length > 0) {
        warnings.push(...attRes.warnings);
        attachmentWarningCount++;
      }
    }

    const summaryStr = fields.summary ? String(fields.summary).trim() : '';

    if (errors.length > 0) {
      invalidCount++;
    } else if (summaryStr) {
      const lower = summaryStr.toLowerCase();
      const existing = summariesToRows.get(lower) || [];
      existing.push(rIndex);
      summariesToRows.set(lower, existing);
    }

    rowPayloads.set(rIndex, {
      summary: summaryStr || `Row ${rIndex}`,
      errors,
      warnings,
    });
  }

  // 2. Duplicate check against Jira Cloud
  const duplicateMatches = new Map<string, DuplicateIssueMatch>();
  if (checkDuplicates && summariesToRows.size > 0) {
    const summariesList = Array.from(summariesToRows.keys());
    const matches = await searchSummaries(config.projectKey, summariesList);
    matches.forEach((v, k) => duplicateMatches.set(k, v));
  }

  let duplicateCount = 0;

  // 3. Assemble problem list
  for (const rIndex of sortedRowIndices) {
    const info = rowPayloads.get(rIndex)!;
    const lowerSummary = info.summary.toLowerCase();
    const dupMatch = duplicateMatches.get(lowerSummary);

    if (dupMatch) {
      duplicateCount++;
    }

    if (info.errors.length > 0 || info.warnings.length > 0 || dupMatch) {
      problems.push({
        rowIndex: rIndex,
        summary: info.summary,
        errors: info.errors,
        warnings: info.warnings,
        duplicateOf: dupMatch,
      });
    }
  }

  const total = sortedRowIndices.length;
  const readyCount = Math.max(0, total - invalidCount - duplicateCount);

  return {
    total,
    readyCount,
    invalidCount,
    duplicateCount,
    attachmentWarningCount,
    problems,
  };
}
