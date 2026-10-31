import fs from 'node:fs';
import path from 'node:path';

export interface ResolvedAttachment {
  originalPath: string;
  resolvedPath: string;
  filename: string;
  sizeBytes: number;
  mimeType: string;
  valid: boolean;
  error?: string;
}

export interface AttachmentResolutionResult {
  attachments: ResolvedAttachment[];
  warnings: string[];
  hasOversizeOrMissing: boolean;
}

const MIME_MAP: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.log': 'text/plain',
  '.zip': 'application/zip',
  '.msg': 'application/vnd.ms-outlook',
  '.eml': 'message/rfc822',
};

const DENYLIST_PATTERNS = [
  /[\\/]\.ssh([\\/]|$)/i,
  /[\\/]\.aws([\\/]|$)/i,
  /[\\/]\.kube([\\/]|$)/i,
  /[\\/]\.env/i,
  /id_rsa/i,
  /AppData[\\/]Roaming[\\/]Microsoft[\\/]Credentials/i,
];

export function getMaxAttachmentSizeMb(): number {
  const envVal = process.env.MAX_ATTACHMENT_MB;
  if (envVal) {
    const parsed = parseInt(envVal, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return 20;
}

export function getMaxAttachmentsPerRow(): number {
  const envVal = process.env.MAX_ATTACHMENTS_PER_ROW;
  if (envVal) {
    const parsed = parseInt(envVal, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return 10;
}

export function splitAttachmentPaths(cellValue: string | null | undefined): string[] {
  if (!cellValue || !cellValue.trim()) return [];
  // Split on ';' or newlines
  const rawParts = cellValue.split(/[;\r\n]+/);
  const paths: string[] = [];

  for (const part of rawParts) {
    let clean = part.trim();
    // Trim straight or curly quotes
    clean = clean.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
    if (clean) {
      paths.push(clean);
    }
  }

  return paths;
}

export function resolveAttachmentPath(rawPath: string): ResolvedAttachment {
  const maxMb = getMaxAttachmentSizeMb();
  const maxBytes = maxMb * 1024 * 1024;

  let clean = rawPath.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();

  // Reject if not absolute (UNC paths starting with \\ are absolute)
  const isUnc = clean.startsWith('\\\\');
  const isAbs = path.isAbsolute(clean) || isUnc;

  if (!isAbs) {
    return {
      originalPath: rawPath,
      resolvedPath: clean,
      filename: path.basename(clean),
      sizeBytes: 0,
      mimeType: 'application/octet-stream',
      valid: false,
      error: 'Path must be absolute or UNC.',
    };
  }

  // Sensitive directory denylist
  for (const pattern of DENYLIST_PATTERNS) {
    if (pattern.test(clean)) {
      return {
        originalPath: rawPath,
        resolvedPath: clean,
        filename: path.basename(clean),
        sizeBytes: 0,
        mimeType: 'application/octet-stream',
        valid: false,
        error: 'Path refers to a restricted/sensitive location.',
      };
    }
  }

  // Windows long paths
  let openPath = clean;
  if (process.platform === 'win32' && clean.length > 259 && !clean.startsWith('\\\\?\\')) {
    openPath = isUnc ? `\\\\?\\UNC\\${clean.slice(2)}` : `\\\\?\\${clean}`;
  }

  // Check existence and realpath
  let realPathStr: string;
  try {
    realPathStr = fs.realpathSync(openPath);
  } catch (err: any) {
    return {
      originalPath: rawPath,
      resolvedPath: clean,
      filename: path.basename(clean),
      sizeBytes: 0,
      mimeType: 'application/octet-stream',
      valid: false,
      error: `File not found or inaccessible: ${err.message}`,
    };
  }

  // Check stat
  let stat: fs.Stats;
  try {
    stat = fs.statSync(realPathStr);
  } catch (err: any) {
    return {
      originalPath: rawPath,
      resolvedPath: realPathStr,
      filename: path.basename(realPathStr),
      sizeBytes: 0,
      mimeType: 'application/octet-stream',
      valid: false,
      error: `Cannot stat file: ${err.message}`,
    };
  }

  if (!stat.isFile()) {
    return {
      originalPath: rawPath,
      resolvedPath: realPathStr,
      filename: path.basename(realPathStr),
      sizeBytes: stat.size,
      mimeType: 'application/octet-stream',
      valid: false,
      error: 'Path is a directory, device, or socket (must be a regular file).',
    };
  }

  // Check size
  if (stat.size > maxBytes) {
    const sizeMb = (stat.size / (1024 * 1024)).toFixed(1);
    return {
      originalPath: rawPath,
      resolvedPath: realPathStr,
      filename: path.basename(realPathStr),
      sizeBytes: stat.size,
      mimeType: 'application/octet-stream',
      valid: false,
      error: `File size (${sizeMb} MB) exceeds maximum limit of ${maxMb} MB.`,
    };
  }

  // Inferred mime type
  const ext = path.extname(realPathStr).toLowerCase();
  const mimeType = MIME_MAP[ext] || 'application/octet-stream';

  return {
    originalPath: rawPath,
    resolvedPath: realPathStr,
    filename: path.basename(realPathStr),
    sizeBytes: stat.size,
    mimeType,
    valid: true,
  };
}

export function resolveRowAttachments(cellValue: string | null | undefined): AttachmentResolutionResult {
  const rawPaths = splitAttachmentPaths(cellValue);
  const maxPerRow = getMaxAttachmentsPerRow();
  const warnings: string[] = [];

  let candidatePaths = rawPaths;
  if (candidatePaths.length > maxPerRow) {
    warnings.push(`Found ${candidatePaths.length} attachments; only first ${maxPerRow} will be uploaded.`);
    candidatePaths = candidatePaths.slice(0, maxPerRow);
  }

  const attachments: ResolvedAttachment[] = [];
  let hasOversizeOrMissing = false;

  for (const p of candidatePaths) {
    const res = resolveAttachmentPath(p);
    attachments.push(res);
    if (!res.valid) {
      hasOversizeOrMissing = true;
      warnings.push(`Attachment "${res.filename}": ${res.error}`);
    }
  }

  return {
    attachments,
    warnings,
    hasOversizeOrMissing,
  };
}
