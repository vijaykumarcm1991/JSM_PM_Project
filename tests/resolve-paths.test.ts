import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  splitAttachmentPaths,
  resolveAttachmentPath,
  resolveRowAttachments,
} from '../src/lib/attachments/resolve';

describe('Attachment Path Resolver', () => {
  let tempDir: string;
  let testFile: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-test-att-'));
    testFile = path.join(tempDir, 'sample.pdf');
    fs.writeFileSync(testFile, 'PDF sample content');
  });

  afterAll(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('splits paths by semicolon and newlines and trims quotes', () => {
    const input = '"C:\\Docs\\one.pdf"; \'D:\\Data\\two.png\'\n“E:\\three.txt”';
    const split = splitAttachmentPaths(input);
    expect(split).toEqual(['C:\\Docs\\one.pdf', 'D:\\Data\\two.png', 'E:\\three.txt']);
  });

  it('rejects relative paths', () => {
    const res = resolveAttachmentPath('relative/path/file.pdf');
    expect(res.valid).toBe(false);
    expect(res.error).toContain('Path must be absolute');
  });

  it('rejects sensitive locations via denylist', () => {
    const resSsh = resolveAttachmentPath('C:\\Users\\test\\.ssh\\id_rsa');
    expect(resSsh.valid).toBe(false);
    expect(resSsh.error).toContain('restricted/sensitive');

    const resEnv = resolveAttachmentPath('C:\\Projects\\app\\.env');
    expect(resEnv.valid).toBe(false);
    expect(resEnv.error).toContain('restricted/sensitive');
  });

  it('rejects directories', () => {
    const res = resolveAttachmentPath(tempDir);
    expect(res.valid).toBe(false);
    expect(res.error).toContain('regular file');
  });

  it('resolves valid regular files and infers mime type', () => {
    const res = resolveAttachmentPath(testFile);
    expect(res.valid).toBe(true);
    expect(res.mimeType).toBe('application/pdf');
    expect(res.sizeBytes).toBeGreaterThan(0);
    expect(res.filename).toBe('sample.pdf');
  });

  it('truncates over-count per row', () => {
    const paths = Array.from({ length: 15 }, (_, i) => `C:\\mock\\file_${i}.txt`).join('; ');
    const res = resolveRowAttachments(paths);
    expect(res.warnings[0]).toContain('only first 10 will be uploaded');
    expect(res.attachments).toHaveLength(10);
  });
});
