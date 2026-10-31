import fs from 'node:fs';
import path from 'node:path';
import { jiraFetch } from '../jira/client';
import { ResolvedAttachment } from './resolve';

export interface FileUploadResult {
  path: string;
  filename: string;
  status: 'ok' | 'failed';
  error?: string;
  jiraId?: string;
}

export interface AttachmentUploadOutcome {
  status: 'none' | 'ok' | 'partial' | 'failed';
  attachedCount: number;
  files: FileUploadResult[];
  error?: string;
}

async function uploadSingleFile(
  issueKey: string,
  att: ResolvedAttachment
): Promise<FileUploadResult> {
  try {
    const blob = await fs.openAsBlob(att.resolvedPath, { type: att.mimeType });
    const form = new FormData();
    form.append('file', blob, att.filename);

    const res = await jiraFetch<Array<{ id: string; filename: string }>>({
      method: 'POST',
      path: `/rest/api/3/issue/${encodeURIComponent(issueKey)}/attachments`,
      body: form,
      isMultipart: true,
      headers: {
        'X-Atlassian-Token': 'no-check',
      },
    });

    const jiraId = Array.isArray(res) && res.length > 0 ? res[0].id : undefined;
    return {
      path: att.resolvedPath,
      filename: att.filename,
      status: 'ok',
      jiraId,
    };
  } catch (err: any) {
    return {
      path: att.resolvedPath,
      filename: att.filename,
      status: 'failed',
      error: err.message || 'Upload failed',
    };
  }
}

async function uploadBatch(
  issueKey: string,
  batch: ResolvedAttachment[]
): Promise<FileUploadResult[]> {
  try {
    const form = new FormData();
    for (const att of batch) {
      const blob = await fs.openAsBlob(att.resolvedPath, { type: att.mimeType });
      form.append('file', blob, att.filename);
    }

    const res = await jiraFetch<Array<{ id: string; filename: string }>>({
      method: 'POST',
      path: `/rest/api/3/issue/${encodeURIComponent(issueKey)}/attachments`,
      body: form,
      isMultipart: true,
      headers: {
        'X-Atlassian-Token': 'no-check',
      },
    });

    const results: FileUploadResult[] = batch.map((att) => {
      const matched = Array.isArray(res) ? res.find((r) => r.filename === att.filename) : undefined;
      return {
        path: att.resolvedPath,
        filename: att.filename,
        status: 'ok',
        jiraId: matched?.id,
      };
    });

    return results;
  } catch (batchErr) {
    // If batch fails, retry each file one-by-one to isolate errors
    console.warn(`[Attachments] Batch upload of ${batch.length} files failed. Retrying files individually...`);
    const results: FileUploadResult[] = [];
    for (const att of batch) {
      const singleRes = await uploadSingleFile(issueKey, att);
      results.push(singleRes);
    }
    return results;
  }
}

export async function uploadIssueAttachments(
  issueKey: string,
  validAttachments: ResolvedAttachment[]
): Promise<AttachmentUploadOutcome> {
  if (validAttachments.length === 0) {
    return {
      status: 'none',
      attachedCount: 0,
      files: [],
    };
  }

  const results: FileUploadResult[] = [];
  const BATCH_SIZE = 5;

  for (let i = 0; i < validAttachments.length; i += BATCH_SIZE) {
    const batch = validAttachments.slice(i, i + BATCH_SIZE);
    const batchResults = await uploadBatch(issueKey, batch);
    results.push(...batchResults);
  }

  const successCount = results.filter((r) => r.status === 'ok').length;
  let status: 'none' | 'ok' | 'partial' | 'failed';

  if (successCount === results.length) {
    status = 'ok';
  } else if (successCount > 0) {
    status = 'partial';
  } else {
    status = 'failed';
  }

  const errors = results.filter((r) => r.error).map((r) => `${r.filename}: ${r.error}`);

  return {
    status,
    attachedCount: successCount,
    files: results,
    error: errors.length > 0 ? errors.join('; ') : undefined,
  };
}
