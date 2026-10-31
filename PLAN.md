# Excel → Jira Bulk Creator — Implementation Plan

**Status:** Approved design, not yet implemented
**Project root:** `D:\OM_Projects\JSM_PM_Project`
**Created:** 2026-10-31
**Target instance:** Jira Cloud (`https://<tenant>.atlassian.net`)

---

## 1. Goal

A localhost web app that:

1. Accepts an Excel workbook (`.xlsx` / `.xls` / `.csv`).
2. Lets the user map spreadsheet columns onto Jira issue fields through a UI.
3. Creates **one plain Jira issue per row** via the Jira Cloud REST API.
4. Optionally uploads files to each issue, taking the file paths from a spreadsheet column.
5. Reports a per-row **success / failure / skipped** status, in the browser and as a downloadable `.xlsx`.
6. Lets the user retry only the rows (or only the attachments) that failed, without creating duplicates.

### Confirmed decisions

| Decision | Choice |
|---|---|
| Issue creation API | Plain Jira issues — `POST /rest/api/3/issue` (not JSM portal requests) |
| Column mapping | Dynamic mapping UI, driven by live `createmeta` |
| Credentials | Settings page, encrypted at rest in SQLite |
| Stack | Next.js 16 + TypeScript + SQLite |
| Duplicate handling | Warn during review, then user chooses skip or create |
| Results delivery | In-app table **and** Excel export |
| App authentication | None; loopback-only single-user tool |
| Attachment source | Local file paths listed in a spreadsheet column |
| Attachment failure | Row stays `created` with a warning; retry attachments only |
| Attachment limits | 20 MB per file, 10 files per row |
| Attachment requirement | Optional, informational only |

### Environment verified on this machine

| Check | Result |
|---|---|
| Node | v26.7.0 |
| npm | 11.19.0 |
| Bun | not installed → use npm |
| `node:sqlite` (`DatabaseSync`) | works → avoids native module builds |
| `fs.openAsBlob` | works, streamed a 103 MB file without buffering |
| Native `FormData` / `File` | available → no multipart library needed |
| Latest packages | next 16.4.3, react 19.3.1, exceljs 4.4.0, zod 4.6.7 |

Because this is an IT-managed laptop, avoiding native compilation (`better-sqlite3`, Prisma engine binaries) is deliberate: `node:sqlite` is a Node built-in.

---

## 2. Stack

| Concern | Choice | Notes |
|---|---|---|
| Framework | Next.js 16.4.3, App Router, Turbopack | Route handlers run on the Node runtime |
| UI runtime | React 19.3.1 | |
| Language | TypeScript, `strict: true` | |
| Validation | zod 4.6.7 | Shared between API routes and client forms |
| Styling | Tailwind v4 | |
| Components | shadcn/ui primitives: button, input, select, combobox, table, badge, dialog, progress, toast, alert | |
| Database | `node:sqlite` → `.data/app.db` | WAL mode, schema created on boot |
| Excel | `exceljs` 4.4.0 | Single library for parse **and** result export |
| Attachments | none | `fs.openAsBlob` + `FormData` + `fetch` |
| Tests | `vitest` | Unit tests for pure lib modules |

`next.config.ts` sets `serverExternalPackages: ['exceljs']` so Exceljs is not bundled into the build output.

Everything that touches Jira runs server-side. The API token never reaches the browser.

---

## 3. Jira integration

### 3.1 Authentication

HTTP Basic with `email:apiToken`, base64-encoded, on every request:

```
Authorization: Basic base64(email + ":" + apiToken)
Accept: application/json
```

Credentials come from the `settings` table (encrypted) via `src/lib/settings.ts`.

### 3.2 Endpoints used

