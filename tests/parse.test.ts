import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { parseWorkbookBuffer } from '../src/lib/excel/parse';

describe('Excel Parser', () => {
  it('parses valid workbook with headers, string, numeric, and date cells', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');

    ws.addRow(['Summary', 'Estimate', 'Due Date']);
    ws.addRow(['First Issue', 5, new Date('2026-11-01T00:00:00.000Z')]);
    ws.addRow(['Second Issue', 12, '2026-12-15']);
    ws.addRow([]); // empty row
    ws.addRow(['Third Issue', null, null]);

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const res = await parseWorkbookBuffer(buffer, 'test.xlsx');

    expect(res.sheets).toEqual(['Sheet1']);
    expect(res.headers).toEqual(['Summary', 'Estimate', 'Due Date']);
    expect(res.rowCount).toBe(3); // 3 non-empty data rows
    expect(res.previewRows.length).toBe(3);
    expect(res.previewRows[0].values['Summary']).toBe('First Issue');
    expect(res.previewRows[0].values['Estimate']).toBe(5);
  });

  it('auto-detects header row on non-empty first row', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');

    // Row 1 and 2 are empty/title
    ws.addRow([]);
    ws.addRow(['   ']);
    ws.addRow(['Task Name', 'Assignee']); // Row 3 is header
    ws.addRow(['Implement auth', 'alice']);

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const res = await parseWorkbookBuffer(buffer, 'test.xlsx');

    expect(res.headerRowIndex).toBe(3);
    expect(res.headers).toEqual(['Task Name', 'Assignee']);
    expect(res.rowCount).toBe(1);
  });
});
