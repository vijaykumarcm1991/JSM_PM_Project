'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import {
  Download,
  Upload,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Play,
  RefreshCw,
  ExternalLink,
  FileSpreadsheet,
  Check,
  RotateCcw,
  Clock,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

interface RowProblem {
  rowIndex: number;
  summary: string;
  errors: string[];
  warnings: string[];
  duplicateOf?: { key: string; status: string };
}

interface ValidationSummary {
  total: number;
  readyCount: number;
  invalidCount: number;
  duplicateCount: number;
  attachmentWarningCount: number;
  problems: RowProblem[];
}

export default function SimplifiedImportPage() {
  // Connection state
  const [connection, setConnection] = useState<{
    baseUrl: string;
    email: string;
    hasToken: boolean;
  } | null>(null);

  // File & Upload state
  const [file, setFile] = useState<File | null>(null);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<{
    sheets: string[];
    selectedSheet: string;
    headers: string[];
    rowCount: number;
    previewRows: Array<{ rowIndex: number; values: Record<string, any> }>;
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Validation state
  const [validating, setValidating] = useState(false);
  const [validationSummary, setValidationSummary] = useState<ValidationSummary | null>(null);
  const [duplicatePolicy, setDuplicatePolicy] = useState<'skip' | 'create'>('skip');

  // Run execution state
  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [runProgress, setRunProgress] = useState<{
    status: string;
    total: number;
    completed: number;
    createdCount: number;
    failedCount: number;
    skippedCount: number;
    rows: any[];
  } | null>(null);

  const [showProblems, setShowProblems] = useState(true);

  // Load connection status on mount
  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((data) => setConnection(data))
      .catch(console.error);
  }, []);

  // Standard Problem issue field mappings (maps template column names directly to Jira fields)
  const defaultProblemFields = [
    { fieldId: 'summary', columnName: 'Summary', transform: 'trim' as const },
    { fieldId: 'description', columnName: 'Description', transform: 'none' as const },
    { fieldId: 'priority', columnName: 'Priority', transform: 'none' as const },
    { fieldId: 'customfield_10091', columnName: 'Country', transform: 'none' as const },
    { fieldId: 'customfield_10094', columnName: 'Affected_CI', transform: 'trim' as const },
    { fieldId: 'customfield_10095', columnName: 'Source', transform: 'none' as const },
    { fieldId: 'customfield_10096', columnName: 'Issue_Category', transform: 'none' as const },
    { fieldId: 'customfield_10151', columnName: 'Impact', transform: 'none' as const },
    { fieldId: 'customfield_10097', columnName: 'Geography', transform: 'none' as const },
    { fieldId: 'customfield_10099', columnName: 'Infra_App', transform: 'none' as const },
    { fieldId: 'customfield_10085', columnName: 'Application', transform: 'none' as const },
    { fieldId: 'customfield_10086', columnName: 'Unit', transform: 'none' as const },
    { fieldId: 'customfield_10121', columnName: 'Classification', transform: 'trim' as const },
    { fieldId: 'customfield_10135', columnName: 'Sub Classification', transform: 'trim' as const },
    { fieldId: 'customfield_10122', columnName: 'Urgency', transform: 'none' as const },
    { fieldId: 'customfield_10123', columnName: 'Investigation Reason', transform: 'none' as const },
    { fieldId: 'assignee', columnName: 'Assignee', transform: 'trim' as const },
    { fieldId: 'customfield_10101', columnName: 'External Comment', transform: 'none' as const },
  ];

  // Auto-validate whenever upload succeeds
  async function triggerValidation(uId: string) {
    setValidating(true);
    setValidationSummary(null);

    const config = {
      projectKey: 'NDCCLOUD', // default fallback; row-level 'Project' column overrides per row
      issueTypeId: '10037',   // 'Problem'
      fields: defaultProblemFields,
      attachment: { columnName: 'Attachment Paths' },
    };

    try {
      const res = await fetch('/api/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uploadId: uId,
          config,
          checkDuplicates: true,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setValidationSummary(data);
      } else {
        setUploadError(data.error || 'Validation failed');
      }
    } catch (err: any) {
      setUploadError(err.message || 'Validation error');
    } finally {
      setValidating(false);
    }
  }

  // Handle file upload
  async function handleFileUpload(selectedFile: File) {
    setFile(selectedFile);
    setUploading(true);
    setUploadError(null);
    setRunProgress(null);

    const formData = new FormData();
    formData.append('file', selectedFile);

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Upload failed');
      }
      setUploadId(data.uploadId);
      setUploadResult({
        sheets: data.sheets,
        selectedSheet: data.selectedSheet,
        headers: data.headers,
        rowCount: data.rowCount,
        previewRows: data.previewRows,
      });

      // Automatically trigger dry-run validation immediately!
      await triggerValidation(data.uploadId);
    } catch (err: any) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
    }
  }

  // Handle Submit & Create Jira Issues
  async function handleSubmit() {
    if (!uploadId || !validationSummary) return;
    setRunning(true);
    setUploadError(null);

    const config = {
      projectKey: 'NDCCLOUD',
      issueTypeId: '10037', // 'Problem'
      fields: defaultProblemFields,
      attachment: { columnName: 'Attachment Paths' },
    };

    // Determine skipped row indices based on duplicate policy
    const skippedIndices: number[] = [];
    if (duplicatePolicy === 'skip') {
      for (const p of validationSummary.problems) {
        if (p.duplicateOf) {
          skippedIndices.push(p.rowIndex);
        }
      }
    }

    try {
      const res = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uploadId,
          config,
          projectName: 'Multi-Project',
          issueTypeName: 'Problem',
          duplicatePolicy,
          skippedRowIndices: skippedIndices,
        }),
      });

      const data = await res.json();
      if (res.ok && data.runId) {
        setRunId(data.runId);
        startStreamingRun(data.runId);
      } else {
        throw new Error(data.error || 'Failed to start creation run');
      }
    } catch (err: any) {
      setUploadError(err.message);
      setRunning(false);
    }
  }

  function startStreamingRun(activeRunId: string) {
    const eventSource = new EventSource(`/api/runs/${activeRunId}/stream`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setRunProgress((prev) => {
          const currentRows = prev?.rows || [];
          let updatedRows = [...currentRows];

          if (data.row) {
            const idx = updatedRows.findIndex((r) => r.rowIndex === data.row.rowIndex);
            if (idx >= 0) {
              updatedRows[idx] = data.row;
            } else {
              updatedRows.push(data.row);
            }
          }

          return {
            status: data.type === 'completed' || data.type === 'cancelled' ? data.type : 'running',
            total: data.total || prev?.total || 0,
            completed: data.completed || prev?.completed || 0,
            createdCount: data.createdCount || prev?.createdCount || 0,
            failedCount: data.failedCount || prev?.failedCount || 0,
            skippedCount: data.skippedCount || prev?.skippedCount || 0,
            rows: updatedRows,
          };
        });

        if (data.type === 'completed' || data.type === 'cancelled') {
          eventSource.close();
          setRunning(false);
        }
      } catch (err) {
        console.error('SSE error:', err);
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
      setRunning(false);
    };
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Hero Header */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6 sm:p-8 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 mb-3">
            <ShieldCheck className="w-3.5 h-3.5" /> Jira Cloud REST API v3 • Issue Type: Problem
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">
            Bulk Create Jira Problems from Excel
          </h1>
          <p className="text-sm text-gray-600 mt-1.5 max-w-2xl">
            Upload your spreadsheet to create Jira issues across any project. Each row specifies its own project.
            Dropdown fields, country codes, units, and local file attachments are handled automatically.
          </p>
        </div>

        {/* Download Template Action */}
        <div className="shrink-0 flex flex-col sm:flex-row items-center gap-3 w-full md:w-auto">
          <a
            href="/api/template/problem"
            download
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-bold shadow-md hover:shadow-lg transition transform hover:-translate-y-0.5"
          >
            <Download className="w-4 h-4" /> Download Excel Template (.xlsx)
          </a>
        </div>
      </div>

      {/* Connection Notice */}
      {!connection?.hasToken && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between text-sm text-amber-900">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
            <span>Jira credentials are not configured yet. Please configure your API token in Settings.</span>
          </div>
          <Link href="/settings" className="px-3.5 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-bold hover:bg-amber-700">
            Go to Settings
          </Link>
        </div>
      )}

      {/* Upload & Run Container */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 sm:p-8 space-y-6">
        <div>
          <h2 className="text-lg font-bold text-gray-900">1. Upload Completed Excel Sheet</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Select the filled <code>Jira-Problem-Import-Template.xlsx</code> or any spreadsheet containing <code>Project</code> and <code>Summary</code> columns.
          </p>
        </div>

        {/* Drag & Drop Upload Zone */}
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
              handleFileUpload(e.dataTransfer.files[0]);
            }
          }}
          className="border-2 border-dashed border-gray-300 hover:border-blue-500 rounded-2xl p-8 text-center cursor-pointer transition bg-gray-50/60 hover:bg-blue-50/20"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                handleFileUpload(e.target.files[0]);
              }
            }}
          />

          {uploading ? (
            <div className="flex flex-col items-center">
              <RefreshCw className="w-10 h-10 animate-spin text-blue-600 mb-2" />
              <p className="text-sm font-semibold text-gray-700">Reading and validating workbook...</p>
            </div>
          ) : file ? (
            <div className="flex flex-col items-center">
              <FileSpreadsheet className="w-12 h-12 text-green-600 mb-2" />
              <p className="text-base font-bold text-gray-900">{file.name}</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {(file.size / 1024).toFixed(1)} KB • {uploadResult?.rowCount || 0} rows found • Click to replace
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center">
              <Upload className="w-12 h-12 text-gray-400 mb-2" />
              <p className="text-base font-bold text-gray-800">Drag & drop your Excel file here, or click to browse</p>
              <p className="text-xs text-gray-500 mt-1">Accepts .xlsx, .xls, .csv</p>
            </div>
          )}
        </div>

        {uploadError && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-800 flex items-center gap-2.5">
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
            <span>{uploadError}</span>
          </div>
        )}

        {/* Validation / Dry-Run Overview */}
        {validating && (
          <div className="py-6 flex flex-col items-center text-sm text-gray-600">
            <RefreshCw className="w-6 h-6 animate-spin text-blue-600 mb-2" />
            <span>Validating rows and checking Jira Cloud for duplicate summaries...</span>
          </div>
        )}

        {validationSummary && !validating && (
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-green-50 border border-green-200 rounded-xl p-3.5 text-center">
                <div className="text-xs font-semibold text-green-700 uppercase">Ready to Create</div>
                <div className="text-2xl font-extrabold text-green-900 mt-0.5">{validationSummary.readyCount}</div>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 text-center">
                <div className="text-xs font-semibold text-amber-700 uppercase">Duplicates Detected</div>
                <div className="text-2xl font-extrabold text-amber-900 mt-0.5">{validationSummary.duplicateCount}</div>
              </div>
              <div className="bg-red-50 border border-red-200 rounded-xl p-3.5 text-center">
                <div className="text-xs font-semibold text-red-700 uppercase">Invalid Rows</div>
                <div className="text-2xl font-extrabold text-red-900 mt-0.5">{validationSummary.invalidCount}</div>
              </div>
              <div className="bg-purple-50 border border-purple-200 rounded-xl p-3.5 text-center">
                <div className="text-xs font-semibold text-purple-700 uppercase">Attachment Warnings</div>
                <div className="text-2xl font-extrabold text-purple-900 mt-0.5">{validationSummary.attachmentWarningCount}</div>
              </div>
            </div>

            {/* Duplicate Policy Choice if duplicates detected */}
            {validationSummary.duplicateCount > 0 && (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2 text-amber-900 font-semibold">
                  <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                  <span>{validationSummary.duplicateCount} issues with identical summaries already exist in Jira:</span>
                </div>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-1.5 cursor-pointer font-bold text-amber-950">
                    <input
                      type="radio"
                      name="dupPolicy"
                      checked={duplicatePolicy === 'skip'}
                      onChange={() => setDuplicatePolicy('skip')}
                    />
                    Skip duplicates (Recommended)
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer font-bold text-amber-950">
                    <input
                      type="radio"
                      name="dupPolicy"
                      checked={duplicatePolicy === 'create'}
                      onChange={() => setDuplicatePolicy('create')}
                    />
                    Create anyway
                  </label>
                </div>
              </div>
            )}

            {/* Problem list accordion if issues exist */}
            {validationSummary.problems.length > 0 && (
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowProblems(!showProblems)}
                  className="w-full px-4 py-2.5 bg-gray-50 flex items-center justify-between text-xs font-bold text-gray-700"
                >
                  <span>Validation Details ({validationSummary.problems.length} alerts)</span>
                  {showProblems ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
                {showProblems && (
                  <div className="max-h-56 overflow-y-auto divide-y divide-gray-100 text-xs">
                    {validationSummary.problems.map((p) => (
                      <div key={p.rowIndex} className="p-2.5 flex items-start gap-3 hover:bg-gray-50">
                        <span className="font-mono font-bold text-gray-500 shrink-0">Row #{p.rowIndex}</span>
                        <div className="flex-1 truncate">
                          <span className="font-semibold text-gray-900 mr-2">{p.summary}</span>
                          {p.duplicateOf && (
                            <span className="text-amber-700 font-medium mr-2">
                              [Duplicate of {p.duplicateOf.key} ({p.duplicateOf.status})]
                            </span>
                          )}
                          {p.errors.length > 0 && (
                            <span className="text-red-700 font-medium mr-2">
                              [Error: {p.errors.join(', ')}]
                            </span>
                          )}
                          {p.warnings.length > 0 && (
                            <span className="text-purple-700 font-medium">
                              [Warning: {p.warnings.join(', ')}]
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Big Action Submit Button */}
            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={handleSubmit}
                disabled={running || (duplicatePolicy === 'skip' && validationSummary.readyCount === 0)}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-3.5 bg-green-600 hover:bg-green-700 text-white rounded-xl text-base font-bold shadow-md hover:shadow-lg transition transform hover:-translate-y-0.5 disabled:opacity-50"
              >
                {running ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5" />}
                Submit & Create Jira Issues
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Progress & Live Results Section */}
      {runProgress && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 sm:p-8 shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-extrabold text-gray-900">Creation Run in Progress</h2>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase ${
                    runProgress.status === 'completed'
                      ? 'bg-green-100 text-green-800'
                      : 'bg-blue-100 text-blue-800'
                  }`}
                >
                  {runProgress.status}
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Processed {runProgress.completed} of {runProgress.total} rows • Concurrency: 2 workers
              </p>
            </div>

            {runId && runProgress.status === 'completed' && (
              <div className="flex items-center gap-3">
                <a
                  href={`/api/runs/${runId}/export`}
                  download
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow transition"
                >
                  <Download className="w-3.5 h-3.5" /> Download Results .xlsx
                </a>
                <Link
                  href={`/runs/${runId}`}
                  className="px-3.5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-semibold transition"
                >
                  View Run Details
                </Link>
              </div>
            )}
          </div>

          {/* Progress Bar */}
          <div>
            <div className="flex justify-between text-xs font-bold text-gray-700 mb-1.5">
              <span>Overall Progress</span>
              <span>
                {runProgress.total > 0 ? Math.round((runProgress.completed / runProgress.total) * 100) : 0}%
              </span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-3.5 overflow-hidden flex">
              <div
                className="bg-green-500 h-full transition-all duration-300"
                style={{
                  width: `${runProgress.total > 0 ? (runProgress.createdCount / runProgress.total) * 100 : 0}%`,
                }}
              />
              <div
                className="bg-red-500 h-full transition-all duration-300"
                style={{
                  width: `${runProgress.total > 0 ? (runProgress.failedCount / runProgress.total) * 100 : 0}%`,
                }}
              />
              <div
                className="bg-amber-400 h-full transition-all duration-300"
                style={{
                  width: `${runProgress.total > 0 ? (runProgress.skippedCount / runProgress.total) * 100 : 0}%`,
                }}
              />
            </div>
          </div>

          {/* Live Rows Table */}
          <div className="border border-gray-200 rounded-xl overflow-hidden max-h-80 overflow-y-auto">
            <table className="min-w-full divide-y divide-gray-200 text-xs">
              <thead className="bg-gray-50 text-gray-700 font-semibold sticky top-0">
                <tr>
                  <th className="px-4 py-2.5 text-left w-16">Row</th>
                  <th className="px-4 py-2.5 text-left">Summary</th>
                  <th className="px-4 py-2.5 text-left">Status</th>
                  <th className="px-4 py-2.5 text-left">Jira Issue</th>
                  <th className="px-4 py-2.5 text-left">Attachments</th>
                  <th className="px-4 py-2.5 text-left">Message</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {runProgress.rows.map((r) => (
                  <tr key={r.rowIndex} className="hover:bg-gray-50">
                    <td className="px-4 py-2 font-mono font-bold text-gray-500">#{r.rowIndex}</td>
                    <td className="px-4 py-2 font-medium max-w-xs truncate text-gray-900">{r.summary}</td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {r.status === 'created' ? (
                        <span className="text-green-700 font-bold inline-flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Created
                        </span>
                      ) : r.status === 'failed' ? (
                        <span className="text-red-700 font-bold inline-flex items-center gap-1">
                          <AlertCircle className="w-3.5 h-3.5" /> Failed
                        </span>
                      ) : r.status === 'skipped' ? (
                        <span className="text-amber-700 font-bold inline-flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5" /> Skipped
                        </span>
                      ) : (
                        <span className="text-blue-700 font-bold inline-flex items-center gap-1">
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Pending
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap font-mono font-bold">
                      {r.issueKey ? (
                        <a
                          href={r.issueUrl || '#'}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-600 hover:underline inline-flex items-center gap-1"
                        >
                          {r.issueKey} <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap text-gray-600">
                      {r.attachmentStatus === 'ok' ? (
                        <span className="text-green-700 font-medium">✓ {r.attachedCount} uploaded</span>
                      ) : r.attachmentStatus === 'partial' ? (
                        <span className="text-amber-700 font-medium">⚠️ {r.attachedCount} uploaded</span>
                      ) : r.attachmentStatus === 'failed' ? (
                        <span className="text-red-700 font-medium">✗ Failed</span>
                      ) : (
                        <span className="text-gray-400">None</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-gray-500 max-w-xs truncate">{r.error || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