| Purpose | Endpoint |
|---|---|
| Connection test | `GET /rest/api/3/myself` |
| Project list | `GET /rest/api/3/project/search?maxResults=100` (paginate with `startAt`/`isLast`) |
| Issue types creatable in project | `GET /rest/api/3/issue/createmeta/{projectKey}/issuetypes` |
| Field metadata | `GET /rest/api/3/issue/createmeta/{projectKey}/issuetypes/{issueTypeId}?startAt=&maxResults=50` |
| Create issue | `POST /rest/api/3/issue` |
| Upload attachments | `POST /rest/api/3/issue/{issueKey}/attachments` |
| Duplicate check | `POST /rest/api/3/search/jql` |
| Resolve assignee/reporter | `GET /rest/api/3/user/picker?query=` |

`createmeta` returns each field's `required` flag, `schema.type` / `schema.custom`, `allowedValues`, and `hasDefaultValue`. That metadata is the single source of truth for the mapping UI and for value serialization — no hardcoded field lists.

### 3.3 Attachment upload specifics

- Must be `multipart/form-data`.
- Must include the header `X-Atlassian-Token: no-check`; Jira Cloud rejects multipart requests without it (XSRF protection).
- The file part must be named `file`. Jira accepts several `file` parts in one request, so the client sends up to **5 files per request**. If that request fails, it retries the same files **one per request** so the error can be attributed to a specific file.
- Response is an array of `{ id, filename, size, mimeType, content }`.

### 3.4 Client wrapper — `src/lib/jira/client.ts`

Responsibilities:

- Injects auth headers; never logs the token (redacts `Authorization` on error dumps).
- **Retry policy:** `429` → wait per `Retry-After` (fallback 2s, exponential); `5xx` / network error → exponential backoff; max 3 attempts.
- **Pacing:** minimum interval between requests (`JIRA_MIN_INTERVAL_MS`, default `300`), enforced process-wide by a simple async mutex.
- **Concurrency:** worker pool size `JIRA_CONCURRENCY`, default `2`.
- **Error normalization:**
  - `400` → join `errorMessages[]` plus `errors{field: message}` into one readable sentence; keep the raw JSON on the row for debugging.
  - `401` → fatal, abort the run ("Authentication failed — check the API token in Settings").
  - `403` → fatal, abort ("The account lacks permission to create issues in this project").
  - `404` → fatal, abort ("Project or issue type no longer exists").
  - `413` → per-file, "attachment too large for this Jira instance".
  - Other `4xx` → per-row failure, keep going.

### 3.5 Field value serialization — `src/lib/mapping/build.ts`

Driven by `schema.type` and `schema.custom` from `createmeta`:

| Jira schema | Excel input | Payload value |
|---|---|---|
| `string` | any cell | trimmed string |
| `number` | numeric cell | `Number(value)`; row error if `NaN` |
| `date` | `Date`, Excel serial, or text | `YYYY-MM-DD` |
| `datetime` | `Date` or text | ISO 8601 with offset |
| `option` (custom select) | text | `{ value }` if `allowedValues` entries expose `value`, else `{ id }` resolved case-insensitively |
| `array` + `items: string` (labels) | text | split on `,` `;` newline → `string[]`, deduped |
| `array` + `items: option` (multi-select) | text | `[{ value }]`, each resolved against `allowedValues` |
| `user` (assignee, reporter) | email, display name, or `@me` | `{ accountId }` via cached `/user/picker` lookup |
| `priority` | name or id | `{ id }` matched from `allowedValues` |
| `component` / `version` | name or id | `{ id }` or `[{ name }]` |
| `description` | multi-line text | **ADF document** (see below) |
| anything unknown | text | passthrough string |

Rules:

- Blank cell → field omitted from the payload.
- Blank **required** field with `hasDefaultValue: false` → row-level validation error. Never a silent create.
- `project` and `issuetype` are fixed by the run configuration (`{ key }`, `{ id }`).

### 3.6 Description → ADF — `src/lib/adf.ts`

API v3 rejects plain strings for `description`, so text is converted to Atlassian Document Format:

