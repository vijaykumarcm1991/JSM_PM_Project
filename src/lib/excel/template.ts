import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';

export interface DropdownFieldDefinition {
  header: string;
  fieldId: string;
  width: number;
  required?: boolean;
  options?: string[];
  note?: string;
}

export async function generateProblemTemplate(): Promise<Buffer> {
  // Load fetched fields and projects
  let projectKeys: string[] = ['NDCCLOUD', 'NDCPRE'];
  let fieldOptions: Record<string, string[]> = {};

  try {
    const projPath = path.resolve(process.cwd(), 'samples', 'projects.json');
    if (fs.existsSync(projPath)) {
      const projData = JSON.parse(fs.readFileSync(projPath, 'utf-8'));
      projectKeys = projData.map((p: any) => p.key);
    }
  } catch (err) {
    console.warn('Could not read samples/projects.json:', err);
  }

  try {
    const fieldsPath = path.resolve(process.cwd(), 'samples', 'ndccloud-problem-fields.json');
    if (fs.existsSync(fieldsPath)) {
      const fieldsData = JSON.parse(fs.readFileSync(fieldsPath, 'utf-8'));
      for (const [id, f] of Object.entries<any>(fieldsData)) {
        if (f.allowedValues && f.allowedValues.length > 0) {
          fieldOptions[id] = f.allowedValues.map((av: any) => av.value || av.name);
        }
      }
    }
  } catch (err) {
    console.warn('Could not read samples/ndccloud-problem-fields.json:', err);
  }

  const columns: DropdownFieldDefinition[] = [
    {
      header: 'Project',
      fieldId: 'project',
      width: 16,
      required: true,
      options: projectKeys,
      note: 'Jira Project Key (e.g. NDCCLOUD, NDCPRE)',
    },
    {
      header: 'Summary',
      fieldId: 'summary',
      width: 32,
      required: true,
      note: 'Issue summary title',
    },
    {
      header: 'Description',
      fieldId: 'description',
      width: 40,
      note: 'Detailed description (paragraphs, bullet points)',
    },
    {
      header: 'Priority',
      fieldId: 'priority',
      width: 18,
      options: fieldOptions['priority'] || ['Blocker', 'High (migrated)', 'Medium (migrated)', 'Low (migrated)'],
    },
    {
      header: 'Country',
      fieldId: 'customfield_10091',
      width: 20,
      options: fieldOptions['customfield_10091'] || [],
    },
    {
      header: 'Affected_CI',
      fieldId: 'customfield_10094',
      width: 22,
      note: 'Affected CI name or host',
    },
    {
      header: 'Source',
      fieldId: 'customfield_10095',
      width: 16,
      options: fieldOptions['customfield_10095'] || ['NMS', 'CRM', 'EMAIL', 'Crowdstrike', 'CCM'],
    },
    {
      header: 'Issue_Category',
      fieldId: 'customfield_10096',
      width: 30,
      options: fieldOptions['customfield_10096'] || [],
    },
    {
      header: 'Impact',
      fieldId: 'customfield_10151',
      width: 24,
      options: fieldOptions['customfield_10151'] || ['Extensive / Widespread', 'Significant / Large', 'Moderate / Limited', 'Minor / Localized'],
    },
    {
      header: 'Geography',
      fieldId: 'customfield_10097',
      width: 18,
      options: fieldOptions['customfield_10097'] || ['India', 'Asia', 'Europe', 'Africa', 'MEA', 'North America', 'LATIN-AMERICA', 'Latam'],
    },
    {
      header: 'Infra_App',
      fieldId: 'customfield_10099',
      width: 16,
      options: fieldOptions['customfield_10099'] || ['Infra', 'App', 'UNKNOWN'],
    },
    {
      header: 'Application',
      fieldId: 'customfield_10085',
      width: 26,
      options: fieldOptions['customfield_10085'] || [],
    },
    {
      header: 'Unit',
      fieldId: 'customfield_10086',
      width: 26,
      options: fieldOptions['customfield_10086'] || [],
    },
    {
      header: 'Classification',
      fieldId: 'customfield_10121',
      width: 22,
    },
    {
      header: 'Sub Classification',
      fieldId: 'customfield_10135',
      width: 22,
    },
    {
      header: 'Urgency',
      fieldId: 'customfield_10122',
      width: 16,
      options: fieldOptions['customfield_10122'] || ['Critical', 'High', 'Medium', 'Low'],
    },
    {
      header: 'Investigation Reason',
      fieldId: 'customfield_10123',
      width: 26,
      options: fieldOptions['customfield_10123'] || ['High impact incident', 'Recurring incident', 'Non-routine incident', 'Other'],
    },
    {
      header: 'Assignee',
      fieldId: 'assignee',
      width: 24,
      note: 'User email, display name, or @me',
    },
    {
      header: 'External Comment',
      fieldId: 'customfield_10101',
      width: 30,
    },
    {
      header: 'Attachment Paths',
      fieldId: 'attachment',
      width: 40,
      note: 'Absolute local file paths separated by ;',
    },
  ];

  const workbook = new ExcelJS.Workbook();
  const dataSheet = workbook.addWorksheet('Problems');
  const lookupSheet = workbook.addWorksheet('_LookupData');

  // Format header row on dataSheet
  const headerRow = dataSheet.addRow(columns.map((c) => c.header));
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF0052CC' }, // Jira Blue
  };
  headerRow.height = 26;

  // Set column widths
  columns.forEach((col, idx) => {
    dataSheet.getColumn(idx + 1).width = col.width;
  });

  // Populate _LookupData sheet with option lists
  // Each option list is stored in its own column:
  const colLetter = (colIdx: number) => {
    let temp = '';
    let letter = '';
    while (colIdx > 0) {
      temp = ((colIdx - 1) % 26) + 65 + '';
      letter = String.fromCharCode(parseInt(temp, 10)) + letter;
      colIdx = Math.floor((colIdx - 1) / 26);
    }
    return letter;
  };

  const validationMap = new Map<number, { colLetter: string; count: number }>();
  let lookupColIndex = 1;

  columns.forEach((col, colIdx) => {
    if (col.options && col.options.length > 0) {
      const letter = colLetter(lookupColIndex);
      // Write header in lookup sheet
      lookupSheet.getCell(`${letter}1`).value = col.header;
      lookupSheet.getCell(`${letter}1`).font = { bold: true };

      // Write values
      col.options.forEach((opt, optIdx) => {
        lookupSheet.getCell(`${letter}${optIdx + 2}`).value = opt;
      });

      validationMap.set(colIdx + 1, {
        colLetter: letter,
        count: col.options.length,
      });

      lookupColIndex++;
    }
  });

  // Add sample row with valid examples
  const sampleRowValues: any[] = [
    'NDCCLOUD',
    'Sample: High memory utilization on database server',
    'Observed persistent high memory usage exceeding 92%.\n- Investigated swap space\n- Recommended pool parameter tuning',
    'High (migrated)',
    'India',
    'DB-SRV-01',
    'NMS',
    'MEMORY UTILIZATION',
    'Moderate / Limited',
    'India',
    'Infra',
    'galera db',
    'NDC-Cloud',
    'Database Issue',
    'Resource Contention',
    'High',
    'Recurring incident',
    '@me',
    'Investigating root cause with DBA team.',
    '',
  ];

  const sampleRow = dataSheet.addRow(sampleRowValues);
  sampleRow.height = 20;

  // Apply data validations to rows 2 to 500 on dataSheet
  for (let r = 2; r <= 500; r++) {
    validationMap.forEach(({ colLetter: lookupCol, count }, targetColIdx) => {
      const cell = dataSheet.getCell(r, targetColIdx);
      cell.dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [`_LookupData!$${lookupCol}$2:$${lookupCol}$${count + 1}`],
        showErrorMessage: true,
        errorTitle: 'Invalid Selection',
        error: 'Please select a valid option from the dropdown list.',
      };
    });
  }

  // Freeze the header row
  dataSheet.views = [{ state: 'frozen', ySplit: 1 }];

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
