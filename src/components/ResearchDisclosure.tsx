"use client";

import { useEffect, useMemo, useState } from "react";
import type { ResearchCandidate, ResearchOutgoingField } from "@/core/contracts";
import type { PmfRun } from "@/core/views/pmf";

export type ResearchablePerson = {
  personId: string;
  name: string;
  emoji?: string | null;
  country?: string | null;
  platform?: string | null;
  outgoing?: ResearchOutgoingField[];
};

export function outgoingFromPerson(person: {
  name: string;
  country?: string | null;
}): ResearchOutgoingField[] {
  const outgoing: ResearchOutgoingField[] = [];
  const name = person.name.trim();
  if (name.length > 0) outgoing.push({ field: "name", value: name });
  const country = person.country?.trim();
  if (country) outgoing.push({ field: "country", value: country });
  return outgoing;
}

export function asResearchCandidate(person: ResearchablePerson): ResearchCandidate {
  return {
    personId: person.personId,
    name: person.name,
    emoji: person.emoji ?? null,
    country: person.country ?? null,
    platform: person.platform ?? null,
    outgoing: person.outgoing?.length ? person.outgoing : outgoingFromPerson(person),
  };
}

interface ResearchDisclosureProps {
  workspace: string;
  person: ResearchablePerson | null;
  queueLabel?: string;
  onClose: () => void;
  onComplete?: (run: PmfRun) => void;
}

export default function ResearchDisclosure({
  workspace,
  person,
  queueLabel,
  onClose,
  onComplete,
}: ResearchDisclosureProps) {
  const candidate = useMemo(
    () => (person ? asResearchCandidate(person) : null),
    [person]
  );
  const [approved, setApproved] = useState<Record<string, boolean>>({});
  const [researching, setResearching] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);

  useEffect(() => {
    if (!candidate) return;
    setResearchError(null);
    setApproved(
      Object.fromEntries(candidate.outgoing.map((field) => [field.field, true]))
    );
  }, [candidate]);

  useEffect(() => {
    if (!candidate) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (!researching) onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [candidate, researching, onClose]);

  if (!candidate) return null;

  const approvedFields = candidate.outgoing.filter((field) => approved[field.field]);

  const runApprovedResearch = async () => {
    if (approvedFields.length === 0) return;
    setResearching(true);
    setResearchError(null);
    try {
      const response = await fetch("/api/views/pmf", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspace,
          personId: candidate.personId,
          approvedFields,
        }),
      });
      const data = (await response.json()) as { run?: PmfRun; error?: string };
      if (!response.ok || !data.run) {
        setResearchError(data.error || "Research did not run.");
        return;
      }
      onComplete?.(data.run);
    } catch {
      setResearchError("Research did not run.");
    } finally {
      setResearching(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-text/10 border-0 cursor-default"
        aria-label="Cancel research"
        onClick={() => !researching && onClose()}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="research-disclosure-title"
        data-testid="research-disclosure"
        className="relative w-full max-w-md bg-panel border border-border rounded-lg shadow-lg p-4 space-y-3"
      >
        <h3 id="research-disclosure-title" className="font-semibold">
          Fields that leave this machine
          {queueLabel ? ` (${queueLabel})` : ""}
        </h3>
        <p className="text-xs text-sub">
          Approve exactly these values before any public query is made.
          Uncheck a row to keep it here.
        </p>
        <ul className="space-y-2" data-testid="research-outgoing-fields">
          {candidate.outgoing.map((field) => (
            <li
              key={field.field}
              className="flex items-start gap-3 p-2 bg-panel-2 rounded text-sm"
              data-testid="research-outgoing-field"
              data-field={field.field}
            >
              <input
                type="checkbox"
                className="mt-1"
                checked={Boolean(approved[field.field])}
                disabled={field.field === "name"}
                onChange={(e) =>
                  setApproved({ ...approved, [field.field]: e.target.checked })
                }
                aria-label={`Send ${field.field}`}
              />
              <div className="min-w-0">
                <div className="eyebrow">{field.field}</div>
                <div className="font-mono text-xs break-all">{field.value}</div>
              </div>
            </li>
          ))}
        </ul>
        {researchError && <p className="text-xs text-red">{researchError}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={researching}
            onClick={onClose}
            className="px-3 py-1.5 border border-border rounded text-xs"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={researching || approvedFields.length === 0}
            onClick={() => void runApprovedResearch()}
            className="px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-medium hover:bg-accent/90 disabled:opacity-40"
          >
            {researching ? "Searching…" : "Approve and search"}
          </button>
        </div>
      </div>
    </div>
  );
}