- Split on newlines; each non-empty run of lines becomes a `paragraph` with `hardBreak` nodes between them.
- Lines starting with `- ` or `• ` become a `bulletList` with `listItem` / `paragraph` children.
- Blank lines close the current block.
- Everything is emitted with `type: "text"` nodes — no HTML is interpreted, which also removes an injection surface.

---

## 4. Attachments from local file paths

### 4.1 Why paths

Jira has no attachment field in `createmeta`; files are uploaded **after** the issue exists, against its key. Excel cannot carry arbitrary binary files inline (only embedded images via `xl/media`, and OLE objects via `xl/embeddings`, which no JS library exposes cleanly). So for PDFs, logs, screenshots, and documents, the source is a spreadsheet column holding filesystem paths.

### 4.2 Input format

One Excel column is mapped in a dedicated **Attachments** card in the mapping step — it is not a Jira field.

- A cell may list one or more paths, separated by `;` or newlines.
- Surrounding straight or curly quotes are trimmed: `"C:\Scans\page 1.pdf"; D:\Docs\invoice.pdf`
- Drive letters are safe because the separator is `;`, not `:`.
- Paths are shown in the results table as plain text (never as clickable links).

### 4.3 Resolution rules — `src/lib/attachments/resolve.ts`

For every candidate path:

1. Trim whitespace and wrapping quotes.
2. Reject if not absolute (`path.isAbsolute`); UNC paths (`\\server\share\...`) are accepted.
3. `fs.realpath` to resolve symlinks and junctions.
4. `fs.stat` → must exist and be a **regular file**; directories, devices, and pipes are rejected.
5. Size check: > `MAX_ATTACHMENT_MB` (default 20) → rejected with its size in the message.
6. Per-row count check: more than `MAX_ATTACHMENTS_PER_ROW` (default 10) → the first 10 are kept, the rest reported as skipped.
7. Sensitive-location denylist — a hostile spreadsheet should not be able to push credentials into Jira: `\.ssh\`, `\.aws\`, `\.kube\`, `\.env`, `id_rsa`, `AppData\Roaming\Microsoft\Credentials`. Matches are rejected with an explicit message.
8. MIME type inferred from extension (`.pdf .png .jpg .jpeg .gif .docx .doc .xlsx .xls .csv .txt .log .zip .msg .eml`), fallback `application/octet-stream`.
9. Windows long paths: if the absolute path exceeds 259 characters, prefix with `\\?\` before opening.

All of this runs during the **Review** step too, so missing or oversized files are reported before any issue is created.

### 4.4 Upload — `src/lib/attachments/upload.ts`

```ts
const blob = await fs.openAsBlob(resolvedPath, { type: mime });
const form = new FormData();
form.append('file', blob, basename(resolvedPath));
await client.post(`/rest/api/3/issue/${issueKey}/attachments`, form, {
  headers: { 'X-Atlassian-Token': 'no-check' },
});
```

Files stream from disk; nothing is buffered in memory. The upload happens inside the same worker task immediately after the issue is created, so concurrency stays bounded by `JIRA_CONCURRENCY`.

### 4.5 Failure semantics

An attachment failure **never** marks the row failed and **never** triggers an issue recreate — that is the duplicate-creation trap this design avoids.

Per-row attachment state:

| Column | Meaning |
|---|---|
| `attachment_status` | `none` (no paths), `ok` (all uploaded), `partial` (some failed), `failed` (all failed) |
| `attached_count` | files successfully attached |
| `attachments_json` | resolved paths, per-file status, Jira attachment id |
| `attachment_attempts` | number of upload passes |
| `attachment_error` | joined error text |

A row with `status = created` and `attachment_status in (partial, failed)` exposes a **Retry attachments** action that re-uploads only those files for the existing key.

---

## 5. Data model (SQLite)

Created by `src/lib/db.ts` on first boot (`CREATE TABLE IF NOT EXISTS`), `PRAGMA journal_mode = WAL`.

### `settings`

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | always `1` |
| `base_url` | TEXT | e.g. `https://tenant.atlassian.net` |
| `email` | TEXT | Atlassian account email |
| `token_enc` | TEXT | base64 of `iv \|\| tag \|\| ciphertext` |
| `token_hint` | TEXT | last 4 characters only, for display |
| `updated_at` | TEXT | ISO timestamp |

