"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { PersonPanelResponse } from "@/core/contracts";
import ResearchDisclosure, {
  type ResearchablePerson,
} from "@/components/ResearchDisclosure";
import { useFreshness } from "@/components/useFreshness";

interface PersonPanelProps {
  workspace: string;
  personId: string;
  onClose: () => void;
}

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

function money(amount: number | null, currency: string): string {
  if (amount === null) return "—";
  const symbol = currency.toLowerCase() === "usd" ? "$" : `${currency} `;
  return `${symbol}${amount.toLocaleString("en-US", {
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function PersonPanel({
  workspace,
  personId,
  onClose,
}: PersonPanelProps) {
  const router = useRouter();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [data, setData] = useState<PersonPanelResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [researchPerson, setResearchPerson] = useState<ResearchablePerson | null>(
    null
  );

  const loadPerson = useCallback((refresh = false) => {
    let cancelled = false;
    if (!refresh) {
      setData(null);
      setError(null);
    }

    fetch(
      `/api/views/person?workspace=${encodeURIComponent(workspace)}&user=${encodeURIComponent(personId)}`
    )
      .then(async (res) => {
        if (res.status === 404) {
          throw new Error("not-found");
        }
        if (!res.ok) {
          throw new Error("failed");
        }
        return res.json() as Promise<PersonPanelResponse>;
      })
      .then((panel) => {
        if (!cancelled) setData(panel);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (!refresh) {
          setError(err instanceof Error && err.message === "not-found" ? "not-found" : "failed");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [workspace, personId]);

  useEffect(() => {
    return loadPerson(false);
  }, [loadPerson]);

  useFreshness({
    workspace,
    watch: ["ingest"],
    onStale: () => {
      loadPerson(true);
    },
  });

  useEffect(() => {
    closeRef.current?.focus();
  }, [personId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const title = data?.name ?? personId;
  const revenue = data?.revenue;

  return (
    <div className="fixed inset-0 z-[80] flex justify-end">
      <button
        type="button"
        className="flex-1 bg-text/10 border-0 cursor-default"
        aria-label="Close person panel"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="person-panel-title"
        data-testid="person-panel"
        className="animate-person-panel w-[360px] max-w-[92vw] h-full bg-panel border-l border-border shadow-lg flex flex-col"
      >
        <header className="flex items-start gap-3 px-4 py-3 border-b border-rule">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {data?.emoji && <span className="text-2xl" aria-hidden>{data.emoji}</span>}
              <h2
                id="person-panel-title"
                className="font-display text-[16px] font-semibold truncate"
              >
                {title}
              </h2>
            </div>
            <p className="text-xs text-sub mt-0.5 font-mono">{personId}</p>
          </div>
          <button
            type="button"
            disabled={!data}
            data-testid="person-research"
            aria-label={`Research ${title}`}
            onClick={() =>
              data &&
              setResearchPerson({
                personId: data.personId,
                name: data.name,
                emoji: data.emoji,
                country: data.country,
                platform: data.platform,
              })
            }
            className="text-sub hover:text-text text-sm px-2 py-1 rounded border border-border disabled:opacity-40"
          >
            ✨
          </button>
          <button
            ref={closeRef}
            type="button"
            data-testid="person-panel-close"
            onClick={onClose}
            className="text-sub hover:text-text text-sm px-2 py-1 rounded border border-border"
          >
            Close
          </button>
        </header>

        <div className="flex-1 overflow-auto px-4 py-4 space-y-5">
          {error === "not-found" && (
            <p className="text-sm text-sub">This person is not in the workspace.</p>
          )}
          {error === "failed" && (
            <p className="text-sm text-sub">Could not load this person.</p>
          )}
          {!data && !error && <p className="text-sm text-sub">Loading…</p>}

          {data && (
            <>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-3 text-sm">
                <div>
                  <dt className="eyebrow">First seen</dt>
                  <dd className="text-xs mt-0.5">{formatWhen(data.firstSeen)}</dd>
                </div>
                <div>
                  <dt className="eyebrow">Last seen</dt>
                  <dd className="text-xs mt-0.5">{formatWhen(data.lastSeen)}</dd>
                </div>
                <div>
                  <dt className="eyebrow">Cohort</dt>
                  <dd className="text-xs mt-0.5">{data.cohort ?? "—"}</dd>
                </div>
                <div>
                  <dt className="eyebrow">Cluster</dt>
                  <dd className="text-xs mt-0.5">{data.cluster ?? "—"}</dd>
                </div>
                <div>
                  <dt className="eyebrow">Platform</dt>
                  <dd className="text-xs mt-0.5">{data.platform ?? "—"}</dd>
                </div>
              </dl>

              <section aria-labelledby="person-revenue-title">
                <h3 id="person-revenue-title" className="eyebrow mb-2">
                  Revenue
                </h3>
                {revenue && (
                  <div
                    data-testid="person-revenue"
                    className="rounded-lg border border-border bg-panel-2 p-3 text-sm space-y-1.5"
                  >
                    <div className="flex justify-between gap-2">
                      <span className="text-sub">Status</span>
                      <span>
                        {revenue.status}
                        {revenue.plan ? ` · ${revenue.plan}` : ""}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-sub">Charges</span>
                      <span>{revenue.charges.count}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-sub">Total</span>
                      <span>{money(revenue.charges.total, revenue.currency)}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-sub">Last charge</span>
                      <span>
                        {money(revenue.charges.lastAmount, revenue.currency)}
                        {revenue.charges.lastAt
                          ? ` · ${formatWhen(revenue.charges.lastAt)}`
                          : ""}
                      </span>
                    </div>
                  </div>
                )}
              </section>

              <section aria-labelledby="person-timeline-title">
                <h3 id="person-timeline-title" className="eyebrow mb-2">
                  Event timeline
                </h3>
                {data.events.length === 0 ? (
                  <p className="text-xs text-sub">No events yet.</p>
                ) : (
                  <ol className="space-y-2" data-testid="person-timeline">
                    {data.events.map((event) => (
                      <li
                        key={event.id}
                        className="flex items-start justify-between gap-3 text-xs border-b border-rule pb-2 last:border-b-0"
                      >
                        <div>
                          <div className="font-medium">{event.eventName}</div>
                          <div className="text-faint">{event.eventClass}</div>
                        </div>
                        <time
                          className="font-mono text-faint whitespace-nowrap"
                          dateTime={event.timestamp}
                        >
                          {formatWhen(event.timestamp)}
                        </time>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </>
          )}
        </div>
      </aside>
      <ResearchDisclosure
        workspace={workspace}
        person={researchPerson}
        onClose={() => setResearchPerson(null)}
        onComplete={() => {
          setResearchPerson(null);
          router.replace(
            `/dashboard?workspace=${encodeURIComponent(workspace)}&view=pmf`
          );
        }}
      />
    </div>
  );
}
