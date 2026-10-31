'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { RefreshCw, Play, AlertTriangle, CheckCircle, XCircle, Clock, Download, Trash2, ArrowRight } from 'lucide-react';

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

export default function RunsHistoryPage() {
  const [runs, setRuns] = useState<DbRun[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRuns = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/runs');
      if (res.ok) {
        const data = await res.json();
        setRuns(data);
      }
    } catch (err) {
      console.error('Failed to load runs', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRuns();
  }, []);

  async function handleDeleteRun(runId: string) {
    if (!confirm('Are you sure you want to delete this run record?')) return;
    try {
      const res = await fetch(`/api/runs/${runId}`, { method: 'DELETE' });
      if (res.ok) {
        setRuns((prev) => prev.filter((r) => r.id !== runId));
      }
    } catch (err) {
      console.error('Failed to delete run', err);
    }
  }

  function getStatusBadge(status: string) {
    switch (status) {
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800">
            <CheckCircle className="w-3.5 h-3.5" /> Completed
          </span>
        );
      case 'running':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Running
          </span>
        );
      case 'cancelled':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-800">
            <Clock className="w-3.5 h-3.5" /> Cancelled
          </span>
        );
      case 'interrupted':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
            <AlertTriangle className="w-3.5 h-3.5" /> Interrupted
          </span>
        );
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Run History</h1>
          <p className="text-sm text-gray-500 mt-1">
            Audit log of all batch creation executions, row outcomes, and attachment status.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchRuns}
            className="inline-flex items-center gap-2 px-3.5 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 shadow-sm transition"
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold shadow-sm transition"
          >
            <Play className="w-4 h-4" /> New Import
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 flex justify-center">
          <RefreshCw className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      ) : runs.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Clock className="w-12 h-12 text-gray-400 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-gray-900">No import runs yet</h3>
          <p className="text-sm text-gray-500 mt-1 mb-6">
            Upload an Excel workbook and run your first Jira bulk issue creation.
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold shadow-sm transition"
          >
            Start Import Wizard
          </Link>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-gray-700 text-xs uppercase font-semibold">
                <tr>
                  <th className="px-6 py-3.5 text-left">Target</th>
                  <th className="px-6 py-3.5 text-left">Source File</th>
                  <th className="px-6 py-3.5 text-left">Status</th>
                  <th className="px-6 py-3.5 text-left">Outcomes</th>
                  <th className="px-6 py-3.5 text-left">Started</th>
                  <th className="px-6 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {runs.map((run) => (
                  <tr key={run.id} className="hover:bg-gray-50/80 transition">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="font-semibold text-gray-900">
                        {run.project_key} • {run.issue_type_name}
                      </div>
                      <div className="text-xs text-gray-500">{run.project_name}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-gray-900 font-medium">{run.source_filename}</div>
                      <div className="text-xs text-gray-500">Sheet: {run.sheet_name}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">{getStatusBadge(run.status)}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-3 text-xs">
                        <span className="text-green-700 font-medium">{run.created_count} created</span>
                        {run.failed_count > 0 && (
                          <span className="text-red-700 font-medium">{run.failed_count} failed</span>
                        )}
                        {run.skipped_count > 0 && (
                          <span className="text-amber-700 font-medium">{run.skipped_count} skipped</span>
                        )}
                        {run.attachment_warning_count > 0 && (
                          <span className="text-purple-700 font-medium" title="Attachment upload warnings">
                            ⚠️ {run.attachment_warning_count} att. warn
                          </span>
                        )}
                        <span className="text-gray-400">/ {run.total} total</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-500">
                      {new Date(run.started_at).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-xs">
                      <div className="flex items-center justify-end gap-2">
                        <a
                          href={`/api/runs/${run.id}/export`}
                          download
                          title="Download results .xlsx"
                          className="p-1.5 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded transition"
                        >
                          <Download className="w-4 h-4" />
                        </a>
                        <button
                          onClick={() => handleDeleteRun(run.id)}
                          title="Delete run"
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        <Link
                          href={`/runs/${run.id}`}
                          className="inline-flex items-center gap-1 px-3 py-1.5 bg-gray-100 hover:bg-blue-50 hover:text-blue-600 font-medium rounded-lg text-gray-700 transition"
                        >
                          View <ArrowRight className="w-3.5 h-3.5" />
                        </Link>
                      </div>
                    </td>
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
