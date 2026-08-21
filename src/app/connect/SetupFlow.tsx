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
import {
  DEFAULT_COMPANY_NAME,
  DEMO_HOME_CITY,
  formatCompanyDayLabel,
  HOME_CITY_PRESETS,
} from "@/core/company-day";
import {
  dashboardPath,
  settingsPath,
  writeLabeledDemo,
  writeSetupStatus,
} from "@/core/setup-flow";
import { GALLERY_CARDS, type GalleryCard } from "@/core/source-gallery";
import { SourceGallery } from "./SourceGallery";
import {
  SourceCredentialForm,
  type ConnectStatus,
  type CredentialValues,
} from "./SourceCredentialForm";

const STEPS = ["Welcome", "Connect", "First data"] as const;

export function SetupFlow({
  workspaceId,
  reentry = false,
}: {
  workspaceId: string;
  reentry?: boolean;
}) {
  const [step, setStep] = useState(0);
  const [adminKey, setAdminKey] = useState("");
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
  const [picked, setPicked] = useState<GalleryCard | null>(null);
  const [credValues, setCredValues] = useState<CredentialValues>({});
  const [connecting, setConnecting] = useState(false);
  const [connectStatus, setConnectStatus] = useState<ConnectStatus>(null);
  const [connectedSource, setConnectedSource] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [sdkSnippet, setSdkSnippet] = useState("");
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
  } | null>(null);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(adminKey ? { Authorization: `Bearer ${adminKey}` } : {}),
  };

  const finish = (status: "complete" | "skipped", dest: string) => {
    writeSetupStatus(workspaceId, status);
    window.location.href = dest;
  };

  const skipForNow = () => finish("skipped", dashboardPath(workspaceId));

  const saveProfile = async () => {
    setProfileSaving(true);
    setProfileStatus(null);
    try {
      const response = await fetch("/api/v1/config", {
        method: "PATCH",
        headers,
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
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setProfileStatus({
          ok: false,
          error: data.error || "Could not save company profile",
        });
        return false;
      }
      setProfileStatus({ ok: true });
      return true;
    } catch {
      setProfileStatus({ ok: false, error: "Could not save company profile" });
      return false;
    } finally {
      setProfileSaving(false);
    }
  };

  const connectSource = async (source: string, credentials: CredentialValues) => {
    setConnecting(true);
    setConnectStatus(null);
    try {
      const response = await fetch("/api/v1/connect", {
        method: "POST",
        headers,
        body: JSON.stringify({ source, credentials, workspaceId }),
      });
      const data = (await response.json()) as { error?: string; rotated?: boolean };
      if (!response.ok) {
        setConnectStatus({
          source,
          ok: false,
          error: data.error || "Could not save credentials",
        });
        return;
      }
      setConnectStatus({ source, ok: true, rotated: data.rotated });
      setConnectedSource(source);
    } catch {
      setConnectStatus({ source, ok: false, error: "Could not save credentials" });
    } finally {
      setConnecting(false);
    }
  };

  const syncNow = async () => {
    setSyncing(true);
    setSyncStatus(null);
    try {
      const response = await fetch("/api/v1/sync", {
        method: "POST",
        headers,
        body: JSON.stringify({
          workspace: workspaceId,
          source: connectedSource ?? "all",
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setSyncStatus(data.error || "Sync did not finish");
        return;
      }
      finish("complete", dashboardPath(workspaceId));
    } catch {
      setSyncStatus("Sync did not finish");
    } finally {
      setSyncing(false);
    }
  };

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

  const handleCsvImport = async () => {
    setCsvImporting(true);
    setCsvResult(null);
    try {
      const connected = await fetch("/api/v1/connect", {
        method: "POST",
        headers,
        body: JSON.stringify({
          source: "csv",
          workspaceId,
          credentials: { kind: csvKind, mapping: JSON.stringify(csvMapping) },
        }),
      });
      if (!connected.ok) {
        const data = (await connected.json()) as { error?: string };
        setCsvResult({ ok: false, error: data.error || "Could not save mapping" });
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
      };
      if (!response.ok) {
        setCsvResult({ ok: false, error: data.error || "Import failed" });
        return;
      }
      setCsvResult({ ok: true, imported: data.imported, skipped: data.skipped });
      writeSetupStatus(workspaceId, "complete");
    } catch {
      setCsvResult({ ok: false, error: "Import failed" });
    } finally {
      setCsvImporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg" data-testid="setup-flow">
      <div className="max-w-3xl mx-auto p-8">
        <div className="flex items-center justify-between gap-4 mb-8">
          <Link
            href={settingsPath(workspaceId)}
            className="text-accent hover:underline text-sm"
          >
            ← Settings
          </Link>
          <button
            type="button"
            data-testid="setup-skip"
            onClick={skipForNow}
            className="text-sm text-sub hover:text-text"
          >
            Skip for now
          </button>
        </div>

        <p className="text-xs font-mono uppercase tracking-wider text-faint mb-2">
          {reentry ? "Setup" : "First-run"} · Step {step + 1} of {STEPS.length}
        </p>
        <ol className="flex gap-2 mb-6" data-testid="setup-steps">
          {STEPS.map((label, index) => (
            <li
              key={label}
              className={`text-xs font-mono uppercase tracking-wider px-2 py-1 rounded border ${
                index === step
                  ? "border-accent text-accent bg-accent-soft"
                  : index < step
                    ? "border-border text-text"
                    : "border-border text-faint"
              }`}
            >
              {index + 1}. {label}
            </li>
          ))}
        </ol>

        {step === 0 && (
          <section className="bg-panel border border-border rounded-lg p-6 space-y-4" data-testid="setup-welcome">
            <div>
              <h1 className="font-display text-2xl font-bold">Welcome to ANYKPI</h1>
              <p className="text-sm text-sub mt-1">
                Name, founded date, and home city for this workspace. Setting the
                name changes {formatCompanyDayLabel(companyName)}.
              </p>
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
                data-testid="setup-company-name"
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
                data-testid="setup-founded"
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
                data-testid="setup-home-city"
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
            <p className="text-sm">
              <span className="text-faint uppercase tracking-wider text-xs font-mono mr-2">
                Preview
              </span>
              <span className="font-semibold">{formatCompanyDayLabel(companyName)}</span>
            </p>
            {profileStatus && (
              <p className={`text-sm ${profileStatus.ok ? "text-accent" : "text-red-500"}`}>
                {profileStatus.ok
                  ? `Saved. ${formatCompanyDayLabel(companyName)}.`
                  : profileStatus.error}
              </p>
            )}
            <button
              type="button"
              data-testid="setup-welcome-continue"
              disabled={profileSaving}
              onClick={async () => {
                const ok = await saveProfile();
                if (ok) setStep(1);
              }}
              className="px-4 py-2 bg-accent text-white text-sm rounded hover:opacity-90 disabled:opacity-50"
            >
              {profileSaving ? "Saving…" : "Continue"}
            </button>
          </section>
        )}

        {step === 1 && (
          <section className="space-y-4" data-testid="setup-connect">
            <div>
              <h1 className="font-display text-2xl font-bold">Connect a source</h1>
              <p className="text-sm text-sub mt-1">
                Cards with a logo and a one-line value. Shipped sources connect now;
                roadmap cards carry their ticket.
              </p>
            </div>
            {picked ? (
              <div className="space-y-4">
                <button
                  type="button"
                  onClick={() => setPicked(null)}
                  className="text-sm text-accent hover:underline"
                >
                  ← Back to gallery
                </button>
                <SourceCredentialForm
                  card={picked}
                  values={credValues}
                  onChange={setCredValues}
                  onConnect={(credentials) => connectSource(picked.id, credentials)}
                  connecting={connecting}
                  status={connectStatus}
                />
              </div>
            ) : (
              <SourceGallery
                onPick={(card) => {
                  setPicked(card);
                  setCredValues({});
                  setConnectStatus(null);
                }}
              />
            )}
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setStep(0)}
                className="px-4 py-2 border border-border rounded text-sm hover:bg-panel-2"
              >
                Back
              </button>
              <button
                type="button"
                data-testid="setup-connect-continue"
                onClick={() => setStep(2)}
                className="px-4 py-2 bg-accent text-white text-sm rounded hover:opacity-90"
              >
                Continue
              </button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="space-y-6" data-testid="setup-first-data">
            <div>
              <h1 className="font-display text-2xl font-bold">First data or demo</h1>
              <p className="text-sm text-sub mt-1">
                Sync now, install the snippet, import a CSV, or explore the demo first.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div className="bg-panel border border-border rounded-lg p-5 space-y-3">
                <h2 className="font-semibold">Sync now</h2>
                <p className="text-sm text-sub">
                  Pull the source you just connected. Lands on this workspace.
                </p>
                <button
                  type="button"
                  data-testid="setup-sync-now"
                  disabled={syncing || !connectedSource}
                  onClick={() => void syncNow()}
                  className="px-4 py-2 bg-accent text-white text-sm rounded hover:opacity-90 disabled:opacity-50"
                >
                  {syncing ? "Syncing…" : "Sync now"}
                </button>
                {!connectedSource && (
                  <p className="text-xs text-faint">Connect a shipped source first.</p>
                )}
                {syncStatus && <p className="text-sm text-sub">{syncStatus}</p>}
              </div>

              <div className="bg-panel border border-border rounded-lg p-5 space-y-3">
                <h2 className="font-semibold">Install the snippet</h2>
                <p className="text-sm text-sub">
                  Add ANYKPI events from your app. Data stays on this instance.
                </p>
                <button
                  type="button"
                  data-testid="setup-snippet"
                  onClick={() =>
                    setSdkSnippet(
                      browserSnippet({
                        endpoint: window.location.origin,
                        workspaceId,
                        apiKey: adminKey || "YOUR_API_KEY",
                        debug: true,
                      })
                    )
                  }
                  className="px-4 py-2 bg-accent text-white text-sm rounded hover:opacity-90"
                >
                  Generate snippet
                </button>
                {sdkSnippet && (
                  <pre
                    data-testid="setup-snippet-body"
                    className="bg-bg border border-border rounded p-3 text-xs font-mono overflow-x-auto"
                  >
                    {sdkSnippet}
                  </pre>
                )}
              </div>
            </div>

            <div className="bg-panel border border-border rounded-lg p-5 space-y-3">
              <h2 className="font-semibold">Import CSV</h2>
              <p className="text-sm text-sub">Users or events. Preview the mapping, then import.</p>
              <input
                type="file"
                accept=".csv,text/csv"
                data-testid="setup-csv"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => applyCsv(String(reader.result ?? ""), file.name);
                  reader.readAsText(file);
                }}
                className="w-full text-sm"
              />
              {csvName && (
                <p className="text-xs text-faint font-mono">
                  {csvName} · {csvRowCount} rows
                </p>
              )}
              {csvParseError && <p className="text-sm text-red-400">{csvParseError}</p>}
              {csvColumns.length > 0 && (
                <div className="space-y-3">
                  <select
                    value={csvKind}
                    onChange={(e) => applyCsv(csvText, csvName, e.target.value as ImportKind)}
                    className="px-3 py-2 text-sm bg-bg border border-border rounded font-mono"
                  >
                    <option value="events">events</option>
                    <option value="users">users</option>
                  </select>
                  <table className="w-full text-sm">
                    <tbody>
                      {csvColumns.map((column) => (
                        <tr key={column} className="border-t border-border">
                          <td className="py-2 pr-4 font-mono">{column}</td>
                          <td>
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
                  {csvSample.length > 0 && (
                    <p className="text-xs text-faint font-mono">
                      First row: {Object.values(csvSample[0] ?? {}).join(" · ")}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleCsvImport()}
                    disabled={csvImporting || !csvText}
                    className="px-4 py-2 bg-accent text-white text-sm rounded hover:opacity-90 disabled:opacity-50"
                  >
                    {csvImporting ? "Importing…" : "Import"}
                  </button>
                  {csvResult && (
                    <p className="text-sm">
                      {csvResult.ok
                        ? `Imported ${csvResult.imported ?? 0}`
                        : csvResult.error}
                    </p>
                  )}
                  {csvResult?.ok && (
                    <button
                      type="button"
                      onClick={() => finish("complete", dashboardPath(workspaceId))}
                      className="px-4 py-2 border border-border rounded text-sm hover:bg-panel-2"
                    >
                      Open dashboard
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="bg-accent-soft border border-accent-line rounded-lg p-5 space-y-3">
              <h2 className="font-semibold">Explore the demo first</h2>
              <p className="text-sm text-sub">
                Land on the labeled demo. A dismissible banner stays until real data
                arrives.
              </p>
              <button
                type="button"
                data-testid="setup-explore-demo"
                onClick={() => {
                  writeLabeledDemo("demo");
                  finish("skipped", dashboardPath("demo"));
                }}
                className="px-4 py-2 bg-accent text-white text-sm rounded hover:opacity-90"
              >
                Explore demo first
              </button>
            </div>

            <button
              type="button"
              onClick={() => setStep(1)}
              className="text-sm text-accent hover:underline"
            >
              ← Back
            </button>
          </section>
        )}

        <p className="text-xs text-faint mt-8">
          Workspace <span className="font-mono">{workspaceId}</span>
          {connectedSource
            ? ` · ${GALLERY_CARDS.find((c) => c.id === connectedSource)?.name ?? connectedSource}`
            : ""}
        </p>
      </div>
    </div>
  );
}
