"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { browserSnippet } from "@/sdk";
import { setupPath } from "@/core/setup-flow";
import { SetupFlow } from "./SetupFlow";
import {
  DEFAULT_INSTANCE_ORIGIN,
  READ_KEY_CONSENT,
  buildAgentPrompt,
  mcpAddress,
} from "@/app/agents/onboarding";
import {
  detectKind,
  fieldsFor,
  parseCsv,
  previewCsv,
  suggestMapping,
  type ImportKind,
} from "@/core/csv-parse";
import { AuditReadout } from "./AuditReadout";
import { ConnectorHealthPanel } from "./ConnectorHealthPanel";
import { ValueEventPicker } from "./ValueEventPicker";
import {
  DEFAULT_COMPANY_NAME,
  DEMO_HOME_CITY,
  formatCompanyDayLabel,
  HOME_CITY_PRESETS,
} from "@/core/company-day";

function ConnectSettings({ workspaceFromQuery }: { workspaceFromQuery: string }) {
  const [selectedPath, setSelectedPath] = useState<
    "existing" | "sdk" | "csv" | "agents" | null
  >(null);
  const [origin, setOrigin] = useState(DEFAULT_INSTANCE_ORIGIN);
  const [copied, setCopied] = useState("");
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
  const [workspaceId, setWorkspaceId] = useState(workspaceFromQuery);
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
  const [companyName, setCompanyName] = useState(DEFAULT_COMPANY_NAME);
  const [foundedDate, setFoundedDate] = useState("");
  const [homeCityLabel, setHomeCityLabel] = useState(DEMO_HOME_CITY.label);
  const [homeCityTimezone, setHomeCityTimezone] = useState(DEMO_HOME_CITY.timezone);
  const [customTimezone, setCustomTimezone] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileStatus, setProfileStatus] = useState<{
    ok: boolean;
    error?: string;
  } | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    setWorkspaceId(workspaceFromQuery);
  }, [workspaceFromQuery]);

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(""), 2000);
    } catch {
      setCopied("");
    }
  };

  useEffect(() => {
    const headers: Record<string, string> = {};
    if (adminKey) headers.Authorization = `Bearer ${adminKey}`;
    fetch(`/api/v1/config?workspace=${encodeURIComponent(workspaceId)}`, {
      headers,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then(
        (
          data: {
            companyName?: string;
            foundedAt?: string | null;
            homeCity?: { timezone: string; label: string } | null;
          } | null
        ) => {
          if (!data) return;
          setCompanyName(data.companyName || DEFAULT_COMPANY_NAME);
          setFoundedDate(data.foundedAt ? data.foundedAt.slice(0, 10) : "");
          if (data.homeCity) {
            setHomeCityLabel(data.homeCity.label);
            setHomeCityTimezone(data.homeCity.timezone);
            setCustomTimezone(
              !HOME_CITY_PRESETS.some(
                (preset) =>
                  preset.timezone === data.homeCity?.timezone &&
                  preset.label === data.homeCity.label
              )
            );
          }
        }
      )
      .catch(() => {
        // Leave the form at defaults when the workspace is locked
      });
  }, [workspaceId, adminKey]);

  const handleSaveCompanyProfile = async () => {
    setProfileSaving(true);
    setProfileStatus(null);
    try {
      const response = await fetch("/api/v1/config", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(adminKey ? { Authorization: `Bearer ${adminKey}` } : {}),
        },
        body: JSON.stringify({
          workspaceId,
          companyName,
          foundedAt: foundedDate || null,
          homeCity:
            homeCityLabel.trim() && homeCityTimezone.trim()
              ? { timezone: homeCityTimezone.trim(), label: homeCityLabel.trim() }
              : null,
        }),
      });
      const data = (await response.json()) as {
        error?: string;
        companyName?: string;
        foundedAt?: string | null;
        homeCity?: { timezone: string; label: string } | null;
      };
      if (!response.ok) {
        setProfileStatus({
          ok: false,
          error: data.error || "Could not save company profile",
        });
        return;
      }
      if (data.companyName) setCompanyName(data.companyName);
      setFoundedDate(data.foundedAt ? data.foundedAt.slice(0, 10) : "");
      if (data.homeCity) {
        setHomeCityLabel(data.homeCity.label);
        setHomeCityTimezone(data.homeCity.timezone);
      }
      setProfileStatus({ ok: true });
    } catch {
      setProfileStatus({ ok: false, error: "Could not save company profile" });
    } finally {
      setProfileSaving(false);
    }
  };

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
        <div className="flex items-center justify-between gap-4 mb-8">
          <Link href="/dashboard" className="text-accent hover:underline text-sm">
            ← Back to Dashboard
          </Link>
          <Link
            href={setupPath(workspaceId)}
            data-testid="reenter-setup"
            className="text-sm text-accent hover:underline"
          >
            First-run setup
          </Link>
        </div>

        <div className="mb-8">
          <h1 className="font-display text-3xl font-bold mb-2">Connect Your Data</h1>
          <p className="text-sub">
            Three data paths, plus an Agents step. All doable by a human OR an AI
            agent. Choose one:
          </p>
        </div>

        <section className="bg-panel border border-border rounded-lg p-6 space-y-4 mb-12">
          <div>
            <h2 className="font-display text-lg font-semibold">Company profile</h2>
            <p className="text-sm text-sub mt-1">
              Name, founded date, and home city for this workspace. Setting the
              name changes {formatCompanyDayLabel(companyName)}.
            </p>
          </div>
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
                placeholder="Required to save a live workspace"
                className="w-full px-3 py-2 text-sm bg-bg border border-border rounded font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-faint mb-1">
                Company name
              </label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder={DEFAULT_COMPANY_NAME}
                className="w-full px-3 py-2 text-sm bg-bg border border-border rounded"
              />
            </div>
            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-faint mb-1">
                Founded date
              </label>
              <input
                type="date"
                value={foundedDate}
                onChange={(e) => setFoundedDate(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-bg border border-border rounded font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-faint mb-1">
                Home city
              </label>
              <input
                type="text"
                value={homeCityLabel}
                onChange={(e) => setHomeCityLabel(e.target.value)}
                placeholder="San Francisco"
                className="w-full px-3 py-2 text-sm bg-bg border border-border rounded"
              />
            </div>
            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-faint mb-1">
                Time zone (IANA)
              </label>
              {customTimezone ? (
                <input
                  type="text"
                  value={homeCityTimezone}
                  onChange={(e) => setHomeCityTimezone(e.target.value)}
                  placeholder="America/Los_Angeles"
                  className="w-full px-3 py-2 text-sm bg-bg border border-border rounded font-mono"
                />
              ) : (
                <select
                  value={`${homeCityTimezone}|${homeCityLabel}`}
                  onChange={(e) => {
                    if (e.target.value === "custom") {
                      setCustomTimezone(true);
                      return;
                    }
                    const [timezone, ...labelParts] = e.target.value.split("|");
                    setHomeCityTimezone(timezone);
                    setHomeCityLabel(labelParts.join("|"));
                  }}
                  className="w-full px-3 py-2 text-sm bg-bg border border-border rounded"
                >
                  {HOME_CITY_PRESETS.map((preset) => (
                    <option
                      key={`${preset.timezone}-${preset.label}`}
                      value={`${preset.timezone}|${preset.label}`}
                    >
                      {preset.label} ({preset.timezone})
                    </option>
                  ))}
                  <option value="custom">Custom IANA time zone…</option>
                </select>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm">
              <span className="text-faint uppercase tracking-wider text-xs font-mono mr-2">
                Preview
              </span>
              <span className="font-semibold">{formatCompanyDayLabel(companyName)}</span>
            </p>
            <button
              type="button"
              onClick={handleSaveCompanyProfile}
              disabled={profileSaving}
              className="px-4 py-2 bg-accent text-white text-sm rounded hover:opacity-90 disabled:opacity-50"
            >
              {profileSaving ? "Saving…" : "Save profile"}
            </button>
          </div>
          {profileStatus && (
            <p className={`text-sm ${profileStatus.ok ? "text-accent" : "text-red-500"}`}>
              {profileStatus.ok
                ? `Saved. ${formatCompanyDayLabel(companyName)}.`
                : profileStatus.error}
            </p>
          )}
        </section>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
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

          <button
            type="button"
            data-testid="agents-setup-step"
            onClick={() => {
              setSelectedPath("agents");
              document.getElementById("agents")?.scrollIntoView({ behavior: "smooth" });
            }}
            className={`bg-panel border-2 rounded-lg p-6 text-left hover:border-accent ${
              selectedPath === "agents" ? "border-accent" : "border-border"
            }`}
          >
            <div className="text-3xl mb-3">🤖</div>
            <h2 className="font-display text-xl font-semibold mb-2">Agents</h2>
            <p className="text-sm text-sub">
              Copy one prompt. Connect Claude, ChatGPT, Cursor, Claude Code, or the CLI.
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
              <Link href="/agents" className="text-accent hover:underline text-xs">
                View agent setup →
              </Link>
            </div>

            <ValueEventPicker workspaceId={workspaceId} apiKey={adminKey} />
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

        {selectedPath === "agents" && (
          <div className="space-y-4 mb-12">
            <section className="bg-panel border border-border rounded-lg p-6 space-y-3">
              <h2 className="font-display text-xl font-semibold">Agents step</h2>
              <p className="text-sm text-sub">
                Copy one prompt, then issue a read key below. Per-client tabs live on{" "}
                <Link href="/agents" className="text-accent hover:underline">
                  /agents
                </Link>
                .
              </p>
              <button
                type="button"
                onClick={() => copyText(buildAgentPrompt(origin), "setup-prompt")}
                className="px-4 py-2 bg-accent text-white text-sm rounded hover:opacity-90"
              >
                {copied === "setup-prompt" ? "Copied" : "Copy prompt"}
              </button>
            </section>
          </div>
        )}

        <div className="mt-12 space-y-8">
          <ConnectorHealthPanel apiKey={adminKey} workspace={workspaceId} />

          <AuditReadout apiKey={adminKey} />

          <section id="agents">
            <h2 className="font-display text-xl font-semibold mb-4">Agents</h2>
            <div className="bg-panel border border-border rounded-lg p-6">
              <div className="flex items-start gap-4 mb-4">
                <span className="text-3xl">🤖</span>
                <div className="flex-1">
                  <h3 className="font-semibold text-base mb-1">Copy one prompt</h3>
                  <p className="text-sm text-sub mb-3">
                    Instance address, <code className="text-xs">/llms.txt</code>,{" "}
                    <code className="text-xs">AGENTS.md</code>, and how to ask for a
                    key. {READ_KEY_CONSENT}
                  </p>
                  <div className="flex flex-wrap gap-2 mb-4">
                    <button
                      type="button"
                      onClick={() => copyText(buildAgentPrompt(origin), "prompt")}
                      className="px-4 py-2 bg-accent text-white text-sm rounded hover:opacity-90"
                    >
                      {copied === "prompt" ? "Copied" : "Copy prompt"}
                    </button>
                    <Link
                      href="/agents"
                      className="px-4 py-2 border border-border rounded text-sm hover:bg-panel-2"
                    >
                      Open /agents
                    </Link>
                  </div>
                  <pre
                    data-testid="connect-agent-prompt"
                    className="bg-bg border border-border rounded p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap mb-6"
                  >
                    {buildAgentPrompt(origin)}
                  </pre>

                  <h3 className="font-semibold text-base mb-1">Issue a key</h3>
                  <p className="text-sm text-sub mb-3">{READ_KEY_CONSENT}</p>

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
                          API Key (save this — it won&apos;t be shown again)
                        </label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={apiKey}
                            readOnly
                            className="flex-1 px-3 py-2 text-sm bg-bg border border-border rounded font-mono"
                          />
                          <button
                            onClick={() => copyText(apiKey, "key")}
                            className="px-3 py-2 border border-border rounded text-sm hover:bg-panel-2"
                          >
                            {copied === "key" ? "Copied" : "Copy"}
                          </button>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-mono uppercase tracking-wider text-faint mb-1">
                          MCP address
                        </label>
                        <code
                          data-testid="connect-mcp-address"
                          className="block px-3 py-2 text-sm bg-bg border border-border rounded font-mono"
                        >
                          {mcpAddress(origin)}
                        </code>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-4 p-4 bg-accent-soft border border-accent-line rounded-lg text-sm">
              <p className="mb-2">
                <strong>For agents:</strong> Paste the prompt, then add the MCP
                address with the API key. The agent can query users, cohorts, and
                WBR — every response includes a view_url. Revoke on{" "}
                <Link href="/agents" className="text-accent hover:underline">
                  /agents
                </Link>
                .
              </p>
              <Link href="/agents" className="text-accent hover:underline text-xs">
                View agent setup →
              </Link>
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

function ConnectPageInner() {
  const searchParams = useSearchParams();
  const workspace = searchParams.get("workspace") || "live";
  if (searchParams.get("setup") === "1") {
    return (
      <SetupFlow
        workspaceId={workspace}
        reentry={searchParams.get("reentry") === "1"}
      />
    );
  }
  return <ConnectSettings workspaceFromQuery={workspace} />;
}

export default function ConnectPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-bg" />}>
      <ConnectPageInner />
    </Suspense>
  );
}
