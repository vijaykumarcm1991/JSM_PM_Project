import { NextRequest, NextResponse } from 'next/server';
import { getDb, DbRun, DbRunRow } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();
    const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as unknown as DbRun | undefined;

    if (!run) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    const rows = db.prepare(
      'SELECT * FROM run_rows WHERE run_id = ? ORDER BY row_index ASC'
    ).all(id) as unknown as DbRunRow[];

    return NextResponse.json({ run, rows });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();
    db.prepare('DELETE FROM run_rows WHERE run_id = ?').run(id);
    db.prepare('DELETE FROM runs WHERE id = ?').run(id);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