### `mapping_profiles`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | uuid |
| `name` | TEXT | user-facing label |
| `project_key` | TEXT | |
| `issue_type_id` | TEXT | |
| `mapping_json` | TEXT | field mappings + attachment column + transforms |
| `updated_at` | TEXT | |

### `uploads`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | uuid |
| `filename` | TEXT | sanitized original name |
| `sheet_name` | TEXT | |
| `headers_json` | TEXT | column names in order |
| `rows_json` | TEXT | parsed rows, keyed by Excel row number |
| `created_at` | TEXT | |

Storing the parsed snapshot means a run, a retry, or an attachment retry never needs the original file again — and survives an app restart.

### `runs`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | uuid |
| `project_key`, `project_name` | TEXT | |
| `issue_type_id`, `issue_type_name` | TEXT | |
| `source_filename`, `sheet_name` | TEXT | |
| `total` | INTEGER | rows in scope |
| `created_count`, `failed_count`, `skipped_count` | INTEGER | |
| `attachment_warning_count` | INTEGER | |
| `status` | TEXT | `running` / `completed` / `cancelled` / `interrupted` |
| `started_at`, `finished_at` | TEXT | |
| `parent_run_id` | TEXT NULL | set when a run was spawned by "Retry failed" |

### `run_rows`

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `run_id` | TEXT FK | |
| `row_index` | INTEGER | **real Excel row number**, so the user can find it in the sheet |
| `summary` | TEXT | for quick scanning |
| `payload_json` | TEXT | the exact `fields` object sent, for audit/debug |
| `status` | TEXT | `pending` / `created` / `failed` / `skipped` |
| `issue_key`, `issue_url` | TEXT NULL | |
| `error` | TEXT NULL | human-readable |
| `http_status` | INTEGER NULL | |
| `attempts` | INTEGER | |
| `duration_ms` | INTEGER | |
| `attachment_status` | TEXT | `none` / `ok` / `partial` / `failed` |
| `attached_count` | INTEGER | |
| `attachments_json` | TEXT | |
| `attachment_attempts` | INTEGER | |
| `attachment_error` | TEXT NULL | |

On boot, any run still marked `running` is flipped to `interrupted` so the UI never shows a zombie job.

---

## 6. Pages

| Route | Purpose |
|---|---|
| `/` | Import wizard (6 steps, client-side state) |
| `/runs` | Run history: project, counts, attachment warnings, duration, status |
| `/runs/[id]` | Result table with filters (all / created / failed / skipped / attachment warnings), export and retry actions |
| `/settings` | Base URL, email, API token, "Test connection", encryption key status |

### Wizard steps

1. **Connection** — shows masked credentials (`hasToken`, last 4 chars) and a "Test connection" button that calls `/myself` and displays the account's display name.
2. **Destination** — searchable project select, then issue type select populated from `createmeta`.
3. **Source** — drag-and-drop zone → sheet picker → header-row picker (auto-detected as the first non-empty row, overridable) → preview of the first 8 rows.
4. **Mapping** — one row per Jira field, required fields first, then standard, then custom:
   - Excel column dropdown (blank = not mapped)
   - Constant-value input for fields not present in the sheet (e.g. a fixed reporter)
   - Transform: `none` / `trim` / `uppercase` / `lowercase` / `split-list` / `date-normalize`
   - Required-and-unmapped fields block "Next"
   - Header names are auto-matched against Jira field names, always editable
   - **Attachments card** below the grid: column picker, separator hint, and the active size/count limits
   - Save / load as a named mapping profile
