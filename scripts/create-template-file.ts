import { generateProblemTemplate } from '../src/lib/excel/template';
import fs from 'node:fs';
import path from 'node:path';

async function main() {
  const buf = await generateProblemTemplate();
  const dest = path.resolve(process.cwd(), 'samples', 'Jira-Problem-Import-Template.xlsx');
  fs.writeFileSync(dest, buf);
  console.log(`Generated template at ${dest} (${buf.length} bytes)`);
}

main().catch(console.error);
