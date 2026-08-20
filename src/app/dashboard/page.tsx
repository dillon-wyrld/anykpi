"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
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

function DashboardContent() {
  const searchParams = useSearchParams();
  const workspace = searchParams.get("workspace") || "demo";
  const view = searchParams.get("view") || "dotplot";
  const wall = searchParams.get("w") === "1";

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
          <nav className="w-[200px] bg-panel border-r border-border flex flex-col p-3 flex-shrink-0">
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

        <main className={`flex-1 overflow-auto ${wall ? "px-[22px] py-3" : "p-6"}`}>
          <div className="max-w-6xl mx-auto">
            <LiveWorkspaceGate>
              {view === "dotplot" && <DotPlot workspace={workspace} />}
              {view === "cohorts" && <Cohorts workspace={workspace} />}
              {view === "wbr" && <WBR workspace={workspace} />}
              {view === "calendar" && <Calendar workspace={workspace} />}
              {view === "pmf" && <PMF workspace={workspace} />}
            </LiveWorkspaceGate>
          </div>
        </main>
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
