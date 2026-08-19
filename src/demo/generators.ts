/**
 * Production generators ported from spec/prototype.html
 * 
 * Canon data with pinned facts:
 * - NAMED users (36) with seed 777
 * - buildCohorts with smile detection
 * - 21 WBR metrics with real YOY
 * - Calendar with 6 sources
 * - PMF+ simulated research
 * 
 * These are the golden fixtures CI tests against.
 */

// Mulberry32 PRNG - same as prototype
function mulberry32(seed: number) {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Canon named users - pinned from prototype
export const NAMED: Array<[string, string, number]> = [
  ["Dave","🧢",0],["Mia","🎧",1],["Jo","🌱",2],["Rex","📟",0],["Kai","🛹",5],
  ["Zara","🪚",12],["Nova","🚀",17],["Ines","🧃",6],["Sam","🎨",4],["Ava","🐶",7],
  ["Eli","⚽",3],["Tess","🌸",8],["Ben","🎮",11],["Milo","🦖",9],["Liv","🍰",15],
  ["Yuki","🍜",8],["Omar","🕹️",1],["Lena","📚",14],["Max","⚡",10],["Noa","🫧",16],
  ["Iris","🌵",3],["Finn","🎣",12],["Ruby","💎",17],["Theo","🎷",0],["Cleo","🐈",19],
  ["Axel","🏔️",9],["June","🌻",20],["Remy","🥁",7],["Sky","🪁",21],["Wren","🦉",5],
  ["Ezra","🧊",11],["Lola","💃",13],["Nico","🛸",18],["Vera","🕯️",2],["Otis","🥾",22],
  ["Pia","🍯",6]
];

const ANON = ["🐝","🐢","🦊","🐸","🦔","🐙","🦜","🐳","🦥","🐞","🦩","🐨"];

const CWEEKS = 24;
const DAYS = CWEEKS * 7;

export interface CohortUser {
  name: string | null;
  emoji: string;
  platform: string;
  loyal: boolean;
  weeks: boolean[];
  paidW: number;
  sd: number;
  dact: Uint8Array;
}

export interface Cohort {
  week: number;
  label: string;
  size: number;
  users: CohortUser[];
  ret: number[];
  counts: number[];
}

// Port of buildCohorts from prototype - seed 777 is canon
export function buildCohorts(): Cohort[] {
  const rnd = mulberry32(777);
  const cohorts: Cohort[] = [];
  
  for (let c = 0; c < CWEEKS; c++) {
    const size = 8 + Math.floor(c * 1.3) + Math.floor(rnd() * 6);
    const quality = 0.30 + 0.010 * c + rnd() * 0.04;
    const asym = 0.07 + 0.004 * c;
    
    const users: CohortUser[] = [];
    const cast = NAMED.filter(x => x[2] === c); // Named users for this cohort
    
    for (let u = 0; u < size; u++) {
      const loyal = rnd() < quality;
      const named = cast[u]; // Get named user from filtered cast
      const weeks: boolean[] = [];
      
      for (let w = 0; w < CWEEKS - c; w++) {
        const t = w / (CWEEKS - c);
        let p = loyal ? (0.85 - t * 0.30) : (0.60 - t * 0.55);
        p -= asym * w;
        weeks.push(rnd() < p);
      }
      
      const paidW = loyal && rnd() < 0.7 ? 2 + Math.floor(rnd() * 3) : (rnd() < 0.12 ? 3 + Math.floor(rnd() * 5) : -1);
      
      users.push({
        name: named ? named[0] : null,
        emoji: named ? named[1] : ANON[Math.floor(rnd() * ANON.length)],
        platform: ["ios", "android", "web"][Math.floor(rnd() * 3)],
        loyal,
        weeks,
        paidW,
        sd: 0,
        dact: new Uint8Array(DAYS)
      });
    }
    
    const ret: number[] = [];
    const counts: number[] = [];
    const maxW = CWEEKS - c;
    
    for (let w = 0; w < maxW; w++) {
      const n = users.filter(u => u.weeks[w]).length;
      counts.push(n);
      ret.push(Math.round(n / size * 100));
    }
    
    cohorts.push({ week: c, label: `W${c + 1}`, size, users, ret, counts });
  }
  
  return cohorts;
}

// Add daily texture - separate PRNG stream (seed 31337)
export function addDailyTexture(cohorts: Cohort[]): void {
  const rnd = mulberry32(31337);
  
  cohorts.forEach(c => {
    c.users.forEach(u => {
      const sd = c.week * 7 + Math.floor(rnd() * 7);
      u.sd = sd;
      u.dact[sd] = 1;
      
      u.weeks.forEach((on, w) => {
        if (!on) return;
        
        const a0 = c.week * 7 + w * 7;
        const a1 = Math.min(DAYS, a0 + 7);
        const pool: number[] = [];
        
        for (let d = Math.max(a0, sd + 1); d < a1; d++) {
          pool.push(d);
        }
        
        let want = (u.loyal ? 3 + Math.floor(rnd() * 4) : 1 + Math.floor(rnd() * 2)) - (w === 0 ? 1 : 0);
        
        while (want-- > 0 && pool.length) {
          const i = Math.floor(rnd() * pool.length);
          u.dact[pool[i]] = 1;
          pool.splice(i, 1);
        }
      });
    });
  });
}

// Smile detector - port from prototype
export function detectSmile(retention: number[]): boolean {
  if (retention.length < 4) return false;
  
  const lastThree = retention.slice(-3).filter(w => w !== null);
  if (lastThree.length < 3) return false;
  
  const diffs: number[] = [];
  for (let i = 1; i < lastThree.length; i++) {
    diffs.push(lastThree[i] - lastThree[i - 1]);
  }
  
  const avgDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  return avgDiff > -2 && lastThree[lastThree.length - 1] > 20;
}

// WBR metrics - 21 metrics ported from prototype
export interface WBRMetric {
  sec: string;
  name: string;
  type: "input" | "output";
  unit: string;
  owner: string;
  target: number;
  goodDir: 1 | -1;
  dp?: number;
  weeks: number[];
  prevWeeks: number[];
  m: [number, number, number];
  pm: [number, number, number];
  drivers?: string[];
  note?: { w: number; text: string };
  months?: number[];
  prevMonths?: number[];
}

// WBR series generator
function wgen(n: number, from: number, to: number, wob: number, seed: number): number[] {
  let x = (seed * 7919 + 13) % 233280;
  const r = () => ((x = (x * 9301 + 49297) % 233280) / 233280 - 0.5);
  const out: number[] = [];
  
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    out.push((from + (to - from) * t) * (1 + wob * r() * 2));
  }
  
  return out;
}

