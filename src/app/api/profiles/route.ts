import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { getDb, DbMappingProfile } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const projectKey = searchParams.get('projectKey');
    const issueTypeId = searchParams.get('issueTypeId');

    const db = getDb();
    let query = 'SELECT * FROM mapping_profiles';
    const params: any[] = [];

    if (projectKey && issueTypeId) {
      query += ' WHERE project_key = ? AND issue_type_id = ?';
      params.push(projectKey, issueTypeId);
    } else if (projectKey) {
      query += ' WHERE project_key = ?';
      params.push(projectKey);
    }

    query += ' ORDER BY updated_at DESC';
    const profiles = db.prepare(query).all(...params) as unknown as DbMappingProfile[];

    const result = profiles.map((p) => {
      let mapping = {};
      try {
        mapping = JSON.parse(p.mapping_json);
      } catch {
        // ignore
      }
      return {
        id: p.id,
        name: p.name,
        projectKey: p.project_key,
        issueTypeId: p.issue_type_id,
        mapping,
        updatedAt: p.updated_at,
      };
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, projectKey, issueTypeId, mapping } = body;

    if (!name || !projectKey || !issueTypeId || !mapping) {
      return NextResponse.json(
        { error: 'name, projectKey, issueTypeId, and mapping are required' },
        { status: 400 }
      );
    }

    const db = getDb();
    const id = body.id || crypto.randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT OR REPLACE INTO mapping_profiles (id, name, project_key, issue_type_id, mapping_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, name.trim(), projectKey, issueTypeId, JSON.stringify(mapping), now);

    return NextResponse.json({ id, name, projectKey, issueTypeId, mapping, updatedAt: now });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
