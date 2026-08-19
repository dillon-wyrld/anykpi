"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";

function HomeContent() {
  const searchParams = useSearchParams();
  const workspace = searchParams.get("workspace") || "demo";

  return (
    <div className="flex h-screen">
      <nav className="w-[200px] bg-panel border-r border-border flex flex-col p-3">
        <div className="flex items-center gap-2 px-2 pb-4 border-b border-rule mb-2">
          <h1 className="font-display text-[15px] font-bold tracking-wide">
            ANY<span className="text-accent">KPI</span>
          </h1>
          <span className="text-[8.5px] text-sub border border-border rounded px-1 font-mono uppercase tracking-wider">
            Beta
          </span>
        </div>

        <Link
          href={`/?workspace=${workspace}&view=dotplot`}
          className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent-soft text-sm"
        >
          <svg className="w-[15px] h-[15px]" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="4" cy="4" r="1.5" />
            <circle cx="11" cy="4" r="1.5" />
            <circle cx="4" cy="11" r="1.5" />
            <circle cx="11" cy="11" r="1.5" />
          </svg>
          Dot Plot
        </Link>

        <Link
          href={`/?workspace=${workspace}&view=cohorts`}
          className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent-soft text-sm"
        >
          <svg className="w-[15px] h-[15px]" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M2 12L7 7L12 12" />
          </svg>
          Cohorts
        </Link>

        <Link
          href={`/?workspace=${workspace}&view=wbr`}
          className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent-soft text-sm"
        >
          <svg className="w-[15px] h-[15px]" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="9" height="9" rx="1" />
            <path d="M5 3V1M10 3V1M3 6H12" />
          </svg>
          WBR
        </Link>

        <Link
          href={`/?workspace=${workspace}&view=calendar`}
          className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent-soft text-sm"
        >
          <svg className="w-[15px] h-[15px]" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="2" y="3" width="11" height="10" rx="1" />
            <path d="M2 6H13M5 1V4M10 1V4" />
          </svg>
          Calendar
        </Link>

        <Link
          href={`/?workspace=${workspace}&view=pmf`}
          className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent-soft text-sm"
        >
          <svg className="w-[15px] h-[15px]" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="7.5" cy="7.5" r="5" />
            <path d="M10.5 10.5L13 13" />
          </svg>
          PMF+
        </Link>

        <div className="flex-1" />

        <Link
          href="/connect"
          className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent-soft text-sm text-sub"
        >
          <svg className="w-[15px] h-[15px]" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M2 7.5L6 3.5L10 7.5M6 3.5V12.5" />
          </svg>
          Connect
        </Link>
      </nav>

      <main className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto">
          <div className="bg-panel border border-border rounded-lg p-8 text-center">
            <h2 className="font-display text-3xl font-bold mb-4">
              Welcome to ANYKPI
            </h2>
            <p className="text-sub mb-6">
              The growth stack for modern builders. Dashboard + API + CLI + MCP.
            </p>
            <div className="flex gap-4 justify-center">
              <Link
                href={`/?workspace=demo&view=dotplot`}
                className="px-4 py-2 bg-accent text-white rounded hover:opacity-90"
              >
                View Demo
              </Link>
              <Link
                href="/connect"
                className="px-4 py-2 border border-border rounded hover:bg-panel-2"
              >
                Connect Tools
              </Link>
            </div>
            
            <div className="mt-8 pt-6 border-t border-rule text-sm text-sub">
              <p>Using workspace: <span className="font-mono text-accent">{workspace}</span></p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <HomeContent />
    </Suspense>
  );
}
