/**
 * Pulls live Google Ads data from Windsor.ai REST API for Amudar.
 * Account: 464-415-2268 (A-mudar).
 *
 * Google Ads concepts differ from Meta:
 * - Status: ENABLED | PAUSED | REMOVED (not ACTIVE | ADSET_PAUSED)
 * - No ad sets — campaigns hold ad groups (for Search) or asset groups (for Pmax)
 * - "Conversions" is the equivalent of Meta's "actions_lead"
 * - Spend is in account currency (COP for Amudar)
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const GOOGLE_ACCOUNT_ID = process.env.GOOGLE_ADS_ACCOUNT_ID || "464-415-2268";
const WINDSOR_BASE = "https://connectors.windsor.ai/google_ads";

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

function filterAccount(rows: WindsorRow[]): WindsorRow[] {
  return rows.filter((r) => String(r.account_id) === GOOGLE_ACCOUNT_ID);
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
    return Response.json({ error: "WINDSOR_API_KEY not set in environment" }, { status: 500 });
  }

  try {
    const url = new URL(req.url);
    const requested = parseInt(url.searchParams.get("days") || "30", 10);
    const rangeDays: 30 | 60 | 90 = [30, 60, 90].includes(requested) ? (requested as 30 | 60 | 90) : 30;
    const datePreset = rangeDays === 60 ? "last_60dT" : rangeDays === 90 ? "last_90dT" : "last_30dT";

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const priorStart = new Date(today); priorStart.setDate(today.getDate() - rangeDays * 2);
    const priorEnd = new Date(today); priorEnd.setDate(today.getDate() - rangeDays - 1);
    const fmtDate = (d: Date) => d.toISOString().slice(0, 10);

    const [dailyRaw, priorRaw, campaignRaw, activeLast7Raw] = await Promise.all([
      windsor({
        fields: "date,account_id,campaign,spend,impressions,clicks,conversions",
        date_preset: datePreset,
      }),
      windsor({
        fields: "date,account_id,campaign,spend,impressions,conversions",
        date_from: fmtDate(priorStart),
        date_to: fmtDate(priorEnd),
      }),
      windsor({
        fields: "campaign,campaign_status,account_id,spend,impressions,clicks,conversions",
        date_preset: datePreset,
      }),
      windsor({
        fields: "campaign,account_id,spend",
        date_preset: "last_7d",
      }),
    ]);

    // Active campaigns = had spend in last 7 days
    const activeFiltered = filterAccount(activeLast7Raw);
    const spendLast7By = new Map<string, number>();
    for (const r of activeFiltered) {
      const c = String(r.campaign || "");
      spendLast7By.set(c, (spendLast7By.get(c) || 0) + num(r.spend));
    }
    const activeCampaigns = new Set<string>([...spendLast7By.entries()].filter(([, s]) => s > 0).map(([c]) => c));
    const isActive = (c?: string) => !!c && activeCampaigns.has(c);

    // Campaign-level breakdown
    const campaignFiltered = filterAccount(campaignRaw).filter((r) => isActive(String(r.campaign || "")));
    const campaignByName = new Map<string, { status: string; spend: number; impressions: number; clicks: number; conversions: number }>();
    for (const r of campaignFiltered) {
      const name = String(r.campaign || "");
      const status = String(r.campaign_status || "");
      const ex = campaignByName.get(name);
      const row = {
        status,
        spend: num(r.spend),
        impressions: num(r.impressions),
        clicks: num(r.clicks),
        conversions: num(r.conversions),
      };
      if (!ex) campaignByName.set(name, row);
      else {
        // Prefer ENABLED status over PAUSED
        if (row.status === "ENABLED" && ex.status !== "ENABLED") ex.status = "ENABLED";
        ex.spend += row.spend; ex.impressions += row.impressions; ex.clicks += row.clicks; ex.conversions += row.conversions;
      }
    }
    const campaignBreakdown = Array.from(campaignByName.entries())
      .map(([name, m]) => ({
        name,
        status: m.status,
        spend: m.spend,
        impressions: m.impressions,
        clicks: m.clicks,
        conversions: m.conversions,
        cpa: m.conversions > 0 ? m.spend / m.conversions : null,
        ctr: m.impressions > 0 ? m.clicks / m.impressions : 0,
      }))
      .sort((a, b) => b.spend - a.spend);

    // Daily aggregation
    const dailyFiltered = filterAccount(dailyRaw).filter((r) => isActive(String(r.campaign || "")));
    const dailyAgg = aggBy(dailyFiltered, "date", ["spend", "impressions", "clicks", "conversions"]);
    type DailyRow = { date: string; spend: number; impressions: number; clicks: number; conversions: number };
    const daily: DailyRow[] = Object.entries(dailyAgg)
      .map(([date, m]) => ({
        date,
        spend: m.spend,
        impressions: m.impressions,
        clicks: m.clicks,
        conversions: m.conversions,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Prior period (for monthOverMonth)
    const priorFiltered = filterAccount(priorRaw).filter((r) => isActive(String(r.campaign || "")));
    const prior = priorFiltered.reduce<{ spend: number; impressions: number; conversions: number }>(
      (acc, r) => {
        acc.spend += num(r.spend); acc.impressions += num(r.impressions); acc.conversions += num(r.conversions);
        return acc;
      },
      { spend: 0, impressions: 0, conversions: 0 }
    );

    // Totals
    const total = daily.reduce<{ spend: number; impressions: number; clicks: number; conversions: number }>(
      (acc, d) => {
        acc.spend += d.spend; acc.impressions += d.impressions; acc.clicks += d.clicks; acc.conversions += d.conversions;
        return acc;
      },
      { spend: 0, impressions: 0, clicks: 0, conversions: 0 }
    );
    const cpa = total.conversions > 0 ? total.spend / total.conversions : 0;
    const ctr = total.impressions > 0 ? total.clicks / total.impressions : 0;
    const cpm = total.impressions > 0 ? (total.spend / total.impressions) * 1000 : 0;

    // 7d vs prev 7d
    const sumWin = (rows: typeof daily) => rows.reduce<{ spend: number; impressions: number; conversions: number }>(
      (acc, d) => { acc.spend += d.spend; acc.impressions += d.impressions; acc.conversions += d.conversions; return acc; },
      { spend: 0, impressions: 0, conversions: 0 }
    );
    const last7 = sumWin(daily.slice(-7));
    const prev7 = sumWin(daily.slice(-14, -7));
    const pct = (n: number, p: number) => (p ? ((n - p) / p) * 100 : 0);

    // Campaign statuses (for status badges)
    const campaignStatuses = Array.from(campaignByName.entries()).map(([name, m]) => ({
      name,
      effective_status: m.status,
      label: m.status === "ENABLED" ? "active" as const : m.status.includes("PAUSED") ? "paused" as const : "historical" as const,
    }));

    return Response.json({
      platform: "google",
      lastUpdated: new Date().toISOString(),
      rangeDays,
      period: { start: daily[0]?.date || "", end: daily[daily.length - 1]?.date || "" },
      totals30d: {
        spend: total.spend,
        impressions: total.impressions,
        clicks: total.clicks,
        conversions: total.conversions,
        cpa,
        ctr,
        cpm,
      },
      monthOverMonth: {
        current: { label: `Últimos ${rangeDays} días`, spend: total.spend, impressions: total.impressions, conversions: total.conversions, cpa },
        prior: { label: `${rangeDays} días previos`, spend: prior.spend, impressions: prior.impressions, conversions: prior.conversions, cpa: prior.conversions > 0 ? prior.spend / prior.conversions : 0 },
        deltas: {
          spend: pct(total.spend, prior.spend),
          impressions: pct(total.impressions, prior.impressions),
          conversions: pct(total.conversions, prior.conversions),
          cpa: pct(cpa, prior.conversions > 0 ? prior.spend / prior.conversions : 0),
        },
      },
      last7vsPrev7: {
        spend: { now: last7.spend, prev: prev7.spend, pct: pct(last7.spend, prev7.spend) },
        conversions: { now: last7.conversions, prev: prev7.conversions, pct: pct(last7.conversions, prev7.conversions) },
        impressions: { now: last7.impressions, prev: prev7.impressions, pct: pct(last7.impressions, prev7.impressions) },
        cpa_now: last7.conversions > 0 ? last7.spend / last7.conversions : 0,
        cpa_prev: prev7.conversions > 0 ? prev7.spend / prev7.conversions : 0,
      },
      campaignBreakdown,
      daily,
      campaignStatuses,
      activeCampaigns: Array.from(activeCampaigns),
    });
  } catch (err) {
    console.error("[google-data]", err);
    return Response.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