5. **Review** — dry run with no writes:
   - Counts: ready / invalid / duplicates / attachment warnings
   - Per-row problem list keyed by Excel row number
   - Duplicate policy toggle: `skip duplicates` (default) or `create anyway`
   - Attachment problems are warnings only, since attachments are optional
6. **Run** — progress bar, live row table via SSE, cancel button. On completion: summary, **Download results .xlsx**, **Retry failed**, **Retry attachments**.

---

## 7. API routes

All under `src/app/api/`, all Node runtime (`export const runtime = 'nodejs'`).

| Route | Methods | Purpose |
|---|---|---|
| `/api/settings` | GET, PUT | GET returns `{ baseUrl, email, hasToken, tokenHint }` only; PUT encrypts and stores the token |
| `/api/settings/test` | POST | Calls `/myself`, returns account name plus latency |
| `/api/jira/projects` | GET | Cached project list |
| `/api/jira/issuetypes` | GET | Cached creatable issue types for a project |
| `/api/jira/fields` | GET | `createmeta` for project + issue type, normalized (name, id, required, schema, allowedValues) |
| `/api/jira/users` | GET | User picker proxy for assignee/reporter autocomplete |
| `/api/upload` | POST | Multipart workbook → parsed `{ uploadId, sheets, headers, previewRows, rowCount }` |
| `/api/profiles` | GET, POST | List / create mapping profiles |
| `/api/profiles/[id]` | DELETE | Remove a profile |
| `/api/validate` | POST | Dry run: validation results + duplicate scan + attachment resolution summary |
| `/api/runs` | POST | Create and start a run |
| `/api/runs/[id]` | GET, DELETE | Run + rows; DELETE removes history |
| `/api/runs/[id]/stream` | GET | Server-Sent Events progress stream |
| `/api/runs/[id]/export` | GET | Generated `.xlsx` of results |
| `/api/runs/[id]/retry` | POST | Body `{ mode: "failed" \| "attachments" }` |

### Run engine — `src/lib/runs/engine.ts`

- Reads `run_rows` with `status = 'pending'`, drives a pool of `JIRA_CONCURRENCY` workers.
- Per task:
  1. Build the `fields` payload from the stored spreadsheet row + mapping.
  2. `POST /issue` → store key, URL, `status = created` (or `failed` + error).
  3. If the row lists attachment paths: resolve, upload in batches of 5, store attachment outcome.
  4. Emit a progress event; persist immediately, so a crash never loses completed work.
- Cancellation sets a flag checked between tasks.
- Progress is broadcast on a per-run `EventEmitter` (`src/lib/runs/events.ts`) consumed by the SSE route. Single-process, so an in-memory emitter is sufficient.
- **Retry failed** creates a child run containing only the failed rows (`parent_run_id` set) and links back in the UI.
- **Retry attachments** mutates the existing rows in place — it never creates issues.

### Duplicate detection — `src/lib/mapping/validate.ts`

