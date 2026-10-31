'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  CheckCircle2,
  AlertCircle,
  Upload,
  ArrowRight,
  ArrowLeft,
  FileSpreadsheet,
  Check,
  RotateCcw,
  RefreshCw,
  ExternalLink,
  Save,
  Download,
  AlertTriangle,
  FolderOpen,
  Paperclip,
  Play,
  KeyRound,
  X,
  FileText,
} from 'lucide-react';
import { JiraProject, JiraIssueType, JiraFieldMeta } from '@/lib/jira/meta';
import { FieldMapping, MappingConfig } from '@/lib/mapping/types';

export default function ImportWizardPage() {
  const router = useRouter();

  // Wizard state: 1 to 6
  const [step, setStep] = useState<number>(1);

  // Step 1: Connection
  const [connection, setConnection] = useState<{
    baseUrl: string;
    email: string;
    hasToken: boolean;
    tokenHint: string;
  } | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    displayName?: string;
    accountId?: string;
    message?: string;
  } | null>(null);

  // Step 2: Destination
  const [projects, setProjects] = useState<JiraProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<JiraProject | null>(null);
  const [issueTypes, setIssueTypes] = useState<JiraIssueType[]>([]);
  const [selectedIssueType, setSelectedIssueType] = useState<JiraIssueType | null>(null);
  const [loadingDest, setLoadingDest] = useState(false);

  // Step 3: Source (Spreadsheet)
  const [file, setFile] = useState<File | null>(null);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<{
    sheets: string[];
    selectedSheet: string;
    headerRowIndex: number;
    headers: string[];
    rowCount: number;
    previewRows: Array<{ rowIndex: number; values: Record<string, any> }>;
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Step 4: Mapping
  const [fieldMetas, setFieldMetas] = useState<JiraFieldMeta[]>([]);
  const [fieldMappings, setFieldMappings] = useState<Record<string, FieldMapping>>({});
  const [attachmentColumn, setAttachmentColumn] = useState<string>('');
  const [loadingFields, setLoadingFields] = useState(false);
  const [savedProfiles, setSavedProfiles] = useState<any[]>([]);
  const [profileName, setProfileName] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  // Step 5: Review
  const [validating, setValidating] = useState(false);
  const [validationSummary, setValidationSummary] = useState<{
    total: number;
    readyCount: number;
    invalidCount: number;
    duplicateCount: number;
    attachmentWarningCount: number;
    problems: any[];
  } | null>(null);
  const [duplicatePolicy, setDuplicatePolicy] = useState<'skip' | 'create'>('skip');

  // Step 6: Run
  const [runId, setRunId] = useState<string | null>(null);
  const [startingRun, setStartingRun] = useState(false);
  const [runProgress, setRunProgress] = useState<{
    status: string;
    total: number;
    completed: number;
    createdCount: number;
    failedCount: number;
    skippedCount: number;
    rows: any[];
  } | null>(null);

  // Load connection status on mount
  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((data) => {
        setConnection(data);
        if (data.hasToken) {
          testConn();
        }
      })
      .catch(console.error);
  }, []);

  async function testConn() {
    setTestingConnection(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/settings/test', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setTestResult({
          success: true,
          displayName: data.displayName,
          accountId: data.accountId,
        });
      } else {
        setTestResult({
          success: false,
          message: data.error || 'Connection failed',
        });
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err.message,
      });
    } finally {
      setTestingConnection(false);
    }
  }

  // Load projects when entering Step 2
  useEffect(() => {
    if (step === 2 && projects.length === 0) {
      setLoadingDest(true);
      fetch('/api/jira/projects')
        .then((r) => r.json())
        .then((data) => {
          if (Array.isArray(data)) setProjects(data);
        })
        .finally(() => setLoadingDest(false));
    }
  }, [step]);

  // Load issue types when project changes
  useEffect(() => {
    if (selectedProject) {
      fetch(`/api/jira/issuetypes?projectKey=${encodeURIComponent(selectedProject.key)}`)
        .then((r) => r.json())
        .then((data) => {
          if (Array.isArray(data)) {
            setIssueTypes(data);
            setSelectedIssueType(data[0] || null);
          }
        });
    } else {
      setIssueTypes([]);
      setSelectedIssueType(null);
    }
  }, [selectedProject]);

  // Handle file drop/selection
  async function handleFileUpload(selectedFile: File) {
    setFile(selectedFile);
    setUploading(true);
    setUploadError(null);

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
        headerRowIndex: data.headerRowIndex,
        headers: data.headers,
        rowCount: data.rowCount,
        previewRows: data.previewRows,
      });
    } catch (err: any) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
    }
  }

  // Handle re-parsing on sheet or header change
  async function handleReparse(sheetName: string, headerRowIndex: number) {
    if (!file) return;
    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    if (uploadId) formData.append('uploadId', uploadId);
    formData.append('sheetName', sheetName);
    formData.append('headerRowIndex', String(headerRowIndex));

    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (res.ok) {
        setUploadResult({
          sheets: data.sheets,
          selectedSheet: data.selectedSheet,
          headerRowIndex: data.headerRowIndex,
          headers: data.headers,
          rowCount: data.rowCount,
          previewRows: data.previewRows,
        });
      }
    } finally {
      setUploading(false);
    }
  }

  // Load field metadata and profiles on step 4
  useEffect(() => {
    if (step === 4 && selectedProject && selectedIssueType) {
      setLoadingFields(true);
      Promise.all([
        fetch(
          `/api/jira/fields?projectKey=${selectedProject.key}&issueTypeId=${selectedIssueType.id}`
        ).then((r) => r.json()),
        fetch(
          `/api/profiles?projectKey=${selectedProject.key}&issueTypeId=${selectedIssueType.id}`
        ).then((r) => r.json()),
      ])
        .then(([fieldsData, profilesData]) => {
          if (Array.isArray(fieldsData)) {
            setFieldMetas(fieldsData);

            // Auto-match headers to Jira fields
            const headers = uploadResult?.headers || [];
            const initialMap: Record<string, FieldMapping> = {};

            for (const f of fieldsData) {
              const matchedHeader = headers.find((h) => {
                const cleanH = h.toLowerCase().replace(/[^a-z0-9]/g, '');
                const cleanF = f.name.toLowerCase().replace(/[^a-z0-9]/g, '');
                return cleanH === cleanF || cleanH.includes(cleanF) || cleanF.includes(cleanH);
              });

              initialMap[f.id] = {
                fieldId: f.id,
                columnName: matchedHeader || null,
                constantValue: null,
                transform: f.schema?.type === 'date' ? 'date-normalize' : 'trim',
              };
            }
            setFieldMappings(initialMap);

            // Check if any column is an attachment path
            const attHeader = headers.find((h) =>
              /attachment|filepath|path|file/i.test(h)
            );
            if (attHeader) {
              setAttachmentColumn(attHeader);
            }
          }

          if (Array.isArray(profilesData)) {
            setSavedProfiles(profilesData);
          }
        })
        .finally(() => setLoadingFields(false));
    }
  }, [step, selectedProject, selectedIssueType]);

  // Execute review validation on step 5
  useEffect(() => {
    if (step === 5 && uploadId && selectedProject && selectedIssueType) {
      runReviewValidation();
    }
  }, [step]);

  async function runReviewValidation() {
    setValidating(true);
    setValidationSummary(null);

    const config: MappingConfig = {
      projectKey: selectedProject!.key,
      issueTypeId: selectedIssueType!.id,
      fields: Object.values(fieldMappings).filter((m) => m.columnName || m.constantValue),
      attachment: { columnName: attachmentColumn || null },
    };

    try {
      const res = await fetch('/api/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uploadId,
          config,
          checkDuplicates: true,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setValidationSummary(data);
      } else {
        alert(data.error || 'Validation failed');
      }
    } catch (err: any) {
      alert(err.message || 'Validation error');
    } finally {
      setValidating(false);
    }
  }

  // Profile Save
  async function handleSaveProfile() {
    if (!profileName.trim() || !selectedProject || !selectedIssueType) return;
    setSavingProfile(true);

    const mapping = {
      fields: Object.values(fieldMappings),
      attachment: { columnName: attachmentColumn || null },
    };

    try {
      const res = await fetch('/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: profileName.trim(),
          projectKey: selectedProject.key,
          issueTypeId: selectedIssueType.id,
          mapping,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setSavedProfiles((prev) => [data, ...prev]);
        setProfileName('');
      }
    } finally {
      setSavingProfile(false);
    }
  }

  function handleApplyProfile(profile: any) {
    if (!profile.mapping) return;
    if (Array.isArray(profile.mapping.fields)) {
      const newMap = { ...fieldMappings };
      for (const f of profile.mapping.fields) {
        if (newMap[f.fieldId]) {
          newMap[f.fieldId] = f;
        }
      }
      setFieldMappings(newMap);
    }
    if (profile.mapping.attachment?.columnName) {
      setAttachmentColumn(profile.mapping.attachment.columnName);
    }
  }

  // Start Run (Step 6)
  async function handleStartRun() {
    if (!uploadId || !selectedProject || !selectedIssueType || !validationSummary) return;
    setStartingRun(true);

    const config: MappingConfig = {
      projectKey: selectedProject.key,
      issueTypeId: selectedIssueType.id,
      fields: Object.values(fieldMappings).filter((m) => m.columnName || m.constantValue),
      attachment: { columnName: attachmentColumn || null },
    };

    // Determine duplicate skipped rows
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
          projectName: selectedProject.name,
          issueTypeName: selectedIssueType.name,
          duplicatePolicy,
          skippedRowIndices: skippedIndices,
        }),
      });

      const data = await res.json();
      if (res.ok && data.runId) {
        setRunId(data.runId);
        setStep(6);
        startStreamingRun(data.runId);
      } else {
        alert(data.error || 'Failed to start run');
      }
    } catch (err: any) {
      alert(err.message || 'Error starting run');
    } finally {
      setStartingRun(false);
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
        }
      } catch (err) {
        console.error('SSE progress error', err);
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
    };
  }

  // Check if mapping step is valid
  const unmappedRequiredFields = fieldMetas.filter((fm) => {
    if (!fm.required || fm.hasDefaultValue) return false;
    const m = fieldMappings[fm.id];
    return !m || (!m.columnName && (!m.constantValue || !m.constantValue.trim()));
  });

  return (
    <div className="space-y-8">
      {/* Wizard Step Breadcrumb */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <div className="flex items-center justify-between max-w-4xl mx-auto">
          {[
            { num: 1, label: 'Connection' },
            { num: 2, label: 'Destination' },
            { num: 3, label: 'Source' },
            { num: 4, label: 'Mapping' },
            { num: 5, label: 'Review' },
            { num: 6, label: 'Run' },
          ].map((s) => {
            const isCurrent = step === s.num;
            const isDone = step > s.num;
            return (
              <div key={s.num} className="flex items-center space-x-2">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs transition ${
                    isDone
                      ? 'bg-green-600 text-white'
                      : isCurrent
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'bg-gray-100 text-gray-400'
                  }`}
                >
                  {isDone ? <Check className="w-4 h-4" /> : s.num}
                </div>
                <span
                  className={`hidden sm:inline text-xs font-semibold ${
                    isCurrent ? 'text-blue-600' : isDone ? 'text-gray-800' : 'text-gray-400'
                  }`}
                >
                  {s.label}
                </span>
                {s.num < 6 && <div className="hidden md:block w-6 h-0.5 bg-gray-200" />}
              </div>
            );
          })}
        </div>
      </div>

      {/* STEP 1: CONNECTION */}
      {step === 1 && (
        <div className="bg-white rounded-xl border border-gray-200 p-8 max-w-2xl mx-auto space-y-6 shadow-sm">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Step 1: Check Jira Cloud Connection</h2>
            <p className="text-sm text-gray-500 mt-1">
              Verify your connected Jira Cloud instance before selecting projects.
            </p>
          </div>

          <div className="border border-gray-200 rounded-xl p-5 bg-gray-50/50 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-gray-500 font-semibold uppercase">Jira Base URL</div>
                <div className="text-sm font-medium text-gray-900 font-mono mt-0.5">
                  {connection?.baseUrl || 'Not configured'}
                </div>
              </div>
              <Link href="/settings" className="text-xs text-blue-600 hover:underline">
                Configure in Settings
              </Link>
            </div>

            <div>
              <div className="text-xs text-gray-500 font-semibold uppercase">Account Email</div>
              <div className="text-sm font-medium text-gray-900 mt-0.5">
                {connection?.email || 'Not configured'}
              </div>
            </div>

            <div>
              <div className="text-xs text-gray-500 font-semibold uppercase">API Token Status</div>
              <div className="text-sm font-medium mt-0.5 flex items-center gap-1.5">
                {connection?.hasToken ? (
                  <span className="text-green-600 flex items-center gap-1">
                    <CheckCircle2 className="w-4 h-4" /> Token configured (ending in ...{connection.tokenHint})
                  </span>
                ) : (
                  <span className="text-red-600 flex items-center gap-1">
                    <AlertCircle className="w-4 h-4" /> No API token configured
                  </span>
                )}
              </div>
            </div>
          </div>

          {testResult && (
            <div
              className={`p-4 rounded-xl border flex items-start gap-3 ${
                testResult.success
                  ? 'bg-blue-50 border-blue-200 text-blue-900'
                  : 'bg-red-50 border-red-200 text-red-900'
              }`}
            >
              {testResult.success ? (
                <CheckCircle2 className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              )}
              <div className="text-sm">
                <p className="font-semibold">
                  {testResult.success ? `Connected as ${testResult.displayName}` : 'Connection Failed'}
                </p>
                {testResult.accountId && (
                  <p className="text-xs text-gray-500 mt-0.5">Account ID: {testResult.accountId}</p>
                )}
                {testResult.message && <p className="text-xs mt-0.5">{testResult.message}</p>}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between pt-4 border-t border-gray-100">
            <button
              onClick={testConn}
              disabled={testingConnection || !connection?.hasToken}
              className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 transition disabled:opacity-50"
            >
              {testingConnection ? <RefreshCw className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
              Test Connection
            </button>

            <button
              onClick={() => setStep(2)}
              disabled={!connection?.hasToken}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold shadow-sm transition disabled:opacity-50"
            >
              Next: Select Destination <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 2: DESTINATION */}
      {step === 2 && (
        <div className="bg-white rounded-xl border border-gray-200 p-8 max-w-2xl mx-auto space-y-6 shadow-sm">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Step 2: Destination Project & Issue Type</h2>
            <p className="text-sm text-gray-500 mt-1">
              Select the Jira Cloud project and issue type to create issues in.
            </p>
          </div>

          {loadingDest ? (
            <div className="py-12 flex justify-center">
              <RefreshCw className="w-8 h-8 animate-spin text-blue-600" />
            </div>
          ) : (
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-1.5">
                  Target Jira Project
                </label>
                <select
                  value={selectedProject?.key || ''}
                  onChange={(e) => {
                    const p = projects.find((proj) => proj.key === e.target.value);
                    setSelectedProject(p || null);
                  }}
                  className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">-- Choose a project ({projects.length} available) --</option>
                  {projects.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.name} ({p.key})
                    </option>
                  ))}
                </select>
              </div>

              {selectedProject && (
                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-1.5">
                    Issue Type
                  </label>
                  <select
                    value={selectedIssueType?.id || ''}
                    onChange={(e) => {
                      const it = issueTypes.find((item) => item.id === e.target.value);
                      setSelectedIssueType(it || null);
                    }}
                    className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {issueTypes.map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between pt-4 border-t border-gray-100">
            <button
              onClick={() => setStep(1)}
              className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 transition"
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </button>

            <button
              onClick={() => setStep(3)}
              disabled={!selectedProject || !selectedIssueType}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold shadow-sm transition disabled:opacity-50"
            >
              Next: Select Source <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: SOURCE (SPREADSHEET) */}
      {step === 3 && (
        <div className="bg-white rounded-xl border border-gray-200 p-8 max-w-3xl mx-auto space-y-6 shadow-sm">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Step 3: Upload Spreadsheet</h2>
            <p className="text-sm text-gray-500 mt-1">
              Upload your <code>.xlsx</code>, <code>.xls</code>, or <code>.csv</code> workbook. Max 10 MB and 5,000 rows.
            </p>
          </div>

          {/* Drag & Drop Zone */}
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                handleFileUpload(e.dataTransfer.files[0]);
              }
            }}
            className="border-2 border-dashed border-gray-300 hover:border-blue-500 rounded-2xl p-8 text-center cursor-pointer transition bg-gray-50/50 hover:bg-blue-50/20"
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
                <p className="text-sm font-semibold text-gray-700">Parsing workbook...</p>
              </div>
            ) : file ? (
              <div className="flex flex-col items-center">
                <FileSpreadsheet className="w-12 h-12 text-green-600 mb-2" />
                <p className="text-base font-semibold text-gray-900">{file.name}</p>
                <p className="text-xs text-gray-500 mt-0.5">{(file.size / 1024).toFixed(1)} KB • Click to replace</p>
              </div>
            ) : (
              <div className="flex flex-col items-center">
                <Upload className="w-12 h-12 text-gray-400 mb-2" />
                <p className="text-base font-semibold text-gray-800">Drag & drop workbook here or click to browse</p>
                <p className="text-xs text-gray-500 mt-1">Supports .xlsx, .xls, .csv</p>
              </div>
            )}
          </div>

          {uploadError && (
            <div className="p-3.5 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800 flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
              <span>{uploadError}</span>
            </div>
          )}

          {uploadResult && (
            <div className="space-y-4 pt-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">
                    Worksheet
                  </label>
                  <select
                    value={uploadResult.selectedSheet}
                    onChange={(e) => handleReparse(e.target.value, uploadResult.headerRowIndex)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  >
                    {uploadResult.sheets.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">
                    Header Row Index
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={uploadResult.headerRowIndex}
                    onChange={(e) =>
                      handleReparse(uploadResult.selectedSheet, parseInt(e.target.value, 10) || 1)
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
              </div>

              {/* Data Preview */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs font-semibold uppercase text-gray-700">
                    Preview (First {uploadResult.previewRows.length} of {uploadResult.rowCount} rows)
                  </span>
                  <span className="text-xs text-gray-500">{uploadResult.headers.length} columns detected</span>
                </div>
                <div className="border border-gray-200 rounded-xl overflow-x-auto max-h-56">
                  <table className="min-w-full divide-y divide-gray-200 text-xs">
                    <thead className="bg-gray-50 font-semibold text-gray-700">
                      <tr>
                        <th className="px-3 py-2 text-left">Row</th>
                        {uploadResult.headers.map((h) => (
                          <th key={h} className="px-3 py-2 text-left whitespace-nowrap">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 bg-white">
                      {uploadResult.previewRows.map((r) => (
                        <tr key={r.rowIndex}>
                          <td className="px-3 py-1.5 font-mono text-gray-400 font-bold">#{r.rowIndex}</td>
                          {uploadResult.headers.map((h) => (
                            <td key={h} className="px-3 py-1.5 whitespace-nowrap max-w-xs truncate text-gray-800">
                              {r.values[h] !== null && r.values[h] !== undefined ? String(r.values[h]) : '—'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between pt-4 border-t border-gray-100">
            <button
              onClick={() => setStep(2)}
              className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 transition"
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </button>

            <button
              onClick={() => setStep(4)}
              disabled={!uploadResult || uploadResult.rowCount === 0}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold shadow-sm transition disabled:opacity-50"
            >
              Next: Column Mapping <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 4: MAPPING */}
      {step === 4 && (
        <div className="bg-white rounded-xl border border-gray-200 p-8 max-w-5xl mx-auto space-y-6 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-gray-900">Step 4: Map Spreadsheet to Jira Fields</h2>
              <p className="text-sm text-gray-500 mt-1">
                Configure field mappings for {selectedProject?.key} • {selectedIssueType?.name}.
              </p>
            </div>

            {/* Profile load */}
            {savedProfiles.length > 0 && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-gray-500">Saved profile:</span>
                <select
                  onChange={(e) => {
                    const prof = savedProfiles.find((p) => p.id === e.target.value);
                    if (prof) handleApplyProfile(prof);
                  }}
                  className="px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs"
                >
                  <option value="">-- Apply a profile --</option>
                  {savedProfiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {unmappedRequiredFields.length > 0 && (
            <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                Required field(s) not mapped:{' '}
                <strong>{unmappedRequiredFields.map((f) => f.name).join(', ')}</strong>. You must map a column or provide
                a constant value to proceed.
              </span>
            </div>
          )}

          {loadingFields ? (
            <div className="py-16 flex justify-center">
              <RefreshCw className="w-8 h-8 animate-spin text-blue-600" />
            </div>
          ) : (
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-gray-700 text-xs uppercase font-semibold">
                  <tr>
                    <th className="px-4 py-3 text-left">Jira Field</th>
                    <th className="px-4 py-3 text-left">Type</th>
                    <th className="px-4 py-3 text-left">Excel Column</th>
                    <th className="px-4 py-3 text-left">Constant Value</th>
                    <th className="px-4 py-3 text-left">Transform</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {fieldMetas.map((fm) => {
                    const current = fieldMappings[fm.id] || {
                      fieldId: fm.id,
                      columnName: null,
                      constantValue: null,
                      transform: 'trim',
                    };

                    return (
                      <tr key={fm.id} className="hover:bg-gray-50/60 transition">
                        <td className="px-4 py-3">
                          <div className="font-semibold text-gray-900 flex items-center gap-1.5">
                            {fm.name}
                            {fm.required && <span className="text-red-500 font-bold">*</span>}
                          </div>
                          <div className="text-xs text-gray-400 font-mono">{fm.id}</div>
                        </td>

                        <td className="px-4 py-3 text-xs text-gray-500">
                          {fm.schema?.type || 'string'}
                          {fm.schema?.items ? `[${fm.schema.items}]` : ''}
                        </td>

                        <td className="px-4 py-3">
                          <select
                            value={current.columnName || ''}
                            onChange={(e) => {
                              const val = e.target.value || null;
                              setFieldMappings((prev) => ({
                                ...prev,
                                [fm.id]: { ...current, columnName: val },
                              }));
                            }}
                            className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs"
                          >
                            <option value="">-- (Not mapped) --</option>
                            {uploadResult?.headers.map((h) => (
                              <option key={h} value={h}>
                                {h}
                              </option>
                            ))}
                          </select>
                        </td>

                        <td className="px-4 py-3">
                          <input
                            type="text"
                            placeholder="Optional constant"
                            value={current.constantValue || ''}
                            onChange={(e) => {
                              const val = e.target.value || null;
                              setFieldMappings((prev) => ({
                                ...prev,
                                [fm.id]: { ...current, constantValue: val },
                              }));
                            }}
                            className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs"
                          />
                        </td>

                        <td className="px-4 py-3">
                          <select
                            value={current.transform}
                            onChange={(e) => {
                              setFieldMappings((prev) => ({
                                ...prev,
                                [fm.id]: { ...current, transform: e.target.value as any },
                              }));
                            }}
                            className="px-2 py-1.5 border border-gray-300 rounded-lg text-xs"
                          >
                            <option value="none">None</option>
                            <option value="trim">Trim</option>
                            <option value="uppercase">Uppercase</option>
                            <option value="lowercase">Lowercase</option>
                            <option value="split-list">Split List</option>
                            <option value="date-normalize">Date Normalize</option>
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Attachments Card */}
          <div className="bg-purple-50/50 border border-purple-200 rounded-xl p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Paperclip className="w-5 h-5 text-purple-700" />
              <h3 className="text-sm font-bold text-gray-900">Attachments Configuration (Optional)</h3>
            </div>
            <p className="text-xs text-gray-600">
              Select a spreadsheet column containing absolute local file paths (separated by <code>;</code> or newlines).
              Files will stream directly from disk to Jira attachments after issue creation.
            </p>
            <div className="max-w-md">
              <select
                value={attachmentColumn}
                onChange={(e) => setAttachmentColumn(e.target.value)}
                className="w-full px-3 py-2 border border-purple-300 rounded-lg text-xs bg-white"
              >
                <option value="">-- No attachments column --</option>
                {uploadResult?.headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>
            <div className="text-[11px] text-gray-500 flex items-center gap-4">
              <span>Limit: 20 MB per file</span>
              <span>• Max 10 files per row</span>
              <span>• Failure creates an attachment warning without failing the issue</span>
            </div>
          </div>

          {/* Save Profile Box */}
          <div className="flex items-center gap-3 pt-2">
            <input
              type="text"
              placeholder="Save configuration as profile name..."
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-xs w-64"
            />
            <button
              onClick={handleSaveProfile}
              disabled={savingProfile || !profileName.trim()}
              className="inline-flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg text-xs font-semibold bg-white hover:bg-gray-50 transition disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" /> Save Profile
            </button>
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-gray-100">
            <button
              onClick={() => setStep(3)}
              className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 transition"
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </button>

            <button
              onClick={() => setStep(5)}
              disabled={unmappedRequiredFields.length > 0}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold shadow-sm transition disabled:opacity-50"
            >
              Next: Review & Validate <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 5: REVIEW */}
      {step === 5 && (
        <div className="bg-white rounded-xl border border-gray-200 p-8 max-w-4xl mx-auto space-y-6 shadow-sm">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Step 5: Review & Dry Run Validation</h2>
            <p className="text-sm text-gray-500 mt-1">
              Verify your import payload and duplicate checks before writing to Jira Cloud.
            </p>
          </div>

          {validating ? (
            <div className="py-20 flex flex-col items-center">
              <RefreshCw className="w-10 h-10 animate-spin text-blue-600 mb-3" />
              <p className="text-sm font-semibold text-gray-800">
                Validating rows & scanning Jira Cloud for duplicates...
              </p>
            </div>
          ) : validationSummary ? (
            <div className="space-y-6">
              {/* Summary Stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-center">
                  <div className="text-xs text-blue-700 font-semibold uppercase">Ready to Create</div>
                  <div className="text-2xl font-bold text-blue-900 mt-1">{validationSummary.readyCount}</div>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
                  <div className="text-xs text-red-700 font-semibold uppercase">Invalid Rows</div>
                  <div className="text-2xl font-bold text-red-900 mt-1">{validationSummary.invalidCount}</div>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
                  <div className="text-xs text-amber-700 font-semibold uppercase">Duplicates Found</div>
                  <div className="text-2xl font-bold text-amber-900 mt-1">{validationSummary.duplicateCount}</div>
                </div>
                <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 text-center">
                  <div className="text-xs text-purple-700 font-semibold uppercase">Att. Warnings</div>
                  <div className="text-2xl font-bold text-purple-900 mt-1">{validationSummary.attachmentWarningCount}</div>
                </div>
              </div>

              {/* Duplicate Handling Policy Toggle */}
              {validationSummary.duplicateCount > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 space-y-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-amber-700" />
                    <h3 className="text-sm font-bold text-amber-900">
                      {validationSummary.duplicateCount} Duplicate Summary Matches Detected in Jira
                    </h3>
                  </div>
                  <p className="text-xs text-amber-800">
                    Choose whether to skip issues that already exist in project {selectedProject?.key} or create them
                    anyway:
                  </p>
                  <div className="flex items-center gap-4 pt-1">
                    <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer text-amber-950">
                      <input
                        type="radio"
                        name="dupPolicy"
                        checked={duplicatePolicy === 'skip'}
                        onChange={() => setDuplicatePolicy('skip')}
                      />
                      Skip duplicates (Recommended)
                    </label>
                    <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer text-amber-950">
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

              {/* Problems list */}
              {validationSummary.problems.length > 0 ? (
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 mb-2">
                    Row Problems & Warnings ({validationSummary.problems.length})
                  </h3>
                  <div className="border border-gray-200 rounded-xl overflow-hidden max-h-64 overflow-y-auto">
                    <table className="min-w-full divide-y divide-gray-200 text-xs">
                      <thead className="bg-gray-50 text-gray-700 font-semibold">
                        <tr>
                          <th className="px-3 py-2 text-left w-16">Row</th>
                          <th className="px-3 py-2 text-left">Summary</th>
                          <th className="px-3 py-2 text-left">Issue / Reason</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {validationSummary.problems.map((p) => (
                          <tr key={p.rowIndex} className="hover:bg-gray-50/70">
                            <td className="px-3 py-2 font-mono font-bold text-gray-500">#{p.rowIndex}</td>
                            <td className="px-3 py-2 font-medium max-w-xs truncate">{p.summary}</td>
                            <td className="px-3 py-2">
                              {p.duplicateOf && (
                                <span className="text-amber-700 font-medium mr-2">
                                  Duplicate of {p.duplicateOf.key} ({p.duplicateOf.status})
                                </span>
                              )}
                              {p.errors.length > 0 && (
                                <span className="text-red-700 font-medium mr-2">{p.errors.join('; ')}</span>
                              )}
                              {p.warnings.length > 0 && (
                                <span className="text-purple-700 font-medium">{p.warnings.join('; ')}</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="p-6 bg-green-50 border border-green-200 rounded-xl text-center">
                  <CheckCircle2 className="w-8 h-8 text-green-600 mx-auto mb-2" />
                  <p className="text-sm font-bold text-green-900">All rows are valid and ready to import!</p>
                </div>
              )}
            </div>
          ) : null}

          <div className="flex items-center justify-between pt-4 border-t border-gray-100">
            <button
              onClick={() => setStep(4)}
              className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 transition"
            >
              <ArrowLeft className="w-4 h-4" /> Back to Mapping
            </button>

            <button
              onClick={handleStartRun}
              disabled={startingRun || validating || !validationSummary}
              className="inline-flex items-center gap-2 px-6 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-bold shadow-sm transition disabled:opacity-50"
            >
              {startingRun ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              Start Issue Creation Run
            </button>
          </div>
        </div>
      )}

      {/* STEP 6: RUN */}
      {step === 6 && (
        <div className="bg-white rounded-xl border border-gray-200 p-8 max-w-4xl mx-auto space-y-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-900">Step 6: Issue Creation in Progress</h2>
              <p className="text-sm text-gray-500 mt-1">
                Creating issues and uploading attachments to Jira Cloud.
              </p>
            </div>
            {runId && (
              <Link
                href={`/runs/${runId}`}
                className="text-xs text-blue-600 hover:underline flex items-center gap-1 font-semibold"
              >
                Open Full Run Details <ExternalLink className="w-3.5 h-3.5" />
              </Link>
            )}
          </div>

          {/* Progress Bar */}
          {runProgress && (
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-xs font-semibold text-gray-700 mb-1.5">
                  <span>
                    Processed {runProgress.completed} of {runProgress.total} rows
                  </span>
                  <span>
                    {runProgress.total > 0
                      ? Math.round((runProgress.completed / runProgress.total) * 100)
                      : 0}
                    %
                  </span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-3.5 overflow-hidden flex">
                  <div
                    className="bg-green-500 h-full transition-all duration-300"
                    style={{
                      width: `${
                        runProgress.total > 0 ? (runProgress.createdCount / runProgress.total) * 100 : 0
                      }%`,
                    }}
                  />
                  <div
                    className="bg-red-500 h-full transition-all duration-300"
                    style={{
                      width: `${
                        runProgress.total > 0 ? (runProgress.failedCount / runProgress.total) * 100 : 0
                      }%`,
                    }}
                  />
                  <div
                    className="bg-amber-400 h-full transition-all duration-300"
                    style={{
                      width: `${
                        runProgress.total > 0 ? (runProgress.skippedCount / runProgress.total) * 100 : 0
                      }%`,
                    }}
                  />
                </div>
              </div>

              {/* Stats Bar */}
              <div className="grid grid-cols-4 gap-3 text-center">
                <div className="bg-green-50 border border-green-200 rounded-lg p-2.5">
                  <div className="text-[11px] text-green-700 font-semibold uppercase">Created</div>
                  <div className="text-lg font-bold text-green-800">{runProgress.createdCount}</div>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-lg p-2.5">
                  <div className="text-[11px] text-red-700 font-semibold uppercase">Failed</div>
                  <div className="text-lg font-bold text-red-800">{runProgress.failedCount}</div>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                  <div className="text-[11px] text-amber-700 font-semibold uppercase">Skipped</div>
                  <div className="text-lg font-bold text-amber-800">{runProgress.skippedCount}</div>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-2.5">
                  <div className="text-[11px] text-gray-500 font-semibold uppercase">Status</div>
                  <div className="text-lg font-bold text-gray-800 capitalize">{runProgress.status}</div>
                </div>
              </div>

              {/* Live rows table */}
              <div className="border border-gray-200 rounded-xl overflow-hidden max-h-72 overflow-y-auto">
                <table className="min-w-full divide-y divide-gray-200 text-xs">
                  <thead className="bg-gray-50 font-semibold text-gray-700">
                    <tr>
                      <th className="px-3 py-2 text-left w-14">Row</th>
                      <th className="px-3 py-2 text-left">Summary</th>
                      <th className="px-3 py-2 text-left">Status</th>
                      <th className="px-3 py-2 text-left">Jira Key</th>
                      <th className="px-3 py-2 text-left">Attachments</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {runProgress.rows.map((r) => (
                      <tr key={r.rowIndex}>
                        <td className="px-3 py-1.5 font-mono font-bold text-gray-500">#{r.rowIndex}</td>
                        <td className="px-3 py-1.5 max-w-xs truncate">{r.summary}</td>
                        <td className="px-3 py-1.5">
                          <span
                            className={`font-semibold capitalize ${
                              r.status === 'created'
                                ? 'text-green-700'
                                : r.status === 'failed'
                                ? 'text-red-700'
                                : r.status === 'skipped'
                                ? 'text-amber-700'
                                : 'text-blue-700'
                            }`}
                          >
                            {r.status}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 font-mono font-bold">
                          {r.issueKey ? (
                            <a
                              href={r.issueUrl || '#'}
                              target="_blank"
                              rel="noreferrer"
                              className="text-blue-600 hover:underline"
                            >
                              {r.issueKey}
                            </a>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-gray-500">{r.attachmentStatus || 'none'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {runProgress.status === 'completed' && runId && (
                <div className="p-5 bg-green-50 border border-green-200 rounded-xl flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-6 h-6 text-green-600" />
                    <div>
                      <h4 className="text-sm font-bold text-green-900">Run Finished Successfully!</h4>
                      <p className="text-xs text-green-700">
                        {runProgress.createdCount} issues created in Jira Cloud.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <a
                      href={`/api/runs/${runId}/export`}
                      download
                      className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-sm transition"
                    >
                      <Download className="w-3.5 h-3.5" /> Download Results .xlsx
                    </a>
                    <Link
                      href={`/runs/${runId}`}
                      className="px-4 py-2 bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-lg text-xs font-semibold transition"
                    >
                      View Details
                    </Link>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