export const WBR_METRICS: WBRMetric[] = [
  // 01 Finance
  {
    sec: "fin", name: "Weekly Revenue", type: "output", unit: "$", owner: "🚀", target: 1200, goodDir: 1,
    weeks: [820, 905, 870, 1010, 1150, 1240], prevWeeks: [340, 360, 330, 400, 420, 455],
    m: [1800, 5600, 0.04], pm: [520, 1600, 0.05], drivers: ["New Signups", "Activation Rate"]
  },
  {
    sec: "fin", name: "New Paid Accounts", type: "input", unit: "", owner: "💳", target: 16, goodDir: 1,
    weeks: [12, 15, 11, 19, 17, 22], prevWeeks: [5, 6, 4, 7, 6, 8],
    m: [28, 86, 0.06], pm: [9, 30, 0.08]
  },
  {
    sec: "fin", name: "ARPU", type: "output", unit: "$", owner: "💰", target: 8, goodDir: 1, dp: 1,
    weeks: [7.1, 7.3, 7.0, 7.6, 7.9, 8.2], prevWeeks: [4.2, 4.3, 4.1, 4.4, 4.5, 4.6],
    m: [5.2, 8.1, 0.03], pm: [3.1, 4.7, 0.04], drivers: ["New Paid Accounts"]
  },
  {
    sec: "fin", name: "Gross Margin", type: "output", unit: "%", owner: "🧾", target: 72, goodDir: 1,
    weeks: [69, 70, 68, 71, 70, 69], prevWeeks: [61, 62, 60, 63, 62, 63],
    m: [58, 70, 0.02], pm: [48, 62, 0.03],
    drivers: ["p95 Latency", "Tickets per 100 Users"],
    note: { w: 2, text: "moved image processing to the cheaper region — partially" }
  },
  // 02 Acquisition
  {
    sec: "acq", name: "New Signups", type: "input", unit: "", owner: "🎧", target: 60, goodDir: 1,
    weeks: [45, 52, 38, 61, 58, 72], prevWeeks: [21, 25, 19, 27, 24, 30],
    m: [95, 230, 0.07], pm: [30, 88, 0.09],
    note: { w: 3, text: "referral banner shipped Tuesday — that's the 61 week" }
  },
  {
    sec: "acq", name: "Invites Sent", type: "input", unit: "", owner: "🪩", target: 120, goodDir: 1,
    weeks: [85, 92, 110, 98, 130, 145], prevWeeks: [42, 45, 50, 47, 58, 62],
    m: [150, 490, 0.05], pm: [60, 195, 0.06]
  },
  {
    sec: "acq", name: "Invite Accept Rate", type: "output", unit: "%", owner: "🤝", target: 30, goodDir: 1,
    weeks: [34, 33, 31, 29, 28, 26], prevWeeks: [25, 26, 24, 27, 26, 25],
    m: [31, 27, 0.04], pm: [19, 25, 0.05],
    drivers: ["Invites Sent", "Landing → Signup"],
    note: { w: 2, text: "invite copy A/B — variant B won on volume, not on quality" }
  },
  {
    sec: "acq", name: "CAC", type: "output", unit: "$", owner: "🎯", target: 22, goodDir: -1,
    weeks: [19, 18, 20, 19, 21, 20], prevWeeks: [31, 30, 32, 29, 31, 30],
    m: [34, 21, 0.04], pm: [46, 32, 0.05], drivers: ["New Signups"]
  },
  {
    sec: "acq", name: "Landing → Signup", type: "input", unit: "%", owner: "🛬", target: 12, goodDir: 1,
    weeks: [11, 12, 10, 13, 12, 14], prevWeeks: [8, 9, 7, 9, 8, 10],
    m: [8, 14, 0.05], pm: [5, 10, 0.06]
  },
  // 03 Activation
  {
    sec: "act", name: "Activation Rate", type: "input", unit: "%", owner: "🌱", target: 50, goodDir: 1,
    weeks: [38, 41, 36, 44, 47, 52], prevWeeks: [29, 31, 28, 30, 33, 32],
    m: [28, 46, 0.04], pm: [20, 31, 0.05],
    note: { w: 4, text: "3-step onboarding replaced the 6-step one" }
  },
  {
    sec: "act", name: "Time to First Value", type: "output", unit: "min", owner: "⏱️", target: 10, goodDir: -1,
    weeks: [12, 11, 11, 10, 9, 9], prevWeeks: [17, 18, 16, 17, 16, 17],
    m: [16, 9, 0.04], pm: [22, 17, 0.05],
    drivers: ["Activation Rate", "Onboarding Completion"]
  },
  {
    sec: "act", name: "Onboarding Completion", type: "input", unit: "%", owner: "🧩", target: 65, goodDir: 1,
    weeks: [58, 61, 57, 63, 66, 64], prevWeeks: [44, 46, 43, 47, 45, 48],
    m: [42, 64, 0.04], pm: [30, 47, 0.05]
  },
  {
    sec: "act", name: "Agent Setup Runs", type: "input", unit: "", owner: "🤖", target: 30, goodDir: 1,
    weeks: [18, 24, 27, 31, 38, 44], prevWeeks: [0, 0, 2, 3, 5, 6],
    m: [20, 150, 0.08], pm: [0, 18, 0.30],
    note: { w: 1, text: "one-line wizard went in the README" }
  },
  // 04 Engagement & Retention
  {
    sec: "eng", name: "Weekly Active Users", type: "output", unit: "", owner: "🧢", target: 150, goodDir: 1,
    weeks: [118, 124, 131, 127, 142, 156], prevWeeks: [48, 51, 49, 54, 53, 56],
    m: [210, 610, 0.04], pm: [40, 190, 0.06],
    drivers: ["New Signups", "Invites Sent"]
  },
  {
    sec: "eng", name: "D7 Retention", type: "output", unit: "%", owner: "🛹", target: 28, goodDir: 1,
    weeks: [24, 26, 22, 25, 21, 19], prevWeeks: [17, 18, 16, 19, 17, 18],
    m: [18, 21, 0.05], pm: [12, 15, 0.06],
    drivers: ["Activation Rate", "Streak Holders"],
    note: { w: 4, text: "push notifications paused for the iOS review" }
  },
  {
    sec: "eng", name: "Sessions per User", type: "output", unit: "", owner: "📱", target: 3.6, goodDir: 1, dp: 1,
    weeks: [4.1, 4.3, 4.0, 4.2, 3.9, 3.8], prevWeeks: [3.2, 3.3, 3.1, 3.4, 3.3, 3.2],
    m: [3.0, 3.9, 0.03], pm: [2.4, 3.3, 0.04],
    drivers: ["Streak Holders"]
  },
  {
    sec: "eng", name: "Streak Holders", type: "input", unit: "", owner: "🔥", target: 38, goodDir: 1,
    weeks: [28, 31, 35, 33, 41, 46], prevWeeks: [9, 11, 10, 13, 12, 15],
    m: [30, 150, 0.07], pm: [6, 40, 0.10]
  },
  // 05 Quality & Support
  {
    sec: "qua", name: "Tickets per 100 Users", type: "output", unit: "", owner: "🎫", target: 5, goodDir: -1, dp: 1,
    weeks: [4.2, 4.0, 4.5, 4.1, 3.8, 3.6], prevWeeks: [6.1, 6.3, 5.9, 6.2, 6.0, 5.8],
    m: [7.0, 3.8, 0.05], pm: [9, 6, 0.06],
    drivers: ["First Response Time"]
  },
  {
    sec: "qua", name: "First Response Time", type: "input", unit: "h", owner: "⚡", target: 4.5, goodDir: -1, dp: 1,
    weeks: [5.2, 4.8, 5.5, 4.1, 3.6, 3.2], prevWeeks: [9.0, 8.5, 9.2, 8.1, 8.4, 7.9],
    m: [9, 3.4, 0.05], pm: [14, 8, 0.06]
  },
  {
    sec: "qua", name: "Crash-free Sessions", type: "output", unit: "%", owner: "🛡️", target: 99.5, goodDir: 1, dp: 2,
    weeks: [99.71, 99.68, 99.42, 99.61, 99.74, 99.78], prevWeeks: [98.90, 99.00, 98.80, 99.10, 99.00, 99.20],
    m: [98.8, 99.7, 0.001], pm: [97.5, 99.0, 0.002],
    drivers: ["p95 Latency"]
  },
  {
    sec: "qua", name: "p95 Latency", type: "input", unit: "ms", owner: "🚦", target: 400, goodDir: -1,
    weeks: [362, 349, 411, 388, 341, 318], prevWeeks: [610, 585, 640, 602, 588, 571],
    m: [720, 330, 0.05], pm: [980, 600, 0.06]
  }
];

