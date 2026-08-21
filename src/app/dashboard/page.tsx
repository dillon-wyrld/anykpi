"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import DotPlot from "@/components/DotPlot";
import Cohorts from "@/components/Cohorts";
import WBR from "@/components/WBR";
import Calendar from "@/components/Calendar";
import PMF from "@/components/PMF";
import {
  LiveWorkspaceGate,
  SessionLogout,
  WorkspaceSessionProvider,
} from "@/components/WorkspaceSession";
import { WorkspaceSwitcher } from "@/components/WorkspaceSwitcher";
import DayTracker from "@/components/DayTracker";
import { askDashboardPath, parseAskQuery } from "@/core/ask";
import { viewFromSearchParams } from "@/core/view-state";

const WORDMARK_LIGHT_2X = "/brand/wordmark-light@2x.png";
const WORDMARK_LIGHT_3X = "/brand/wordmark-light@3x.png";
const WORDMARK_DARK_2X = "/brand/wordmark-dark@2x.png";
const WORDMARK_DARK_3X = "/brand/wordmark-dark@3x.png";

function WordmarkMark() {
  return (
    <picture>
      <source
        media="(prefers-color-scheme: dark)"
        srcSet={`${WORDMARK_DARK_2X} 2x, ${WORDMARK_DARK_3X} 3x`}
      />
      {/* Retina PNGs from public/brand; picture/source needs a native img. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="block h-[19px] w-auto"
        alt="ANYKPI"
        src={WORDMARK_LIGHT_2X}
        srcSet={`${WORDMARK_LIGHT_2X} 2x, ${WORDMARK_LIGHT_3X} 3x`}
        height={19}
        data-testid="wordmark"
      />
    </picture>
  );
}

function LogoRow({ href }: { href?: string }) {
  const mark = <WordmarkMark />;
  return (
    <div className="flex items-center gap-[7px]" data-testid="logo-row">
      {href ? (
        <Link href={href} className="block">
          {mark}
        </Link>
      ) : (
        mark
      )}
      <span
        className="font-mono text-[8.5px]/[13px] font-medium tracking-[0.1em] uppercase text-sub border border-border rounded px-1"
        data-testid="beta-tag"
      >
        beta
      </span>
    </div>
  );
}

function AskBar({
  workspace,
  wall,
  onAsk,
}: {
  workspace: string;
  wall: boolean;
  onAsk: () => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [miss, setMiss] = useState(false);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const submit = useCallback(
    (raw: string) => {
      const phrase = raw.trim();
      if (!phrase) return;
      const state = parseAskQuery(phrase);
      if (!state) {
        setMiss(false);
        requestAnimationFrame(() => setMiss(true));
        return;
      }
      setMiss(false);
      onAsk();
      router.push(askDashboardPath(workspace, state, { wall }));
    },
    [onAsk, router, wall, workspace]
  );

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = inputRef.current?.value ?? "";
    submit(value);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div
      className={`flex items-center gap-2.5 px-4 py-2.5 border-b border-border bg-panel flex-shrink-0 ${
        wall ? "px-[22px]" : ""
      }`}
      data-testid="ask-anything-chrome"
    >
      <style>{`
        @keyframes ask-miss-nudge {
          25% { transform: translateX(-3px); }
          75% { transform: translateX(3px); }
        }
        .ask-miss { animation: ask-miss-nudge 0.28s ease-out; border-color: var(--red); }
      `}</style>
      <form
        className={`flex-1 flex items-center gap-2.5 border border-border rounded-[9px] px-3 py-[7px] bg-bg focus-within:border-accent ${
          miss ? "ask-miss" : ""
        }`}
        data-testid="ask-anything-bar"
        onSubmit={onSubmit}
        onAnimationEnd={() => setMiss(false)}
      >
        <span className="text-sm leading-none text-sub" aria-hidden>
          ✦
        </span>
        <input
          ref={inputRef}
          id="ask-anything"
          data-testid="ask-anything"
          className="flex-1 bg-transparent border-0 outline-none text-[13px] text-text placeholder:text-faint"
          placeholder='ask anything — "ios users in france", "are we smiling yet?", "who churned this week"'
          autoComplete="off"
          aria-label="Ask anything"
        />
        <kbd className="font-sans text-[10.5px] border border-border border-b-2 rounded-[5px] px-1.5 py-px bg-panel text-sub">
          ⌘K
        </kbd>
      </form>
    </div>
  );
}

function DashboardContent() {
  const searchParams = useSearchParams();
  const workspace = searchParams.get("workspace") || "demo";
  const view = viewFromSearchParams(searchParams);
  const wall = searchParams.get("w") === "1";
  const [askTick, setAskTick] = useState(0);

  const navItems = [
    { id: "dotplot", label: "Dot Plot", icon: "grid" },
    { id: "cohorts", label: "Cohorts", icon: "chart" },
    { id: "wbr", label: "WBR", icon: "table" },
    { id: "calendar", label: "Calendar", icon: "calendar" },
    { id: "pmf", label: "PMF+", icon: "search" },
  ];

  return (
    <WorkspaceSessionProvider workspace={workspace}>
      <div className={`flex h-screen bg-bg ${wall ? "flex-col" : ""}`}>
        {wall ? (
          <header
            className="flex items-center gap-[7px] px-[22px] py-3 flex-shrink-0"
            data-testid="wall-masthead"
          >
            <LogoRow />
          </header>
        ) : (
          <nav className="w-[200px] bg-panel border-r border-border flex flex-col p-3 flex-shrink-0 overflow-y-auto">
            <div className="flex items-center px-2 pt-0.5 pb-3.5 border-b border-rule mb-2">
              <LogoRow href="/" />
            </div>

            {navItems.map((item) => (
              <Link
                key={item.id}
                href={`/dashboard?workspace=${workspace}&view=${item.id}`}
                className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm mb-1 ${
                  view === item.id
                    ? "bg-accent-soft text-accent font-semibold"
                    : "hover:bg-hover"
                }`}
              >
                {item.label}
              </Link>
            ))}

            <div className="flex-1" />

            <DayTracker workspace={workspace} />

            <div className="border-t border-rule pt-3 mt-3">
              <WorkspaceSwitcher workspace={workspace} view={view} />

              <Link
                href="/connect"
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-hover text-sm text-sub"
              >
                Connect
              </Link>
              <SessionLogout />
            </div>
          </nav>
        )}

        <div className="flex-1 min-w-0 flex flex-col">
          <AskBar
            workspace={workspace}
            wall={wall}
            onAsk={() => setAskTick((tick) => tick + 1)}
          />
          <main className={`flex-1 overflow-auto ${wall ? "px-[22px] py-3" : "p-6"}`}>
            <div className="max-w-6xl mx-auto">
              <LiveWorkspaceGate>
                {view === "dotplot" && (
                  <DotPlot key={`dotplot-${askTick}`} workspace={workspace} />
                )}
                {view === "cohorts" && (
                  <Cohorts key={`cohorts-${askTick}`} workspace={workspace} />
                )}
                {view === "wbr" && <WBR key={`wbr-${askTick}`} workspace={workspace} />}
                {view === "calendar" && (
                  <Calendar key={`calendar-${askTick}`} workspace={workspace} />
                )}
                {view === "pmf" && <PMF key={`pmf-${askTick}`} workspace={workspace} />}
              </LiveWorkspaceGate>
            </div>
          </main>
        </div>
      </div>
    </WorkspaceSessionProvider>
  );
}

export default function Dashboard() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen">Loading...</div>}>
      <DashboardContent />
    </Suspense>
  );
}
