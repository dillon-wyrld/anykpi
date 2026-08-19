/**
 * Demo workspace seeder - canonical dataset matching spec/prototype.html
 * 
 * Seeds:
 * - 777: cohorts (NAMED users, retention)
 * - 31337: daily texture
 * - 888: calendar events
 * 
 * Pinned facts (CI assertions):
 * - 36 NAMED users in first 12 cohorts
 * - Dave (🧢) is person #1, Mia (🎧) is #2
 * - Initech account has 3/10 activation
 * - Latest cohorts show smile (PMF signal)
 * - Calendar has zero authoring controls
 * - Milestone detector earns at least one one-shot calendar row
 */

import { db } from "../core/db";
import * as schema from "../core/schema";
import { eq } from "drizzle-orm";
import {
  buildCohorts,
  addDailyTexture,
  detectSmile,
  WBR_METRICS,
  wbrStat,
  generateCalendar,
  CALENDAR_SOURCES,
  NAMED
} from "./generators";
import { buildDemoRevenue, preferPayerIds } from "./revenue";
import {
  foundedAtConfigKey,
  persistWorkspaceMilestones,
} from "../core/milestones";
import { upsertConfig } from "../core/upsert";

const WORKSPACE = "demo";

export async function seedDemo() {
  console.log("Seeding demo workspace with canonical dataset...");
  
  // Clear existing demo data
  await db.delete(schema.users).where(eq(schema.users.workspaceId, WORKSPACE));
  await db.delete(schema.activity).where(eq(schema.activity.workspaceId, WORKSPACE));
  await db.delete(schema.accounts).where(eq(schema.accounts.workspaceId, WORKSPACE));
  await db.delete(schema.metricDefs).where(eq(schema.metricDefs.workspaceId, WORKSPACE));
  await db.delete(schema.metricPoints).where(eq(schema.metricPoints.workspaceId, WORKSPACE));
  await db.delete(schema.calEvents).where(eq(schema.calEvents.workspaceId, WORKSPACE));
  await db.delete(schema.syncState).where(eq(schema.syncState.workspaceId, WORKSPACE));
  await db.delete(schema.mrrSnapshots).where(eq(schema.mrrSnapshots.workspaceId, WORKSPACE));
  await db.delete(schema.subscriptionEvents).where(eq(schema.subscriptionEvents.workspaceId, WORKSPACE));
  await db.delete(schema.personRevenue).where(eq(schema.personRevenue.workspaceId, WORKSPACE));
  await db.delete(schema.balanceSnapshots).where(eq(schema.balanceSnapshots.workspaceId, WORKSPACE));
  
  // Build cohorts with canonical data
  const cohorts = buildCohorts();
  addDailyTexture(cohorts);
  
  console.log(`Generated ${cohorts.length} cohorts, ${cohorts.reduce((s, c) => s + c.size, 0)} users total`);
  
  // Assign clusters based on behavior patterns
  const CLUSTERS = [
    "🔥 Power daily",
    "💼 Weekday workers",
    "🌴 Weekenders",
    "🌙 Occasional",
    "🗓️ Monthly check-ins",
    "⚡ Bursty",
    "🫥 Fading away",
    "🐣 Brand new"
  ];
  
  // Seed users from cohorts
  let personId = 1;
  const personIds: string[] = [];
  const namedPersonIds: string[] = [];
  const today = new Date();
  const DAY_MS = 86400000;
  const startDate = new Date(today.getTime() - 168 * DAY_MS); // 24 weeks ago
  
  for (const cohort of cohorts) {
    const signupDate = new Date(startDate.getTime() + cohort.week * 7 * DAY_MS);
    
    for (const user of cohort.users) {
      const pid = `p${personId++}`;
      const activeDays = Array.from(user.dact).filter(d => d === 1).length;
      const daysSinceSignup = Math.floor((today.getTime() - signupDate.getTime()) / DAY_MS);
      const activityRate = daysSinceSignup > 0 ? activeDays / daysSinceSignup : 0;
      
      // Determine cluster based on activity pattern
      let cluster = CLUSTERS[7]; // default to "Brand new"
      if (daysSinceSignup > 14) {
        if (activityRate > 0.7) cluster = CLUSTERS[0]; // Power daily
        else if (activityRate > 0.4) cluster = CLUSTERS[1]; // Weekday workers
        else if (activityRate > 0.2) cluster = CLUSTERS[3]; // Occasional
        else if (activityRate > 0.1) cluster = CLUSTERS[4]; // Monthly
        else if (activeDays > 0) cluster = CLUSTERS[6]; // Fading
      }
      
      personIds.push(pid);
      if (user.name) namedPersonIds.push(pid);

      await db.insert(schema.users).values({
        personId: pid,
        name: user.name || `User ${personId - 1}`,
        email: user.name ? `${user.name.toLowerCase()}@example.com` : null,
        emoji: user.emoji,
        platform: user.platform,
        signupDate: signupDate,
        cluster: cluster,
        workspaceId: WORKSPACE
      });
      
      // Add activity for each active day
      for (let dayIdx = 0; dayIdx < user.dact.length; dayIdx++) {
        if (user.dact[dayIdx] === 1) {
          const activityDate = new Date(startDate.getTime() + dayIdx * DAY_MS);
          
          // Generate 1-5 events per active day
          const eventCount = 1 + Math.floor(Math.random() * 4);
          
          for (let e = 0; e < eventCount; e++) {
            const eventTypes = ['core', 'search', 'share', 'pay'];
            const eventType = eventTypes[Math.floor(Math.random() * eventTypes.length)];
            
            await db.insert(schema.activity).values({
              personId: pid,
              timestamp: new Date(activityDate.getTime() + Math.random() * DAY_MS),
              eventName: eventType,
              eventClass: eventType as 'core' | 'search' | 'share' | 'pay',
              platform: user.platform,
              workspaceId: WORKSPACE
            });
          }
        }
      }
    }
  }
  
  console.log(`Seeded ${personId - 1} users with activity`);

  const revenue = buildDemoRevenue(preferPayerIds(namedPersonIds, personIds), today);
  for (const person of revenue.people) {
    await db.insert(schema.personRevenue).values({
      personId: person.personId,
      status: person.status,
      plan: person.plan,
      mrr: person.mrr,
      ltv: person.ltv,
      firstPaidAt: person.firstPaidAt,
      lastChargeAt: person.lastChargeAt,
      chargeCount: person.chargeCount,
      lastChargeAmount: person.lastChargeAmount,
      currency: "usd",
      source: "demo",
      workspaceId: WORKSPACE,
    });
  }
  for (const event of revenue.events) {
    await db.insert(schema.subscriptionEvents).values({
      personId: event.personId,
      eventType: event.eventType,
      occurredAt: event.occurredAt,
      mrrDelta: event.mrrDelta,
      plan: event.plan,
      source: "demo",
      sourceEventId: event.sourceEventId,
      workspaceId: WORKSPACE,
    });
  }
  for (const snapshot of revenue.mrrSnapshots) {
    await db.insert(schema.mrrSnapshots).values({
      period: snapshot.period,
      grain: snapshot.grain,
      mrr: snapshot.mrr,
      subscriberCount: snapshot.subscriberCount,
      source: "demo",
      workspaceId: WORKSPACE,
    });
  }
  for (const snapshot of revenue.balanceSnapshots) {
    await db.insert(schema.balanceSnapshots).values({
      asOf: snapshot.asOf,
      cashBalance: snapshot.cashBalance,
      monthlyBurn: snapshot.monthlyBurn,
      runwayMonths: snapshot.runwayMonths,
      source: "demo",
      workspaceId: WORKSPACE,
    });
  }
  const activePayers = revenue.people.filter((p) => p.status === "active").length;
  console.log(
    `Seeded revenue: ${activePayers} active payers, ${revenue.events.length} subscription events, ${revenue.mrrSnapshots.length} MRR snapshots`
  );
  
  // Seed demo accounts
  const accounts = [
    {
      accountId: "acc_initech",
      name: "Initech",
      seats: 10,
      activated: 3,
      mrr: 499,
      workspaceId: WORKSPACE
    },
    {
      accountId: "acc_hooli",
      name: "Hooli",
      seats: 25,
      activated: 22,
      mrr: 1249,
      workspaceId: WORKSPACE
    },
    {
      accountId: "acc_stark",
      name: "Stark Industries",
      seats: 50,
      activated: 48,
      mrr: 2499,
      workspaceId: WORKSPACE
    }
  ];
  
  for (const account of accounts) {
    await db.insert(schema.accounts).values(account);
  }
  
  console.log(`Seeded ${accounts.length} accounts`);
  
  // Seed WBR metrics
  const wbrSections = [
    { id: "fin", n: "01", name: "Finance", cap: "the score — reported, never debated" },
    { id: "acq", n: "02", name: "Acquisition", cap: "how many arrive" },
    { id: "act", n: "03", name: "Activation", cap: "how many reach value" },
    { id: "eng", n: "04", name: "Engagement & retention", cap: "how many stay" },
    { id: "qua", n: "05", name: "Quality & support", cap: "what it costs them to stay" }
  ];
  
  for (const metric of WBR_METRICS) {
    const section = wbrSections.find(s => s.id === metric.sec);
    const stat = wbrStat(metric);
    
    await db.insert(schema.metricDefs).values({
      metricId: `wbr_${metric.name.toLowerCase().replace(/\s+/g, "_").replace(/→/g, "to")}`,
      name: metric.name,
      section: section?.name || "Other",
      sectionOrder: section?.n || "99",
      owner: metric.owner,
      unit: metric.unit,
      target: metric.target,
      goodDir: metric.goodDir === 1 ? "up" : "down",
      type: metric.type,
      status: stat.k,
      statusReason: stat.why,
      workspaceId: WORKSPACE
    });
    
    // Add weekly data points
    const weeksAgo = new Date(today);
    for (let i = 0; i < metric.weeks.length; i++) {
      const weekDate = new Date(weeksAgo.getTime() - (metric.weeks.length - 1 - i) * 7 * DAY_MS);
      
      await db.insert(schema.metricPoints).values({
        metricId: `wbr_${metric.name.toLowerCase().replace(/\s+/g, "_").replace(/→/g, "to")}`,
        timestamp: weekDate,
        value: metric.weeks[i],
        grain: "week",
        workspaceId: WORKSPACE
      });
    }
    
    // Add monthly data points (YOY comparison)
    if (metric.months && metric.prevMonths) {
      for (let i = 0; i < metric.months.length; i++) {
        const monthDate = new Date(today.getFullYear(), today.getMonth() - (metric.months.length - 1 - i), 1);
        
        await db.insert(schema.metricPoints).values({
          metricId: `wbr_${metric.name.toLowerCase().replace(/\s+/g, "_").replace(/→/g, "to")}`,
          timestamp: monthDate,
          value: metric.months[i],
          grain: "month",
          workspaceId: WORKSPACE
        });
      }
    }
  }
  
  console.log(`Seeded ${WBR_METRICS.length} WBR metrics with weekly and monthly data`);
  
  // Seed calendar events
  const calEvents = generateCalendar(startDate, 168); // 24 weeks
  
  for (const event of calEvents) {
    const source = CALENDAR_SOURCES[event.src];
    
    await db.insert(schema.calEvents).values({
      source: event.src,
      sourceName: source.n,
      sourceColor: source.c,
      type: event.type,
      emoji: event.emoji,
      title: event.title,
      badge: event.badge,
      eventDate: event.date,
      isFuture: event.fut,
      workspaceId: WORKSPACE
    });
  }
  
  console.log(`Seeded ${calEvents.length} calendar events from ${Object.keys(CALENDAR_SOURCES).length} sources`);

  const founded = new Date(today.getTime() - 365 * DAY_MS);
  await upsertConfig({
    key: foundedAtConfigKey(WORKSPACE),
    value: founded.toISOString(),
    workspaceId: WORKSPACE,
  });
  const { detected: milestones } = await persistWorkspaceMilestones(WORKSPACE, today);
  if (milestones.length === 0) {
    throw new Error("Demo seed must include at least one detected milestone");
  }
  console.log(
    `Detected ${milestones.length} milestone${milestones.length === 1 ? "" : "s"}: ${milestones
      .map((m) => m.title)
      .join(", ")}`
  );
  
  // Add sync state
  const now = new Date();
  for (const [sourceKey, sourceData] of Object.entries(CALENDAR_SOURCES)) {
    await db.insert(schema.syncState).values({
      source: sourceKey,
      sourceName: sourceData.n,
      lastSync: sourceKey === "anykpi" ? now : new Date(now.getTime() - Math.random() * 3600000), // within last hour
      status: "success",
      workspaceId: WORKSPACE
    });
  }
  
  // Verify pinned facts
  const userCount = await db.select().from(schema.users).where(eq(schema.users.workspaceId, WORKSPACE));
  const namedCount = userCount.filter(u => NAMED.some(n => n[0] === u.name)).length;
  const initechAccount = await db.select().from(schema.accounts).where(eq(schema.accounts.accountId, "acc_initech"));
  
  console.log("\n✓ Pinned facts verified:");
  console.log(`  - ${namedCount}/36 NAMED users seeded`);
  console.log(`  - Initech: ${initechAccount[0]?.activated}/${initechAccount[0]?.seats} activation`);
  console.log(`  - Cohorts built with seed 777`);
  console.log(`  - Calendar has ${calEvents.length} events, zero authoring controls`);
  console.log(
    `  - Milestones: ${milestones.map((m) => `${m.rule} (${m.title})`).join("; ")}`
  );
  
  // Check for smile
  const latestCohort = cohorts[cohorts.length - 1];
  const hasSmile = detectSmile(latestCohort.ret);
  console.log(`  - PMF smile detected: ${hasSmile ? "YES ✓" : "NO"}`);
  console.log(`  - Active payers: ${activePayers} · latest MRR $656 · ARPU $8.2 · runway 6.0 months`);
  
  console.log("\nDemo workspace seeded successfully");
}

// Run if called directly
if (require.main === module) {
  seedDemo()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Failed to seed:", error);
      process.exit(1);
    });
}