// Add monthly series to each metric
WBR_METRICS.forEach((m, i) => {
  m.months = wgen(12, m.m[0], m.m[1], m.m[2], i + 1);
  m.prevMonths = wgen(12, m.pm[0], m.pm[1], m.pm[2], i + 40);
});

// WBR stat computer - pure function
export function wbrStat(metric: WBRMetric): { k: "ok" | "watch" | "off"; why: string } {
  const w = metric.weeks;
  const n = w.length;
  const lw = w[n - 1];
  const t = metric.target;
  const dir = metric.goodDir;
  
  const hits = (v: number) => dir > 0 ? v >= t : v <= t;
  
  let miss = 0;
  for (let i = n - 1; i >= 0 && !hits(w[i]); i--) miss++;
  
  const worse = (lw - w[n - 3]) * dir < 0;
  const wsd = (a: number[]) => {
    const mu = a.reduce((s, v) => s + v, 0) / a.length;
    return Math.sqrt(a.reduce((s, v) => s + (v - mu) ** 2, 0) / a.length);
  };
  const sd = wsd(w);
  const margin = Math.abs(lw - t);
  const priorMiss = w.slice(0, n - 1).filter(v => !hits(v)).length;
  
  if (miss >= 2) {
    return {
      k: "off",
      why: `${miss} weeks off target${worse ? ", and still going the wrong way" : ""}. Exceptional variation, not usual wobble.`
    };
  }
  
  if (miss === 1) {
    return {
      k: "watch",
      why: `first week off target. One week is not a trend — watch it, don't theorise.`
    };
  }
  
  if (metric.type === "input" && margin < sd) {
    return {
      k: "watch",
      why: `on the right side of target for the first time in ${priorMiss + 1} weeks, but by less than one normal week's wobble. Not a real win yet.`
    };
  }
  
  if (metric.type === "input" && worse) {
    return {
      k: "watch",
      why: `still on target but turning the wrong way across three weeks. Inputs get discussed early.`
    };
  }
  
  return {
    k: "ok",
    why: "on target and inside its usual range — a one-second glance, no discussion."
  };
}

