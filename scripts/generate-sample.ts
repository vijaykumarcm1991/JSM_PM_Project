import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';

async function generateSampleFile() {
  const samplesDir = path.resolve(process.cwd(), 'samples');
  if (!fs.existsSync(samplesDir)) {
    fs.mkdirSync(samplesDir, { recursive: true });
  }

  // Create a real sample attachment file so the valid ones work
  const realAttachmentPath = path.join(samplesDir, 'sample-spec.pdf');
  if (!fs.existsSync(realAttachmentPath)) {
    fs.writeFileSync(realAttachmentPath, '%PDF-1.4 Mock sample PDF attachment content for testing.');
  }

  const missingAttachmentPath = path.join(samplesDir, 'non-existent-file-xyz.pdf');

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Tasks');

  ws.columns = [
    { header: 'Summary', key: 'summary', width: 28 },
    { header: 'Description', key: 'description', width: 35 },
    { header: 'Priority', key: 'priority', width: 14 },
    { header: 'Labels', key: 'labels', width: 20 },
    { header: 'Assignee', key: 'assignee', width: 16 },
    { header: 'Due Date', key: 'dueDate', width: 15 },
    { header: 'Attachment Path', key: 'attachmentPath', width: 45 },
  ];

  // 1. Valid row with attachment
  ws.addRow({
    summary: 'Upgrade database server to Postgres 16',
    description: 'Ensure all extensions and pg_dump backups are tested prior to upgrade.\n- Verify storage IOPS\n- Schedule maintenance window',
    priority: 'High',
    labels: 'infrastructure, database',
    assignee: '@me',
    dueDate: '2026-11-15',
    attachmentPath: realAttachmentPath,
  });

  // 2. Valid row without attachment
  ws.addRow({
    summary: 'Update privacy policy on signup modal',
    description: 'Comply with latest GDPR data privacy guidelines.\nUpdate cookie consent banner links.',
    priority: 'Medium',
    labels: 'compliance, legal',
    assignee: '',
    dueDate: '2026-11-20',
    attachmentPath: '',
  });

  // 3. Planted row with MISSING Summary (should be flagged during review)
  ws.addRow({
    summary: '',
    description: 'This row has no summary title and should fail validation.',
    priority: 'Low',
    labels: 'qa, test',
    assignee: '@me',
    dueDate: '2026-11-25',
    attachmentPath: '',
  });

  // 4. Planted row with MISSING attachment file path (should raise an attachment warning in review)
  ws.addRow({
    summary: 'Configure SAML SSO for internal workforce',
    description: 'Connect Okta SAML IdP to Jira Cloud instance.\nReview attribute mappings.',
    priority: 'High',
    labels: 'security, sso',
    assignee: '@me',
    dueDate: '2026-12-01',
    attachmentPath: missingAttachmentPath,
  });

  // 5. Valid row with multiple labels
  ws.addRow({
    summary: 'Implement bulk export to CSV feature',
    description: 'Allow managers to export monthly velocity reports.',
    priority: 'Medium',
    labels: 'reporting, export; analytics',
    assignee: '',
    dueDate: '2026-12-10',
    attachmentPath: '',
  });

  const targetFile = path.join(samplesDir, 'sample-import.xlsx');
  await wb.xlsx.writeFile(targetFile);
  console.log(`Generated sample fixture at: ${targetFile}`);
}

generateSampleFile().catch(console.error);
