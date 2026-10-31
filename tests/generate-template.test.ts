import { describe, it, expect } from 'vitest';
import { generateProblemTemplate } from '../src/lib/excel/template';
import fs from 'node:fs';
import path from 'node:path';

describe('Generate Problem Template', () => {
  it('generates template workbook with valid lookup data', async () => {
    const buf = await generateProblemTemplate();
    expect(buf.length).toBeGreaterThan(1000);
    const dest = path.resolve(process.cwd(), 'samples', 'Jira-Problem-Import-Template.xlsx');
    fs.writeFileSync(dest, buf);
    expect(fs.existsSync(dest)).toBe(true);
    console.log(`Successfully generated template at: ${dest} (${buf.length} bytes)`);
  });
});