// Calendar sources
export const CALENDAR_SOURCES = {
  gcal: { n: "Google Calendar", g: "📅", c: "#4285f4", ago: "synced 2m ago" },
  stripe: { n: "Stripe", g: "💳", c: "#635bff", ago: "synced 4m ago" },
  rc: { n: "RevenueCat", g: "📱", c: "#e0574f", ago: "synced 9m ago" },
  plaid: { n: "Plaid · Mercury", g: "🏦", c: "#26a465", ago: "synced 1h ago" },
  gh: { n: "GitHub", g: "🐙", c: "#24292f", ago: "synced 3m ago" },
  anykpi: { n: "ANYKPI", g: "✦", c: "#5e6ad2", ago: "live" }
};

export interface CalendarEvent {
  src: keyof typeof CALENDAR_SOURCES;
  type: "launch" | "ritual" | "milestone" | "comms";
  emoji: string;
  title: string;
  badge: string;
  date: Date;
  fut: boolean;
  past: boolean;
}

// Calendar generator - deterministic
export function generateCalendar(startDate: Date, days: number): CalendarEvent[] {
  const rnd = mulberry32(888);
  const events: CalendarEvent[] = [];
  const DAYMS = 86400000;
  const t0 = startDate.getTime();
  
  const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
  
  for (let i = 0; i < days; i++) {
    const d = new Date(t0 + i * DAYMS);
    const wd = d.getDay();
    const dom = d.getDate();
    const r = () => rnd();
    const past = i < days / 2;
    const fut = !past;
    
    // Google Calendar - rituals
    if (wd === 1 && dom <= 7) {
      events.push({
        src: "gcal",
        type: "ritual",
        emoji: "🧑‍⚖️",
        title: "Board sync",
        badge: "Tue 16:00",
        date: d,
        fut,
        past
      });
    }
    
    // Stripe - payouts
    if (wd === 1) {
      events.push({
        src: "stripe",
        type: "milestone",
        emoji: "💳",
        title: `Payout ${money(2200 + r() * 5400)}`,
        badge: past ? "settled" : "scheduled",
        date: d,
        fut,
        past
      });
    }
    
    // RevenueCat - conversions
    if (wd === 3) {
      events.push({
        src: "rc",
        type: "milestone",
        emoji: "📱",
        title: `Trial cohort converts — ${Math.round(4 + r() * 11)}`,
        badge: past ? "converted" : "due",
        date: d,
        fut,
        past
      });
    }
    
    // Plaid/Mercury - payroll
    if (wd === 4 && Math.abs(Math.round(i / 7)) % 2 === 0) {
      events.push({
        src: "plaid",
        type: "milestone",
        emoji: "🏦",
        title: `Payroll ${money(41000 + r() * 4000)}`,
        badge: past ? "cleared" : "scheduled",
        date: d,
        fut,
        past
      });
    }
    
    // GitHub - releases
    if (r() < 0.2) {
      events.push({
        src: "gh",
        type: "launch",
        emoji: "🚢",
        title: `Release v0.${3 + Math.floor(r() * 5)}.${Math.floor(r() * 9)}`,
        badge: past ? "shipped" : "cut",
        date: d,
        fut,
        past
      });
    }
    
    // ANYKPI - detections
    if (r() < 0.16) {
      const names = ["Mia", "Dave", "Nova", "Lena", "Remy"];
      events.push({
        src: "anykpi",
        type: "milestone",
        emoji: "💯",
        title: `${names[Math.floor(r() * names.length)]}'s 100th session`,
        badge: past ? "hit" : "projected",
        date: d,
        fut,
        past
      });
    }
  }
  
  return events;
}
