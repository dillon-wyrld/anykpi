"use client";

import { useState, useEffect } from "react";
import { nanoid } from "nanoid";

/**
 * Agents Page
 * 
 * MCP + REST API + CLI setup for agent access
 * Midday-style: everything an agent needs in one place
 */
export default function AgentsPage() {
  const [apiKey, setApiKey] = useState<string>("");
  const [keyName, setKeyName] = useState<string>("Agent Key");
  const [generatedKey, setGeneratedKey] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<string>("");

  const apiUrl = typeof window !== 'undefined' 
    ? `${window.location.protocol}//${window.location.host}` 
    : 'http://localhost:3000';

  const handleGenerateKey = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/v1/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: keyName }),
      });
      
      const data = await response.json();
      if (data.key) {
        setGeneratedKey(data.key);
        setApiKey(data.key);
      }
    } catch (error) {
      console.error('Failed to generate key:', error);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(""), 2000);
  };

  const mcpConfig = `{
  "mcpServers": {
    "anykpi": {
      "command": "npx",
      "args": ["-y", "@anykpi/cli", "mcp"],
      "env": {
        "ANYKPI_API_URL": "${apiUrl}",
        "ANYKPI_API_KEY": "${apiKey || 'YOUR_API_KEY'}"
      }
    }
  }
}`;

  const cliSetup = `# Install CLI
npx @anykpi/cli login --url=${apiUrl}

# Or set manually
export ANYKPI_API_URL="${apiUrl}"
export ANYKPI_API_KEY="${apiKey || 'YOUR_API_KEY'}"

# Query
anykpi overview
anykpi users --cluster='🔥'
anykpi cohorts --json`;

  const curlExample = `curl ${apiUrl}/api/v1/overview?workspace=demo \\
  -H "Authorization: Bearer ${apiKey || 'YOUR_API_KEY'}"`;

  return (
    <div className="min-h-screen bg-bg">
      <div className="border-b border-border bg-panel">
        <div className="max-w-5xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between mb-2">
            <h1 className="font-display text-3xl font-semibold">Agents</h1>
            <a
              href="/dashboard?workspace=demo"
              className="text-sm text-accent hover:underline"
            >
              ← Dashboard
            </a>
          </div>
          <p className="text-sub">
            Everything an agent needs: MCP, REST API, CLI. Anything humans see, agents can fetch.
          </p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
        {/* Step 1: Generate API Key */}
        <section className="bg-panel border border-border rounded-lg p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="font-display text-xl font-semibold mb-1">1. Generate API Key</h2>
              <p className="text-sub text-sm">One key works for MCP, CLI, and REST API</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Key Name</label>
              <input
                type="text"
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg bg-bg focus:outline-none focus:ring-2 focus:ring-accent"
                placeholder="My Agent Key"
              />
            </div>

            <button
              onClick={handleGenerateKey}
              disabled={loading || !keyName}
              className="px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Generating...' : 'Generate API Key'}
            </button>

            {generatedKey && (
              <div className="bg-accent-soft border border-accent-line rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-mono text-sub">API Key (save this, shown once)</span>
                  <button
                    onClick={() => copyToClipboard(generatedKey, 'key')}
                    className="text-xs text-accent hover:underline"
                  >
                    {copied === 'key' ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
                <code className="block font-mono text-sm text-text break-all">
                  {generatedKey}
                </code>
              </div>
            )}
          </div>
        </section>

        {/* Step 2: MCP Setup */}
        <section className="bg-panel border border-border rounded-lg p-6">
          <div className="mb-4">
            <h2 className="font-display text-xl font-semibold mb-1">2. MCP (Machine Context Protocol)</h2>
            <p className="text-sub text-sm">Add to Claude Desktop or any MCP client</p>
          </div>

          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-mono text-sub">claude_desktop_config.json</span>
                <button
                  onClick={() => copyToClipboard(mcpConfig, 'mcp')}
                  className="text-xs text-accent hover:underline"
                >
                  {copied === 'mcp' ? '✓ Copied' : 'Copy'}
                </button>
              </div>
              <pre className="bg-bg border border-rule rounded-lg p-4 text-xs font-mono overflow-x-auto">
                <code>{mcpConfig}</code>
              </pre>
            </div>

            <div className="text-sm text-sub">
              <p className="mb-1"><strong>Available Tools:</strong></p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li><code className="text-xs bg-bg px-1 py-0.5 rounded">get_overview</code> — Company snapshot</li>
                <li><code className="text-xs bg-bg px-1 py-0.5 rounded">query_users</code> — Filter/group users</li>
                <li><code className="text-xs bg-bg px-1 py-0.5 rounded">get_cohorts</code> — Retention with PMF signal</li>
                <li><code className="text-xs bg-bg px-1 py-0.5 rounded">get_wbr</code> — Weekly Business Review</li>
                <li><code className="text-xs bg-bg px-1 py-0.5 rounded">get_calendar</code> — Multi-source timeline</li>
              </ul>
              <p className="mt-2">Every response includes <code className="text-xs bg-bg px-1 py-0.5 rounded">view_url</code> for proof.</p>
            </div>
          </div>
        </section>

        {/* Step 3: CLI Setup */}
        <section className="bg-panel border border-border rounded-lg p-6">
          <div className="mb-4">
            <h2 className="font-display text-xl font-semibold mb-1">3. CLI</h2>
            <p className="text-sub text-sm">Command-line interface for scripts and agents</p>
          </div>

          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-mono text-sub">Setup</span>
                <button
                  onClick={() => copyToClipboard(cliSetup, 'cli')}
                  className="text-xs text-accent hover:underline"
                >
                  {copied === 'cli' ? '✓ Copied' : 'Copy'}
                </button>
              </div>
              <pre className="bg-bg border border-rule rounded-lg p-4 text-xs font-mono overflow-x-auto">
                <code>{cliSetup}</code>
              </pre>
            </div>

            <div className="text-sm text-sub">
              <p className="mb-1"><strong>Common Commands:</strong></p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li><code className="text-xs bg-bg px-1 py-0.5 rounded">anykpi overview</code> — Company snapshot</li>
                <li><code className="text-xs bg-bg px-1 py-0.5 rounded">anykpi users --json</code> — Query users</li>
                <li><code className="text-xs bg-bg px-1 py-0.5 rounded">anykpi cohorts</code> — Retention data</li>
                <li><code className="text-xs bg-bg px-1 py-0.5 rounded">anykpi wbr --section=Finance</code> — WBR metrics</li>
              </ul>
            </div>
          </div>
        </section>

        {/* Step 4: REST API */}
        <section className="bg-panel border border-border rounded-lg p-6">
          <div className="mb-4">
            <h2 className="font-display text-xl font-semibold mb-1">4. REST API</h2>
            <p className="text-sub text-sm">
              Direct HTTP access. <a href="/api-docs" className="text-accent underline">Full OpenAPI docs →</a>
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-mono text-sub">Example Request</span>
                <button
                  onClick={() => copyToClipboard(curlExample, 'curl')}
                  className="text-xs text-accent hover:underline"
                >
                  {copied === 'curl' ? '✓ Copied' : 'Copy'}
                </button>
              </div>
              <pre className="bg-bg border border-rule rounded-lg p-4 text-xs font-mono overflow-x-auto">
                <code>{curlExample}</code>
              </pre>
            </div>

            <div className="text-sm text-sub">
              <p className="mb-1"><strong>Endpoints:</strong></p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li><code className="text-xs bg-bg px-1 py-0.5 rounded">GET /api/v1/overview</code></li>
                <li><code className="text-xs bg-bg px-1 py-0.5 rounded">GET /api/v1/users</code></li>
                <li><code className="text-xs bg-bg px-1 py-0.5 rounded">GET /api/v1/cohorts</code></li>
                <li><code className="text-xs bg-bg px-1 py-0.5 rounded">GET /api/v1/wbr</code></li>
                <li><code className="text-xs bg-bg px-1 py-0.5 rounded">GET /api/v1/calendar</code></li>
                <li><code className="text-xs bg-bg px-1 py-0.5 rounded">POST /api/v1/ingest/identify</code></li>
                <li><code className="text-xs bg-bg px-1 py-0.5 rounded">POST /api/v1/ingest/event</code></li>
              </ul>
              <p className="mt-2">
                All responses include <code className="text-xs bg-bg px-1 py-0.5 rounded">view_url</code>.
              </p>
            </div>
          </div>
        </section>

        {/* Agent-Installable Connect */}
        <section className="bg-accent-soft border border-accent-line rounded-lg p-6">
          <h3 className="font-semibold mb-2">Agent-Installable Connect</h3>
          <p className="text-sm text-sub mb-3">
            An agent can connect data sources unattended via CLI:
          </p>
          <pre className="bg-bg border border-rule rounded-lg p-4 text-xs font-mono">
            <code>{`anykpi connect posthog
anykpi connect mixpanel
anykpi identify user123 --name="Jane" --email="jane@example.com"
anykpi track user123 song_played`}</code>
          </pre>
        </section>

        <div className="text-center text-sm text-sub pt-4">
          <p>
            Need help? Check <a href="https://github.com/dillon-wyrld/anykpi/blob/main/docs/introduction.md" className="text-accent underline">docs/introduction.md</a>
          </p>
        </div>
      </div>
    </div>
  );
}
