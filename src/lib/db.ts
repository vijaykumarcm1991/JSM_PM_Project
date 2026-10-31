import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve(process.cwd(), '.data');
const DB_FILE = path.join(DATA_DIR, 'app.db');

let _db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (_db) {
    return _db;
  }

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const db = new DatabaseSync(DB_FILE);

  // Enable WAL mode
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  // Schema creation
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY,
      base_url TEXT NOT NULL,
      email TEXT NOT NULL,
      token_enc TEXT NOT NULL,
      token_hint TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mapping_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      project_key TEXT NOT NULL,
      issue_type_id TEXT NOT NULL,
      mapping_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS uploads (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      sheet_name TEXT NOT NULL,
      headers_json TEXT NOT NULL,
      rows_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      project_key TEXT NOT NULL,
      project_name TEXT NOT NULL,
      issue_type_id TEXT NOT NULL,
      issue_type_name TEXT NOT NULL,
      source_filename TEXT NOT NULL,
      sheet_name TEXT NOT NULL,
      total INTEGER NOT NULL,
      created_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      attachment_warning_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      parent_run_id TEXT
    );

    CREATE TABLE IF NOT EXISTS run_rows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      row_index INTEGER NOT NULL,
      summary TEXT,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL,
      issue_key TEXT,
      issue_url TEXT,
      error TEXT,
      http_status INTEGER,
      attempts INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      attachment_status TEXT NOT NULL DEFAULT 'none',
      attached_count INTEGER NOT NULL DEFAULT 0,
      attachments_json TEXT NOT NULL DEFAULT '[]',
      attachment_attempts INTEGER NOT NULL DEFAULT 0,
      attachment_error TEXT
    );
  `);

  // On boot, any run still marked 'running' is flipped to 'interrupted'
  db.exec(`
    UPDATE runs
    SET status = 'interrupted', finished_at = datetime('now')
    WHERE status = 'running';
  `);

  _db = db;
  return _db;
}

export interface DbSettings {
  id: number;
  base_url: string;
  email: string;
  token_enc: string;
  token_hint: string;
  updated_at: string;
}

export interface DbMappingProfile {
  id: string;
  name: string;
  project_key: string;
  issue_type_id: string;
  mapping_json: string;
  updated_at: string;
}

export interface DbUpload {
  id: string;
  filename: string;
  sheet_name: string;
  headers_json: string;
  rows_json: string;
  created_at: string;
}

export interface DbRun {
  id: string;
  project_key: string;
  project_name: string;
  issue_type_id: string;
  issue_type_name: string;
  source_filename: string;
  sheet_name: string;
  total: number;
  created_count: number;
  failed_count: number;
  skipped_count: number;
  attachment_warning_count: number;
  status: 'running' | 'completed' | 'cancelled' | 'interrupted';
  started_at: string;
  finished_at: string | null;
  parent_run_id: string | null;
}

export interface DbRunRow {
  id: number;
  run_id: string;
  row_index: number;
  summary: string | null;
  payload_json: string;
  status: 'pending' | 'created' | 'failed' | 'skipped';
  issue_key: string | null;
  issue_url: string | null;
  error: string | null;
  http_status: number | null;
  attempts: number;
  duration_ms: number;
  attachment_status: 'none' | 'ok' | 'partial' | 'failed';
  attached_count: number;
  attachments_json: string;
  attachment_attempts: number;
  attachment_error: string | null;
}
