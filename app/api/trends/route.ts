/**
 * Pulls Google Trends interest-over-time for Bogotá moving keywords.
 * Uses google-trends-api (unofficial scraper). Free but rate-limited.
 * Cached 24h in /tmp — trend data is slow, no need for real-time.
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
// google-trends-api has no types
// @ts-expect-error — no type declarations
import googleTrends from "google-trends-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_FILE = path.join(os.tmpdir(), "amudar-trends-cache.json");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const GEO = "CO-DC"; // Bogotá D.C.

// Keywords to track for Amudar (moving services in Bogotá)
const KEYWORDS = [
  "mudanzas Bogotá",
  "trasteos Bogotá",
  "empresa de mudanzas",
];

type Point = { date: string; value: number };
type KeywordSeries = { keyword: string; points: Point[]; latestValue: number; peak: number; peakDate: string };
type Payload = {
  lastUpdated: string;
  geo: string;
  timeframe: string;
  series: KeywordSeries[];
};

interface TimelineValue { time: string; value: number[]; formattedTime: string; formattedValue: string[] }
interface InterestOverTimeResponse {
  default: {
    timelineData: TimelineValue[];
  };
}

async function readCache(): Promise<(Payload & { cached: true }) | null> {
  try {
    const raw = await fs.readFile(CACHE_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Payload;
    const age = Date.now() - new Date(parsed.lastUpdated).getTime();
    if (age < CACHE_TTL_MS) return { ...parsed, cached: true };
    return null;
  } catch {
    return null;
  }
}

async function writeCache(data: Payload) {
  try { await fs.writeFile(CACHE_FILE, JSON.stringify(data)); } catch { /* best effort */ }
}

async function fetchKeyword(keyword: string): Promise<KeywordSeries> {
  // 90 days of daily data (weekly bucketing happens client-side if desired)
  const now = new Date();
  const startTime = new Date(now.getTime() - 90 * 86400000);
  const raw: string = await googleTrends.interestOverTime({
    keyword,
    startTime,
    endTime: now,
    geo: GEO,
  });
  const parsed = JSON.parse(raw) as InterestOverTimeResponse;
  const timeline = parsed.default?.timelineData ?? [];
  const points: Point[] = timeline.map((t) => ({
    // "time" is a unix seconds string
    date: new Date(parseInt(t.time, 10) * 1000).toISOString().slice(0, 10),
    value: Array.isArray(t.value) ? t.value[0] : 0,
  }));
  const latestValue = points.length > 0 ? points[points.length - 1].value : 0;
  let peak = 0, peakDate = "";
  for (const p of points) if (p.value > peak) { peak = p.value; peakDate = p.date; }
  return { keyword, points, latestValue, peak, peakDate };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";

  if (!force) {
    const cached = await readCache();
    if (cached) return Response.json(cached);
  }

  try {
    // Sequential + long delay (Google blocks fast requests as bot)
    const series: KeywordSeries[] = [];
    let blocked = false;
    for (let i = 0; i < KEYWORDS.length; i++) {
      const kw = KEYWORDS[i];
      if (i > 0) await new Promise((r) => setTimeout(r, 8000)); // 8s between requests
      try {
        const s = await fetchKeyword(kw);
        series.push(s);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[trends] failed for ${kw}:`, msg.slice(0, 100));
        if (msg.includes("<html") || msg.includes("Unexpected token")) blocked = true;
      }
    }
    if (series.length === 0) {
      return Response.json({
        error: blocked
          ? "Google Trends bloqueó las requests (rate limit o bot detection). Se requiere DataForSEO API para acceso confiable."
          : "No se pudo obtener data de Google Trends",
        blocked,
        keywords_tried: KEYWORDS,
      }, { status: 503 });
    }
    const payload: Payload = {
      lastUpdated: new Date().toISOString(),
      geo: GEO,
      timeframe: "last_90d",
      series,
    };
    await writeCache(payload);
    return Response.json({ ...payload, cached: false });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown" },
      { status: 500 }
    );
  }
}
