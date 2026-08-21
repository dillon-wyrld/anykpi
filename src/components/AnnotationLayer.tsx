"use client";

import { useCallback, useEffect, useState } from "react";

export type AnnotationRecord = {
  id: number;
  type: "sticker" | "note";
  targetType: "person" | "date" | "metric" | "cohort";
  targetId: string;
  content: string;
  createdAt: string;
  workspaceId: string;
};

type TargetType = AnnotationRecord["targetType"];

export function useAnnotations(
  workspace: string,
  initial?: AnnotationRecord[]
) {
  const [rows, setRows] = useState<AnnotationRecord[]>(initial ?? []);

  const reload = useCallback(() => {
    fetch(`/api/v1/annotations?workspace=${encodeURIComponent(workspace)}`, {
      credentials: "include",
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { annotations?: AnnotationRecord[] } | null) => {
        if (data?.annotations) setRows(data.annotations);
      })
      .catch(() => {
        // Keep whatever is on screen
      });
  }, [workspace]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { rows, setRows, reload };
}

export function annotationMatchesDate(
  row: AnnotationRecord,
  dayKey: string
): boolean {
  return row.targetType === "date" && row.targetId === dayKey;
}

export function annotationMatchesPerson(
  row: AnnotationRecord,
  personId: string
): boolean {
  return row.targetType === "person" && row.targetId === personId;
}

export function annotationMatchesCohort(
  row: AnnotationRecord,
  groupName: string
): boolean {
  if (row.targetType !== "cohort") return false;
  return row.targetId === groupName || `Month ${row.targetId}` === groupName;
}

export function AnnotationStickers({
  annotations,
  compact = false,
}: {
  annotations: AnnotationRecord[];
  compact?: boolean;
}) {
  if (annotations.length === 0) return null;
  return (
    <div
      className={`flex flex-wrap items-center gap-1.5 ${compact ? "" : "mt-1"}`}
      data-testid={compact ? undefined : "sticker-layer"}
    >
      {annotations.map((row) => (
        <span
          key={row.id}
          data-testid={`annotation-${row.id}`}
          data-annotation-type={row.type}
          data-annotation-target={row.targetType}
          title={`${row.type} on ${row.targetType} ${row.targetId}`}
          className={row.type === "sticker" ? "annotation-stick" : "annotation-note"}
        >
          {row.content}
        </span>
      ))}
    </div>
  );
}

export function AnnotationPinForm({
  workspace,
  people,
  defaultTargetType = "person",
  defaultTargetId = "",
  onPinned,
}: {
  workspace: string;
  people?: { personId: string; name: string }[];
  defaultTargetType?: TargetType;
  defaultTargetId?: string;
  onPinned: (row: AnnotationRecord) => void;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"sticker" | "note">("sticker");
  const [targetType, setTargetType] = useState<TargetType>(defaultTargetType);
  const [targetId, setTargetId] = useState(defaultTargetId);
  const [content, setContent] = useState(kind === "sticker" ? "📌" : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setTargetType(defaultTargetType);
    setTargetId(defaultTargetId);
  }, [defaultTargetType, defaultTargetId]);

  const submit = async () => {
    const trimmed = content.trim();
    const id = targetId.trim();
    if (!trimmed || !id) {
      setError("Need a target and a sticker or note.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(
        `/api/v1/annotations?workspace=${encodeURIComponent(workspace)}`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            type: kind,
            targetType,
            targetId: id,
            content: trimmed,
            workspace,
          }),
        }
      );
      if (!res.ok) {
        setError("Could not pin. Unlock this workspace or use a write key.");
        return;
      }
      const body = (await res.json()) as { annotation?: AnnotationRecord };
      if (body.annotation) {
        onPinned(body.annotation);
        setOpen(false);
        if (kind === "sticker") setContent("📌");
        else setContent("");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="px-3 py-1.5 text-xs font-medium border border-border rounded-lg bg-panel text-sub hover:text-text"
      >
        Pin sticker
      </button>
      {open && (
        <form
          data-testid="annotation-pin-form"
          className="absolute top-full left-0 mt-1 z-50 w-72 bg-panel border border-border rounded-lg shadow-lg p-3 space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label className="block text-xs text-sub">
            Kind
            <select
              aria-label="Kind"
              value={kind}
              onChange={(event) => {
                const next = event.target.value as "sticker" | "note";
                setKind(next);
                if (next === "sticker" && !content) setContent("📌");
              }}
              className="mt-1 w-full px-2 py-1.5 text-xs border border-border rounded bg-panel text-text"
            >
              <option value="sticker">Sticker</option>
              <option value="note">Note</option>
            </select>
          </label>
          <label className="block text-xs text-sub">
            Pin to
            <select
              aria-label="Pin to"
              value={targetType}
              onChange={(event) => setTargetType(event.target.value as TargetType)}
              className="mt-1 w-full px-2 py-1.5 text-xs border border-border rounded bg-panel text-text"
            >
              <option value="person">User</option>
              <option value="date">Date</option>
              <option value="metric">Metric</option>
              <option value="cohort">Cohort</option>
            </select>
          </label>
          <label className="block text-xs text-sub">
            Target
            {targetType === "person" && people && people.length > 0 ? (
              <select
                aria-label="Target"
                value={targetId}
                onChange={(event) => setTargetId(event.target.value)}
                className="mt-1 w-full px-2 py-1.5 text-xs border border-border rounded bg-panel text-text"
              >
                <option value="">Choose a user</option>
                {people.map((person) => (
                  <option key={person.personId} value={person.personId}>
                    {person.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                aria-label="Target"
                value={targetId}
                onChange={(event) => setTargetId(event.target.value)}
                placeholder={
                  targetType === "date"
                    ? "YYYY-MM-DD"
                    : targetType === "metric"
                      ? "metric id"
                      : targetType === "cohort"
                        ? "cohort key"
                        : "person id"
                }
                className="mt-1 w-full px-2 py-1.5 text-xs border border-border rounded bg-panel text-text"
              />
            )}
          </label>
          <label className="block text-xs text-sub">
            {kind === "sticker" ? "Sticker" : "Note"}
            <input
              aria-label={kind === "sticker" ? "Sticker" : "Note"}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder={kind === "sticker" ? "📌" : "What happened"}
              className="mt-1 w-full px-2 py-1.5 text-xs border border-border rounded bg-panel text-text"
            />
          </label>
          {error ? <p className="text-[11px] text-red">{error}</p> : null}
          <button
            type="submit"
            disabled={busy}
            className="w-full px-3 py-1.5 text-xs font-medium rounded bg-accent text-white hover:opacity-90 disabled:opacity-50"
          >
            Save pin
          </button>
        </form>
      )}
    </div>
  );
}
