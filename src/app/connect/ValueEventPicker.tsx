"use client";

import { useMemo, useState } from "react";
import { parseValueEventMapping, vanityWarningForMapping } from "@/core/vanity-events";

const SUGGESTED = [
  { id: "song_played", label: "song_played" },
  { id: "doc_created", label: "doc_created" },
  { id: "$pageview", label: "page views" },
  { id: "app_opened", label: "opened the app" },
  { id: "session_start", label: "session starts" },
  { id: "login", label: "logins" },
] as const;

type Props = {
  workspaceId: string;
  apiKey: string;
};

export function ValueEventPicker({ workspaceId, apiKey }: Props) {
  const [core, setCore] = useState("");
  const [search, setSearch] = useState("");
  const [share, setShare] = useState("");
  const [pay, setPay] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mapping = useMemo(
    () =>
      parseValueEventMapping({
        core,
        search,
        share,
        pay,
      }),
    [core, search, share, pay]
  );
  const warning = vanityWarningForMapping(mapping);

  const pick = (eventName: string) => {
    setCore(eventName);
    setSaved(false);
    setError(null);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch("/api/v1/config", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({ workspaceId, valueEvents: mapping }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error || "Could not save value events");
        return;
      }
      setSaved(true);
    } catch {
      setError("Could not save value events");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-panel border border-border rounded-lg p-6" data-testid="value-event-picker">
      <h3 className="font-semibold mb-3">Configure Value Events</h3>
      <p className="text-sm text-sub mb-4">
        Tell ANYKPI which events matter. These map to the dot plot&apos;s cell grammar.
      </p>

      <div className="mb-4">
        <p className="block text-xs font-mono uppercase tracking-wider text-faint mb-2">
          Pick a core event
        </p>
        <div className="flex flex-wrap gap-2">
          {SUGGESTED.map((event) => (
            <button
              key={event.id}
              type="button"
              data-testid={`value-event-pick-${event.id}`}
              onClick={() => pick(event.id)}
              className={`px-3 py-1 text-xs rounded border ${
                core === event.id
                  ? "border-accent text-accent bg-accent-soft"
                  : "border-border text-sub hover:bg-panel-2"
              }`}
            >
              {event.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3 text-sm mb-4">
        <label className="flex items-center gap-2">
          <span className="font-mono text-accent w-16 shrink-0">core:</span>
          <input
            data-testid="value-event-core"
            value={core}
            onChange={(e) => {
              setCore(e.target.value);
              setSaved(false);
            }}
            placeholder='The main value action (e.g. "song_played")'
            className="flex-1 px-3 py-2 text-sm bg-bg border border-border rounded font-mono"
          />
        </label>
        <label className="flex items-center gap-2">
          <span className="font-mono text-accent w-16 shrink-0">search:</span>
          <input
            data-testid="value-event-search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSaved(false);
            }}
            placeholder="Discovery actions"
            className="flex-1 px-3 py-2 text-sm bg-bg border border-border rounded font-mono"
          />
        </label>
        <label className="flex items-center gap-2">
          <span className="font-mono text-accent w-16 shrink-0">share:</span>
          <input
            data-testid="value-event-share"
            value={share}
            onChange={(e) => {
              setShare(e.target.value);
              setSaved(false);
            }}
            placeholder="Sharing or collaboration"
            className="flex-1 px-3 py-2 text-sm bg-bg border border-border rounded font-mono"
          />
        </label>
        <label className="flex items-center gap-2">
          <span className="font-mono text-accent w-16 shrink-0">pay:</span>
          <input
            data-testid="value-event-pay"
            value={pay}
            onChange={(e) => {
              setPay(e.target.value);
              setSaved(false);
            }}
            placeholder="Payment events"
            className="flex-1 px-3 py-2 text-sm bg-bg border border-border rounded font-mono"
          />
        </label>
      </div>

      {warning && (
        <p
          data-testid="value-event-warning"
          role="status"
          className="text-sm text-amber mb-4"
        >
          {warning}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          data-testid="value-event-save"
          onClick={save}
          disabled={saving}
          className="px-4 py-2 bg-accent text-white text-sm rounded hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save value events"}
        </button>
        {saved && (
          <p data-testid="value-event-saved" className="text-sm text-accent">
            Saved.
          </p>
        )}
        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>
    </div>
  );
}
