"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { OutreachConversionByCluster, ResearchCandidate } from "@/core/contracts";
import { FreshnessChip } from "@/components/FreshnessChip";
import { ViewEmptyState } from "@/components/ViewEmptyState";
import { useFreshness } from "@/components/useFreshness";
import ResearchDisclosure, {
  type ResearchablePerson,
} from "@/components/ResearchDisclosure";
import {
  generatePmfQueue,
  pmfProgressPct,
  pmfRunTotals,
  type PmfOutreachOutcome,
  type PmfRun,
} from "@/core/views/pmf";

const OUTCOME_OPTIONS: Array<{ value: PmfOutreachOutcome; label: string }> = [
  { value: "replied", label: "Replied" },
  { value: "interviewed", label: "Interviewed" },
  { value: "converted", label: "Converted" },
];

interface PMFProps {
  workspace: string;
}

const STANDARD_QUESTIONS = [
  "How would you feel if you could no longer use this? (very / somewhat / not disappointed)",
  "What's the main benefit you get from it?",
  "What would you use instead if it vanished?",
  "What kind of person do you think gets the most out of it?",
  "If we changed one thing this month, what should it be?",
];

export default function PMF({ workspace }: PMFProps) {
  const [runs, setRuns] = useState<PmfRun[]>([]);
  const [candidates, setCandidates] = useState<ResearchCandidate[]>([]);
  const [conversion, setConversion] = useState<OutreachConversionByCluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [includeGift, setIncludeGift] = useState(true);
  const [giftAmount, setGiftAmount] = useState("25");
  const [giftType, setGiftType] = useState("gift card");
  const [showStandardQuestions, setShowStandardQuestions] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [researchQueue, setResearchQueue] = useState<ResearchablePerson[]>([]);
  const [researchTotal, setResearchTotal] = useState(0);

  const loadPmf = useCallback((refresh = false) => {
    fetch(`/api/views/pmf?workspace=${encodeURIComponent(workspace)}`)
      .then((res) => res.json())
      .then((data) => {
        setRuns(data.runs || []);
        setCandidates(data.candidates || []);
        setConversion(data.conversion || []);
        if (!refresh) setLoading(false);
      })
      .catch(() => {
        if (!refresh) setLoading(false);
      });
  }, [workspace]);

  useEffect(() => {
    loadPmf(false);
  }, [loadPmf]);

  const freshnessHealth = useFreshness({
    workspace,
    watch: ["ingest"],
    onStale: () => loadPmf(true),
  });

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return candidates;
    return candidates.filter(
      (person) =>
        person.name.toLowerCase().includes(needle) ||
        person.personId.toLowerCase().includes(needle)
    );
  }, [candidates, query]);

  const selected = candidates.find((person) => person.personId === selectedId);
  const researchPerson = researchQueue[0] ?? null;
  const filterActive = query.trim().length > 0;

  const openDisclosure = (...people: ResearchablePerson[]) => {
    const next = people.filter((person) => person.name.trim().length > 0);
    setResearchQueue(next);
    setResearchTotal(next.length);
  };

  const recordRun = (run: PmfRun) => {
    setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
    setResearchQueue((current) => current.slice(1));
  };

  const generateQueue = async (run: PmfRun) => {
    const drafts = generatePmfQueue(run, { includeGift, giftAmount, giftType });
    const persisted = await Promise.all(
      drafts.map(async (draft) => {
        const response = await fetch("/api/v1/outreach", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            workspaceId: workspace,
            personId: draft.personId,
            body: draft.message,
          }),
        });
        const data = (await response.json()) as {
          draft?: {
            id: string;
            personId: string;
            body: string;
            state: "waiting" | "approved" | "sent";
            outcome?: PmfOutreachOutcome | null;
          };
          error?: string;
        };
        if (!response.ok || !data.draft) {
          return { ...draft };
        }
        return {
          id: data.draft.id,
          personId: data.draft.personId,
          message: data.draft.body,
          state: data.draft.state,
          outcome: data.draft.outcome ?? null,
        };
      })
    );
    setRuns(runs.map((r) => (r.id === run.id ? { ...r, queue: persisted } : r)));
    const listed = await fetch(`/api/views/pmf?workspace=${encodeURIComponent(workspace)}`);
    if (listed.ok) {
      const next = (await listed.json()) as { conversion?: OutreachConversionByCluster[] };
      setConversion(next.conversion || []);
    }
  };

  const approveDraft = async (runId: string, draftId: string | undefined, personId: string) => {
    if (!draftId) return;
    const response = await fetch("/api/v1/outreach/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId: workspace, id: draftId }),
    });
    if (!response.ok) return;
    const data = (await response.json()) as {
      draft?: { id: string; state: "approved"; approvedBy?: string | null };
    };
    setRuns(
      runs.map((r) => {
        if (r.id !== runId) return r;
        return {
          ...r,
          queue: r.queue.map((d) =>
            d.personId === personId
              ? {
                  ...d,
                  id: data.draft?.id ?? d.id,
                  state: "approved" as const,
                  approvedBy: data.draft?.approvedBy ?? d.approvedBy,
                }
              : d
          ),
        };
      })
    );
  };

  const tagOutcome = async (
    runId: string,
    draftId: string | undefined,
    personId: string,
    outcome: PmfOutreachOutcome | null
  ) => {
    if (!draftId) return;
    const response = await fetch("/api/v1/outreach/outcome", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId: workspace, id: draftId, outcome }),
    });
    if (!response.ok) return;
    const data = (await response.json()) as {
      draft?: { outcome?: PmfOutreachOutcome | null };
      conversion?: OutreachConversionByCluster[];
    };
    setConversion(data.conversion ?? conversion);
    setRuns(
      runs.map((r) => {
        if (r.id !== runId) return r;
        return {
          ...r,
          queue: r.queue.map((d) =>
            d.personId === personId
              ? { ...d, outcome: data.draft?.outcome ?? outcome }
              : d
          ),
        };
      })
    );
  };

  const sendDraft = async (runId: string, draftId: string | undefined, personId: string) => {
    if (!draftId) return;
    const response = await fetch("/api/v1/outreach/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId: workspace, id: draftId }),
    });
    if (!response.ok) return;
    setRuns(
      runs.map((r) => {
        if (r.id !== runId) return r;
        return {
          ...r,
          queue: r.queue.map((d) =>
            d.personId === personId ? { ...d, state: "sent" as const } : d
          ),
        };
      })
    );
  };

  const editDraft = (runId: string, personId: string, newMessage: string) => {
    setRuns(
      runs.map((r) => {
        if (r.id !== runId) return r;
        return {
          ...r,
          queue: r.queue.map((d) =>
            d.personId === personId
              ? { ...d, message: newMessage, state: "edited" as const }
              : d
          ),
        };
      })
    );
  };

  const deepLinkToDotPlot = (personId: string, personName: string) => {
    const dotPlotUrl = `/workspace/${workspace}?view=dotplot&filter=person:${personId}`;
    window.open(dotPlotUrl, "_blank");
  };

  if (loading) {
    return <div className="text-sub">Loading...</div>;
  }

  if (runs.length === 0 && candidates.length === 0) {
    return (
      <div className="space-y-3">
        <FreshnessChip health={freshnessHealth} />
        <ViewEmptyState view="pmf" workspace={workspace} />
      </div>
    );
  }

  const { runCount, peopleResearched, queuedTotal, waitingCount } = pmfRunTotals(runs);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-lg font-semibold">PMF+</h2>
        <FreshnessChip health={freshnessHealth} />
        <span className="text-sm text-sub">
          {runCount} run{runCount !== 1 ? "s" : ""} ·{" "}
          {peopleResearched} people researched
        </span>
      </div>

      <div
        className="bg-panel border border-border rounded-lg p-4 space-y-3"
        data-testid="pmf-research"
      >
        <div>
          <div className="text-sm font-semibold">Research one person</div>
          <div className="text-xs text-sub mt-0.5">
            Nothing leaves this machine until you approve the outgoing fields.
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name"
            className="px-2 py-1.5 border border-border rounded bg-panel text-xs w-40"
            aria-label="Filter people to research"
          />
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="px-2 py-1.5 border border-border rounded bg-panel text-xs min-w-[12rem]"
            aria-label="Person to research"
          >
            <option value="">Select a person</option>
            {filtered.map((person) => (
              <option key={person.personId} value={person.personId}>
                {person.emoji ? `${person.emoji} ` : ""}
                {person.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!selected}
            onClick={() => selected && openDisclosure(selected)}
            className="px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-medium hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ✨ Research
          </button>
          <button
            type="button"
            disabled={!filterActive || filtered.length === 0}
            onClick={() => openDisclosure(...filtered)}
            data-testid="pmf-research-view"
            aria-label="Research this view"
            className="px-3 py-1.5 border border-border rounded-lg text-xs font-medium hover:border-accent disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ✨ Research this view
          </button>
        </div>
      </div>

      <ResearchDisclosure
        workspace={workspace}
        person={researchPerson}
        queueLabel={
          researchTotal > 1 && researchQueue.length > 0
            ? `${researchTotal - researchQueue.length + 1} of ${researchTotal}`
            : undefined
        }
        onClose={() => setResearchQueue([])}
        onComplete={recordRun}
      />

      {conversion.length > 0 && (
        <div
          className="bg-panel border border-border rounded-lg p-4 space-y-3"
          data-testid="pmf-conversion-by-cluster"
        >
          <div>
            <div className="text-sm font-semibold">Conversion by cluster</div>
            <div className="text-xs text-sub mt-0.5">
              Replied / interviewed / converted on outreach — research quality by cluster.
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-faint uppercase tracking-wider">
                  <th className="pb-2 font-medium">Cluster</th>
                  <th className="pb-2 font-medium text-right">Outreach</th>
                  <th className="pb-2 font-medium text-right">Sent</th>
                  <th className="pb-2 font-medium text-right">Replied</th>
                  <th className="pb-2 font-medium text-right">Interviewed</th>
                  <th className="pb-2 font-medium text-right">Converted</th>
                  <th className="pb-2 font-medium text-right">Rate</th>
                </tr>
              </thead>
              <tbody>
                {conversion.map((row) => (
                  <tr
                    key={row.cluster}
                    className="border-t border-border"
                    data-testid="pmf-conversion-row"
                    data-cluster={row.cluster}
                  >
                    <td className="py-2 pr-3">{row.cluster}</td>
                    <td className="py-2 text-right">{row.outreach}</td>
                    <td className="py-2 text-right">{row.sent}</td>
                    <td className="py-2 text-right">{row.replied}</td>
                    <td className="py-2 text-right">{row.interviewed}</td>
                    <td className="py-2 text-right">{row.converted}</td>
                    <td className="py-2 text-right">
                      {Math.round(row.conversionRate * 100)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {queuedTotal > 0 && (
        <div className="bg-amber/10 border-l-4 border-amber rounded-lg p-3">
          <div className="flex items-center gap-3">
            <span className="text-2xl">📬</span>
            <div>
              <div className="text-sm font-semibold">
                {waitingCount} message{waitingCount !== 1 ? "s" : ""} waiting for approval
              </div>
              <div className="text-xs text-sub">Nothing sends on its own — every message waits for your OK</div>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-4 flex-wrap text-xs">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={includeGift}
            onChange={(e) => setIncludeGift(e.target.checked)}
            className="w-4 h-4"
          />
          <span>🎁 thank-you gift</span>
        </label>

        {includeGift && (
          <>
            <select
              value={giftAmount}
              onChange={(e) => setGiftAmount(e.target.value)}
              className="px-2 py-1 border border-border rounded bg-panel text-xs"
            >
              <option value="10">$10</option>
              <option value="25">$25</option>
              <option value="50">$50</option>
              <option value="100">$100</option>
            </select>

            <select
              value={giftType}
              onChange={(e) => setGiftType(e.target.value)}
              className="px-2 py-1 border border-border rounded bg-panel text-xs"
            >
              <option value="gift card">gift card</option>
              <option value="account credit">account credit</option>
              <option value="coffee card">coffee card</option>
              <option value="swag box">swag box (flat)</option>
            </select>
          </>
        )}

        <label
          className="flex items-center gap-2 opacity-75 cursor-help"
          title="off in v1 — every message waits for your OK before anything would go out"
        >
          <input type="checkbox" disabled className="w-4 h-4" />
          <span>🤖 autopilot conversations</span>
          <span className="px-1.5 py-0.5 border border-border rounded text-[10px] text-sub">🔒 v1</span>
        </label>
      </div>

      {runs.length === 0 ? (
        <div className="bg-panel border border-border rounded-lg p-12 text-center">
          <div className="text-5xl mb-3">✨</div>
          <div className="text-sm text-sub">
            Pick a person above. You will see every outgoing field before any query is made.
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {runs.map((run) => (
            <div key={run.id} className="space-y-3">
              <div className="bg-panel border border-border rounded-lg p-4">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">{run.emoji}</span>
                  <div className="flex-1">
                    <div className="font-semibold text-lg">{run.title}</div>
                    <div className="text-xs text-sub">
                      {run.people.length} card{run.people.length !== 1 ? "s" : ""} ·{" "}
                      {run.queue.length} queued
                    </div>
                  </div>
                  {run.status === "researching" && (
                    <div className="flex items-center gap-2">
                      <div className="w-32 h-2 bg-panel-2 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-accent transition-all"
                          style={{ width: `${pmfProgressPct(run.progress, run.totalPeople)}%` }}
                        />
                      </div>
                      <span className="text-xs text-sub">{run.progress}/{run.totalPeople}</span>
                    </div>
                  )}
                  {run.status === "done" && run.queue.length === 0 && (
                    <button
                      onClick={() => void generateQueue(run)}
                      className="px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-medium hover:bg-accent/90"
                    >
                      → Generate outreach
                    </button>
                  )}
                </div>
              </div>

              {run.isGroup && run.groupRollup && (
                <div className="bg-panel border-l-4 border-accent rounded-lg p-4">
                  <div className="text-xs uppercase tracking-wider text-sub mb-3">The group, read together</div>
                  <div className="flex gap-2 flex-wrap mb-3">
                    {run.groupRollup.segments.map((seg, i) => (
                      <span key={i} className="px-2 py-1 bg-panel-2 rounded text-xs">
                        {seg.name} × {seg.count}
                      </span>
                    ))}
                  </div>
                  {run.groupRollup.resonatingWith && (
                    <div className="text-sm">
                      resonating with <strong>{run.groupRollup.resonatingWith}</strong>
                    </div>
                  )}
                </div>
              )}

              {run.people.length > 0 && (
                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                  {run.people.map((person) => (
                    <div
                      key={person.personId}
                      className={`bg-panel border rounded-lg p-4 ${
                        person.verified ? "border-border" : "border-amber/30"
                      }`}
                    >
                      <div className="flex items-start gap-3 mb-3">
                        <span className="text-3xl">{person.emoji}</span>
                        <div className="flex-1">
                          <div className="font-semibold">{person.name}</div>
                          <div className="text-xs text-sub">
                            {person.platform} · {person.country}
                            {person.income && ` · ${person.income}`}
                          </div>
                        </div>
                      </div>

                      {!person.verified ? (
                        <div className="mb-3 p-2 bg-amber/10 border border-amber/30 rounded text-xs text-amber-900">
                          couldn't verify — common name, no matching profiles
                        </div>
                      ) : (
                        <div className="space-y-3 mb-3">
                          {person.role && person.city && (
                            <div className="text-xs">
                              <strong>{person.role}</strong>
                              {person.org && ` at ${person.org}`} · {person.city}
                            </div>
                          )}

                          {person.links.length > 0 && (
                            <div className="flex gap-1.5 flex-wrap">
                              {person.links.map((link, i) => (
                                <span
                                  key={i}
                                  className="px-2 py-1 bg-panel-2 rounded text-[10px] font-mono"
                                  title="demo — the real one links out"
                                >
                                  {link.type} · {link.value}
                                </span>
                              ))}
                            </div>
                          )}

                          {person.claims.length > 0 && (
                            <div className="space-y-2">
                              {person.claims.map((claim, i) => (
                                <div
                                  key={i}
                                  className="flex items-start justify-between gap-2 text-xs"
                                  data-confidence={claim.confidence}
                                >
                                  <div className="flex-1">
                                    <div className="font-medium">
                                      {claim.content && "🎬 "}
                                      {claim.title}
                                    </div>
                                    <div className="text-[10px] text-sub">{claim.source}</div>
                                  </div>
                                  <div className="text-[10px] text-faint" title={`confidence: ${claim.confidence}`}>
                                    {claim.confidence === "high" ? "●●●" : claim.confidence === "medium" ? "●●○" : "●○○"}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      <div className="space-y-2 mb-3 text-xs">
                        <div className="p-2 bg-panel-2 rounded">
                          <span className="text-[10px] uppercase tracking-wider text-faint">Signal</span>
                          <div className="text-sub mt-1">{person.signal}</div>
                        </div>

                        <div className="p-2 bg-panel-2 rounded">
                          <span className="text-[10px] uppercase tracking-wider text-faint">The read</span>
                          <div className="mt-1">{person.read}</div>
                        </div>

                        <div className="p-2 bg-panel-2 rounded">
                          <span className="text-[10px] uppercase tracking-wider text-faint">Worth trying</span>
                          <div className="mt-1">{person.play}</div>
                        </div>
                      </div>

                      <div className="mb-3">
                        <div className="text-[10px] uppercase tracking-wider text-faint mb-2">Worth a conversation</div>
                        <ul className="text-xs space-y-1 list-disc pl-4 text-sub">
                          {person.questions.map((q, i) => (
                            <li key={i}>{q}</li>
                          ))}
                        </ul>
                      </div>

                      <button
                        onClick={() => {
                          const show = !showStandardQuestions[person.personId];
                          setShowStandardQuestions({ ...showStandardQuestions, [person.personId]: show });
                        }}
                        className="text-xs text-accent hover:underline mb-2"
                      >
                        {showStandardQuestions[person.personId] ? "−" : "+"} standard questionnaire
                      </button>

                      {showStandardQuestions[person.personId] && (
                        <ul className="text-[11px] space-y-1 list-decimal pl-4 text-sub mb-3">
                          {STANDARD_QUESTIONS.map((q, i) => (
                            <li key={i}>{q}</li>
                          ))}
                        </ul>
                      )}

                      <button
                        onClick={() => deepLinkToDotPlot(person.personId, person.name)}
                        className="w-full px-3 py-1.5 border border-border rounded text-xs hover:border-accent"
                      >
                        → their row
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {run.queue.length > 0 && (
                <div className="space-y-3">
                  <div className="text-sm font-semibold">Outreach queue — {run.queue.length} messages</div>
                  {run.queue.map((draft) => {
                    const person = run.people.find((p) => p.personId === draft.personId);
                    if (!person) return null;

                    return (
                      <div
                        key={draft.personId}
                        className={`bg-panel border rounded-lg p-4 ${
                          draft.state === "sent"
                            ? "border-green bg-green-50"
                            : draft.state === "approved"
                            ? "border-green bg-green-50"
                            : draft.state === "edited"
                            ? "border-amber"
                            : "border-border"
                        }`}
                      >
                        <div className="flex items-center gap-3 mb-3">
                          <span className="text-2xl">{person.emoji}</span>
                          <div className="flex-1">
                            <div className="font-semibold">{person.name}</div>
                            <div className="text-xs text-sub">
                              {draft.state === "sent" ? (
                                <span className="text-green">✓ Sent</span>
                              ) : draft.state === "approved" ? (
                                <span className="text-green">✓ Approved — send is a separate step</span>
                              ) : draft.state === "edited" ? (
                                <span className="text-amber">Edited</span>
                              ) : (
                                <span>Waiting for approval</span>
                              )}
                            </div>
                          </div>
                          {draft.id && (
                            <label className="text-xs text-sub flex items-center gap-2">
                              <span className="uppercase tracking-wider text-[10px] text-faint">
                                Outcome
                              </span>
                              <select
                                value={draft.outcome ?? ""}
                                onChange={(e) =>
                                  void tagOutcome(
                                    run.id,
                                    draft.id,
                                    draft.personId,
                                    (e.target.value || null) as PmfOutreachOutcome | null
                                  )
                                }
                                className="px-2 py-1 border border-border rounded bg-panel text-xs"
                                aria-label={`Outreach outcome for ${person.name}`}
                                data-testid="outreach-outcome"
                              >
                                <option value="">—</option>
                                {OUTCOME_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}
                        </div>

                        <textarea
                          value={draft.message}
                          onChange={(e) => editDraft(run.id, draft.personId, e.target.value)}
                          className="w-full min-h-[120px] p-3 border border-border rounded bg-white text-sm font-mono resize-y mb-3"
                          disabled={draft.state === "approved" || draft.state === "sent"}
                        />

                        {draft.state !== "approved" && draft.state !== "sent" && (
                          <button
                            onClick={() => void approveDraft(run.id, draft.id, draft.personId)}
                            className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90"
                          >
                            ✓ Approve
                          </button>
                        )}
                        {draft.state === "approved" && (
                          <button
                            onClick={() => void sendDraft(run.id, draft.id, draft.personId)}
                            className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90"
                          >
                            Send
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
