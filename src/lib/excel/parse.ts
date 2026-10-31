import ExcelJS from 'exceljs';

export interface ParsedSheetSummary {
  sheetName: string;
  rowCount: number;
}

export interface ParsedUploadResult {
  filename: string;
  sheets: string[];
  selectedSheet: string;
  headerRowIndex: number;
  headers: string[];
  rowCount: number;
  // Keyed by real 1-based Excel row index
  rows: Record<number, Record<string, any>>;
  previewRows: Array<{
    rowIndex: number;
    values: Record<string, any>;
  }>;
}

export function extractCellValue(value: ExcelJS.CellValue): any {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'object') {
    // Rich text
    if ('richText' in value && Array.isArray((value as any).richText)) {
      return (value as any).richText.map((part: any) => part.text || '').join('');
    }
    // Formula with result
    if ('result' in value) {
      return extractCellValue((value as any).result);
    }
    // Hyperlink
    if ('text' in value) {
      return (value as any).text;
    }
    // Text formula
    if ('formula' in value) {
      return (value as any).formula;
    }
    return String(value);
  }

  return value;
}

export async function parseWorkbookBuffer(
  buffer: Buffer,
  filename: string,
  options?: { sheetName?: string; headerRowIndex?: number }
): Promise<ParsedUploadResult> {
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error('File exceeds the maximum allowed size of 10 MB.');
  }

  const workbook = new ExcelJS.Workbook();
  const lowerName = filename.toLowerCase();

  if (lowerName.endsWith('.csv')) {
    const stream = require('node:stream');
    const readable = stream.Readable.from(buffer);
    await workbook.csv.read(readable);
  } else {
    await workbook.xlsx.load(buffer as any);
  }

  const sheetNames = workbook.worksheets.map((ws) => ws.name);
  if (sheetNames.length === 0) {
    throw new Error('Workbook contains no worksheets.');
  }

  const targetSheetName = options?.sheetName && sheetNames.includes(options.sheetName)
    ? options.sheetName
    : sheetNames[0];

  const worksheet = workbook.getWorksheet(targetSheetName);
  if (!worksheet) {
    throw new Error(`Worksheet "${targetSheetName}" not found.`);
  }

  // Auto-detect header row if not specified
  let headerRowIndex = options?.headerRowIndex;
  if (!headerRowIndex || headerRowIndex < 1) {
    for (let r = 1; r <= Math.min(20, worksheet.rowCount); r++) {
      const row = worksheet.getRow(r);
      let hasText = false;
      row.eachCell({ includeEmpty: false }, (cell) => {
        const val = extractCellValue(cell.value);
        if (val !== null && val !== undefined && String(val).trim().length > 0) {
          hasText = true;
        }
      });
      if (hasText) {
        headerRowIndex = r;
        break;
      }
    }
  }

  if (!headerRowIndex) {
    headerRowIndex = 1;
  }

  // Extract headers
  const headerRow = worksheet.getRow(headerRowIndex);
  const colIndexToHeader = new Map<number, string>();
  const headers: string[] = [];

  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const rawVal = extractCellValue(cell.value);
    const headerText = rawVal ? String(rawVal).trim() : '';
    if (headerText) {
      colIndexToHeader.set(colNumber, headerText);
      headers.push(headerText);
    }
  });

  if (headers.length === 0) {
    throw new Error(`No headers found in row ${headerRowIndex}.`);
  }

  // Parse rows (capped at 5,000 data rows)
  const MAX_ROWS = 5000;
  const rows: Record<number, Record<string, any>> = {};
  const previewRows: Array<{ rowIndex: number; values: Record<string, any> }> = [];

  let dataRowCount = 0;
  for (let r = headerRowIndex + 1; r <= worksheet.rowCount; r++) {
    const row = worksheet.getRow(r);
    let hasValues = false;
    const rowData: Record<string, any> = {};

    colIndexToHeader.forEach((headerName, colNumber) => {
      const cell = row.getCell(colNumber);
      const val = extractCellValue(cell.value);
      if (val !== null && val !== undefined && String(val).trim().length > 0) {
        hasValues = true;
        rowData[headerName] = val;
      } else {
        rowData[headerName] = null;
      }
    });

    if (hasValues) {
      dataRowCount++;
      if (dataRowCount > MAX_ROWS) {
        throw new Error(`Sheet exceeds the maximum limit of ${MAX_ROWS} rows.`);
      }

      rows[r] = rowData;

      if (previewRows.length < 8) {
        previewRows.push({
          rowIndex: r,
          values: rowData,
        });
      }
    }
  }

  return {
    filename,
    sheets: sheetNames,
    selectedSheet: targetSheetName,
    headerRowIndex,
    headers,
    rowCount: dataRowCount,
    rows,
    previewRows,
  };
}