- Collect candidate summaries, chunk ~20 per request.
- `POST /rest/api/3/search/jql` with `jql: project = "KEY" AND summary in ("a","b",…)`, `fields: ["summary","status"]`.
- Escape `"` and `\` inside summaries.
- Match case-insensitively on trimmed text; flag matched rows with the existing issue key.

### Result export — `src/lib/excel/export.ts`

Original columns, plus:

`Import Status`, `Jira Key`, `Jira URL`, `Error`, `Attachments Found`, `Attached`, `Attachment Status`, `Attachment Error`, `Source Row`

Appended to the right of the original data, one row per source row, so the file diffs cleanly against the input.

---

## 8. Security

| Concern | Mitigation |
|---|---|
| Token at rest | AES-256-GCM; key from `APP_ENCRYPTION_KEY` (64 hex chars) or generated once into `.data/secret.key` with a startup warning |
| Token in transit to browser | Never sent; GET returns only `tokenHint` and `hasToken` |
| Token in logs | `Authorization` redacted on every error path |
| SSRF via base URL | HTTPS only, host must match `*.atlassian.net` unless `ALLOW_CUSTOM_JIRA_HOST=1` |
| Network exposure | Dev/start bound to `127.0.0.1`; README states it is a single-user local tool |
| Hostile spreadsheet reading local files | Absolute paths only, `realpath`, regular files only, size/count caps, credential-directory denylist |
| HTML/CSV injection in UI/export | Cell values rendered as text; export cells written as strings, never formulas |
| Workbook abuse | 10 MB file cap, 5,000 rows/sheet cap, sheet/header bounds checks |
| Repo hygiene | `.gitignore` covers `.data/`, `.env*`, `*.db` |

---

## 9. File layout

```
PLAN.md                        this document
README.md                      setup, usage, troubleshooting
.env.example                   APP_ENCRYPTION_KEY, JIRA_CONCURRENCY, JIRA_MIN_INTERVAL_MS,
                               MAX_ATTACHMENT_MB, MAX_ATTACHMENTS_PER_ROW, ALLOW_CUSTOM_JIRA_HOST
next.config.ts                 serverExternalPackages: ['exceljs']
tsconfig.json
package.json

src/app/
  layout.tsx                   shell + nav
  page.tsx                     import wizard
  runs/page.tsx
  runs/[id]/page.tsx
  settings/page.tsx
  api/…                        routes from section 7

src/lib/
  db.ts                        node:sqlite init, schema, typed query helpers
  crypto.ts                    seal/open (AES-256-GCM), key resolution
  settings.ts                  credential load/save, redaction
  jira/client.ts               auth, retry, pacing, error normalization
  jira/meta.ts                 projects, issue types, createmeta fields, users (TTL cache)
  jira/issues.ts               createIssue, searchSummaries
  adf.ts                       plain text → ADF
  excel/parse.ts               workbook → sheets, headers, rows (string / Date / numeric cells)
  excel/export.ts              results → xlsx
  mapping/types.ts             zod schemas for mapping config
  mapping/build.ts             row + mapping → { fields, errors }
  mapping/validate.ts          required fields, allowed values, duplicates
  attachments/resolve.ts       path parsing, realpath, size/count/denylist checks
  attachments/upload.ts        openAsBlob → FormData → attachment endpoint
  runs/engine.ts               worker pool, cancel, retry modes
  runs/events.ts               per-run progress emitter

src/components/                wizard steps, mapping grid, attachment card,
                               results table, status badge, export button

tests/                         adf, build, validate, crypto, parse, resolve-paths
samples/sample-import.xlsx     generated fixture: 5 rows,
                               1 missing Summary, 1 with a missing attachment path
