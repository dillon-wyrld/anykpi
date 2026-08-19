"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import DotPlot from "@/components/DotPlot";
import Cohorts from "@/components/Cohorts";
import WBR from "@/components/WBR";
import Calendar from "@/components/Calendar";
import PMF from "@/components/PMF";

function DashboardContent() {
  const searchParams = useSearchParams();
  const workspace = searchParams.get("workspace") || "demo";
  const view = searchParams.get("view") || "dotplot";

  const navItems = [
    { id: "dotplot", label: "Dot Plot", icon: "grid" },
    { id: "cohorts", label: "Cohorts", icon: "chart" },
    { id: "wbr", label: "WBR", icon: "table" },
    { id: "calendar", label: "Calendar", icon: "calendar" },
    { id: "pmf", label: "PMF+", icon: "search" },
  ];

  return (
    <div className="flex h-screen bg-bg">
      <nav className="w-[200px] bg-panel border-r border-border flex flex-col p-3 flex-shrink-0">
        <div className="flex items-center gap-2 px-2 pb-4 border-b border-rule mb-2">
          <Link href="/" className="font-display text-[15px] font-bold tracking-wide hover:text-accent">
            ANY<span className="text-accent">KPI</span>
          </Link>
          <span className="text-[8.5px] text-sub border border-border rounded px-1 font-mono uppercase tracking-wider">
            Beta
          </span>
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
          <div className="px-2 mb-2">
            <div className="eyebrow text-[9px] mb-1">Workspace</div>
            <select
              value={workspace}
              onChange={(e) => {
                const newWorkspace = e.target.value;
                window.location.href = `/dashboard?workspace=${newWorkspace}&view=${view}`;
              }}
              className="w-full text-xs bg-panel border border-border rounded px-2 py-1 font-mono"
            >
              <option value="demo">demo</option>
              <option value="live">live</option>
            </select>
          </div>

          <Link
            href="/connect"
            className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-hover text-sm text-sub"
          >
            Connect
          </Link>
        </div>
      </nav>

      <main className="flex-1 overflow-auto p-6">
        <div className="max-w-6xl mx-auto">
          {view === "dotplot" && <DotPlot workspace={workspace} />}
          {view === "cohorts" && <Cohorts workspace={workspace} />}
          {view === "wbr" && <WBR workspace={workspace} />}
          {view === "calendar" && <Calendar workspace={workspace} />}
          {view === "pmf" && <PMF workspace={workspace} />}
        </div>
      </main>
    </div>
  );
}

export default function Dashboard() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen">Loading...</div>}>
      <DashboardContent />
    </Suspense>
  );
}
