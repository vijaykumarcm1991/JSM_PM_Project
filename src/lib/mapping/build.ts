import { textToAdf } from '../adf';
import { JiraFieldMeta, searchUsers, testConnection } from '../jira/meta';
import { FieldMapping, MappingConfig } from './types';

export interface BuildPayloadResult {
  fields: Record<string, any>;
  errors: string[];
}

function parseExcelSerialDate(serial: number): Date {
  // Excel base date: 1899-12-30 (accounting for the 1900 leap year bug)
  const utcDays = Math.floor(serial - 25569);
  const utcValue = utcDays * 86400;
  const dateInfo = new Date(utcValue * 1000);
  const fractionalDay = serial - Math.floor(serial) + 0.0000001;
  const totalSeconds = Math.floor(86400 * fractionalDay);
  const seconds = totalSeconds % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  return new Date(Date.UTC(dateInfo.getUTCFullYear(), dateInfo.getUTCMonth(), dateInfo.getUTCDate(), hours, minutes, seconds));
}

export function normalizeDate(value: any): string | null {
  if (value === null || value === undefined || value === '') return null;
  let d: Date;

  if (value instanceof Date) {
    d = value;
  } else if (typeof value === 'number') {
    // If it's a timestamp or Excel serial
    if (value > 100000000000) {
      d = new Date(value);
    } else {
      d = parseExcelSerialDate(value);
    }
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = new Date(trimmed);
    if (isNaN(parsed.getTime())) {
      // Try YYYY-MM-DD or DD/MM/YYYY or MM/DD/YYYY
      const parts = trimmed.split(/[-/]/);
      if (parts.length === 3) {
        if (parts[0].length === 4) {
          // YYYY-MM-DD
          return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
        }
      }
      return null;
    }
    d = parsed;
  } else {
    return null;
  }

  if (isNaN(d.getTime())) return null;
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function normalizeDateTime(value: any): string | null {
  if (value === null || value === undefined || value === '') return null;
  let d: Date;
  if (value instanceof Date) {
    d = value;
  } else if (typeof value === 'number') {
    d = parseExcelSerialDate(value);
  } else {
    d = new Date(String(value));
  }
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

function applyTransform(val: any, transform: string): any {
  if (val === null || val === undefined) return val;
  const str = String(val);

  switch (transform) {
    case 'trim':
      return str.trim();
    case 'uppercase':
      return str.toUpperCase().trim();
    case 'lowercase':
      return str.toLowerCase().trim();
    case 'split-list':
      return str.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
    case 'date-normalize':
      return normalizeDate(val) || str.trim();
    case 'none':
    default:
      return typeof val === 'string' ? val.trim() : val;
  }
}

// Cached accountId for @me
let currentMyselfAccountId: string | null = null;
async function getCurrentUserAccountId(): Promise<string> {
  if (!currentMyselfAccountId) {
    const myself = await testConnection();
    currentMyselfAccountId = myself.accountId;
  }
  return currentMyselfAccountId;
}

export async function buildIssuePayload(
  rowValues: Record<string, any>,
  config: MappingConfig,
  fieldMetas: JiraFieldMeta[]
): Promise<BuildPayloadResult> {
  const rowProjectKey = rowValues['Project'] || rowValues['project'] || config.projectKey;
  const errors: string[] = [];

  if (!rowProjectKey || !String(rowProjectKey).trim()) {
    errors.push('Project key is required for each row.');
  }

  const fields: Record<string, any> = {
    project: { key: String(rowProjectKey || 'NDCCLOUD').trim() },
    issuetype: { id: config.issueTypeId || '10037' },
  };

  const fieldMetaMap = new Map<string, JiraFieldMeta>();
  for (const fm of fieldMetas) {
    fieldMetaMap.set(fm.id, fm);
  }

  for (const mapping of config.fields) {
    const meta = fieldMetaMap.get(mapping.fieldId);
    if (!meta) continue;

    // Get raw cell value or constant
    let rawValue: any = null;
    if (mapping.columnName && rowValues[mapping.columnName] !== undefined && rowValues[mapping.columnName] !== null) {
      rawValue = rowValues[mapping.columnName];
    } else if (mapping.constantValue !== null && mapping.constantValue !== undefined && mapping.constantValue !== '') {
      rawValue = mapping.constantValue;
    }

    // Check empty
    const isEmpty =
      rawValue === null ||
      rawValue === undefined ||
      (typeof rawValue === 'string' && rawValue.trim() === '');

    if (isEmpty) {
      if (meta.required && !meta.hasDefaultValue) {
        errors.push(`Required field "${meta.name}" (${meta.id}) is missing.`);
      }
      continue;
    }

    // Apply transform
    let val = applyTransform(rawValue, mapping.transform);

    // Schema-driven serialization
    const schemaType = meta.schema?.type || 'string';
    const schemaCustom = meta.schema?.custom || '';
    const schemaItems = meta.schema?.items || '';

    try {
      if (mapping.fieldId === 'description') {
        fields[mapping.fieldId] = textToAdf(String(val));
        continue;
      }

      if (schemaType === 'string') {
        fields[mapping.fieldId] = String(val).trim();
      } else if (schemaType === 'number') {
        const num = Number(val);
        if (isNaN(num)) {
          errors.push(`Field "${meta.name}" requires a number; got "${val}".`);
        } else {
          fields[mapping.fieldId] = num;
        }
      } else if (schemaType === 'date') {
        const dateStr = normalizeDate(val);
        if (!dateStr) {
          errors.push(`Field "${meta.name}" requires a valid date (YYYY-MM-DD); got "${val}".`);
        } else {
          fields[mapping.fieldId] = dateStr;
        }
      } else if (schemaType === 'datetime') {
        const dtStr = normalizeDateTime(val);
        if (!dtStr) {
          errors.push(`Field "${meta.name}" requires a valid datetime; got "${val}".`);
        } else {
          fields[mapping.fieldId] = dtStr;
        }
      } else if (schemaType === 'priority') {
        const textVal = String(val).trim().toLowerCase();
        const allowed = meta.allowedValues || [];
        const match = allowed.find(
          (a) => a.id === textVal || (a.name && a.name.toLowerCase() === textVal)
        );
        if (match) {
          fields[mapping.fieldId] = { id: match.id };
        } else if (allowed.length > 0) {
          errors.push(`Priority "${val}" is not valid. Allowed: ${allowed.map((a) => a.name).join(', ')}.`);
        } else {
          fields[mapping.fieldId] = { name: String(val).trim() };
        }
      } else if (schemaType === 'user') {
        const textVal = String(val).trim();
        if (textVal === '@me') {
          const accountId = await getCurrentUserAccountId();
          fields[mapping.fieldId] = { accountId };
        } else {
          const users = await searchUsers(textVal);
          const exact = users.find(
            (u) =>
              u.emailAddress?.toLowerCase() === textVal.toLowerCase() ||
              u.displayName.toLowerCase() === textVal.toLowerCase() ||
              u.accountId === textVal
          );
          if (exact) {
            fields[mapping.fieldId] = { accountId: exact.accountId };
          } else if (users.length > 0) {
            fields[mapping.fieldId] = { accountId: users[0].accountId };
          } else {
            errors.push(`User "${textVal}" for field "${meta.name}" could not be found.`);
          }
        }
      } else if (schemaType === 'option') {
        const textVal = String(val).trim().toLowerCase();
        const allowed = meta.allowedValues || [];
        const match = allowed.find(
          (a) =>
            (a.value && a.value.toLowerCase() === textVal) ||
            (a.name && a.name.toLowerCase() === textVal) ||
            a.id === textVal
        );
        if (match) {
          if (match.value) {
            fields[mapping.fieldId] = { value: match.value };
          } else {
            fields[mapping.fieldId] = { id: match.id };
          }
        } else if (allowed.length > 0) {
          errors.push(`Option "${val}" for field "${meta.name}" is not in allowed values: ${allowed.map((a) => a.value || a.name).join(', ')}.`);
        } else {
          fields[mapping.fieldId] = { value: String(val).trim() };
        }
      } else if (schemaType === 'array') {
        if (schemaItems === 'string') {
          // Labels or string array
          let list: string[] = [];
          if (Array.isArray(val)) {
            list = val.map(String);
          } else {
            list = String(val).split(/[,;\n]/);
          }
          const cleanLabels = Array.from(
            new Set(list.map((s) => s.trim().replace(/\s+/g, '-')).filter(Boolean))
          );
          fields[mapping.fieldId] = cleanLabels;
        } else if (schemaItems === 'option') {
          // Multi-select options
          let list: string[] = [];
          if (Array.isArray(val)) {
            list = val.map(String);
          } else {
            list = String(val).split(/[,;\n]/);
          }
          const allowed = meta.allowedValues || [];
          const optionObjects: any[] = [];
          for (const item of list) {
            const trimmed = item.trim();
            if (!trimmed) continue;
            const match = allowed.find(
              (a) =>
                (a.value && a.value.toLowerCase() === trimmed.toLowerCase()) ||
                (a.name && a.name.toLowerCase() === trimmed.toLowerCase()) ||
                a.id === trimmed
            );
            if (match) {
              optionObjects.push(match.value ? { value: match.value } : { id: match.id });
            } else if (allowed.length > 0) {
              errors.push(`Option "${trimmed}" for field "${meta.name}" is not valid.`);
            } else {
              optionObjects.push({ value: trimmed });
            }
          }
          fields[mapping.fieldId] = optionObjects;
        } else if (schemaItems === 'component' || mapping.fieldId === 'components') {
          let list: string[] = [];
          if (Array.isArray(val)) {
            list = val.map(String);
          } else {
            list = String(val).split(/[,;\n]/);
          }
          const allowed = meta.allowedValues || [];
          const compObjects: any[] = [];
          for (const item of list) {
            const trimmed = item.trim();
            if (!trimmed) continue;
            const match = allowed.find((a) => a.name?.toLowerCase() === trimmed.toLowerCase() || a.id === trimmed);
            if (match) {
              compObjects.push({ id: match.id });
            } else {
              compObjects.push({ name: trimmed });
            }
          }
          fields[mapping.fieldId] = compObjects;
        } else {
          // Default string array
          const list = Array.isArray(val) ? val : String(val).split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
          fields[mapping.fieldId] = list;
        }
      } else {
        // Fallback
        fields[mapping.fieldId] = String(val).trim();
      }
    } catch (e: any) {
      errors.push(`Error serializing field "${meta.name}": ${e.message}`);
    }
  }

  return { fields, errors };
}
