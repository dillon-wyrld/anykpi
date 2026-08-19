"use client";

import { useEffect, useState } from "react";

interface User {
  personId: string;
  name: string;
  emoji: string;
  platform: string;
  signupOffset: number;
  activity: boolean[];
}

interface DotPlotProps {
  workspace: string;
}

export default function DotPlot({ workspace }: DotPlotProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/views/dotplot?workspace=${workspace}`)
      .then((res) => res.json())
      .then((data) => {
        setUsers(data.users || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [workspace]);

  if (loading) {
    return <div className="text-sub">Loading...</div>;
  }

  const DAYS = 28;
  const LBL = 140;
  const CW = 15.6;
  const RH = 20;
  const TOP = 22;
  const PAD = 2.6;

  const letters = ["M", "T", "W", "T", "F", "S", "S"];

  return (
    <div className="space-y-4">
      <div className="bg-panel border border-border rounded-lg shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-rule bg-panel-2">
          <span className="eyebrow text-[10px]">
            {users.length} people · {DAYS} days
          </span>
        </div>

        <div className="p-4 overflow-x-auto">
          <svg
            viewBox={`0 0 ${LBL + DAYS * CW + 4} ${TOP + users.length * RH + 8}`}
            className="w-full min-w-[470px]"
            role="img"
            aria-label="Dot plot showing user activity"
          >
            <defs>
              <pattern
                id="hz"
                width="4"
                height="4"
                patternTransform="rotate(45)"
                patternUnits="userSpaceOnUse"
              >
                <line
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="4"
                  stroke="var(--hatch)"
                  strokeWidth="2.6"
                />
              </pattern>
            </defs>

            {Array.from({ length: DAYS }).map((_, d) => {
              const wk = d % 7 >= 5;
              return (
                <text
                  key={`day-${d}`}
                  x={LBL + d * CW + CW / 2}
                  y="12"
                  textAnchor="middle"
                  fontFamily="IBM Plex Mono, monospace"
                  fontSize="8.5"
                  fill={wk ? "var(--accent)" : "var(--faint)"}
                  opacity={wk ? 0.8 : 0.55}
                >
                  {letters[d % 7]}
                </text>
              );
            })}

            {users.map((user, i) => {
              const y = TOP + i * RH;
              const cy = y + RH / 2;

              return (
                <g key={user.personId}>
                  <text
                    x="2"
                    y={cy + 4.4}
                    fontSize="12.5"
                  >
                    {user.emoji}
                  </text>
                  <text
                    x="26"
                    y={cy + 4}
                    fontFamily="IBM Plex Sans, sans-serif"
                    fontSize="11.5"
                    fontWeight="500"
                    fill="var(--text)"
                  >
                    {user.name}
                  </text>
                  <text
                    x={LBL - 11}
                    y={cy + 3.4}
                    textAnchor="end"
                    fontFamily="IBM Plex Mono, monospace"
                    fontSize="7.5"
                    fill="var(--faint)"
                    letterSpacing="0.06em"
                  >
                    {user.platform}
                  </text>

                  {user.signupOffset > 0 && (
                    <rect
                      x={LBL}
                      y={y + 3.5}
                      width={user.signupOffset * CW}
                      height={RH - 7}
                      rx="3"
                      fill="url(#hz)"
                    />
                  )}

                  {(() => {
                    const strips: React.ReactElement[] = [];
                    let d = 0;
                    while (d < DAYS) {
                      if (user.activity[d]) {
                        const start = d;
                        while (d < DAYS && user.activity[d]) d++;
                        const w = (d - start) * CW - PAD * 2;
                        strips.push(
                          <rect
                            key={`${user.personId}-${start}`}
                            x={LBL + start * CW + PAD}
                            y={cy - 4.6}
                            width={w}
                            height="9.2"
                            rx="4.6"
                            fill="var(--accent)"
                          />
                        );
                      } else {
                        d++;
                      }
                    }
                    return strips;
                  })()}

                  {user.signupOffset > 0 && (
                    <circle
                      cx={LBL + user.signupOffset * CW + CW / 2}
                      cy={cy}
                      r="6.4"
                      fill="none"
                      stroke="var(--accent)"
                      strokeWidth="1.6"
                      opacity="0.85"
                    />
                  )}
                </g>
              );
            })}
          </svg>
        </div>

        <div className="flex flex-wrap gap-2 px-4 py-3 border-t border-rule">
          <span className="flex items-center gap-2 text-[11px] font-mono text-sub">
            <i className="w-[22px] h-[9px] rounded-full bg-accent" />
            a streak
          </span>
          <span className="flex items-center gap-2 text-[11px] font-mono text-sub">
            <i className="w-[9px] h-[9px] rounded-full bg-accent" />
            a single day
          </span>
          <span className="flex items-center gap-2 text-[11px] font-mono text-sub">
            <i className="w-[11px] h-[11px] rounded-full border-[1.8px] border-accent" />
            the day they joined
          </span>
          <span className="text-[11px] font-mono text-sub">
            hatched = not signed up yet
          </span>
        </div>
      </div>
    </div>
  );
}
