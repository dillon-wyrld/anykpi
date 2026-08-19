"use client";

import { useState } from "react";
import Link from "next/link";
import { browserSnippet } from "@/sdk";
import {
  detectKind,
  fieldsFor,
  parseCsv,
  previewCsv,
  suggestMapping,
  type ImportKind,
} from "@/core/csv-parse";

export default function ConnectPage() {
  const [selectedPath, setSelectedPath] = useState<"existing" | "sdk" | "csv" | null>(null);
  const [csvText, setCsvText] = useState("");
  const [csvName, setCsvName] = useState("");
  const [csvKind, setCsvKind] = useState<ImportKind>("events");
  const [csvMapping, setCsvMapping] = useState<Record<string, string>>({});
  const [csvColumns, setCsvColumns] = useState<string[]>([]);
  const [csvSample, setCsvSample] = useState<Record<string, string>[]>([]);
  const [csvRowCount, setCsvRowCount] = useState(0);
  const [csvParseError, setCsvParseError] = useState<string | null>(null);
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvResult, setCsvResult] = useState<{
    ok: boolean;
    imported?: number;
    skipped?: number;
    error?: string;
    errors?: Array<{ line: number; message: string }>;
  } | null>(null);
  const [workspaceId, setWorkspaceId] = useState("live");
  const [posthogKey, setPosthogKey] = useState("");
  const [posthogProject, setPosthogProject] = useState("");
  const [posthogHost, setPosthogHost] = useState("");
  const [mixpanelProject, setMixpanelProject] = useState("");
  const [mixpanelSecret, setMixpanelSecret] = useState("");
  const [amplitudeKey, setAmplitudeKey] = useState("");
  const [amplitudeSecret, setAmplitudeSecret] = useState("");
  const [stripeKey, setStripeKey] = useState("");
  const [stripeWebhookSecret, setStripeWebhookSecret] = useState("");
  const [webhookSource, setWebhookSource] = useState("webhook");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [icsUrl, setIcsUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [adminKey, setAdminKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [sdkSnippet, setSdkSnippet] = useState("");
  const [connecting, setConnecting] = useState<string | null>(null);
  const [connectStatus, setConnectStatus] = useState<{
    source: string;
    ok: boolean;
    rotated?: boolean;
    error?: string;
  } | null>(null);

  const handleGenerateApiKey = async () => {
    try {
      const response = await fetch("/api/v1/keys", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(adminKey ? { Authorization: `Bearer ${adminKey}` } : {}),
        },
        body: JSON.stringify({ name: "MCP Access" }),
      });
      const data = await response.json();
      if (!response.ok || !data.key) {
        return;
      }
      setApiKey(data.key);
      setShowApiKey(true);
    } catch {
      // Do not log keys or request bodies
    }
  };

  const connectSource = async (
    source: string,
    credentials: Record<string, string>
  ) => {
    setConnecting(source);
    setConnectStatus(null);
    try {
      const response = await fetch("/api/v1/connect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(adminKey ? { Authorization: `Bearer ${adminKey}` } : {}),
        },
        body: JSON.stringify({ source, credentials, workspaceId }),
      });
      const data = (await response.json()) as {
        error?: string;
        rotated?: boolean;
      };
      if (!response.ok) {
        setConnectStatus({
          source,
          ok: false,
          error: data.error || "Could not save credentials",
        });
        return;
      }
      setConnectStatus({
        source,
        ok: true,
        rotated: data.rotated,
      });
      if (source === "ics") {
        await fetch("/api/v1/sync", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(adminKey ? { Authorization: `Bearer ${adminKey}` } : {}),
          },
          body: JSON.stringify({ source: "ics", workspace: workspaceId }),
        });
      }
    } catch {
      setConnectStatus({
        source,
        ok: false,
        error: "Could not save credentials",
      });
    } finally {
      setConnecting(null);
    }
  };

  const statusFor = (source: string) =>
    connectStatus && connectStatus.source === source ? connectStatus : null;

  const applyCsv = (text: string, name: string, kindOverride?: ImportKind) => {
    setCsvText(text);
    setCsvName(name);
    setCsvResult(null);
    const parsed = parseCsv(text);
    if (!parsed.ok) {
      setCsvParseError(`Line ${parsed.line}: ${parsed.message}`);
      setCsvColumns([]);
      setCsvSample([]);
      setCsvRowCount(0);
      setCsvMapping({});
      return;
    }
    const kind = kindOverride ?? detectKind(parsed.headers) ?? "events";
    const mapping = suggestMapping(parsed.headers, kind);
    const preview = previewCsv(parsed.headers, parsed.records, kind, mapping);
    setCsvParseError(null);
    setCsvKind(kind);
    setCsvMapping(mapping);
    setCsvColumns(preview.columns);
    setCsvSample(preview.sample);
    setCsvRowCount(preview.rowCount);
  };

  const handleCsvFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      applyCsv(String(reader.result ?? ""), file.name);
    };
    reader.readAsText(file);
  };

  const handleCsvKindChange = (kind: ImportKind) => {
    if (!csvText) {
      setCsvKind(kind);
      return;
    }
    applyCsv(csvText, csvName, kind);
  };

  const handleCsvImport = async () => {
    setCsvImporting(true);
    setCsvResult(null);
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(adminKey ? { Authorization: `Bearer ${adminKey}` } : {}),
      };
      const connected = await fetch("/api/v1/connect", {
        method: "POST",
        headers,
        body: JSON.stringify({
          source: "csv",
          workspaceId,
          credentials: {
            kind: csvKind,
            mapping: JSON.stringify(csvMapping),
          },
        }),
      });
      if (!connected.ok) {
        const data = (await connected.json()) as { error?: string };
        setCsvResult({
          ok: false,
          error: data.error || "Could not save mapping",
        });
        return;
      }

      const response = await fetch("/api/v1/import", {
        method: "POST",
        headers,
        body: JSON.stringify({
          csv: csvText,
          kind: csvKind,
          mapping: csvMapping,
          workspaceId,
        }),
      });
      const data = (await response.json()) as {
        error?: string;
        imported?: number;
        skipped?: number;
        errors?: Array<{ line: number; message: string }>;
      };
      if (!response.ok) {
        setCsvResult({
          ok: false,
          error: data.error || "Import failed",
          errors: data.errors,
        });
        return;
      }
      setCsvResult({
        ok: true,
        imported: data.imported,
        skipped: data.skipped,
      });
    } catch {
      setCsvResult({ ok: false, error: "Import failed" });
    } finally {
      setCsvImporting(false);
    }
  };

  const handleGenerateSnippet = () => {
    setSdkSnippet(
      browserSnippet({
        endpoint: window.location.origin,
        workspaceId: "live",
        apiKey: "YOUR_API_KEY",
        debug: true,
      })
    );
  };

  const analyticsTools = [
    {
      id: "posthog",
      name: "PostHog",
      description: "Open-source product analytics",
      badge: "📊",
    },
    {
      id: "mixpanel",
      name: "Mixpanel",
      description: "Product analytics platform",
      badge: "📈",
    },
    {
      id: "amplitude",
      name: "Amplitude",
      description: "Digital analytics platform",
      badge: "📉",
    },
  ];

  const otherTools = [
    {
      id: "revenuecat",
      name: "RevenueCat",
      description: "Mobile subscription data for calendar and metrics",
      status: "dark",
      badge: "📱",
    },
    {
      id: "mercury",
      name: "Mercury",
      description: "Banking data for payroll and runway tracking",
      status: "dark",
      badge: "🏦",
    },
    {
      id: "github",
      name: "GitHub",
      description: "Release tracking for calendar ship days",
      status: "dark",
      badge: "🚀",
    },
  ];

  return (
    <div className="min-h-screen bg-bg">
      <div className="max-w-4xl mx-auto p-8">
        <div className="flex items-center gap-4 mb-8">
          <Link href="/dashboard" className="text-accent hover:underline text-sm">
            ← Back to Dashboard
          </Link>
        </div>

        <div className="mb-8">
          <h1 className="font-display text-3xl font-bold mb-2">Connect Your Data</h1>
          <p className="text-sub">
            Three paths. All doable by a human OR an AI agent. Choose one:
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 mb-12">
          <button
            onClick={() => setSelectedPath("existing")}
            className={`bg-panel border-2 rounded-lg p-6 text-left hover:border-accent ${
              selectedPath === "existing" ? "border-accent" : "border-border"
            }`}
          >
            <div className="text-3xl mb-3">🔌</div>
            <h2 className="font-display text-xl font-semibold mb-2">Path 1: Connect Existing Tools</h2>
            <p className="text-sm text-sub">
              PostHog, Mixpanel, Amplitude, Stripe... tools you already pay for. ANYKPI syncs summaries
              and never writes back.
            </p>
          </button>

          <button
            onClick={() => setSelectedPath("sdk")}
            className={`bg-panel border-2 rounded-lg p-6 text-left hover:border-accent ${
              selectedPath === "sdk" ? "border-accent" : "border-border"
            }`}
          >
            <div className="text-3xl mb-3">📦</div>
            <h2 className="font-display text-xl font-semibold mb-2">Path 2: Add ANYKPI Events</h2>
            <p className="text-sm text-sub">
              Don't have PostHog/Mixpanel/Amplitude? Add the ANYKPI SDK. Self-hosted, data stays on your
              machine.
            </p>
          </button>

          <button
            onClick={() => setSelectedPath("csv")}
            className={`bg-panel border-2 rounded-lg p-6 text-left hover:border-accent ${
              selectedPath === "csv" ? "border-accent" : "border-border"
            }`}
          >
            <div className="text-3xl mb-3">📄</div>
            <h2 className="font-display text-xl font-semibold mb-2">Path 3: Import CSV</h2>
            <p className="text-sm text-sub">
              Upload users or events. Preview the column mapping, then import in one transaction.
            </p>
          </button>
        </div>

        {selectedPath === "existing" && (
          <div className="space-y-8">
            <section className="bg-panel border border-border rounded-lg p-6 space-y-3">
              <h2 className="font-display text-lg font-semibold">Save credentials</h2>
              <p className="text-sm text-sub">
                Writes require an API key. Config is encrypted at rest with ANYKPI_SECRET
                and is never shown again.
              </p>
              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-mono uppercase tracking-wider text-faint mb-1">
                    Workspace
                  </label>
                  <input
                    type="text"
                    value={workspaceId}
                    onChange={(e) => setWorkspaceId(e.target.value)}
                    placeholder="live"
                    className="w-full px-3 py-2 text-sm bg-bg border border-border rounded font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-mono uppercase tracking-wider text-faint mb-1">
                    ANYKPI API key
                  </label>
                  <input
                    type="password"
                    value={adminKey}
                    onChange={(e) => setAdminKey(e.target.value)}
                    placeholder="Required to save"
                    className="w-full px-3 py-2 text-sm bg-bg border border-border rounded font-mono"
                  />
                </div>
              </div>
            </section>

            <section>
              <h2 className="font-display text-xl font-semibold mb-4">Analytics Platforms</h2>
              <div className="grid gap-4">
                {analyticsTools.map((tool) => (
                  <div key={tool.id} className="bg-panel border border-border rounded-lg p-6">
                    <div className="flex items-start gap-4">
                      <span className="text-3xl">{tool.badge}</span>
                      <div className="flex-1">
                        <h3 className="font-semibold text-base mb-1">{tool.name}</h3>
                        <p className="text-sm text-sub mb-3">{tool.description}</p>

                        {tool.id === "posthog" && (
                          <div className="space-y-3">
                            <div>
                              <label className="block text-xs font-mono uppercase tracking-wider text-faint mb-1">
                                PostHog API Key
                              </label>
                              <input
                                type="password"
                                value={posthogKey}
                                onChange={(e) => setPosthogKey(e.target.value)}
                                placeholder="phc_..."
                                className="w-full px-3 py-2 text-sm bg-bg border border-border rounded font-mono"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-mono uppercase tracking-wider text-faint mb-1">
                                Project ID
                              </label>
                              <input
                                type="text"
                                value={posthogProject}
                                onChange={(e) => setPosthogProject(e.target.value)}
                                placeholder="Project ID"
                                className="w-full px-3 py-2 text-sm bg-bg border border-border rounded font-mono"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-mono uppercase tracking-wider text-faint mb-1">
                                Host (optional)
                              </label>
                              <input
                                type="text"
                                value={posthogHost}
                                onChange={(e) => setPosthogHost(e.target.value)}
                                placeholder="https://app.posthog.com"
                                className="w-full px-3 py-2 text-sm bg-bg border border-border rounded font-mono"
                              />
                            </div>
                            <button
                              type="button"
                              disabled={connecting === "posthog"}
                              onClick={() =>
                                connectSource("posthog", {
                                  apiKey: posthogKey,
                                  projectId: posthogProject,
                                  ...(posthogHost ? { host: posthogHost } : {}),
                                })
                              }
                              className="px-4 py-2 bg-accent text-white text-sm rounded hover:opacity-90 disabled:opacity-60"
                            >
                              Connect PostHog
                            </button>
                            {statusFor("posthog")?.ok && (
                              <p className="text-sm text-sub">
                                {statusFor("posthog")?.rotated
                                  ? "PostHog credentials updated."
                                  : "PostHog connected."}
                              </p>
                            )}
                            {statusFor("posthog") && !statusFor("posthog")?.ok && (
                              <p className="text-sm text-sub">
                                {statusFor("posthog")?.error}
                              </p>
                            )}
                          </div>
                        )}

                        {tool.id === "mixpanel" && (
                          <div className="space-y-3">
                            <div>
                              <label className="block text-xs font-mono uppercase tracking-wider text-faint mb-1">
                                Mixpanel Project ID
                              </label>
                              <input
                                type="text"
                                value={mixpanelProject}
                                onChange={(e) => setMixpanelProject(e.target.value)}
                                placeholder="Project ID"
                                className="w-full px-3 py-2 text-sm bg-bg border border-border rounded font-mono"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-mono uppercase tracking-wider text-faint mb-1">
                                Mixpanel API Secret
                              </label>
                              <input
                                type="password"
                                value={mixpanelSecret}
                                onChange={(e) => setMixpanelSecret(e.target.value)}
                                placeholder="API Secret"
                                className="w-full px-3 py-2 text-sm bg-bg border border-border rounded font-mono"
                              />
                            </div>
                            <button
                              type="button"
                              disabled={connecting === "mixpanel"}
                              onClick={() =>
                                connectSource("mixpanel", {
                                  projectId: mixpanelProject,
                                  apiSecret: mixpanelSecret,
                                })
                              }
                              className="px-4 py-2 bg-accent text-white text-sm rounded hover:opacity-90 disabled:opacity-60"
                            >
                              Connect Mixpanel
                            </button>
                            {statusFor("mixpanel")?.ok && (
                              <p className="text-sm text-sub">
                                {statusFor("mixpanel")?.rotated
                                  ? "Mixpanel credentials updated."
                                  : "Mixpanel connected."}
                              </p>
                            )}
                            {statusFor("mixpanel") && !statusFor("mixpanel")?.ok && (
                              <p className="text-sm text-sub">
                                {statusFor("mixpanel")?.error}
                              </p>
                            )}
                          </div>
                        )}

                        {tool.id === "amplitude" && (
                          <div className="space-y-3">
                            <div>
                              <label className="block text-xs font-mono uppercase tracking-wider text-faint mb-1">
                                Amplitude API Key
                              </label>
                              <input
                                type="password"
                                value={amplitudeKey}
                                onChange={(e) => setAmplitudeKey(e.target.value)}
                                placeholder="API Key"
                                className="w-full px-3 py-2 text-sm bg-bg border border-border rounded font-mono"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-mono uppercase tracking-wider text-faint mb-1">
                                Amplitude Secret Key
                              </label>
                              <input
                                type="password"
                                value={amplitudeSecret}
                                onChange={(e) => setAmplitudeSecret(e.target.value)}
                                placeholder="Secret Key"
                                className="w-full px-3 py-2 text-sm bg-bg border border-border rounded font-mono"
                              />
                            </div>
                            <button
                              type="button"
                              disabled={connecting === "amplitude"}
                              onClick={() =>
                                connectSource("amplitude", {
                                  apiKey: amplitudeKey,
                                  secretKey: amplitudeSecret,
                                })
                              }
                              className="px-4 py-2 bg-accent text-white text-sm rounded hover:opacity-90 disabled:opacity-60"
                            >
                              Connect Amplitude
                            </button>
                            {statusFor("amplitude")?.ok && (
                              <p className="text-sm text-sub">
                                {statusFor("amplitude")?.rotated
                                  ? "Amplitude credentials updated."
                                  : "Amplitude connected."}
                              </p>
                            )}
                            {statusFor("amplitude") && !statusFor("amplitude")?.ok && (
                              <p className="text-sm text-sub">
                                {statusFor("amplitude")?.error}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h2 className="font-display text-xl font-semibold mb-4">Revenue</h2>
              <div className="grid gap-4">
                <div className="bg-panel border border-border rounded-lg p-6">
                  <div className="flex items-start gap-4">
                    <span className="text-3xl">💳</span>
                    <div className="flex-1">
                      <h3 className="font-semibold text-base mb-1">Stripe</h3>
                      <p className="text-sm text-sub mb-3">
                        Restricted read-only key for subscription backfill. Webhook
                        signing secret keeps MRR minutes-fresh.
                      </p>
                      <div className="space-y-3">
                        <div>
                          <label className="block text-xs font-mono uppercase tracking-wider text-faint mb-1">
                            Restricted key (read-only)
                          </label>
                          <input
                            type="password"
                            value={stripeKey}
                            onChange={(e) => setStripeKey(e.target.value)}
                            placeholder="rk_..."
                            className="w-full px-3 py-2 text-sm bg-bg border border-border rounded font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-mono uppercase tracking-wider text-faint mb-1">
                            Webhook signing secret
                          </label>
                          <input
                            type="password"
                            value={stripeWebhookSecret}
                            onChange={(e) => setStripeWebhookSecret(e.target.value)}
                            placeholder="whsec_..."
                            className="w-full px-3 py-2 text-sm bg-bg border border-border rounded font-mono"
                          />
                        </div>
                        <button
                          type="button"
                          disabled={connecting === "stripe"}
                          onClick={() =>
                            connectSource("stripe", {
                              apiKey: stripeKey,
                              ...(stripeWebhookSecret
                                ? { webhookSecret: stripeWebhookSecret }
                                : {}),
                            })
                          }
                          className="px-4 py-2 bg-accent text-white text-sm rounded hover:opacity-90 disabled:opacity-60"
                        >
                          Connect Stripe
                        </button>
                        {statusFor("stripe")?.ok && (
                          <p className="text-sm text-sub">
                            {statusFor("stripe")?.rotated
                              ? "Stripe credentials updated."
                              : "Stripe connected."}
                          </p>
                        )}
                        {statusFor("stripe") && !statusFor("stripe")?.ok && (
                          <p className="text-sm text-sub">
                            {statusFor("stripe")?.error}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section>
              <h2 className="font-display text-xl font-semibold mb-4">Realtime webhook</h2>
              <div className="bg-panel border border-border rounded-lg p-6">
                <p className="text-sm text-sub mb-3">
                  Per-source HMAC for <code>POST /api/ingest/webhook/:source</code>.
                  Re-submit to rotate. Recipes: <code>docs/webhooks.md</code>.
                </p>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-mono uppercase tracking-wider text-faint mb-1">
                      Source slug
                    </label>
                    <input
                      type="text"
                      value={webhookSource}
                      onChange={(e) => setWebhookSource(e.target.value)}
                      placeholder="webhook"
                      className="w-full px-3 py-2 text-sm bg-bg border border-border rounded font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-mono uppercase tracking-wider text-faint mb-1">
                      HMAC secret
                    </label>
                    <input
                      type="password"
                      value={webhookSecret}
                      onChange={(e) => setWebhookSecret(e.target.value)}
                      placeholder="Rotatable signing secret"
                      className="w-full px-3 py-2 text-sm bg-bg border border-border rounded font-mono"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={connecting === webhookSource}
                    onClick={() =>
                      connectSource(webhookSource, { hmacSecret: webhookSecret })
                    }
                    className="px-4 py-2 bg-accent text-white text-sm rounded hover:opacity-90 disabled:opacity-60"
                  >
                    Save webhook secret
                  </button>
                  {statusFor(webhookSource)?.ok && (
                    <p className="text-sm text-sub">
                      {statusFor(webhookSource)?.rotated
                        ? "Webhook secret rotated."
                        : "Webhook secret saved."}
                    </p>
                  )}
                  {statusFor(webhookSource) && !statusFor(webhookSource)?.ok && (
                    <p className="text-sm text-sub">
                      {statusFor(webhookSource)?.error}
                    </p>
                  )}
                </div>
              </div>
            </section>

            <section>
              <h2 className="font-display text-xl font-semibold mb-4">Calendar</h2>
              <div className="bg-panel border border-border rounded-lg p-6">
                <div className="flex items-start gap-4">
                  <span className="text-3xl">📅</span>
                  <div className="flex-1">
                    <h3 className="font-semibold text-base mb-1">ICS feed</h3>
                    <p className="text-sm text-sub mb-3">
                      Paste a read-only calendar URL. Events appear on the Calendar
                      view. Nothing is written back.
                    </p>
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-mono uppercase tracking-wider text-faint mb-1">
                          ICS URL
                        </label>
                        <input
                          type="url"
                          value={icsUrl}
                          onChange={(e) => setIcsUrl(e.target.value)}
                          placeholder="https://…"
                          className="w-full px-3 py-2 text-sm bg-bg border border-border rounded font-mono"
                        />
                      </div>
                      <button
                        type="button"
                        disabled={connecting === "ics"}
                        onClick={() => connectSource("ics", { icsUrl })}
                        className="px-4 py-2 bg-accent text-white text-sm rounded hover:opacity-90 disabled:opacity-60"
                      >
                        Connect calendar
                      </button>
                      {statusFor("ics")?.ok && (
                        <p className="text-sm text-sub">
                          {statusFor("ics")?.rotated
                            ? "Calendar URL updated."
                            : "Calendar connected."}
                        </p>
                      )}
                      {statusFor("ics") && !statusFor("ics")?.ok && (
                        <p className="text-sm text-sub">{statusFor("ics")?.error}</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section>
              <h2 className="font-display text-xl font-semibold mb-4">Other Data Sources</h2>
              <div className="grid gap-4">
                {otherTools.map((tool) => (
                  <div
                    key={tool.id}
                    className="bg-panel border border-border rounded-lg p-6 opacity-60"
                  >
                    <div className="flex items-start gap-4">
                      <span className="text-3xl">{tool.badge}</span>
                      <div>
                        <h3 className="font-semibold text-base mb-1">{tool.name}</h3>
                        <p className="text-sm text-sub mb-3">{tool.description}</p>
                        <span className="inline-block text-xs text-faint font-mono uppercase tracking-wider border border-border rounded px-2 py-1">
                          Coming Soon
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {selectedPath === "sdk" && (
          <div className="space-y-6">
            <div className="bg-panel border border-border rounded-lg p-6">
              <div className="flex items-start gap-4 mb-4">
                <span className="text-3xl">📦</span>
                <div className="flex-1">
                  <h3 className="font-semibold text-base mb-1">ANYKPI SDK</h3>
                  <p className="text-sm text-sub mb-4">
                    Install the ANYKPI SDK in your app. Events go directly to your self-hosted instance.
                    Person-level data never leaves your machine.
                  </p>

                  <button
                    onClick={handleGenerateSnippet}
                    className="px-4 py-2 bg-accent text-white text-sm rounded hover:opacity-90 mb-4"
                  >
                    Generate Installation Snippet
                  </button>

                  {sdkSnippet && (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-mono uppercase tracking-wider text-faint mb-1">
                          Add this to your app's HTML
                        </label>
                        <pre className="bg-bg border border-border rounded p-3 text-xs font-mono overflow-x-auto">
                          {sdkSnippet}
                        </pre>
                        <button
                          onClick={() => navigator.clipboard.writeText(sdkSnippet)}
                          className="mt-2 px-3 py-1 border border-border rounded text-xs hover:bg-panel-2"
                        >
                          Copy Snippet
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="bg-accent-soft border border-accent-line rounded-lg p-4 text-sm">
              <p className="mb-2">
                <strong>For agents:</strong> An agent can install this snippet, configure value events,
                and verify first events arrive — all unattended via MCP.
              </p>
              <a href="#agent-setup" className="text-accent hover:underline text-xs">
                View agent setup guide →
              </a>
            </div>

            <div className="bg-panel border border-border rounded-lg p-6">
              <h3 className="font-semibold mb-3">Configure Value Events</h3>
              <p className="text-sm text-sub mb-4">
                Tell ANYKPI which events matter. These map to the dot plot's cell grammar.
              </p>
              <div className="space-y-2 text-sm">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-accent w-16">core:</span>
                  <span className="text-sub">The main value action (e.g., "song_played", "doc_created")</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-accent w-16">search:</span>
                  <span className="text-sub">Discovery actions</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-accent w-16">share:</span>
                  <span className="text-sub">Sharing or collaboration</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-accent w-16">pay:</span>
                  <span className="text-sub">Payment events</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {selectedPath === "csv" && (
          <div className="space-y-6">
            <section className="bg-panel border border-border rounded-lg p-6 space-y-4">
              <h2 className="font-display text-xl font-semibold">Import CSV</h2>
              <p className="text-sm text-sub">
                Users and events. Mapping is stored encrypted via POST /api/v1/connect
                (ANYKPI_SECRET). Re-running the same file does not create duplicate events.
              </p>
              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-mono uppercase tracking-wider text-faint mb-1">
                    Workspace
                  </label>
                  <input
                    type="text"
                    value={workspaceId}
                    onChange={(e) => setWorkspaceId(e.target.value)}
                    placeholder="live"
                    className="w-full px-3 py-2 text-sm bg-bg border border-border rounded font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-mono uppercase tracking-wider text-faint mb-1">
                    ANYKPI API key
                  </label>
                  <input
                    type="password"
                    value={adminKey}
                    onChange={(e) => setAdminKey(e.target.value)}
                    placeholder="Required to import"
                    className="w-full px-3 py-2 text-sm bg-bg border border-border rounded font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-mono uppercase tracking-wider text-faint mb-1">
                  CSV file
                </label>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => handleCsvFile(e.target.files?.[0])}
                  className="w-full text-sm"
                />
                {csvName && (
                  <p className="mt-2 text-xs text-faint font-mono">
                    {csvName} · {csvRowCount} rows
                  </p>
                )}
              </div>
              {csvParseError && (
                <p className="text-sm text-red-400">{csvParseError}</p>
              )}
            </section>

            {csvColumns.length > 0 && (
              <section className="bg-panel border border-border rounded-lg p-6 space-y-4">
                <div className="flex flex-wrap items-end gap-4">
                  <div>
                    <label className="block text-xs font-mono uppercase tracking-wider text-faint mb-1">
                      File kind
                    </label>
                    <select
                      value={csvKind}
                      onChange={(e) => handleCsvKindChange(e.target.value as ImportKind)}
                      className="px-3 py-2 text-sm bg-bg border border-border rounded font-mono"
                    >
                      <option value="events">events</option>
                      <option value="users">users</option>
                    </select>
                  </div>
                  <p className="text-sm text-sub">
                    Column-mapping preview. Change a field if the guess is wrong.
                  </p>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs font-mono uppercase tracking-wider text-faint">
                        <th className="pb-2 pr-4">Column</th>
                        <th className="pb-2">Maps to</th>
                      </tr>
                    </thead>
                    <tbody>
                      {csvColumns.map((column) => (
                        <tr key={column} className="border-t border-border">
                          <td className="py-2 pr-4 font-mono">{column}</td>
                          <td className="py-2">
                            <select
                              value={csvMapping[column] ?? ""}
                              onChange={(e) => {
                                const next = { ...csvMapping };
                                if (e.target.value) next[column] = e.target.value;
                                else delete next[column];
                                setCsvMapping(next);
                              }}
                              className="px-2 py-1 text-sm bg-bg border border-border rounded font-mono"
                            >
                              <option value="">(ignore)</option>
                              {fieldsFor(csvKind).map((field) => (
                                <option key={field} value={field}>
                                  {field}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {csvSample.length > 0 && (
                  <div className="overflow-x-auto">
                    <p className="text-xs font-mono uppercase tracking-wider text-faint mb-2">
                      First rows
                    </p>
                    <table className="w-full text-xs font-mono">
                      <thead>
                        <tr className="text-left text-faint">
                          {csvColumns.map((column) => (
                            <th key={column} className="pb-2 pr-3">
                              {column}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {csvSample.map((row, index) => (
                          <tr key={index} className="border-t border-border">
                            {csvColumns.map((column) => (
                              <td key={column} className="py-1 pr-3">
                                {row[column] || "—"}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <button
                  onClick={handleCsvImport}
                  disabled={csvImporting || !csvText}
                  className="px-4 py-2 bg-accent text-white text-sm rounded hover:opacity-90 disabled:opacity-50"
                >
                  {csvImporting ? "Importing…" : "Import"}
                </button>

                {csvResult && (
                  <div
                    className={`text-sm rounded-lg p-3 border ${
                      csvResult.ok
                        ? "bg-accent-soft border-accent-line"
                        : "border-border"
                    }`}
                  >
                    {csvResult.ok ? (
                      <p>
                        Imported {csvResult.imported ?? 0}
                        {(csvResult.skipped ?? 0) > 0
                          ? ` · ${csvResult.skipped} already present`
                          : ""}
                      </p>
                    ) : (
                      <div className="space-y-1">
                        <p>{csvResult.error}</p>
                        {(csvResult.errors ?? []).slice(0, 20).map((error) => (
                          <p key={`${error.line}-${error.message}`} className="font-mono text-xs">
                            line {error.line}: {error.message}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}
          </div>
        )}

        <div className="mt-12 space-y-8">

          <section>
            <h2 className="font-display text-xl font-semibold mb-4">Agents</h2>
            <div className="bg-panel border border-border rounded-lg p-6">
              <div className="flex items-start gap-4 mb-4">
                <span className="text-3xl">🤖</span>
                <div className="flex-1">
                  <h3 className="font-semibold text-base mb-1">MCP Server</h3>
                  <p className="text-sm text-sub mb-3">
                    Give your AI agents access to ANYKPI data. Every answer includes a view_url
                    that opens the dashboard in the state that proves it.
                  </p>

                  {!showApiKey ? (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-mono uppercase tracking-wider text-faint mb-1">
                          Existing ANYKPI_API_KEY
                        </label>
                        <input
                          type="password"
                          value={adminKey}
                          onChange={(e) => setAdminKey(e.target.value)}
                          placeholder="Required to mint a new key"
                          className="w-full px-3 py-2 text-sm bg-bg border border-border rounded font-mono"
                        />
                      </div>
                      <button
                        onClick={handleGenerateApiKey}
                        className="px-4 py-2 bg-accent text-white text-sm rounded hover:opacity-90"
                      >
                        Generate API Key
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-mono uppercase tracking-wider text-faint mb-1">
                          API Key (save this — it won't be shown again)
                        </label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={apiKey}
                            readOnly
                            className="flex-1 px-3 py-2 text-sm bg-bg border border-border rounded font-mono"
                          />
                          <button
                            onClick={() => navigator.clipboard.writeText(apiKey)}
                            className="px-3 py-2 border border-border rounded text-sm hover:bg-panel-2"
                          >
                            Copy
                          </button>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-mono uppercase tracking-wider text-faint mb-1">
                          MCP Endpoint
                        </label>
                        <code className="block px-3 py-2 text-sm bg-bg border border-border rounded font-mono">
                          http://localhost:3000/api/mcp
                        </code>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-4 p-4 bg-accent-soft border border-accent-line rounded-lg text-sm">
              <p className="mb-2">
                <strong>For agents:</strong> Add this MCP server to your agent's configuration
                with the API key above. The agent can then query users, get cohorts, check WBR
                metrics, and more — every response includes a clickable link to the view.
              </p>
              <a
                href="https://github.com/anykpi/anykpi#agent-setup"
                className="text-accent hover:underline text-xs"
              >
                View agent setup guide →
              </a>
            </div>
          </section>

          <section className="border-t border-rule pt-6">
            <p className="text-sm text-sub">
              Hosted version:{" "}
              <a
                href="https://github.com/dillon-wyrld/anykpi/discussions"
                className="text-accent hover:underline"
              >
                join the waitlist
              </a>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
