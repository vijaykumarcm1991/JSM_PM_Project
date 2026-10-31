import ExcelJS from 'exceljs';
import { DbRunRow } from '../db';

export async function generateResultsExcel(
  headers: string[],
  rowsData: Record<number, Record<string, any>>,
  results: DbRunRow[]
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Results');

  const extraHeaders = [
    'Import Status',
    'Jira Key',
    'Jira URL',
    'Error',
    'Attachments Found',
    'Attached',
    'Attachment Status',
    'Attachment Error',
    'Source Row',
  ];

  const allHeaders = [...headers, ...extraHeaders];

  // Add header row
  const headerRow = worksheet.addRow(allHeaders);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFEAECEF' },
  };

  // Map results by row_index
  const resultMap = new Map<number, DbRunRow>();
  for (const r of results) {
    resultMap.set(r.row_index, r);
  }

  // Iterate rows in numerical order
  const sortedRowIndices = Object.keys(rowsData)
    .map(Number)
    .sort((a, b) => a - b);

  for (const rowIndex of sortedRowIndices) {
    const rowObj = rowsData[rowIndex] || {};
    const result = resultMap.get(rowIndex);

    const rowValues: any[] = [];
    // Original columns - write as string or direct value (never formula)
    for (const h of headers) {
      const val = rowObj[h];
      rowValues.push(val !== null && val !== undefined ? String(val) : '');
    }

    // Attachment info
    let attachmentsFound = 0;
    if (result && result.attachments_json) {
      try {
        const arr = JSON.parse(result.attachments_json);
        if (Array.isArray(arr)) attachmentsFound = arr.length;
      } catch {
        attachmentsFound = 0;
      }
    }

    // Extra columns
    rowValues.push(
      result?.status || 'pending',
      result?.issue_key || '',
      result?.issue_url || '',
      result?.error || '',
      attachmentsFound,
      result?.attached_count || 0,
      result?.attachment_status || 'none',
      result?.attachment_error || '',
      rowIndex
    );

    const addedRow = worksheet.addRow(rowValues);

    // Apply color styling based on status
    if (result?.status === 'created') {
      addedRow.getCell(headers.length + 1).font = { color: { argb: 'FF00875A' }, bold: true };
    } else if (result?.status === 'failed') {
      addedRow.getCell(headers.length + 1).font = { color: { argb: 'FFDE350B' }, bold: true };
    } else if (result?.status === 'skipped') {
      addedRow.getCell(headers.length + 1).font = { color: { argb: 'FFFF991F' }, bold: true };
    }
  }

  // Auto-fit column widths
  worksheet.columns.forEach((col) => {
    col.width = 18;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
