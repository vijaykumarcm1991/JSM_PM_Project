import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseWorkbookBuffer } from '../src/lib/excel/parse';
import { resolveRowAttachments } from '../src/lib/attachments/resolve';

describe('Sample fixture verification', () => {
  it('parses samples/sample-import.xlsx with exact planted issues', async () => {
    const fixturePath = path.resolve(process.cwd(), 'samples', 'sample-import.xlsx');
    expect(fs.existsSync(fixturePath)).toBe(true);

    const buf = fs.readFileSync(fixturePath);
    const parsed = await parseWorkbookBuffer(buf, 'sample-import.xlsx');

    expect(parsed.sheets).toContain('Tasks');
    expect(parsed.rowCount).toBe(5);

    // Row 3 (Excel index 4) should have blank summary
    const row4 = parsed.rows[4];
    expect(row4['Summary']).toBeNull();

    // Row 4 (Excel index 5) should have non-existent attachment path
    const row5 = parsed.rows[5];
    const attRes = resolveRowAttachments(row5['Attachment Path']);
    expect(attRes.warnings.length).toBeGreaterThan(0);
    expect(attRes.hasOversizeOrMissing).toBe(true);

    // Row 1 (Excel index 2) should have valid attachment path
    const row2 = parsed.rows[2];
    const attRes2 = resolveRowAttachments(row2['Attachment Path']);
    expect(attRes2.warnings.length).toBe(0);
    expect(attRes2.attachments[0].valid).toBe(true);
  });
});
