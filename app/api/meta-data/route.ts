/**
 * Pulls live Meta Ads data from Windsor.ai REST API for Amudar.
 * Filters to the Amudar Ads 2026 account only.
 * Returns the shape the dashboard expects.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const CLOSETS_ACCOUNT_ID = process.env.META_ACCOUNT_ID || "2237520487071255";
const WINDSOR_BASE = "https://connectors.windsor.ai/facebook";

type WindsorRow = Record<string, string | number | null>;

function windsorUrl(params: Record<string, string>) {
  const u = new URL(WINDSOR_BASE);
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  u.searchParams.set("api_key", process.env.WINDSOR_API_KEY || "");
  return u.toString();
}

async function windsor(params: Record<string, string>): Promise<WindsorRow[]> {
  const res = await fetch(windsorUrl(params), { cache: "no-store" });
  if (!res.ok) throw new Error(`Windsor returned ${res.status}`);
  const json = (await res.json()) as { data?: WindsorRow[] };
  return json.data || [];
}

function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  const n = parseFloat(String(v));
  return Number.isNaN(n) ? 0 : n;
}

function filterClosets(rows: WindsorRow[]): WindsorRow[] {
  return rows.filter((r) => String(r.account_id) === CLOSETS_ACCOUNT_ID);
}

function aggBy<T extends string>(
  rows: WindsorRow[],
  key: T,
  metrics: string[]
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    const k = String(r[key] ?? "");
    if (!out[k]) out[k] = Object.fromEntries(metrics.map((m) => [m, 0]));
    for (const m of metrics) out[k][m] += num(r[m]);
  }
  return out;
}

export async function GET(req: Request) {
  if (!process.env.WINDSOR_API_KEY) {
    return Response.json(
      { error: "WINDSOR_API_KEY not set in environment" },
      { status: 500 }
    );
  }

  try {
    // Parse range from query: ?days=30 | 60 | 90 (default 30)
    const url = new URL(req.url);
    const requested = parseInt(url.searchParams.get("days") || "30", 10);
    const rangeDays: 30 | 60 | 90 = [30, 60, 90].includes(requested) ? (requested as 30 | 60 | 90) : 30;
    const datePreset =
      rangeDays === 60 ? "last_60dT" : rangeDays === 90 ? "last_90dT" : "last_30dT";

    // Prior comparison window = same length, immediately before the current window
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const priorStart = new Date(today); priorStart.setDate(today.getDate() - rangeDays * 2);
    const priorEnd = new Date(today); priorEnd.setDate(today.getDate() - rangeDays - 1);
    const fmtDate = (d: Date) => d.toISOString().slice(0, 10);

    // Fire all 7 Windsor queries in parallel
    // (added activeLast7 query to detect spend + campaignStatusRaw for true status)
    const [dailyRaw, priorRaw, campaignRaw, adsetRaw, adsRaw, activeLast7Raw, dailyByCampaignRaw, campaignStatusRaw] = await Promise.all([
      windsor({
        fields: "date,account_id,campaign,spend,impressions,reach,clicks,actions_link_click,actions_lead,actions_onsite_conversion_messaging_conversation_started_7d,actions_onsite_conversion_messaging_first_reply,ctr,cpm,cpc",
        date_preset: datePreset,
      }),
      windsor({
        fields: "date,account_id,campaign,spend,impressions,actions_lead,actions_onsite_conversion_messaging_conversation_started_7d",
        date_from: fmtDate(priorStart),
        date_to: fmtDate(priorEnd),
      }),
      windsor({
        fields: "campaign,account_id,spend,impressions,clicks,actions_lead,actions_onsite_conversion_messaging_conversation_started_7d,actions_onsite_conversion_messaging_first_reply",
        date_preset: datePreset,
      }),
      windsor({
        fields: "adset_name,campaign,account_id,spend,impressions,reach,frequency,clicks,actions_link_click,actions_lead,actions_onsite_conversion_messaging_conversation_started_7d,actions_onsite_conversion_messaging_first_reply,ctr,cpc,adset_daily_budget,adset_lifetime_budget,campaign_daily_budget,effective_status",
        date_preset: datePreset,
      }),
      windsor({
        fields: "ad_name,adset_name,campaign,account_id,spend,impressions,clicks,actions_link_click,actions_lead,actions_onsite_conversion_messaging_conversation_started_7d,ctr,cpc,ad_created_time",
        date_preset: datePreset,
      }),
      // Active campaigns = had spend in the last 7 days
      windsor({
        fields: "campaign,account_id,spend",
        date_preset: "last_7d",
      }),
      // Daily WhatsApp conversations broken down by campaign (last 14 days)
      windsor({
        fields: "date,campaign,account_id,actions_lead,actions_onsite_conversion_messaging_conversation_started_7d,spend",
        date_preset: "last_14dT",
      }),
      // Campaign status + start time (for active/paused/learning detection)
      windsor({
        fields: "campaign,account_id,campaign_status,effective_status,campaign_start_time,spend",
        date_preset: "last_30dT",
      }),
    ]);

    // === Classify each campaign by real status (active/paused/learning/historical) ===
    type CampaignStatus = {
      name: string;
      effective_status: string;        // ACTIVE | ADSET_PAUSED | PAUSED | etc.
      started_at: string | null;
      days_old: number;
      is_running: boolean;             // running new traffic right now
      is_paused: boolean;              // user/ad set paused
      is_learning: boolean;            // running but <14 days old (Learning Phase)
      label: "active" | "learning" | "paused" | "historical";
    };

    const statusFiltered = filterClosets(campaignStatusRaw);
    const statusByCampaign = new Map<string, { effective: string; started: string | null; spend: number }>();
    for (const r of statusFiltered) {
      const camp = String(r.campaign || "");
      if (!camp) continue;
      const existing = statusByCampaign.get(camp);
      const effective = String(r.effective_status || "");
      const started = r.campaign_start_time ? String(r.campaign_start_time) : null;
      const spend = num(r.spend);
      if (!existing) {
        statusByCampaign.set(camp, { effective, started, spend });
      } else {
        // Multiple rows per campaign (different ad set statuses). Prefer ACTIVE > ADSET_PAUSED > PAUSED.
        const priority = (s: string) => (s === "ACTIVE" ? 3 : s === "ADSET_PAUSED" ? 2 : s.includes("PAUSED") ? 1 : 0);
        if (priority(effective) > priority(existing.effective)) {
          existing.effective = effective;
        }
        existing.spend += spend;
        if (!existing.started && started) existing.started = started;
      }
    }

    const activeFiltered = filterClosets(activeLast7Raw);
    const spendLast7By = new Map<string, number>();
    for (const r of activeFiltered) {
      const camp = String(r.campaign || "");
      spendLast7By.set(camp, (spendLast7By.get(camp) || 0) + num(r.spend));
    }

    const nowMs = Date.now();
    const campaignStatuses: CampaignStatus[] = Array.from(statusByCampaign.entries()).map(([name, s]) => {
      const startedDate = s.started ? new Date(s.started) : null;
      const days_old = startedDate ? Math.floor((nowMs - startedDate.getTime()) / 86400000) : 999;
      const spend7 = spendLast7By.get(name) || 0;
      const is_paused = s.effective.includes("PAUSED") || spend7 < 1; // <$1 in last 7d = effectively paused
      const is_running = s.effective === "ACTIVE" && spend7 >= 1;
      const is_learning = is_running && days_old < 14;
      let label: CampaignStatus["label"] = "historical";
      if (is_learning) label = "learning";
      else if (is_running) label = "active";
      else if (is_paused && spend7 > 1) label = "paused"; // recently paused
      else label = "historical";
      return { name, effective_status: s.effective, started_at: s.started, days_old, is_running, is_paused, is_learning, label };
    });

    // "Active" set for filtering = anything that ran in last 7 days (running OR recently paused)
    // This way recent activity stays visible in tables, but with clear status badges
    const activeCampaigns = new Set<string>(
      campaignStatuses.filter((c) => c.label !== "historical").map((c) => c.name)
    );
    const isActive = (camp: string | undefined) => !!camp && activeCampaigns.has(camp);

    // === Helper: Amudar's primary KPI is WhatsApp conversations, NOT form leads ===
    // Form leads are tracked but secondary. CPM = "Costo por Mensaje" (Cost per Message).
    const MSG_FIELD = "actions_onsite_conversion_messaging_conversation_started_7d";
    const REPLY_FIELD = "actions_onsite_conversion_messaging_first_reply";

    // Filter to active campaigns everywhere (rule: had spend in last 7 days)
    const dailyFiltered = filterClosets(dailyRaw).filter((r) => isActive(String(r.campaign || "")));
    const dailyAgg = aggBy(dailyFiltered, "date", [
      "spend", "impressions", "reach", "clicks", "actions_link_click", "actions_lead", MSG_FIELD, REPLY_FIELD,
    ]);
    type DailyRow = { date: string; spend: number; impressions: number; reach: number; clicks: number; link_clicks: number; leads: number; messages: number; replies: number };
    const daily: DailyRow[] = Object.entries(dailyAgg)
      .map(([date, m]) => ({
        date,
        spend: m.spend,
        impressions: m.impressions,
        reach: m.reach,
        clicks: m.clicks,
        link_clicks: m.actions_link_click,
        leads: m.actions_lead,
        messages: m[MSG_FIELD],
        replies: m[REPLY_FIELD],
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const priorFiltered = filterClosets(priorRaw).filter((r) => isActive(String(r.campaign || "")));
    const prior = priorFiltered.reduce<{ spend: number; impressions: number; leads: number; messages: number }>(
      (acc, r) => {
        acc.spend += num(r.spend);
        acc.impressions += num(r.impressions);
        acc.leads += num(r.actions_lead);
        acc.messages += num(r[MSG_FIELD]);
        return acc;
      },
      { spend: 0, impressions: 0, leads: 0, messages: 0 }
    );

    const campaignFiltered = filterClosets(campaignRaw).filter((r) => isActive(String(r.campaign || "")));
    const campaignAgg = aggBy(campaignFiltered, "campaign", [
      "spend", "impressions", "clicks", "actions_lead", MSG_FIELD, REPLY_FIELD,
    ]);
    const campaignBreakdown = Object.entries(campaignAgg)
      .map(([name, m]) => ({
        name,
        spend: m.spend,
        impressions: m.impressions,
        leads: m.actions_lead,
        messages: m[MSG_FIELD],
        replies: m[REPLY_FIELD],
        cpl: m.actions_lead > 0 ? m.spend / m.actions_lead : null,
        cpm_msg: m[MSG_FIELD] > 0 ? m.spend / m[MSG_FIELD] : null,
      }))
      .sort((a, b) => b.spend - a.spend);

    // Windsor returns multiple rows per ad set (varying effective_status across the period).
    // Aggregate by (campaign, adset_name) so each ad set is counted once.
    type AdsetAgg = {
      campaign: string; name: string; spend: number; impressions: number; reach: number;
      frequency: number; clicks: number; link_clicks: number; leads: number; messages: number; replies: number;
    };
    const adsetMap = new Map<string, AdsetAgg>();
    for (const r of filterClosets(adsetRaw)) {
      const camp = String(r.campaign || "");
      const name = String(r.adset_name || "");
      if (!isActive(camp)) continue;
      const k = `${camp}||${name}`;
      const ex = adsetMap.get(k);
      const row: AdsetAgg = {
        campaign: camp, name,
        spend: num(r.spend), impressions: num(r.impressions), reach: num(r.reach),
        frequency: num(r.frequency), clicks: num(r.clicks),
        link_clicks: num(r.actions_link_click), leads: num(r.actions_lead),
        messages: num(r[MSG_FIELD]), replies: num(r[REPLY_FIELD]),
      };
      if (!ex) adsetMap.set(k, row);
      else {
        ex.spend += row.spend; ex.impressions += row.impressions; ex.reach += row.reach;
        ex.frequency = Math.max(ex.frequency, row.frequency);
        ex.clicks += row.clicks; ex.link_clicks += row.link_clicks;
        ex.leads += row.leads; ex.messages += row.messages; ex.replies += row.replies;
      }
    }
    const adsets = Array.from(adsetMap.values())
      .filter((a) => a.spend > 50)
      .map((a) => ({
        ...a,
        ctr: a.impressions > 0 ? a.clicks / a.impressions : 0,
        cpc: a.clicks > 0 ? a.spend / a.clicks : 0,
        cpl: a.leads > 0 ? a.spend / a.leads : null,
        cpm_msg: a.messages > 0 ? a.spend / a.messages : null,  // Costo por Mensaje WhatsApp — Amudar's primary CPL
      }));

    // === Budget per ad set (used for deep recommendations) ===
    // Meta returns budgets in "minor currency units". For currencies with cents (USD/EUR),
    // divide by 100. For currencies without cents (COP/CLP/JPY/KRW), no division — the
    // value is already in full units. Amudar's account is COP, so divisor = 1.
    const BUDGET_DIVISOR = 1;
    type BudgetInfo = { adsetDaily: number; campaignDaily: number; effectiveStatus: string };
    const budgetByAdset = new Map<string, BudgetInfo>();
    for (const r of filterClosets(adsetRaw)) {
      const key = `${r.campaign}||${r.adset_name}`;
      const adsetDaily = num(r.adset_daily_budget) / BUDGET_DIVISOR;
      const campaignDaily = num(r.campaign_daily_budget) / BUDGET_DIVISOR;
      const effectiveStatus = String(r.effective_status || "");
      const existing = budgetByAdset.get(key);
      if (!existing) {
        budgetByAdset.set(key, { adsetDaily, campaignDaily, effectiveStatus });
      } else {
        if (adsetDaily > existing.adsetDaily) existing.adsetDaily = adsetDaily;
        if (campaignDaily > existing.campaignDaily) existing.campaignDaily = campaignDaily;
        // Prefer ACTIVE > ADSET_PAUSED > PAUSED
        const pri = (s: string) => (s === "ACTIVE" ? 3 : s === "ADSET_PAUSED" ? 2 : s.includes("PAUSED") ? 1 : 0);
        if (pri(effectiveStatus) > pri(existing.effectiveStatus)) existing.effectiveStatus = effectiveStatus;
      }
    }

    const adsFiltered = filterClosets(adsRaw)
      .filter((r) => num(r.spend) > 30)
      .filter((r) => isActive(String(r.campaign || "")));

    // Detect when creatives were last refreshed: count ads created in last 14 days
    const recentAdCutoff = Date.now() - 14 * 86400000;
    const recentAds = adsFiltered.filter((r) => {
      const ct = r.ad_created_time ? new Date(String(r.ad_created_time)).getTime() : 0;
      return ct >= recentAdCutoff;
    });
    const newestAdAge = adsFiltered.reduce((min, r) => {
      const ct = r.ad_created_time ? new Date(String(r.ad_created_time)).getTime() : 0;
      if (!ct) return min;
      const age = Math.floor((Date.now() - ct) / 86400000);
      return age < min ? age : min;
    }, 999);
    const topAds = adsFiltered.map((r) => ({
      name: String(r.ad_name || ""),
      adset: String(r.adset_name || ""),
      spend: num(r.spend),
      impressions: num(r.impressions),
      clicks: num(r.clicks),
      link_clicks: num(r.actions_link_click),
      leads: num(r.actions_lead),
      ctr: num(r.ctr),
      cpc: num(r.cpc),
      cpl: num(r.actions_lead) > 0 ? num(r.spend) / num(r.actions_lead) : null,
    }));

    // === Daily WhatsApp conversations by active campaign (last 14 days) ===
    // For Amudar this is the primary daily metric — form leads kept for reference only.
    const dailyByCampaignFiltered = filterClosets(dailyByCampaignRaw).filter((r) =>
      isActive(String(r.campaign || ""))
    );
    const dailyMessagesMap: Record<string, Record<string, number>> = {};
    const activeCampaignNames = new Set<string>();
    for (const r of dailyByCampaignFiltered) {
      const date = String(r.date || "");
      const camp = String(r.campaign || "");
      if (!date || !camp) continue;
      activeCampaignNames.add(camp);
      if (!dailyMessagesMap[date]) dailyMessagesMap[date] = {};
      dailyMessagesMap[date][camp] = (dailyMessagesMap[date][camp] || 0) + num(r[MSG_FIELD]);
    }
    const dailyMessagesByCampaign = Object.entries(dailyMessagesMap)
      .map(([date, byCamp]) => ({
        date,
        total: Object.values(byCamp).reduce((s, n) => s + n, 0),
        byCampaign: byCamp,
      }))
      .sort((a, b) => b.date.localeCompare(a.date)); // most recent first

    const todayStr = new Date().toISOString().slice(0, 10);
    const yesterdayStr = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const messagesToday = dailyMessagesByCampaign.find((d) => d.date === todayStr)?.total || 0;
    const messagesYesterday = dailyMessagesByCampaign.find((d) => d.date === yesterdayStr)?.total || 0;

    // === Compute aggregates ===
    const total30d = daily.reduce<{ spend: number; impressions: number; reach_daily_sum: number; clicks: number; leads: number; messages: number; replies: number }>(
      (acc, d) => {
        acc.spend += d.spend;
        acc.impressions += d.impressions;
        acc.reach_daily_sum += d.reach;
        acc.clicks += d.clicks;
        acc.leads += d.leads;
        acc.messages += d.messages;
        acc.replies += d.replies;
        return acc;
      },
      { spend: 0, impressions: 0, reach_daily_sum: 0, clicks: 0, leads: 0, messages: 0, replies: 0 }
    );

    // Primary KPI for Amudar = cost per WhatsApp message. cpl (form leads) is secondary.
    const cpl = total30d.leads > 0 ? total30d.spend / total30d.leads : 0;
    const cpMessage = total30d.messages > 0 ? total30d.spend / total30d.messages : 0;
    const cpm = total30d.impressions > 0 ? (total30d.spend / total30d.impressions) * 1000 : 0;
    const ctr = total30d.impressions > 0 ? total30d.clicks / total30d.impressions : 0;

    const sumWin = (rows: typeof daily) => rows.reduce<{ spend: number; impressions: number; leads: number; messages: number }>(
      (acc, d) => {
        acc.spend += d.spend; acc.impressions += d.impressions; acc.leads += d.leads; acc.messages += d.messages; return acc;
      },
      { spend: 0, impressions: 0, leads: 0, messages: 0 }
    );
    const last7 = sumWin(daily.slice(-7));
    const prev7 = sumWin(daily.slice(-14, -7));

    const pct = (n: number, p: number) => (p ? ((n - p) / p) * 100 : 0);

    // === Week-over-week chart data (last 8 weeks of messages + spend) ===
    type WeekBucket = { weekStart: string; spend: number; messages: number; leads: number };
    const weekBuckets: WeekBucket[] = [];
    if (daily.length > 0) {
      // Group daily data into rolling 7-day buckets ending at the most recent date
      const endDate = new Date(daily[daily.length - 1].date);
      for (let w = 0; w < 8; w++) {
        const weekEnd = new Date(endDate); weekEnd.setDate(endDate.getDate() - w * 7);
        const weekStart = new Date(weekEnd); weekStart.setDate(weekEnd.getDate() - 6);
        const inRange = daily.filter((d) => {
          const dDate = new Date(d.date);
          return dDate >= weekStart && dDate <= weekEnd;
        });
        if (inRange.length === 0) continue;
        weekBuckets.unshift({
          weekStart: weekStart.toISOString().slice(0, 10),
          spend: inRange.reduce((s, d) => s + d.spend, 0),
          messages: inRange.reduce((s, d) => s + d.messages, 0),
          leads: inRange.reduce((s, d) => s + d.leads, 0),
        });
      }
    }
    const weekOverWeek = {
      weeks: weekBuckets,
      latestMessages: weekBuckets[weekBuckets.length - 1]?.messages || 0,
      previousMessages: weekBuckets[weekBuckets.length - 2]?.messages || 0,
      growthPct: weekBuckets.length >= 2
        ? pct(weekBuckets[weekBuckets.length - 1].messages, weekBuckets[weekBuckets.length - 2].messages)
        : 0,
    };

    // === DEEP RECOMMENDATIONS (budget-aware) ===
    // Thresholds in COP (Amudar account). $15 USD/day ≈ 60,000 COP/day × 30 = 1,800,000 COP/mo
    // Min spend gate for "loser if no leads" set at 200,000 COP (~$50 USD).
    const MIN_BUDGET_PER_TEST = 1800000;   // ~$450 USD equivalent in COP for Meta Learning Phase exit
    const CONVERSIONS_FOR_CBO = 50;         // Meta best practice threshold
    const MIN_SPEND_FOR_LOSER = 200000;     // Don't flag low-spend ad sets as losers
    const statusByCampaignName = new Map(campaignStatuses.map((s) => [s.name, s]));

    type AdsetAudit = {
      campaign: string; name: string;
      cpl: number | null; cpMessage: number | null;
      leads: number; messages: number; replies: number; spend: number;
      dailyBudget: number; monthlyBudget: number;
      category: "winner" | "borderline" | "loser" | "learning"; effectiveStatus: string;
    };

    // Per ad set classification — uses MESSAGES (WhatsApp) not form leads as primary metric.
    // Thresholds RELATIVE to account avg cost-per-message (vertical-agnostic).
    const adsetAudits: AdsetAudit[] = adsets.map((a) => {
      const b = budgetByAdset.get(`${a.campaign}||${a.name}`);
      const dailyBudget = b?.adsetDaily || b?.campaignDaily || 0;
      const monthlyBudget = dailyBudget * 30;
      const camStatus = statusByCampaignName.get(a.campaign);
      let category: AdsetAudit["category"];
      if (camStatus?.label === "learning") category = "learning";
      else if (a.cpm_msg !== null && cpMessage > 0 && a.cpm_msg <= cpMessage && a.messages >= 10) category = "winner";
      else if ((a.cpm_msg !== null && cpMessage > 0 && a.cpm_msg > cpMessage * 3) || (a.messages === 0 && a.leads === 0 && a.spend > MIN_SPEND_FOR_LOSER)) category = "loser";
      else category = "borderline";
      return {
        campaign: a.campaign, name: a.name,
        cpl: a.cpl, cpMessage: a.cpm_msg,
        leads: a.leads, messages: a.messages, replies: a.replies, spend: a.spend,
        dailyBudget, monthlyBudget, category, effectiveStatus: b?.effectiveStatus || "",
      };
    });

    // === Budget audit summary ===
    const bucket = (cat: AdsetAudit["category"]) => adsetAudits.filter((a) => a.category === cat);
    const sumMonth = (arr: AdsetAudit[]) => arr.reduce((s, a) => s + a.monthlyBudget, 0);
    const winners = bucket("winner");
    const borderlines = bucket("borderline");
    const losers = bucket("loser");
    const learningSets = bucket("learning");
    const reassignableBudget = sumMonth(losers);
    const budgetAudit = {
      totalMonthlyBudget: adsetAudits.reduce((s, a) => s + a.monthlyBudget, 0),
      winners: { count: winners.length, monthlyBudget: sumMonth(winners), adsets: winners },
      borderline: { count: borderlines.length, monthlyBudget: sumMonth(borderlines), adsets: borderlines },
      losers: { count: losers.length, monthlyBudget: sumMonth(losers), adsets: losers },
      learning: { count: learningSets.length, monthlyBudget: sumMonth(learningSets), adsets: learningSets },
      reassignableBudget,
    };

    // === Structure recommendation: CBO vs ABO per active campaign ===
    type StructureRec = {
      name: string; currentStructure: "CBO" | "ABO" | "unknown";
      activeAdsetCount: number; totalConversions: number;
      recommendation: "switch_to_cbo" | "switch_to_abo" | "keep";
      reason: string; blockedReason?: string;
    };
    const structureByCampaign = new Map<string, StructureRec>();
    for (const a of adsetAudits) {
      const existing = structureByCampaign.get(a.campaign);
      const b = budgetByAdset.get(`${a.campaign}||${a.name}`);
      const isABO = (b?.adsetDaily || 0) > 0;
      const isCBO = (b?.campaignDaily || 0) > 0;
      const struct: "CBO" | "ABO" | "unknown" = isABO ? "ABO" : isCBO ? "CBO" : "unknown";
      const isActiveAdset = b?.effectiveStatus === "ACTIVE";
      if (!existing) {
        structureByCampaign.set(a.campaign, {
          name: a.campaign, currentStructure: struct,
          activeAdsetCount: isActiveAdset ? 1 : 0,
          totalConversions: a.leads, recommendation: "keep", reason: "",
        });
      } else {
        if (isActiveAdset) existing.activeAdsetCount++;
        existing.totalConversions += a.leads;
        if (existing.currentStructure === "unknown") existing.currentStructure = struct;
      }
    }
    for (const [, rec] of structureByCampaign) {
      const camStatus = statusByCampaignName.get(rec.name);
      if (camStatus?.label === "learning") {
        rec.blockedReason = `Campaña en Learning Phase (${camStatus.days_old}d) — esperar día 14 antes de cambiar estructura`;
        rec.recommendation = "keep";
        rec.reason = "No tocar durante Learning Phase";
      } else if (rec.currentStructure === "ABO" && rec.activeAdsetCount >= 2 && rec.totalConversions >= CONVERSIONS_FOR_CBO) {
        rec.recommendation = "switch_to_cbo";
        rec.reason = `Tienes ${rec.activeAdsetCount} ad sets activos con ${rec.totalConversions} conversiones. CBO permitiría a Meta concentrar budget en el ganador automáticamente.`;
      } else if (rec.currentStructure === "ABO" && rec.activeAdsetCount >= 2 && rec.totalConversions < CONVERSIONS_FOR_CBO) {
        rec.recommendation = "keep";
        rec.reason = `Aún en ABO: necesitas ${CONVERSIONS_FOR_CBO - rec.totalConversions} conversiones más antes de considerar CBO.`;
      } else {
        rec.recommendation = "keep";
        rec.reason = "Estructura adecuada para el volumen actual.";
      }
    }
    const structureRec = { activeCampaigns: Array.from(structureByCampaign.values()) };

    // === Audience tests (budget-constrained) ===
    const maxTests = Math.min(3, Math.floor(reassignableBudget / MIN_BUDGET_PER_TEST));
    const audienceSuggestions: Array<{
      title: string; audience: string; campaign: string;
      monthlyBudget: number; daysToLearn: number; riskLevel: "low" | "medium" | "high"; rationale: string;
    }> = [];
    const winnerCampaign = winners[0]?.campaign || adsetAudits[0]?.campaign || "";
    const existingAudienceNames = new Set(adsetAudits.map((a) => a.name.toLowerCase()));
    const candidatePool = [
      { title: "Customer LAL 1%", audience: "Lookalike 1% de tus clientes reales (no leads, solo los que ya contrataron mudanza)",
        rationale: "La data más limpia que tienes. Suele bajar CPL porque Meta encuentra perfiles similares a quienes ya compraron.",
        riskLevel: "low" as const, daysToLearn: 14 },
      { title: "Lead LAL 1%", audience: "Lookalike 1% de los leads de los últimos 90 días",
        rationale: "Fácil de armar (Meta ya tiene la data). Buena alternativa si la base de clientes es pequeña.",
        riskLevel: "low" as const, daysToLearn: 14 },
      { title: "Broad + Advantage+ Audience", audience: "Targeting mínimo (geo + edad) con Advantage+ Audience habilitado — dejar que Meta encuentre nuevos bolsillos",
        rationale: "Diversifica fuera de los lookalikes si empiezan a fatigarse. A menudo Meta sorprende encontrando audiencia que las LALs no cubren.",
        riskLevel: "medium" as const, daysToLearn: 18 },
    ];
    for (let i = 0; i < maxTests && i < candidatePool.length; i++) {
      const cand = candidatePool[i];
      if (existingAudienceNames.has(cand.title.toLowerCase())) continue;
      audienceSuggestions.push({
        ...cand,
        campaign: winnerCampaign,
        monthlyBudget: MIN_BUDGET_PER_TEST,
      });
    }
    const audienceTests = {
      freeBudget: reassignableBudget,
      maxTests,
      minBudgetPerTest: MIN_BUDGET_PER_TEST,
      suggestions: audienceSuggestions,
      note: maxTests === 0
        ? `Tu budget actual no permite tests de audiencias nuevas sin afectar las que están funcionando. Foco: nuevos creativos dentro de las audiencias existentes ganadoras.`
        : `Pausando los ${losers.length} ad sets perdedores libera $${reassignableBudget.toFixed(0)}/mes. Eso paga ${maxTests} test${maxTests > 1 ? "s" : ""} nuevo${maxTests > 1 ? "s" : ""} de audiencia (mínimo $${MIN_BUDGET_PER_TEST}/mes c/u para que Meta salga de Learning).`,
    };

    // === Creative variants per active winner ad set ===
    const adCountByAdset = new Map<string, { count: number; oldest: number }>();
    for (const ad of adsFiltered) {
      const adsetKey = String(ad.adset_name || "");
      const ct = ad.ad_created_time ? new Date(String(ad.ad_created_time)).getTime() : 0;
      const ageDays = ct ? Math.floor((Date.now() - ct) / 86400000) : 999;
      const ex = adCountByAdset.get(adsetKey);
      if (!ex) adCountByAdset.set(adsetKey, { count: 1, oldest: ageDays });
      else { ex.count++; if (ageDays > ex.oldest) ex.oldest = ageDays; }
    }
    type CreativeVariantRec = {
      adset: string; campaign: string; currentAdCount: number; oldestAdDays: number;
      recommendedAdds: number; reason: string; blockedReason?: string;
    };
    const creativeVariants: CreativeVariantRec[] = [];
    for (const a of [...winners, ...borderlines]) {
      const info = adCountByAdset.get(a.name) || { count: 0, oldest: 0 };
      const targetCount = 4;
      const recommendedAdds = Math.max(0, targetCount - info.count);
      if (recommendedAdds === 0 && info.oldest < 30) continue;
      const camStatus = statusByCampaignName.get(a.campaign);
      const blocked = camStatus?.label === "learning"
        ? `Campaña en Learning Phase (${camStatus.days_old}d) — esperar día 14 antes de agregar`
        : info.oldest < 7
        ? `Última creatividad tiene ${info.oldest}d. Esperar a día 7 para evaluar performance antes de agregar.`
        : undefined;
      const reason = recommendedAdds > 0
        ? `Tienes ${info.count} ad${info.count !== 1 ? "s" : ""} activo${info.count !== 1 ? "s" : ""} en este ad set. Mejor práctica: 3-5 variantes para que Meta tenga material para optimizar.`
        : `${info.count} ads activos pero el más viejo tiene ${info.oldest}d. Producir 2 variantes nuevas antes que entren en fatiga.`;
      creativeVariants.push({
        adset: a.name, campaign: a.campaign,
        currentAdCount: info.count, oldestAdDays: info.oldest,
        recommendedAdds: recommendedAdds > 0 ? recommendedAdds : 2,
        reason, blockedReason: blocked,
      });
    }

    // === Evaluation calendar ===
    type CalendarItem = { adset: string; campaign: string; daysRunning: number; nextEvalDate: string; action: string };
    const calendar: CalendarItem[] = [];
    for (const a of adsetAudits) {
      const camStatus = statusByCampaignName.get(a.campaign);
      const started = camStatus?.started_at ? new Date(camStatus.started_at) : new Date();
      const daysRunning = camStatus?.days_old || 0;
      let nextEvalOffset = 7;
      let action = "Revisar performance semanal";
      if (camStatus?.label === "learning") {
        nextEvalOffset = Math.max(1, 14 - daysRunning);
        action = "No tocar — esperar fin de Learning Phase";
      } else if (a.category === "loser") {
        nextEvalOffset = 0;
        action = "Pausar o reducir budget al mínimo HOY";
      } else if (a.category === "winner") {
        const info = adCountByAdset.get(a.name);
        nextEvalOffset = info && info.oldest > 21 ? 3 : 7;
        action = info && info.oldest > 21 ? "Refrescar creativo esta semana — riesgo de fatiga" : "Mantener y revisar semanal";
      } else if (a.category === "borderline") {
        nextEvalOffset = 7;
        action = "Producir variantes creativas en próximos 7d";
      }
      const eval_date = new Date(Date.now() + nextEvalOffset * 86400000);
      calendar.push({
        adset: a.name, campaign: a.campaign, daysRunning,
        nextEvalDate: eval_date.toISOString().slice(0, 10),
        action,
      });
    }

    const deepRecommendations = { budgetAudit, structureRec, audienceTests, creativeVariants, evaluationCalendar: calendar };

    return Response.json({
      lastUpdated: new Date().toISOString(),
      rangeDays,
      period: {
        start: daily[0]?.date || "",
        end: daily[daily.length - 1]?.date || "",
      },
      totals30d: {
        spend: total30d.spend,
        impressions: total30d.impressions,
        reach_daily_sum: total30d.reach_daily_sum,
        leads: total30d.leads,
        messages: total30d.messages,
        replies: total30d.replies,
        clicks: total30d.clicks,
        ctr,
        cpl,
        cpMessage,
        cpm,
      },
      monthOverMonth: {
        current: { label: `Últimos ${rangeDays} días`, spend: total30d.spend, impressions: total30d.impressions, leads: total30d.leads, messages: total30d.messages, cpl, cpMessage },
        prior: {
          label: `${rangeDays} días previos`,
          spend: prior.spend, impressions: prior.impressions, leads: prior.leads, messages: prior.messages,
          cpl: prior.leads > 0 ? prior.spend / prior.leads : 0,
          cpMessage: prior.messages > 0 ? prior.spend / prior.messages : 0,
        },
        deltas: {
          spend: pct(total30d.spend, prior.spend),
          impressions: pct(total30d.impressions, prior.impressions),
          leads: pct(total30d.leads, prior.leads),
          messages: pct(total30d.messages, prior.messages),
          cpl: pct(cpl, prior.leads > 0 ? prior.spend / prior.leads : 0),
          cpMessage: pct(cpMessage, prior.messages > 0 ? prior.spend / prior.messages : 0),
        },
      },
      last7vsPrev7: {
        spend: { now: last7.spend, prev: prev7.spend, pct: pct(last7.spend, prev7.spend) },
        leads: { now: last7.leads, prev: prev7.leads, pct: pct(last7.leads, prev7.leads) },
        messages: { now: last7.messages, prev: prev7.messages, pct: pct(last7.messages, prev7.messages) },
        impressions: { now: last7.impressions, prev: prev7.impressions, pct: pct(last7.impressions, prev7.impressions) },
        cpl_now: last7.leads > 0 ? last7.spend / last7.leads : 0,
        cpl_prev: prev7.leads > 0 ? prev7.spend / prev7.leads : 0,
        cpMessage_now: last7.messages > 0 ? last7.spend / last7.messages : 0,
        cpMessage_prev: prev7.messages > 0 ? prev7.spend / prev7.messages : 0,
      },
      weekOverWeek,
      campaignBreakdown30d: campaignBreakdown,
      daily,
      adsets,
      topAds,
      activeCampaigns: Array.from(activeCampaignNames).sort(),
      campaignStatuses,
      dailyMessagesByCampaign,
      messagesToday,
      messagesYesterday,
      creativeRefresh: {
        recentAdsCount: recentAds.length,
        newestAdDays: newestAdAge,
        isTestingNew: newestAdAge < 7,    // <7d = still gathering data, suppress fatigue warning
        readyForFeedback: newestAdAge >= 7 && newestAdAge <= 14, // 7-14d = enough data to evaluate
      },
      deepRecommendations,
    });
  } catch (err) {
    console.error("[meta-data]", err);
    return Response.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
