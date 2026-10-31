import { NextRequest, NextResponse } from 'next/server';
import { getDb, DbUpload } from '@/lib/db';
import { getCreatemetaFields } from '@/lib/jira/meta';
import { validateRowsAndDuplicates } from '@/lib/mapping/validate';
import { MappingConfigSchema } from '@/lib/mapping/types';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { uploadId, config: rawConfig, checkDuplicates } = body;

    if (!uploadId) {
      return NextResponse.json({ error: 'uploadId is required' }, { status: 400 });
    }

    const configParse = MappingConfigSchema.safeParse(rawConfig);
    if (!configParse.success) {
      return NextResponse.json(
        { error: 'Invalid mapping configuration', details: configParse.error.format() },
        { status: 400 }
      );
    }
    const config = configParse.data;

    const db = getDb();
    const upload = db.prepare('SELECT * FROM uploads WHERE id = ?').get(uploadId) as unknown as DbUpload | undefined;
    if (!upload) {
      return NextResponse.json({ error: 'Upload not found' }, { status: 404 });
    }

    let rows: Record<number, Record<string, any>> = {};
    try {
      rows = JSON.parse(upload.rows_json);
    } catch {
      return NextResponse.json({ error: 'Failed to parse upload data rows' }, { status: 500 });
    }

    const fieldMetas = await getCreatemetaFields(config.projectKey, config.issueTypeId);
    const summary = await validateRowsAndDuplicates(
      rows,
      config,
      fieldMetas,
      checkDuplicates !== false
    );

    return NextResponse.json(summary);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Validation failed' },
      { status: err.status || 500 }
    );
  }
}
