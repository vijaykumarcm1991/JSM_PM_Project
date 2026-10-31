'use client';

import { useState, useEffect, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  RefreshCw,
  Download,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  ArrowLeft,
  ExternalLink,
  Paperclip,
  RotateCcw,
  StopCircle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

interface DbRun {
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

interface DbRunRow {
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

export default function RunDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { id: runId } = use(params);

  const [run, setRun] = useState<DbRun | null>(null);
  const [rows, setRows] = useState<DbRunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'created' | 'failed' | 'skipped' | 'warnings'>('all');
  const [retrying, setRetrying] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  const fetchRunData = async () => {
    try {
      const res = await fetch(`/api/runs/${runId}`);
      if (res.ok) {
        const data = await res.json();
        setRun(data.run);
        setRows(data.rows || []);
      }
    } catch (err) {
      console.error('Failed to load run details', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRunData();
  }, [runId]);

  // Connect to SSE stream if run is running
  useEffect(() => {
    if (!run || run.status !== 'running') return;

    const eventSource = new EventSource(`/api/runs/${runId}/stream`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'row_update' && data.row) {
          setRows((prev) => {
            const index = prev.findIndex((r) => r.id === data.row.id || r.row_index === data.row.rowIndex);
            if (index >= 0) {
              const updated = [...prev];
              updated[index] = { ...updated[index], ...data.row };
              return updated;
            }
            return prev;
          });

          setRun((prev) =>
            prev
              ? {
                  ...prev,
                  created_count: data.createdCount,
                  failed_count: data.failedCount,
                  skipped_count: data.skippedCount,
                }
              : null
          );
        } else if (data.type === 'completed' || data.type === 'cancelled') {
          fetchRunData();
          eventSource.close();
        }
      } catch (err) {
        console.error('SSE parse error', err);
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [runId, run?.status]);

  async function handleCancelRun() {
    if (!confirm('Are you sure you want to stop this run?')) return;
    setCancelling(true);
    try {
      await fetch(`/api/runs/${runId}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cancel: true }),
      });
      fetchRunData();
    } catch (err) {
      console.error('Cancel failed', err);
    } finally {
      setCancelling(false);
    }
  }

  async function handleRetryFailed() {
    setRetrying('failed');
    try {
      const res = await fetch(`/api/runs/${runId}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'failed' }),
      });
      const data = await res.json();
      if (res.ok && data.newRunId) {
        router.push(`/runs/${data.newRunId}`);
      } else {
        alert(data.error || 'Failed to trigger retry');
      }
    } catch (err: any) {
      alert(err.message || 'Retry error');
    } finally {
      setRetrying(null);
    }
  }

  async function handleRetryAttachments() {
    setRetrying('attachments');
    try {
      const res = await fetch(`/api/runs/${runId}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'attachments' }),
      });
      const data = await res.json();
      if (res.ok) {
        setTimeout(fetchRunData, 1000);
      } else {
        alert(data.error || 'Failed to retry attachments');
      }
    } catch (err: any) {
      alert(err.message || 'Retry attachments error');
    } finally {
      setRetrying(null);
    }
  }

  const filteredRows = rows.filter((r) => {
    if (filter === 'created') return r.status === 'created';
    if (filter === 'failed') return r.status === 'failed';
    if (filter === 'skipped') return r.status === 'skipped';
    if (filter === 'warnings') return r.attachment_status === 'partial' || r.attachment_status === 'failed';
    return true;
  });

  if (loading) {
    return (
      <div className="flex justify-center items-center py-24">
        <RefreshCw className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!run) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
        <h2 className="text-lg font-semibold text-gray-900">Run not found</h2>
        <p className="text-sm text-gray-500 mt-1 mb-4">The requested run ID does not exist in local SQLite.</p>
        <Link href="/runs" className="text-blue-600 hover:underline text-sm font-medium">
          ← Back to Run History
        </Link>
      </div>
    );
  }

  const completedCount = run.created_count + run.failed_count + run.skipped_count;
  const progressPercent = run.total > 0 ? Math.round((completedCount / run.total) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href="/runs" className="hover:text-blue-600 flex items-center gap-1 font-medium">
          <ArrowLeft className="w-4 h-4" /> Run History
        </Link>
        <span>/</span>
        <span className="text-gray-900 font-mono font-semibold">{run.id.slice(0, 8)}</span>
        {run.parent_run_id && (
          <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
            Retried from{' '}
            <Link href={`/runs/${run.parent_run_id}`} className="underline font-mono">
              {run.parent_run_id.slice(0, 8)}
            </Link>
          </span>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">
                {run.project_key} • {run.issue_type_name}
              </h1>
              <span
                className={`px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider ${
                  run.status === 'completed'
                    ? 'bg-green-100 text-green-800'
                    : run.status === 'running'
                    ? 'bg-blue-100 text-blue-800'
                    : 'bg-amber-100 text-amber-800'
                }`}
              >
                {run.status}
              </span>
            </div>
            <p className="text-sm text-gray-500 mt-1">
              Source: <span className="font-medium text-gray-800">{run.source_filename}</span> ({run.sheet_name}) • Started{' '}
              {new Date(run.started_at).toLocaleString()}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {run.status === 'running' && (
              <button
                onClick={handleCancelRun}
                disabled={cancelling}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-red-300 text-red-700 bg-white hover:bg-red-50 rounded-lg text-sm font-semibold transition shadow-sm"
              >
                <StopCircle className="w-4 h-4" /> Cancel Run
              </button>
            )}

            {run.failed_count > 0 && run.status !== 'running' && (
              <button
                onClick={handleRetryFailed}
                disabled={retrying !== null}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 rounded-lg text-sm font-semibold transition shadow-sm"
              >
                {retrying === 'failed' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                Retry Failed ({run.failed_count})
              </button>
            )}

            {run.attachment_warning_count > 0 && run.status !== 'running' && (
              <button
                onClick={handleRetryAttachments}
                disabled={retrying !== null}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-purple-300 bg-purple-50 text-purple-700 hover:bg-purple-100 rounded-lg text-sm font-semibold transition shadow-sm"
              >
                {retrying === 'attachments' ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Paperclip className="w-4 h-4" />
                )}
                Retry Attachments ({run.attachment_warning_count})
              </button>
            )}

            <a
              href={`/api/runs/${run.id}/export`}
              download
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold shadow-sm transition"
            >
              <Download className="w-4 h-4" /> Export .xlsx
            </a>
          </div>
        </div>

        {/* Progress Bar */}
        <div>
          <div className="flex justify-between text-xs text-gray-500 mb-1.5">
            <span>
              Progress: {completedCount} of {run.total} processed
            </span>
            <span className="font-semibold text-gray-800">{progressPercent}%</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden flex">
            <div
              className="bg-green-500 h-full transition-all duration-300"
              style={{ width: `${run.total > 0 ? (run.created_count / run.total) * 100 : 0}%` }}
              title="Created"
            />
            <div
              className="bg-red-500 h-full transition-all duration-300"
              style={{ width: `${run.total > 0 ? (run.failed_count / run.total) * 100 : 0}%` }}
              title="Failed"
            />
            <div
              className="bg-amber-400 h-full transition-all duration-300"
              style={{ width: `${run.total > 0 ? (run.skipped_count / run.total) * 100 : 0}%` }}
              title="Skipped"
            />
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-2">
          <div className="bg-gray-50 p-3.5 rounded-lg border border-gray-200 text-center">
            <div className="text-xs text-gray-500 font-medium">Total Rows</div>
            <div className="text-xl font-bold text-gray-900 mt-0.5">{run.total}</div>
          </div>
          <div className="bg-green-50 p-3.5 rounded-lg border border-green-200 text-center">
            <div className="text-xs text-green-700 font-medium">Created</div>
            <div className="text-xl font-bold text-green-800 mt-0.5">{run.created_count}</div>
          </div>
          <div className="bg-red-50 p-3.5 rounded-lg border border-red-200 text-center">
            <div className="text-xs text-red-700 font-medium">Failed</div>
            <div className="text-xl font-bold text-red-800 mt-0.5">{run.failed_count}</div>
          </div>
          <div className="bg-amber-50 p-3.5 rounded-lg border border-amber-200 text-center">
            <div className="text-xs text-amber-700 font-medium">Skipped</div>
            <div className="text-xl font-bold text-amber-800 mt-0.5">{run.skipped_count}</div>
          </div>
          <div className="bg-purple-50 p-3.5 rounded-lg border border-purple-200 text-center">
            <div className="text-xs text-purple-700 font-medium">Att. Warnings</div>
            <div className="text-xl font-bold text-purple-800 mt-0.5">{run.attachment_warning_count}</div>
          </div>
        </div>
      </div>

      {/* Row Table Filter Tabs */}
      <div className="flex items-center gap-2 border-b border-gray-200 pb-3">
        {(['all', 'created', 'failed', 'skipped', 'warnings'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setFilter(t)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition ${
              filter === t
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            {t === 'warnings' ? 'Att. Warnings' : t}
          </button>
        ))}
        <span className="text-xs text-gray-400 ml-auto">{filteredRows.length} rows shown</span>
      </div>

      {/* Rows Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-gray-700 text-xs uppercase font-semibold">
              <tr>
                <th className="px-5 py-3 text-left w-16">Row</th>
                <th className="px-5 py-3 text-left">Summary</th>
                <th className="px-5 py-3 text-left">Status</th>
                <th className="px-5 py-3 text-left">Jira Issue</th>
                <th className="px-5 py-3 text-left">Attachments</th>
                <th className="px-5 py-3 text-left">Error / Warning</th>
                <th className="px-5 py-3 text-right">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredRows.map((r) => {
                const isExpanded = expandedRow === r.id;
                return (
                  <tr key={r.id} className="hover:bg-gray-50/70 transition">
                    <td className="px-5 py-3 font-mono text-xs font-bold text-gray-500">#{r.row_index}</td>
                    <td className="px-5 py-3 max-w-xs truncate font-medium text-gray-900">{r.summary || '—'}</td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      {r.status === 'created' ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700">
                          <CheckCircle className="w-3.5 h-3.5" /> Created
                        </span>
                      ) : r.status === 'failed' ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700">
                          <XCircle className="w-3.5 h-3.5" /> Failed
                        </span>
                      ) : r.status === 'skipped' ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700">
                          <Clock className="w-3.5 h-3.5" /> Skipped
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700">
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Pending
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      {r.issue_key ? (
                        <a
                          href={r.issue_url || '#'}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-blue-600 hover:underline font-semibold font-mono text-xs"
                        >
                          {r.issue_key} <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <span className="text-gray-400 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap text-xs">
                      {r.attachment_status === 'ok' ? (
                        <span className="text-green-700 font-medium">✓ {r.attached_count} uploaded</span>
                      ) : r.attachment_status === 'partial' ? (
                        <span className="text-amber-700 font-medium">⚠️ Partial ({r.attached_count})</span>
                      ) : r.attachment_status === 'failed' ? (
                        <span className="text-red-700 font-medium">✗ Failed</span>
                      ) : (
                        <span className="text-gray-400">None</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-xs max-w-sm">
                      {r.error ? (
                        <span className="text-red-600">{r.error}</span>
                      ) : r.attachment_error ? (
                        <span className="text-amber-600">{r.attachment_error}</span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => setExpandedRow(isExpanded ? null : r.id)}
                        className="p-1 text-gray-400 hover:text-gray-700 transition"
                      >
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
