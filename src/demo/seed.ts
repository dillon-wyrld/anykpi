import { db } from "../core/db";
import * as schema from "../core/schema";
import { eq } from "drizzle-orm";

const WORKSPACE_DEMO = "demo";

const PEOPLE = [
  { n: "Dave", e: "🧢", p: "IOS", s: 0, t: "1101101" + "1011011" + "1101101" + "1011011", country: "US" },
  { n: "Mia", e: "🎧", p: "ANDROID", s: 0, t: "0000011" + "0000011" + "0000011" + "0000011", country: "DE" },
  { n: "Jo", e: "🌱", p: "IOS", s: 0, t: "1111010" + "0100000" + "0000000" + "0000000", country: "FR" },
  { n: "Rex", e: "📟", p: "WEB", s: 0, t: "1000000" + "1000000" + "1000000" + "1000000", country: "GB" },
  { n: "Kai", e: "🛹", p: "ANDROID", s: 0, t: "0011100" + "0011100" + "0011100" + "0011100", country: "JP" },
  { n: "Zara", e: "🪚", p: "IOS", s: 12, t: "0000000" + "0000011" + "0000011" + "0000011", country: "FR" },
  { n: "Nova", e: "🚀", p: "WEB", s: 17, t: "0000000" + "0000000" + "0001111" + "1111111", country: "CA" },
  { n: "Leo", e: "🍕", p: "IOS", s: 0, t: "0101000" + "0000000" + "0000000" + "0000000", country: "IT" },
];

const ACCOUNTS_DATA = [
  { accountId: "initech", name: "Initech", entity: "Corp", seats: ["Dave", "Rex"], activationState: "at-risk" },
  { accountId: "globex", name: "Globex", entity: "Inc", seats: ["Mia"], activationState: "healthy" },
];

export async function seedDemo() {
  console.log("Seeding demo workspace...");

  await db.delete(schema.users).where(eq(schema.users.workspaceId, WORKSPACE_DEMO));
  await db.delete(schema.activity).where(eq(schema.activity.workspaceId, WORKSPACE_DEMO));
  await db.delete(schema.accounts).where(eq(schema.accounts.workspaceId, WORKSPACE_DEMO));
  await db.delete(schema.seats).where(eq(schema.seats.workspaceId, WORKSPACE_DEMO));
  await db.delete(schema.metricDefs).where(eq(schema.metricDefs.workspaceId, WORKSPACE_DEMO));
  await db.delete(schema.metricPoints).where(eq(schema.metricPoints.workspaceId, WORKSPACE_DEMO));
  await db.delete(schema.calEvents).where(eq(schema.calEvents.workspaceId, WORKSPACE_DEMO));
  await db.delete(schema.syncState).where(eq(schema.syncState.workspaceId, WORKSPACE_DEMO));

  const baseDate = new Date("2024-01-01T00:00:00Z");

  for (let idx = 0; idx < PEOPLE.length; idx++) {
    const person = PEOPLE[idx];
    const signupDate = new Date(baseDate);
    signupDate.setDate(signupDate.getDate() + person.s);

    await db.insert(schema.users).values({
      personId: `person_${person.n.toLowerCase()}`,
      name: person.n,
      emoji: person.e,
      platform: person.p,
      country: person.country,
      signupDate,
      workspaceId: WORKSPACE_DEMO,
      cluster: idx < 3 ? "power" : idx < 6 ? "casual" : "new",
    });

    for (let day = 0; day < 28; day++) {
      if (person.t[day] === "1") {
        const activityDate = new Date(baseDate);
        activityDate.setDate(activityDate.getDate() + day);

        const isWeekend = activityDate.getDay() === 0 || activityDate.getDay() === 6;
        const baseActivity = isWeekend ? 2 : 5;

        await db.insert(schema.activity).values({
          personId: `person_${person.n.toLowerCase()}`,
          date: activityDate,
          coreCount: baseActivity + Math.floor(Math.random() * 3),
          searchCount: Math.random() > 0.7 ? 1 : 0,
          shareCount: Math.random() > 0.85 ? 1 : 0,
          payCount: Math.random() > 0.95 ? 1 : 0,
          minutes: baseActivity * 12 + Math.floor(Math.random() * 30),
          workspaceId: WORKSPACE_DEMO,
        });
      }
    }
  }

  for (const account of ACCOUNTS_DATA) {
    await db.insert(schema.accounts).values({
      accountId: account.accountId,
      name: account.name,
      entity: account.entity,
      activationState: account.activationState,
      workspaceId: WORKSPACE_DEMO,
    });

    for (const personName of account.seats) {
      await db.insert(schema.seats).values({
        accountId: account.accountId,
        personId: `person_${personName.toLowerCase()}`,
        role: "member",
        workspaceId: WORKSPACE_DEMO,
      });
    }
  }

  const metricsData = [
    { id: "mrr", name: "MRR", section: "finance", type: "output", order: 1, unit: "$", target: 50000 },
    { id: "active_users", name: "Active Users", section: "acquisition", type: "input", order: 2, target: 500 },
    { id: "new_signups", name: "New Signups", section: "acquisition", type: "input", order: 3, target: 100 },
    { id: "activation_rate", name: "Activation Rate", section: "activation", type: "input", order: 4, unit: "%", target: 60 },
    { id: "retention_w1", name: "W1 Retention", section: "retention", type: "input", order: 5, unit: "%", target: 40 },
  ];

  for (const metric of metricsData) {
    await db.insert(schema.metricDefs).values({
      ...metric,
      goodDirection: "up",
      decimals: metric.unit === "%" ? 1 : 0,
      workspaceId: WORKSPACE_DEMO,
    });

    for (let week = 0; week < 12; week++) {
      await db.insert(schema.metricPoints).values({
        metricId: metric.id,
        grain: "week",
        period: `2024-W${(week + 1).toString().padStart(2, "0")}`,
        value: (metric.target || 100) * (0.7 + Math.random() * 0.5),
        workspaceId: WORKSPACE_DEMO,
      });
    }
  }

  const calEventsData = [
    { source: "milestone", type: "milestone", date: new Date("2024-01-10"), title: "100th signup", badge: "🎉" },
    { source: "github", type: "release", date: new Date("2024-01-15"), title: "v1.2.0", badge: "🚀" },
    { source: "stripe", type: "payout", date: new Date("2024-01-20"), title: "Payout", amount: 5420, badge: "💸" },
  ];

  for (const event of calEventsData) {
    await db.insert(schema.calEvents).values({
      ...event,
      workspaceId: WORKSPACE_DEMO,
    });
  }

  await db.insert(schema.syncState).values({
    connector: "demo",
    lastSyncedAt: new Date(),
    status: "success",
    stats: JSON.stringify({ users: 8, days: 28 }),
    workspaceId: WORKSPACE_DEMO,
  });

  console.log("Demo workspace seeded successfully");
}

if (require.main === module) {
  seedDemo()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Failed to seed:", error);
      process.exit(1);
    });
}