```

---

## 10. Build order

| Phase | Scope | Done when |
|---|---|---|
| 1. Scaffold | `create-next-app` (TS, Tailwind, App Router), shadcn init, deps, env example, gitignore, nav shell | `npm run build` passes on the empty page |
| 2. Persistence + crypto | `db.ts`, `crypto.ts`, `settings.ts`, settings page, `/api/settings/test` | Save token → restart app → `/myself` still succeeds |
| 3. Jira metadata | `client.ts`, `meta.ts`, project/issue-type/field/user routes with cache | Dropdowns populate from the real instance; field list matches Jira's create screen |
| 4. Excel + mapping | `parse.ts`, `/api/upload`, mapping grid, profiles, `build.ts`, `validate.ts`, review step | Dry run flags exactly the planted bad row and nothing else |
| 5. Create + report | create route, `engine.ts`, SSE, results page, `export.ts`, retry-failed | Issues created with correct values; export matches the sheet |
| 6. Attachments | `resolve.ts`, `upload.ts`, attachment card, two-phase run, retry-attachments, export columns | Real files attach; retrying attachments creates no duplicate issues |
| 7. Polish | empty/error states, README, `npm test`, `npm run build`, `npm run lint` | All checks clean |

---

## 11. Verification

### Automated

`npm test` covers:

- **ADF:** paragraphs, hard breaks, bullet lists, empty input.
- **Serializers:** each schema type, including `Date` vs Excel serial vs text, option name-vs-id resolution, label splitting and dedupe, `@me` user resolution, `NaN` number rejection.
- **Validation:** required-field detection, `allowedValues` membership, blank-cell omission.
- **Duplicates:** JQL escaping of quotes/backslashes, chunking at ~20, case-insensitive matching.
- **Crypto:** seal → open round trip, tampered ciphertext rejected, missing key error.
- **Excel parse:** string cells, `Date` cells, numeric cells, empty trailing rows, header auto-detection.
- **Path resolver:** quoted paths, `;` and newline splitting, relative path rejected, directory rejected, oversize rejected, over-count truncated, UNC accepted, denylisted path rejected, long path prefixed.

`npm run build` and `npm run lint` must be clean.

### Manual end-to-end (real Jira Cloud project)

1. Settings → enter base URL, email, API token → Test connection shows your display name.
2. Choose project and issue type; confirm the field list matches Jira's create screen.
3. Upload `samples/sample-import.xlsx` (Summary, Description, Priority, Labels, Assignee, Due Date, Attachment Path).
4. Review flags exactly: the row with no Summary, and the row whose attachment path does not exist.
5. Run → 4 issues created.
6. Open each key: summary correct, description renders as paragraphs, priority set, labels split, assignee resolved, due date correct.
7. Attachments panel shows the referenced file for rows that had a valid path.
8. Download results `.xlsx`; verify status, key, URL, and attachment columns.
9. Fix the missing file, use **Retry attachments** on that row — confirm the file appears and **no new issue** is created.
10. Re-run the same workbook: 4 rows flagged as duplicates; choosing "skip" creates nothing.
11. Run a row with 10 files near 19 MB: completes without memory growth, reports per-file outcomes.

---

## 12. Out of scope for v1

- Images embedded in spreadsheet cells (`xl/media`) as an attachment source.
- URL-based attachments and ZIP sidecar bundles.
- Attaching files to `skipped` rows.
- Issue links, subtasks, epics, parent linking.
- Updating existing issues.
- JSM portal requests / request types.
- Scheduled or automated runs.
- Multi-user accounts and role separation.
- Multi-sheet runs in a single job.

The mapping and attachment layers are structured so the first three slot in without redesign: `attachments/resolve.ts` returns a normalized file list that any source (embedded image, URL, ZIP entry) can produce.

---

## 13. Known risks

| Risk | Mitigation |
|---|---|
| Next 16 does not officially list Node 26 as supported | If the build trips, switch to Node 22 LTS; no code changes required |
| Windows `MAX_PATH` (~259 chars) | Prefix `\\?\` in the resolver; buffered fallback for files under 20 MB |
| File held open by Excel/Word | Read usually succeeds under share modes; a hard lock surfaces the OS error on that row |
| UNC paths add latency inside a 2-wide pool | Tune `JIRA_CONCURRENCY` / `JIRA_MIN_INTERVAL_MS` |
| `createmeta` `allowedValues` truncated for huge option lists | Fall back to name matching at create time and surface Jira's own error |
| Exceljs returns `Date` or serial numbers for date cells | Date normalizer handles both |
| Jira instance attachment limit lower than 20 MB | `413` handled per file, reported as an attachment warning |
| Rate limiting on large workbooks (5,000 rows + attachments) | Pacing + backoff + resumable runs (completed rows persist) |

---

## 14. Open items for implementation

None blocking. Two defaults to confirm at runtime rather than in code:

- `APP_ENCRYPTION_KEY` — if absent, a key file is generated at `.data/secret.key` and a warning is logged. Set the env var if the DB may be backed up separately from the key.
- Concurrency — `2` is conservative for Jira Cloud. Raise via env only if runs feel slow and no `429`s appear.
