'use client';

import { useState, useEffect } from 'react';
import { KeyRound, CheckCircle2, AlertCircle, RefreshCw, ShieldCheck, ExternalLink } from 'lucide-react';

export default function SettingsPage() {
  const [baseUrl, setBaseUrl] = useState('');
  const [email, setEmail] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [tokenHint, setTokenHint] = useState('');
  const [hasToken, setHasToken] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    latencyMs?: number;
  } | null>(null);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const data = await res.json();
        setBaseUrl(data.baseUrl || '');
        setEmail(data.email || '');
        setHasToken(data.hasToken);
        setTokenHint(data.tokenHint || '');
        setUpdatedAt(data.updatedAt);
      }
    } catch (err) {
      console.error('Failed to load settings', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveMessage(null);
    setTestResult(null);

    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl,
          email,
          apiToken: apiToken.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save settings');
      }

      setHasToken(data.hasToken);
      setTokenHint(data.tokenHint);
      setUpdatedAt(data.updatedAt);
      setApiToken('');
      setSaveMessage({ type: 'success', text: 'Settings saved and API token encrypted successfully.' });
    } catch (err: any) {
      setSaveMessage({ type: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/settings/test', {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Connection test failed');
      }

      setTestResult({
        success: true,
        message: `Connected as ${data.displayName} (${data.emailAddress || data.accountId})`,
        latencyMs: data.latencyMs,
      });
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err.message,
      });
    } finally {
      setTesting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center py-20">
        <RefreshCw className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Jira Cloud Settings</h1>
        <p className="text-sm text-gray-500 mt-1">
          Configure your Jira Cloud tenant URL, authentication credentials, and test connectivity.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-6">
        <form onSubmit={handleSave} className="space-y-6">
          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-1">
              Jira Cloud Base URL
            </label>
            <input
              type="url"
              required
              placeholder="https://your-domain.atlassian.net"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <p className="text-xs text-gray-500 mt-1">
              Must be an HTTPS Atlassian Cloud URL (e.g. <code>https://acme.atlassian.net</code>).
            </p>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-1">
              Atlassian Account Email
            </label>
            <input
              type="email"
              required
              placeholder="user@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-1">
              Jira API Token
            </label>
            <div className="relative">
              <input
                type="password"
                placeholder={hasToken ? `••••••••••••••••••••••••••••${tokenHint}` : 'Paste API token'}
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div className="flex items-center justify-between mt-1 text-xs">
              <span className="text-gray-500">
                {hasToken ? (
                  <span className="text-green-600 font-medium flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5 inline" /> Encrypted token saved (ending in ...{tokenHint})
                  </span>
                ) : (
                  'No token configured yet.'
                )}
              </span>
              <a
                href="https://id.atlassian.com/manage-profile/security/api-tokens"
                target="_blank"
                rel="noreferrer"
                className="text-blue-600 hover:underline flex items-center gap-1"
              >
                Create Jira API token <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>

          {saveMessage && (
            <div
              className={`p-3.5 rounded-lg text-sm flex items-start gap-2.5 ${
                saveMessage.type === 'success'
                  ? 'bg-green-50 text-green-800 border border-green-200'
                  : 'bg-red-50 text-red-800 border border-red-200'
              }`}
            >
              {saveMessage.type === 'success' ? (
                <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              )}
              <span>{saveMessage.text}</span>
            </div>
          )}

          <div className="flex items-center justify-between pt-2 border-t border-gray-100">
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={testing || (!hasToken && !apiToken)}
              className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 transition"
            >
              {testing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
              Test Connection
            </button>

            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold shadow-sm transition disabled:opacity-50"
            >
              {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
              Save Credentials
            </button>
          </div>
        </form>

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
              <p className="font-semibold">{testResult.success ? 'Connection Successful' : 'Connection Failed'}</p>
              <p className="mt-0.5">{testResult.message}</p>
              {testResult.latencyMs !== undefined && (
                <p className="text-xs text-gray-500 mt-1">Latency: {testResult.latencyMs} ms</p>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="bg-gray-50 rounded-xl border border-gray-200 p-5 flex items-start gap-3 text-xs text-gray-600">
        <ShieldCheck className="w-5 h-5 text-gray-500 shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold text-gray-800">Security & Encryption Details</p>
          <p className="mt-1">
            API tokens are encrypted at rest with AES-256-GCM in local SQLite (<code>.data/app.db</code>).
            Credentials never touch the browser; all Jira API calls execute server-side via loopback.
          </p>
          {updatedAt && <p className="mt-1 text-gray-400">Last updated: {new Date(updatedAt).toLocaleString()}</p>}
        </div>
      </div>
    </div>
  );
}
