# Excel → Jira Bulk Creator

A local, single-user web tool for bulk creating issues and streaming local file attachments to **Jira Cloud** (`https://<tenant>.atlassian.net`) directly from Excel workbooks (`.xlsx`, `.xls`, or `.csv`).

---

## Features

- **Dynamic Column Mapping:** Inspects live Jira `createmeta` schema for the chosen project & issue type. No hardcoded fields.
- **Rich Text & Schema Serialization:**
  - Converts multi-line text and bullet points into Atlassian Document Format (ADF) for Jira Cloud API v3.
  - Automatically formats dates (`YYYY-MM-DD`), datetimes (ISO 8601), numbers, options, multi-selects, priority IDs, components, and user account IDs (`@me` or display name/email lookup).
- **Duplicate Detection:** Scans Jira Cloud via JQL before creating issues and flags matching summaries with an option to skip or create anyway.
- **Local File Attachments:** Reads absolute file paths from a spreadsheet column, verifies permissions and sensitive directory denylists, and streams files directly to Jira without buffering.
- **Failure Resilience & No-Duplicate Retries:**
  - Attachment failures keep the issue `created` with a warning.
  - **Retry Attachments:** Re-uploads failed attachments to existing issues without creating duplicate tickets.
  - **Retry Failed:** Spawns a child run containing only failed rows.
- **Result Export:** Exports full outcome report as an Excel workbook (`.xlsx`) matching the original spreadsheet structure with Jira issue keys, URLs, and attachment statuses appended.
- **Secure by Design:**
  - Credentials encrypted at rest via AES-256-GCM in local SQLite (`.data/app.db`).
  - Tokens never transmitted to the browser or logged in error traces.
  - Binds strictly to loopback (`127.0.0.1`).

---

## System Requirements

- **Node.js:** v22+ or v26+
- **npm:** 10+
- **OS:** Windows / macOS / Linux

---

## Getting Started

### 1. Installation

```bash
npm install
```

### 2. Environment Configuration (Optional)

Copy the example environment configuration:

```bash
cp .env.example .env
```

Available environment variables:
- `APP_ENCRYPTION_KEY`: 64-character hex key (32 bytes) for AES-256-GCM. If omitted, the app automatically generates and persists a key to `.data/secret.key`.
- `JIRA_CONCURRENCY`: Concurrency worker pool size (default: `2`).
- `JIRA_MIN_INTERVAL_MS`: Minimum milliseconds between Jira API calls for rate-limit pacing (default: `300`).
- `MAX_ATTACHMENT_MB`: Maximum file size per attachment in MB (default: `20`).
- `MAX_ATTACHMENTS_PER_ROW`: Maximum attachments per row (default: `10`).
- `ALLOW_CUSTOM_JIRA_HOST`: Set to `1` to allow domains other than `*.atlassian.net` (default: `0`).

### 3. Run Development Server

```bash
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000) in your browser.

### 4. Run Production Build

```bash
npm run build
npm start
```

---

## Automated Tests

Run the test suite via Vitest:

```bash
npm test
```

Tests cover:
- ADF converter (paragraphs, hard breaks, lists)
- AES-256-GCM crypto round-trip and tamper detection
- Jira JQL duplicate string escaping
- Excel/CSV parsing and header auto-detection
- Field value serializers (dates, numbers, options, priority, labels)
- Attachment path validation (quotes, UNC, sensitive directories, file sizes, count limits)
- Planted sample fixture verification (`samples/sample-import.xlsx`)

---

## Step-by-Step Usage Guide

1. **Settings:** Navigate to `/settings`, enter your Jira Cloud URL (e.g. `https://mycompany.atlassian.net`), your Atlassian email address, and API token. Click **Test Connection** to confirm connectivity.
2. **Destination:** Choose your target Jira project and issue type.
3. **Source:** Drag and drop your `.xlsx` or `.csv` spreadsheet. Select sheet and confirm header row index.
4. **Mapping:** Map spreadsheet headers to Jira fields or set constant values. Optionally select an **Attachments** column for file paths. You can save or load mapping profiles.
5. **Review:** Inspect dry-run validation results, missing fields, duplicate summary alerts, and attachment warnings. Choose whether to skip duplicates.
6. **Run:** Execute issue creation with live progress streaming (SSE). Download the generated results `.xlsx` or trigger targeted retries.

---

## Troubleshooting

- **401 Unauthorized:** Verify your API token at [id.atlassian.com](https://id.atlassian.com/manage-profile/security/api-tokens) and ensure the email matches your Atlassian account.
- **403 Forbidden:** The account lacks permission to create issues in the selected project or access Jira Cloud REST API.
- **413 Payload Too Large:** A file exceeds your Jira Cloud instance attachment cap (default: 20 MB).
- **Attachments Missing:** Ensure paths in the spreadsheet are absolute (`C:\docs\file.pdf` or `\\server\share\file.pdf`) and accessible by the user running the app.
