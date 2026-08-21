"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  DEFAULT_INSTANCE_ORIGIN,
  KEY_SCOPE_ITEMS,
  READ_KEY_CONSENT,
  buildAgentPrompt,
  clientTabs,
  consentForScope,
  mcpAddress,
  type AgentClientId,
  type KeyScopeId,
} from "./onboarding";

type KeyRow = {
  id: string;
  name: string;
  scope: string;
  legacy: boolean;
  lastUsedAt?: string | null;
};

export default function AgentsPage() {
  const [origin, setOrigin] = useState(DEFAULT_INSTANCE_ORIGIN);
  const [tab, setTab] = useState<AgentClientId>("claude");
  const [adminKey, setAdminKey] = useState("");
  const [keyName, setKeyName] = useState("Agent Key");
  const [keyScope, setKeyScope] = useState<KeyScopeId>("read");
  const [generatedKey, setGeneratedKey] = useState("");
  const [generatedScope, setGeneratedScope] = useState<KeyScopeId | "">("");
  const [keyRows, setKeyRows] = useState<KeyRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const prompt = buildAgentPrompt(origin);
  const mcp = mcpAddress(origin);
  const tabs = clientTabs(origin);
  const active = tabs.find((item) => item.id === tab) ?? tabs[0];

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(""), 2000);
    } catch {
      setCopied("");
    }
  };

  const refreshKeys = useCallback(async (operatorKey: string) => {
    const listed = await fetch("/api/v1/keys", {
      headers: { Authorization: `Bearer ${operatorKey}` },
    });
    if (!listed.ok) return;
    const meta = (await listed.json()) as { keys?: KeyRow[] };
    if (Array.isArray(meta.keys)) {
      setKeyRows(meta.keys);
    }
  }, []);

  useEffect(() => {
    if (!adminKey) return;
    refreshKeys(adminKey).catch(() => {
      // Listing is optional until the operator key is accepted
    });
  }, [adminKey, refreshKeys]);

  const handleGenerateKey = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/keys", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(adminKey ? { Authorization: `Bearer ${adminKey}` } : {}),
        },
        body: JSON.stringify({ name: keyName, scope: keyScope }),
      });
      const data = (await response.json()) as {
        key?: string;
        scope?: KeyScopeId;
        error?: string;
      };
      if (!response.ok || !data.key) {
        setError(data.error || "Could not mint a key");
        return;
      }
      setGeneratedKey(data.key);
      setGeneratedScope(data.scope === "write" || data.scope === "admin" ? data.scope : "read");
      if (adminKey) {
        await refreshKeys(adminKey);
      }
    } catch {
      setError("Could not mint a key");
    } finally {
      setLoading(false);
    }
  };

  const handleRevoke = async (id: string) => {
    if (!adminKey) {
      setError("Present the operator key to revoke");
      return;
    }
    setRevoking(id);
    setError(null);
    try {
      const response = await fetch(`/api/v1/keys/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${adminKey}` },
      });
      const data = (await response.json()) as { revoked?: boolean; error?: string };
      if (!response.ok || !data.revoked) {
        setError(data.error || "Could not revoke key");
        return;
      }
      await refreshKeys(adminKey);
    } catch {
      setError("Could not revoke key");
    } finally {
      setRevoking(null);
    }
  };

  return (
    <div className="min-h-screen bg-bg">
      <div className="border-b border-border bg-panel">
        <div className="max-w-5xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between mb-2">
            <h1 className="font-display text-3xl font-semibold">Agents</h1>
            <Link href="/dashboard?workspace=demo" className="text-sm text-accent hover:underline">
              ← Dashboard
            </Link>
          </div>
          <p className="text-sub">
            Copy one prompt. Connect any client. A read key can read every view and ask
            questions — and nothing else.
          </p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
        <section className="bg-panel border border-border rounded-lg p-6">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <h2 className="font-display text-xl font-semibold mb-1">Copy one prompt</h2>
              <p className="text-sub text-sm">
                Paste this in a fresh agent session. It includes the instance address,{" "}
                <code className="text-xs bg-bg px-1 py-0.5 rounded">/llms.txt</code>,{" "}
                <code className="text-xs bg-bg px-1 py-0.5 rounded">AGENTS.md</code>, and how
                to ask for a key.
              </p>
            </div>
            <button
              type="button"
              onClick={() => copyToClipboard(prompt, "prompt")}
              className="shrink-0 px-4 py-2 bg-accent text-white text-sm rounded hover:opacity-90"
            >
              {copied === "prompt" ? "Copied" : "Copy prompt"}
            </button>
          </div>
          <pre
            data-testid="agent-prompt"
            className="bg-bg border border-rule rounded-lg p-4 text-xs font-mono overflow-x-auto whitespace-pre-wrap"
          >
            {prompt}
          </pre>
        </section>

        <section className="bg-panel border border-border rounded-lg p-6">
          <div className="mb-4">
            <h2 className="font-display text-xl font-semibold mb-1">Connect a client</h2>
            <p className="text-sub text-sm">
              Numbered steps per client. The MCP address is the same for every tab.
            </p>
          </div>

          <div
            role="tablist"
            aria-label="Agent clients"
            className="flex flex-wrap gap-2 mb-4"
          >
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                data-testid={`client-tab-${item.id}`}
                onClick={() => setTab(item.id)}
                className={`px-3 py-1.5 text-sm rounded border ${
                  tab === item.id
                    ? "border-accent bg-accent-soft text-accent font-semibold"
                    : "border-border hover:bg-panel-2"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between gap-2 mb-3">
            <label className="text-xs font-mono uppercase tracking-wider text-faint">
              MCP address
            </label>
            <button
              type="button"
              data-testid="copy-mcp-address"
              onClick={() => copyToClipboard(mcp, "mcp")}
              className="text-xs text-accent hover:underline"
            >
              {copied === "mcp" ? "Copied" : "Copy MCP address"}
            </button>
          </div>
          <code
            data-testid="mcp-address"
            className="block px-3 py-2 text-sm bg-bg border border-border rounded font-mono break-all mb-4"
          >
            {mcp}
          </code>

          <ol
            data-testid={`client-steps-${active.id}`}
            className="list-decimal list-inside space-y-2 text-sm"
          >
            {active.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>

        <section className="bg-panel border border-border rounded-lg p-6">
          <div className="mb-4">
            <h2 className="font-display text-xl font-semibold mb-1">Issue a key</h2>
            <p className="text-sub text-sm" data-testid="key-consent">
              {consentForScope(keyScope)}
            </p>
          </div>

          <ul data-testid="key-scope-list" className="space-y-2 text-sm mb-4">
            {KEY_SCOPE_ITEMS.map((item) => (
              <li key={item.scope}>
                <code className="text-xs bg-bg px-1 py-0.5 rounded font-mono">
                  {item.scope}
                </code>
                <span className="text-sub"> — {item.summary}</span>
              </li>
            ))}
          </ul>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-faint mb-1">
                Key name
              </label>
              <input
                type="text"
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-bg border border-border rounded"
                placeholder="Agent Key"
              />
            </div>

            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-faint mb-1">
                Scope
              </label>
              <select
                value={keyScope}
                onChange={(e) => setKeyScope(e.target.value as KeyScopeId)}
                className="w-full px-3 py-2 text-sm bg-bg border border-border rounded font-mono"
              >
                <option value="read">read (default)</option>
                <option value="write">write</option>
                <option value="admin">admin</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-faint mb-1">
                Existing ANYKPI_API_KEY
              </label>
              <input
                type="password"
                value={adminKey}
                onChange={(e) => setAdminKey(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-bg border border-border rounded font-mono"
                placeholder="Required to mint a new key"
              />
            </div>

            <button
              type="button"
              onClick={handleGenerateKey}
              disabled={loading || !keyName}
              className="px-4 py-2 bg-accent text-white text-sm rounded hover:opacity-90 disabled:opacity-50"
            >
              {loading ? "Generating..." : "Generate API Key"}
            </button>

            {error && <p className="text-sm text-red-500">{error}</p>}

            {generatedKey && (
              <div className="bg-accent-soft border border-accent-line rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-sub">
                    API Key (save this — it won&apos;t be shown again)
                  </span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(generatedKey, "key")}
                    className="text-xs text-accent hover:underline"
                  >
                    {copied === "key" ? "Copied" : "Copy"}
                  </button>
                </div>
                <input
                  type="text"
                  readOnly
                  value={generatedKey}
                  data-testid="minted-key"
                  className="w-full px-3 py-2 text-sm bg-bg border border-border rounded font-mono"
                />
                <p className="text-sm" data-testid="minted-key-scope">
                  Scope: <code className="font-mono">{generatedScope || keyScope}</code>
                  . {generatedScope === "read" || !generatedScope ? READ_KEY_CONSENT : consentForScope(generatedScope)}
                </p>
              </div>
            )}

            {keyRows.length > 0 && (
              <div className="border border-border rounded-lg overflow-hidden">
                <table className="w-full text-sm" data-testid="key-table">
                  <thead className="bg-bg text-sub text-left">
                    <tr>
                      <th className="px-3 py-2 font-medium">Name</th>
                      <th className="px-3 py-2 font-medium">Scope</th>
                      <th className="px-3 py-2 font-medium">Last used</th>
                      <th className="px-3 py-2 font-medium"> </th>
                    </tr>
                  </thead>
                  <tbody>
                    {keyRows.map((row) => (
                      <tr key={row.id} className="border-t border-border" data-testid={`key-row-${row.id}`}>
                        <td className="px-3 py-2">
                          {row.name}
                          {row.legacy ? (
                            <span className="ml-2 text-xs text-sub">legacy</span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 font-mono">{row.scope}</td>
                        <td className="px-3 py-2 text-sub">
                          {row.lastUsedAt
                            ? new Date(row.lastUsedAt).toLocaleString()
                            : "never"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            data-testid={`revoke-key-${row.id}`}
                            onClick={() => handleRevoke(row.id)}
                            disabled={revoking === row.id}
                            className="text-xs text-accent hover:underline disabled:opacity-50"
                          >
                            {revoking === row.id ? "Revoking…" : "Revoke"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        <p className="text-center text-sm text-sub pt-2">
          Setup also has this step:{" "}
          <Link href="/connect#agents" className="text-accent underline">
            /connect
          </Link>
        </p>
      </div>
    </div>
  );
}
