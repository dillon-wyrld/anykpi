"use client";

import { useEffect, useState, useRef, useCallback, type MouseEvent as ReactMouseEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import PersonPanel from "@/components/PersonPanel";
import ResearchDisclosure, {
  type ResearchablePerson,
} from "@/components/ResearchDisclosure";
import { clampCardPosition, clusterNote, stripDays } from "@/components/user-card";
import { FreshnessChip } from "@/components/FreshnessChip";
import { ViewEmptyState } from "@/components/ViewEmptyState";
import { useFreshness } from "@/components/useFreshness";

interface User {
  personId: string;
  name: string;
  email: string | null;
  avatar: string | null;
  emoji: string;
  platform: string;
  country: string | null;
  cluster: string | null;
  accountId: string | null;
  workspaceId: string;
  incomeBand: string | null;
  traits: string | null;
  signupOffset: number;
  activity: boolean[];
  cohortMonth: number;
  activeCount: number;
  streak: number;
  lastSeen: number;
  isNew: boolean;
  paid: boolean;
  churned: boolean;
}

interface Group {
  name: string;
  users: User[];
  hue: string;
  collapsed: boolean;
}

interface Filter {
  label: string;
  test: (user: User) => boolean;
}

interface CellConfig {
  shape: "circle" | "blob" | "rd" | "sq" | "dia" | "hollow";
  encode: "events" | "minutes" | "fixed";
  scale: number;
  color: string;
  layout: "emoji" | "dot" | "streak" | "dense" | "bars" | "stack" | "heat";
  emoset: "mood" | "you" | "what" | "life";
  marks: boolean;
  num: boolean;
  tint: boolean;
  tinta: number;
  grid: "none" | "row" | "col" | "both";
  lanes: boolean;
  rh: number;
  clay: boolean;
  paper: boolean;
}

interface ViewState {
  zoom: "day" | "week" | "month";
  group: "cluster" | "cohort" | "account" | "none";
  vibe: boolean;
  wall: boolean;
  win: number;
  winLen: number;
  filters: Filter[];
  collapsed: Set<string>;
  cc: CellConfig;
}

interface DotPlotProps {
  workspace: string;
}

const DAYS = 28;
const LBL = 180;
const CW = 18;
const RH = 26;
const TOP = 24;
const PAD = 2.6;

const DOTCOLORS: Record<string, string> = {
  indigo: "#5e6ad2",
  violet: "#8b5cf6",
  teal: "#0d9488",
  amber: "#d97917",
  pink: "#e05fa0",
  slate: "#475569",
  holo: "#a78bfa",
  candy: "#ff5c8a",
};

const ARCHHUE: Record<string, string> = {
  daily: "#ff4d8d",
  weekday: "#5e6ad2",
  weekender: "#ff9a1f",
  casual: "#12b8a0",
  monthly: "#8b5cf6",
  burst: "#ff7a2f",
  churned: "#9aa4b2",
  newbie: "#22c55e",
};

const LANEHUE = [
  "#5e6ad2",
  "#ff9a1f",
  "#12b8a0",
  "#ff4d8d",
  "#8b5cf6",
  "#3fa7d6",
  "#26a465",
  "#d97917",
];

const FLAGS: Record<string, string> = {
  US: "🇺🇸",
  FR: "🇫🇷",
  DE: "🇩🇪",
  GB: "🇬🇧",
  BR: "🇧🇷",
  JP: "🇯🇵",
  IN: "🇮🇳",
  CA: "🇨🇦",
};

const CLUSTERS: Record<string, string> = {
  daily: "🔥 Power daily",
  weekday: "💼 Weekday workers",
  weekender: "🌴 Weekenders",
  casual: "🌙 Occasional",
  monthly: "🗓️ Monthly check-ins",
  burst: "⚡ Bursty",
  churned: "🫥 Fading away",
  newbie: "🐣 Brand new",
};

const EMOSET = {
  mood: (u: User, activity: boolean[]) => {
    const k = u.activeCount / DAYS;
    return k >= 0.8 ? "👑" : k >= 0.6 ? "🔥" : k >= 0.4 ? "🧡" : k >= 0.2 ? "💛" : "🌱";
  },
  you: (u: User) => u.emoji,
  what: (u: User) => (u.paid ? "💸" : u.activeCount > 10 ? "💬" : "🔍"),
  life: (u: User) =>
    u.isNew ? "🐣" : u.paid ? "💎" : u.churned ? "👻" : "🌿",
};

function encodeViewState(vs: ViewState): string {
  const params = new URLSearchParams();
  if (vs.zoom !== "day") params.set("z", vs.zoom);
  if (vs.group !== "cluster") params.set("g", vs.group);
  if (!vs.vibe) params.set("v", "0");
  if (vs.wall) params.set("w", "1");
  if (vs.win !== 0) params.set("win", vs.win.toString());
  if (vs.winLen !== DAYS) params.set("wl", vs.winLen.toString());
  if (vs.collapsed.size > 0) params.set("c", Array.from(vs.collapsed).join(","));
  
  const cc = vs.cc;
  if (cc.shape !== "blob") params.set("cs", cc.shape);
  if (cc.encode !== "events") params.set("ce", cc.encode);
  if (cc.scale !== 100) params.set("csc", cc.scale.toString());
  if (cc.color !== "indigo") params.set("cc", cc.color);
  if (cc.layout !== "emoji") params.set("cl", cc.layout);
  if (cc.emoset !== "mood") params.set("cem", cc.emoset);
  if (!cc.marks) params.set("cm", "0");
  if (cc.num) params.set("cn", "1");
  if (!cc.tint) params.set("ct", "0");
  if (cc.tinta !== 10) params.set("cta", cc.tinta.toString());
  if (cc.grid !== "row") params.set("cg", cc.grid);
  if (cc.lanes) params.set("cln", "1");
  if (cc.rh !== 28) params.set("crh", cc.rh.toString());
  if (!cc.clay) params.set("ccl", "0");
  if (cc.paper) params.set("cp", "1");
  
  if (vs.filters.length > 0) {
    params.set("f", vs.filters.map(f => f.label).join("|"));
  }
  
  const str = params.toString();
  return str ? `?${str}` : "";
}

function decodeViewState(searchParams: URLSearchParams): Partial<ViewState> {
  const vs: Partial<ViewState> = {};
  
  if (searchParams.has("z")) vs.zoom = searchParams.get("z") as any;
  if (searchParams.has("g")) vs.group = searchParams.get("g") as any;
  if (searchParams.has("v")) vs.vibe = searchParams.get("v") === "1";
  if (searchParams.has("w")) vs.wall = searchParams.get("w") === "1";
  if (searchParams.has("win")) vs.win = parseInt(searchParams.get("win")!);
  if (searchParams.has("wl")) vs.winLen = parseInt(searchParams.get("wl")!);
  if (searchParams.has("c")) {
    vs.collapsed = new Set(searchParams.get("c")!.split(","));
  }
  
  const cc: Partial<CellConfig> = {};
  if (searchParams.has("cs")) cc.shape = searchParams.get("cs") as any;
  if (searchParams.has("ce")) cc.encode = searchParams.get("ce") as any;
  if (searchParams.has("csc")) cc.scale = parseInt(searchParams.get("csc")!);
  if (searchParams.has("cc")) cc.color = searchParams.get("cc")!;
  if (searchParams.has("cl")) cc.layout = searchParams.get("cl") as any;
  if (searchParams.has("cem")) cc.emoset = searchParams.get("cem") as any;
  if (searchParams.has("cm")) cc.marks = searchParams.get("cm") === "1";
  if (searchParams.has("cn")) cc.num = searchParams.get("cn") === "1";
  if (searchParams.has("ct")) cc.tint = searchParams.get("ct") === "1";
  if (searchParams.has("cta")) cc.tinta = parseInt(searchParams.get("cta")!);
  if (searchParams.has("cg")) cc.grid = searchParams.get("cg") as any;
  if (searchParams.has("cln")) cc.lanes = searchParams.get("cln") === "1";
  if (searchParams.has("crh")) cc.rh = parseInt(searchParams.get("crh")!);
  if (searchParams.has("ccl")) cc.clay = searchParams.get("ccl") === "1";
  if (searchParams.has("cp")) cc.paper = searchParams.get("cp") === "1";
  
  if (Object.keys(cc).length > 0) vs.cc = cc as any;
  
  return vs;
}

function userCardMeta(user: User): string | null {
  const parts: string[] = [];
  if (user.platform) parts.push(user.platform);
  if (user.country) {
    const flag = FLAGS[user.country];
    parts.push(flag ? `${flag} ${user.country}` : user.country);
  }
  if (user.incomeBand) {
    const band = user.incomeBand.replace(/^\$/, "");
    parts.push(`$${band}/yr`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

export default function DotPlot({ workspace }: DotPlotProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  
  const defaultViewState: ViewState = {
    zoom: "day",
    group: "cluster",
    vibe: true,
    wall: false,
    win: 0,
    winLen: DAYS,
    filters: [],
    collapsed: new Set<string>(),
    cc: {
      shape: "blob",
      encode: "events",
      scale: 100,
      color: "indigo",
      layout: "emoji",
      emoset: "mood",
      marks: true,
      num: false,
      tint: true,
      tinta: 10,
      grid: "row",
      lanes: false,
      rh: 28,
      clay: true,
      paper: false,
    },
  };
  
  const urlState = decodeViewState(searchParams);
  const [viewState, setViewState] = useState<ViewState>({
    ...defaultViewState,
    ...urlState,
    cc: { ...defaultViewState.cc, ...(urlState.cc || {}) },
  });

  const [userCard, setUserCard] = useState<{
    visible: boolean;
    x: number;
    y: number;
    user: User | null;
  }>({ visible: false, x: 0, y: 0, user: null });
  const [researchQueue, setResearchQueue] = useState<ResearchablePerson[]>([]);
  const [researchTotal, setResearchTotal] = useState(0);
  const hideCardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showUserCard = (user: User, x: number, y: number) => {
    if (hideCardTimer.current) {
      clearTimeout(hideCardTimer.current);
      hideCardTimer.current = null;
    }
    setUserCard({ visible: true, x, y, user });
  };

  const scheduleHideUserCard = () => {
    if (hideCardTimer.current) clearTimeout(hideCardTimer.current);
    hideCardTimer.current = setTimeout(() => {
      setUserCard({ visible: false, x: 0, y: 0, user: null });
      hideCardTimer.current = null;
    }, 250);
  };

  const toResearchable = (user: User): ResearchablePerson => ({
    personId: user.personId,
    name: user.name,
    emoji: user.emoji,
    country: user.country,
    platform: user.platform,
  });

  const openResearch = (...people: User[]) => {
    const next = people.map(toResearchable);
    setResearchQueue(next);
    setResearchTotal(next.length);
  };

  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const initialSyncDone = useRef(false);
  const selectedPersonId = searchParams.get("user");

  const openPerson = useCallback(
    (personId: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("workspace", workspace);
      params.set("view", "dotplot");
      params.set("user", personId);
      router.replace(`/dashboard?${params.toString()}`, { scroll: false });
    },
    [router, searchParams, workspace]
  );

  const closePerson = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("user");
    router.replace(`/dashboard?${params.toString()}`, { scroll: false });
  }, [router, searchParams]);

  const loadUsers = useCallback((refresh = false) => {
    fetch(`/api/views/dotplot?workspace=${workspace}`)
      .then((res) => res.json())
      .then((data) => {
        setUsers(data.users || []);
        if (!refresh) setLoading(false);
      })
      .catch(() => {
        if (!refresh) setLoading(false);
      });
  }, [workspace]);

  useEffect(() => {
    loadUsers(false);
  }, [loadUsers]);

  const freshnessHealth = useFreshness({
    workspace,
    watch: ["ingest"],
    onStale: () => loadUsers(true),
  });

  useEffect(() => {
    // Skip the URL sync on initial mount to avoid loops
    if (!initialSyncDone.current) {
      initialSyncDone.current = true;
      return;
    }
    
    const encoded = encodeViewState(viewState);
    if (!encoded) {
      // All defaults, no need to sync
      return;
    }
    
    const params = new URLSearchParams(searchParams.toString());
    const newParams = new URLSearchParams(encoded.slice(1));
    
    // Merge view-state params
    newParams.forEach((value, key) => {
      params.set(key, value);
    });
    
    // Remove view-state keys that are at defaults (not in newParams)
    const viewStateKeys = ['z', 'g', 'v', 'w', 'win', 'wl', 'c', 'cs', 'ce', 'csc', 'cc', 'cl', 'cem', 'cey', 'cew', 'cel'];
    viewStateKeys.forEach(key => {
      if (!newParams.has(key)) {
        params.delete(key);
      }
    });
    
    const newSearch = params.toString();
    if (newSearch !== searchParams.toString()) {
      router.replace(`/dashboard?${newSearch}`, { scroll: false });
    }
  }, [viewState, router, searchParams]);

  const getFilteredUsers = useCallback(() => {
    let filtered = [...users];
    viewState.filters.forEach((f) => {
      filtered = filtered.filter(f.test);
    });
    return filtered;
  }, [users, viewState.filters]);

  const getGroups = useCallback((): Group[] => {
    const filtered = getFilteredUsers();
    
    if (viewState.group === "none") {
      return [{ name: "", users: filtered, hue: "", collapsed: false }];
    }

    if (viewState.group === "cluster") {
      const byCluster = new Map<string, User[]>();
      filtered.forEach((u) => {
        const key = u.cluster || "unknown";
        if (!byCluster.has(key)) byCluster.set(key, []);
        byCluster.get(key)!.push(u);
      });
      
      const groups: Group[] = [];
      let hueIdx = 0;
      Array.from(byCluster.entries())
        .sort((a, b) => b[1].length - a[1].length)
        .forEach(([name, users]) => {
          groups.push({
            name: CLUSTERS[name] || name,
            users,
            hue: ARCHHUE[name] || LANEHUE[hueIdx++ % LANEHUE.length],
            collapsed: viewState.collapsed.has(name),
          });
        });
      return groups;
    }

    if (viewState.group === "cohort") {
      const byCohort = new Map<number, User[]>();
      filtered.forEach((u) => {
        const key = u.cohortMonth;
        if (!byCohort.has(key)) byCohort.set(key, []);
        byCohort.get(key)!.push(u);
      });
      
      const groups: Group[] = [];
      let hueIdx = 0;
      Array.from(byCohort.entries())
        .sort((a, b) => a[0] - b[0])
        .forEach(([month, users]) => {
          groups.push({
            name: `Month ${month}`,
            users,
            hue: LANEHUE[hueIdx++ % LANEHUE.length],
            collapsed: viewState.collapsed.has(`Month ${month}`),
          });
        });
      return groups;
    }

    if (viewState.group === "account") {
      const byAccount = new Map<string, User[]>();
      filtered.forEach((u) => {
        const key = u.accountId || "individual";
        if (!byAccount.has(key)) byAccount.set(key, []);
        byAccount.get(key)!.push(u);
      });
      
      const groups: Group[] = [];
      let hueIdx = 0;
      Array.from(byAccount.entries())
        .sort((a, b) => b[1].length - a[1].length)
        .forEach(([name, users]) => {
          groups.push({
            name: name === "individual" ? "Individual users" : name,
            users,
            hue: LANEHUE[hueIdx++ % LANEHUE.length],
            collapsed: viewState.collapsed.has(name),
          });
        });
      return groups;
    }

    return [{ name: "", users: filtered, hue: "", collapsed: false }];
  }, [getFilteredUsers, viewState.group, viewState.collapsed]);

  const drawMinimap = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const groups = getGroups();
    const flatUsers: User[] = [];
    groups.forEach((g) => {
      if (g.collapsed) {
        flatUsers.push(g.users[0]);
      } else {
        flatUsers.push(...g.users);
      }
    });

    const w = canvas.clientWidth || 900;
    const h = canvas.clientHeight || 112;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = w * dpr;
    canvas.height = h * dpr;

    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const R = flatUsers.length || 1;
    const rh = h / R;
    const cwp = w / DAYS;

    flatUsers.forEach((u, r) => {
      ctx.fillStyle = DOTCOLORS[viewState.cc.color] || "#5e6ad2";
      const y = r * rh;
      const bh = Math.max(0.9, rh - (rh > 3 ? 1 : 0));

      for (let d = 0; d < DAYS; d++) {
        if (!u.activity[d]) continue;
        ctx.globalAlpha = 0.6;
        ctx.fillRect(d * cwp, y, Math.max(0.9, cwp - 0.4), bh);
      }
    });

    ctx.globalAlpha = 1;
  }, [getGroups, viewState.cc.color]);

  useEffect(() => {
    if (!loading && users.length > 0) {
      drawMinimap();
    }
  }, [loading, users, drawMinimap, viewState.group, viewState.collapsed]);

  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;

    const handleScroll = () => {
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
          const scrollFraction = scrollHeight > clientHeight 
            ? scrollTop / (scrollHeight - clientHeight) 
            : 0;
        }
      });
    };

    scrollEl.addEventListener("scroll", handleScroll, { passive: true });
    return () => scrollEl.removeEventListener("scroll", handleScroll);
  }, []);

  const toggleGroupCollapse = (groupName: string) => {
    const newCollapsed = new Set(viewState.collapsed);
    if (newCollapsed.has(groupName)) {
      newCollapsed.delete(groupName);
    } else {
      newCollapsed.add(groupName);
    }
    setViewState({ ...viewState, collapsed: newCollapsed });
  };

  const addFilter = (filter: Filter) => {
    setViewState({
      ...viewState,
      filters: [...viewState.filters, filter],
    });
  };

  const removeFilter = (index: number) => {
    const newFilters = [...viewState.filters];
    newFilters.splice(index, 1);
    setViewState({ ...viewState, filters: newFilters });
  };
  
  const getAvailableFilters = useCallback((): Array<{label: string; filter: Filter}> => {
    if (users.length === 0) return [];
    
    const platforms = Array.from(new Set(users.map(u => u.platform)));
    const countries = Array.from(new Set(users.map(u => u.country).filter((c): c is string => Boolean(c))));
    const clusters = Array.from(new Set(users.map(u => u.cluster).filter(Boolean)));
    
    const filters: Array<{label: string; filter: Filter}> = [];
    
    platforms.forEach(p => {
      filters.push({
        label: `Platform: ${p}`,
        filter: { label: `platform is ${p}`, test: (u) => u.platform === p }
      });
    });
    
    countries.forEach(c => {
      filters.push({
        label: `Country: ${c}`,
        filter: { label: `country is ${c}`, test: (u) => u.country === c }
      });
    });
    
    clusters.forEach(c => {
      filters.push({
        label: `Cluster: ${c}`,
        filter: { label: `cluster is ${c}`, test: (u) => u.cluster === c }
      });
    });
    
    filters.push({
      label: "New users",
      filter: { label: "is new", test: (u) => u.isNew }
    });
    
    filters.push({
      label: "Paid users",
      filter: { label: "is paid", test: (u) => u.paid }
    });
    
    filters.push({
      label: "Churned users",
      filter: { label: "has churned", test: (u) => u.churned }
    });
    
    filters.push({
      label: "Active streak 3+",
      filter: { label: "streak >= 3", test: (u) => u.streak >= 3 }
    });
    
    return filters;
  }, [users]);

  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const filterMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (filterMenuRef.current && !filterMenuRef.current.contains(event.target as Node)) {
        setShowFilterMenu(false);
      }
    };

    if (showFilterMenu) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showFilterMenu]);

  const setZoom = (zoom: "day" | "week" | "month") => {
    setViewState({ ...viewState, zoom });
  };

  const setGroup = (group: "cluster" | "cohort" | "account" | "none") => {
    setViewState({ ...viewState, group });
  };

  const updateCellConfig = (key: keyof CellConfig, value: any) => {
    setViewState({
      ...viewState,
      cc: { ...viewState.cc, [key]: value },
    });
  };

  const cellOpenProps = (user: User) => ({
    onClick: (event: ReactMouseEvent) => {
      event.stopPropagation();
      openPerson(user.personId);
    },
    style: { cursor: "pointer" as const },
  });

  const renderCell = (user: User, day: number, x: number, y: number) => {
    const active = user.activity[day];
    const isSignup = day === user.signupOffset;
    const cw = CW;
    const rh = viewState.cc.rh;

    if (!active && !isSignup) {
      if (day < user.signupOffset) {
        return (
          <rect
            key={`${user.personId}-${day}`}
            x={x}
            y={y + 3.5}
            width={cw}
            height={rh - 7}
            fill="url(#hz)"
            opacity="0.4"
          />
        );
      }
      return null;
    }

    const cx = x + cw / 2;
    const cy = y + rh / 2;

    if (viewState.cc.layout === "emoji") {
      return (
        <text
          key={`${user.personId}-${day}`}
          x={cx}
          y={cy + 5}
          fontSize="14"
          textAnchor="middle"
          {...cellOpenProps(user)}
        >
          {EMOSET[viewState.cc.emoset](user, user.activity)}
        </text>
      );
    }

    if (viewState.cc.layout === "streak") {
      if (!active) return null;
      
      const prevActive = day > 0 && user.activity[day - 1];
      const nextActive = day < DAYS - 1 && user.activity[day + 1];
      
      const h = 9;
      const rx = prevActive ? 0 : 4.6;
      const rxEnd = nextActive ? 0 : 4.6;

      return (
        <g key={`${user.personId}-${day}`} {...cellOpenProps(user)}>
          <rect
            x={x + PAD}
            y={cy - h / 2}
            width={cw - PAD * 2}
            height={h}
            rx={rx}
            fill="var(--accent)"
          />
          {!nextActive && rxEnd > 0 && (
            <circle
              cx={x + cw - PAD}
              cy={cy}
              r={h / 2}
              fill="var(--accent)"
            />
          )}
        </g>
      );
    }

    if (viewState.cc.layout === "heat") {
      const size = Math.max(6, Math.min(cw - 4, rh - 8));
      const opacity = 0.3 + (active ? 0.6 : 0);
      
      return (
        <rect
          key={`${user.personId}-${day}`}
          x={cx - size / 2}
          y={cy - size / 2}
          width={size}
          height={size}
          rx="3"
          fill={DOTCOLORS[viewState.cc.color]}
          opacity={opacity}
          {...cellOpenProps(user)}
        />
      );
    }

    const size = (viewState.cc.scale / 100) * (active ? 8 : 6);

    return (
      <g key={`${user.personId}-${day}`} {...cellOpenProps(user)}>
        <circle
          cx={cx}
          cy={cy}
          r={size / 2}
          fill={active ? "var(--accent)" : "none"}
          stroke={isSignup ? "var(--accent)" : "none"}
          strokeWidth={isSignup ? "1.6" : "0"}
          opacity={active ? 0.85 : 0.6}
        />
      </g>
    );
  };

  const renderRow = (user: User, rowIndex: number, group?: Group) => {
    const y = TOP + rowIndex * viewState.cc.rh;
    const cy = y + viewState.cc.rh / 2;

    return (
      <g key={user.personId}>
        <text x="2" y={cy + 4.4} fontSize="14">
          {user.emoji}
        </text>
        <text
          x="28"
          y={cy + 4}
          fontFamily="IBM Plex Sans, sans-serif"
          fontSize="11.5"
          fontWeight="500"
          fill="var(--text)"
          tabIndex={0}
          role="button"
          aria-label={`Open ${user.name}`}
          data-testid={`person-name-${user.personId}`}
          style={{ cursor: "pointer" }}
          onClick={() => openPerson(user.personId)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              openPerson(user.personId);
            }
          }}
          onMouseEnter={(e) => {
            const rect = (e.target as SVGElement).getBoundingClientRect();
            const pos = clampCardPosition(
              rect.left + 40,
              rect.bottom + 6,
              window.innerWidth,
              window.innerHeight
            );
            showUserCard(user, pos.x, pos.y);
          }}
          onMouseLeave={() => {
            scheduleHideUserCard();
          }}
        >
          {user.name}
        </text>
        <text
          x={LBL - 56}
          y={cy + 3.4}
          fontFamily="IBM Plex Mono, monospace"
          fontSize="7.5"
          fill="var(--faint)"
          letterSpacing="0.06em"
          style={{ textTransform: "uppercase" }}
        >
          {user.platform}
        </text>
        {user.streak >= 3 && (
          <text
            x={LBL - 16}
            y={cy + 3.8}
            fontFamily="IBM Plex Sans, sans-serif"
            fontSize="10"
            fontWeight="600"
            fill="#ff4d8d"
          >
            🔥{user.streak}
          </text>
        )}

        {Array.from({ length: DAYS }).map((_, d) => renderCell(user, d, LBL + d * CW, y))}
      </g>
    );
  };

  const renderGroupHeader = (group: Group, rowIndex: number) => {
    const y = TOP + rowIndex * viewState.cc.rh;
    const cy = y + viewState.cc.rh / 2;

    return (
      <g key={`group-${group.name}`}>
        <rect
          x="0"
          y={y}
          width={LBL + DAYS * CW + 4}
          height={viewState.cc.rh}
          fill="var(--hover)"
          opacity="0.3"
        />
        <text
          x="28"
          y={cy + 4}
          fontFamily="IBM Plex Sans, sans-serif"
          fontSize="12"
          fontWeight="600"
          fill={group.hue}
          onClick={() => toggleGroupCollapse(group.name)}
          style={{ cursor: "pointer" }}
        >
          {group.collapsed ? "▸" : "▾"} {group.name}
        </text>
        <text
          x={LBL - 56}
          y={cy + 3.4}
          fontFamily="IBM Plex Mono, monospace"
          fontSize="9"
          fill="var(--sub)"
        >
          {group.users.length} {group.users.length === 1 ? "user" : "users"}
        </text>
      </g>
    );
  };

  const renderCollapsedRow = (group: Group, rowIndex: number) => {
    const y = TOP + rowIndex * viewState.cc.rh;
    const cy = y + viewState.cc.rh / 2;

    return (
      <g key={`collapsed-${group.name}`}>
        <rect
          x="0"
          y={y}
          width={LBL + DAYS * CW + 4}
          height={viewState.cc.rh}
          fill="var(--hover)"
          opacity="0.15"
        />
        <text
          x="28"
          y={cy + 4}
          fontFamily="IBM Plex Sans, sans-serif"
          fontSize="11.5"
          fontWeight="500"
          fill={group.hue}
          onClick={() => toggleGroupCollapse(group.name)}
          style={{ cursor: "pointer" }}
        >
          ▸ {group.name} ({group.users.length})
        </text>
        {Array.from({ length: DAYS }).map((_, d) => {
          const count = group.users.filter((u) => u.activity[d]).length;
          if (count === 0) return null;

          const x = LBL + d * CW;
          const size = Math.min(CW - 4, viewState.cc.rh - 8);
          const opacity = 0.3 + (count / group.users.length) * 0.6;

          return (
            <rect
              key={`${group.name}-${d}`}
              x={x + 2}
              y={cy - size / 2}
              width={size}
              height={size}
              rx="3"
              fill={group.hue}
              opacity={opacity}
            />
          );
        })}
      </g>
    );
  };

  if (loading) {
    return <div className="text-sub">Loading...</div>;
  }

  if (users.length === 0) {
    return (
      <div className="space-y-3">
        <FreshnessChip health={freshnessHealth} />
        <ViewEmptyState view="dotplot" workspace={workspace} />
      </div>
    );
  }

  const groups = getGroups();
  const letters = ["M", "T", "W", "T", "F", "S", "S"];
  
  let rowIndex = 0;
  const rows: React.ReactElement[] = [];
  
  groups.forEach((group) => {
    if (group.name && viewState.group !== "none") {
      rows.push(renderGroupHeader(group, rowIndex));
      rowIndex++;
      
      if (group.collapsed) {
        rows.push(renderCollapsedRow(group, rowIndex));
        rowIndex++;
        return;
      }
    }
    
    group.users.forEach((user) => {
      rows.push(renderRow(user, rowIndex, group));
      rowIndex++;
    });
  });

  const totalHeight = TOP + rowIndex * viewState.cc.rh + 8;
  const hovered = userCard.visible ? userCard.user : null;
  const hoveredMeta = hovered ? userCardMeta(hovered) : null;
  const hoveredNote = hovered ? clusterNote(hovered.cluster) : null;
  const hoveredDays = hovered ? stripDays(hovered.activity) : [];

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <FreshnessChip health={freshnessHealth} />
        <div className="flex gap-1 border border-border rounded-lg overflow-hidden">
          <button
            onClick={() => setZoom("day")}
            className={`px-3 py-1.5 text-xs font-medium ${
              viewState.zoom === "day"
                ? "bg-accent text-white"
                : "bg-panel text-sub hover:text-text"
            }`}
          >
            Day
          </button>
          <button
            onClick={() => setZoom("week")}
            className={`px-3 py-1.5 text-xs font-medium border-l border-border ${
              viewState.zoom === "week"
                ? "bg-accent text-white"
                : "bg-panel text-sub hover:text-text"
            }`}
          >
            Week
          </button>
          <button
            onClick={() => setZoom("month")}
            className={`px-3 py-1.5 text-xs font-medium border-l border-border ${
              viewState.zoom === "month"
                ? "bg-accent text-white"
                : "bg-panel text-sub hover:text-text"
            }`}
          >
            Month
          </button>
        </div>

        <div className="flex gap-1 border border-border rounded-lg overflow-hidden">
          <button
            onClick={() => setGroup("cluster")}
            className={`px-3 py-1.5 text-xs font-medium ${
              viewState.group === "cluster"
                ? "bg-accent text-white"
                : "bg-panel text-sub hover:text-text"
            }`}
          >
            Clusters
          </button>
          <button
            onClick={() => setGroup("cohort")}
            className={`px-3 py-1.5 text-xs font-medium border-l border-border ${
              viewState.group === "cohort"
                ? "bg-accent text-white"
                : "bg-panel text-sub hover:text-text"
            }`}
          >
            Cohorts
          </button>
          <button
            onClick={() => setGroup("account")}
            className={`px-3 py-1.5 text-xs font-medium border-l border-border ${
              viewState.group === "account"
                ? "bg-accent text-white"
                : "bg-panel text-sub hover:text-text"
            }`}
          >
            B2B
          </button>
          <button
            onClick={() => setGroup("none")}
            className={`px-3 py-1.5 text-xs font-medium border-l border-border ${
              viewState.group === "none"
                ? "bg-accent text-white"
                : "bg-panel text-sub hover:text-text"
            }`}
          >
            None
          </button>
        </div>

        <button
          onClick={() => setShowFilterMenu(!showFilterMenu)}
          className="px-3 py-1.5 text-xs font-medium border border-border rounded-lg bg-panel text-sub hover:text-text relative"
        >
          + Add filter
          {showFilterMenu && (
            <div
              ref={filterMenuRef}
              className="absolute top-full left-0 mt-1 bg-panel border border-border rounded-lg shadow-lg z-50 min-w-[200px] max-h-[300px] overflow-auto"
              onClick={(e) => e.stopPropagation()}
            >
              {getAvailableFilters().map((item, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    addFilter(item.filter);
                    setShowFilterMenu(false);
                  }}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-hover border-b border-border last:border-b-0"
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </button>

        <div className="flex gap-1 border border-border rounded-lg overflow-hidden">
          <button
            onClick={() => updateCellConfig("layout", "emoji")}
            className={`px-3 py-1.5 text-xs font-medium ${
              viewState.cc.layout === "emoji"
                ? "bg-accent text-white"
                : "bg-panel text-sub hover:text-text"
            }`}
          >
            Emoji
          </button>
          <button
            onClick={() => updateCellConfig("layout", "dot")}
            className={`px-3 py-1.5 text-xs font-medium border-l border-border ${
              viewState.cc.layout === "dot"
                ? "bg-accent text-white"
                : "bg-panel text-sub hover:text-text"
            }`}
          >
            Dot
          </button>
          <button
            onClick={() => updateCellConfig("layout", "streak")}
            className={`px-3 py-1.5 text-xs font-medium border-l border-border ${
              viewState.cc.layout === "streak"
                ? "bg-accent text-white"
                : "bg-panel text-sub hover:text-text"
            }`}
          >
            Tape
          </button>
          <button
            onClick={() => updateCellConfig("layout", "heat")}
            className={`px-3 py-1.5 text-xs font-medium border-l border-border ${
              viewState.cc.layout === "heat"
                ? "bg-accent text-white"
                : "bg-panel text-sub hover:text-text"
            }`}
          >
            Heat
          </button>
        </div>

        {viewState.cc.layout === "emoji" && (
          <div className="flex gap-1 border border-border rounded-lg overflow-hidden">
            <button
              onClick={() => updateCellConfig("emoset", "mood")}
              className={`px-3 py-1.5 text-xs font-medium ${
                viewState.cc.emoset === "mood"
                  ? "bg-accent text-white"
                  : "bg-panel text-sub hover:text-text"
              }`}
            >
              🔥 Heat
            </button>
            <button
              onClick={() => updateCellConfig("emoset", "you")}
              className={`px-3 py-1.5 text-xs font-medium border-l border-border ${
                viewState.cc.emoset === "you"
                  ? "bg-accent text-white"
                  : "bg-panel text-sub hover:text-text"
              }`}
            >
              🧢 Them
            </button>
            <button
              onClick={() => updateCellConfig("emoset", "what")}
              className={`px-3 py-1.5 text-xs font-medium border-l border-border ${
                viewState.cc.emoset === "what"
                  ? "bg-accent text-white"
                  : "bg-panel text-sub hover:text-text"
              }`}
            >
              💸 Did
            </button>
            <button
              onClick={() => updateCellConfig("emoset", "life")}
              className={`px-3 py-1.5 text-xs font-medium border-l border-border ${
                viewState.cc.emoset === "life"
                  ? "bg-accent text-white"
                  : "bg-panel text-sub hover:text-text"
              }`}
            >
              🐣 Stage
            </button>
          </div>
        )}
      </div>

      {/* Filter chips */}
      {viewState.filters.length > 0 && (
        <div className="flex gap-2 flex-wrap items-center">
          {viewState.filters.map((filter, idx) => (
            <span
              key={idx}
              className="inline-flex items-center gap-2 px-3 py-1 text-xs bg-accent-soft text-accent rounded-lg"
            >
              {filter.label}
              <button
                onClick={() => removeFilter(idx)}
                className="text-accent hover:text-text"
              >
                ×
              </button>
            </span>
          ))}
          <button
            type="button"
            data-testid="dotplot-research-view"
            aria-label="Research this view"
            disabled={getFilteredUsers().length === 0}
            onClick={() => openResearch(...getFilteredUsers())}
            className="px-3 py-1.5 text-xs font-medium border border-border rounded-lg bg-panel text-sub hover:text-text disabled:opacity-40"
          >
            ✨ Research this view
          </button>
        </div>
      )}

      {/* Minimap */}
      <div className="bg-panel border border-border rounded-lg p-3">
        <canvas
          ref={canvasRef}
          className="w-full h-28 rounded border border-border"
          style={{ imageRendering: "pixelated" }}
        />
        <div className="text-xs text-sub mt-2">
          day 1–{DAYS} · {getFilteredUsers().length} users
        </div>
      </div>

      {/* Main plot */}
      <div
        ref={scrollRef}
        className="bg-panel border border-border rounded-lg shadow-sm overflow-auto"
        style={{ maxHeight: "800px" }}
      >
        <svg
          viewBox={`0 0 ${LBL + DAYS * CW + 4} ${totalHeight}`}
          className="w-full min-w-[600px]"
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

          {rows}
        </svg>
      </div>

      {/* User hover card — spec/prototype.html `.ucard` */}
      {hovered && (
        <div
          data-testid="user-hover-card"
          className="fixed z-[120] w-[250px] bg-panel border border-border rounded-xl p-3"
          style={{
            left: `${userCard.x}px`,
            top: `${userCard.y}px`,
            boxShadow: "0 8px 30px rgba(0,0,0,.14)",
          }}
          onMouseEnter={() => {
            if (hideCardTimer.current) {
              clearTimeout(hideCardTimer.current);
              hideCardTimer.current = null;
            }
          }}
          onMouseLeave={() => scheduleHideUserCard()}
        >
          <div className="flex items-center gap-2.5 mb-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-accent-soft text-[20px]">
              {hovered.emoji}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-bold">{hovered.name}</div>
              {hoveredMeta && (
                <div className="text-[11px] text-sub">{hoveredMeta}</div>
              )}
            </div>
            <button
              type="button"
              aria-label={`Research ${hovered.name}`}
              data-testid={`dotplot-research-${hovered.personId}`}
              onClick={() => openResearch(hovered)}
              className="shrink-0 px-1.5 py-0.5 text-sm border border-border rounded hover:border-accent"
            >
              ✨
            </button>
          </div>
          {hoveredNote && (
            <div className="my-1.5 text-[11.5px] italic text-sub">
              &ldquo;{hoveredNote}&rdquo;
            </div>
          )}
          {hoveredDays.length > 0 && (
            <div className="mt-1.5 flex gap-[1.5px]">
              {hoveredDays.map((active, i) => (
                <i
                  key={i}
                  className={`h-[14px] w-[5px] rounded-[2px] bg-accent ${
                    active ? "opacity-[0.85]" : "opacity-15"
                  }`}
                />
              ))}
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-[5px] text-[10px]">
            <span className="rounded-[5px] bg-hover px-[7px] py-0.5">
              🔥 streak {hovered.streak}
            </span>
            <span className="rounded-[5px] bg-hover px-[7px] py-0.5">
              📅 {hovered.activeCount} active days
            </span>
            <span className="rounded-[5px] bg-hover px-[7px] py-0.5">
              {hovered.paid ? "💸 paid" : "🆓 free"}
            </span>
            {hovered.isNew && (
              <span className="rounded-[5px] bg-hover px-[7px] py-0.5">
                🐣 new
              </span>
            )}
            {hovered.churned && (
              <span className="rounded-[5px] bg-hover px-[7px] py-0.5">
                👻 churned
              </span>
            )}
          </div>
        </div>
      )}

      {selectedPersonId && (
        <PersonPanel
          workspace={workspace}
          personId={selectedPersonId}
          onClose={closePerson}
        />
      )}

      <ResearchDisclosure
        workspace={workspace}
        person={researchQueue[0] ?? null}
        queueLabel={
          researchTotal > 1 && researchQueue.length > 0
            ? `${researchTotal - researchQueue.length + 1} of ${researchTotal}`
            : undefined
        }
        onClose={() => setResearchQueue([])}
        onComplete={() => {
          setResearchQueue((current) => {
            const rest = current.slice(1);
            if (rest.length === 0) {
              const params = new URLSearchParams(searchParams.toString());
              params.set("workspace", workspace);
              params.set("view", "pmf");
              params.delete("user");
              router.replace(`/dashboard?${params.toString()}`);
            }
            return rest;
          });
        }}
      />

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs text-sub">
        <span className="flex items-center gap-2">
          <i className="w-6 h-2 rounded-full bg-accent" />
          consecutive days
        </span>
        <span className="flex items-center gap-2">
          <i className="w-2 h-2 rounded-full border-2 border-accent" />
          signup day
        </span>
        <span className="flex items-center gap-2">
          <svg width="16" height="12" className="inline-block">
            <rect width="16" height="12" fill="url(#hz)" opacity="0.4" />
          </svg>
          not signed up yet
        </span>
      </div>
    </div>
  );
}
