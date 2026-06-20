"use client";
import { useEffect, useRef, useState } from "react";
import {
  LayoutDashboard, CalendarDays, Target, Trophy, TrendingUp, Lightbulb,
  RefreshCw, Menu, AlertTriangle, Ban, CheckCircle2, Award, Sparkles, Activity,
  PauseCircle, Clock, ChevronRight, ArrowUp, ArrowDown, Minus,
} from "lucide-react";

type MetaData = {
  lastUpdated: string;
  rangeDays: 30 | 60 | 90;
  period: { start: string; end: string };
  totals30d: {
    spend: number; impressions: number; reach_daily_sum: number;
    leads: number; clicks: number; ctr: number; cpl: number; cpm: number;
  };
  monthOverMonth: {
    current: { label: string; spend: number; impressions: number; leads: number; cpl: number };
    prior: { label: string; spend: number; impressions: number; leads: number; cpl: number };
    deltas: { spend: number; impressions: number; leads: number; cpl: number };
  };
  last7vsPrev7: {
    spend: { now: number; prev: number; pct: number };
    leads: { now: number; prev: number; pct: number };
    impressions: { now: number; prev: number; pct: number };
    cpl_now: number; cpl_prev: number;
  };
  campaignBreakdown30d: { name: string; spend: number; impressions: number; leads: number; cpl: number | null }[];
  daily: { date: string; spend: number; impressions: number; reach: number; clicks: number; link_clicks: number; leads: number }[];
  adsets: { campaign: string; name: string; spend: number; impressions: number; reach: number; frequency: number; clicks: number; link_clicks: number; leads: number; ctr: number; cpc: number; cpl: number | null }[];
  topAds: { name: string; adset: string; spend: number; impressions: number; clicks: number; link_clicks: number; leads: number; ctr: number; cpc: number; cpl: number | null }[];
  activeCampaigns: string[];
  campaignStatuses: CampaignStatus[];
  dailyLeadsByCampaign: { date: string; total: number; byCampaign: Record<string, number> }[];
  leadsToday: number;
  leadsYesterday: number;
  creativeRefresh: {
    recentAdsCount: number;
    newestAdDays: number;
    isTestingNew: boolean;
    readyForFeedback: boolean;
  };
  deepRecommendations?: DeepRecommendations;
};

type AdsetAudit = {
  campaign: string; name: string; cpl: number | null; leads: number; spend: number;
  dailyBudget: number; monthlyBudget: number;
  category: "winner" | "borderline" | "loser" | "learning"; effectiveStatus: string;
};
type BudgetAudit = {
  totalMonthlyBudget: number;
  winners: { count: number; monthlyBudget: number; adsets: AdsetAudit[] };
  borderline: { count: number; monthlyBudget: number; adsets: AdsetAudit[] };
  losers: { count: number; monthlyBudget: number; adsets: AdsetAudit[] };
  learning: { count: number; monthlyBudget: number; adsets: AdsetAudit[] };
  reassignableBudget: number;
};
type StructureRec = {
  name: string; currentStructure: "CBO" | "ABO" | "unknown";
  activeAdsetCount: number; totalConversions: number;
  recommendation: "switch_to_cbo" | "switch_to_abo" | "keep";
  reason: string; blockedReason?: string;
};
type AudienceSuggestion = {
  title: string; audience: string; campaign: string;
  monthlyBudget: number; daysToLearn: number; riskLevel: "low" | "medium" | "high"; rationale: string;
};
type CreativeVariantRec = {
  adset: string; campaign: string; currentAdCount: number; oldestAdDays: number;
  recommendedAdds: number; reason: string; blockedReason?: string;
};
type CalendarItem = { adset: string; campaign: string; daysRunning: number; nextEvalDate: string; action: string };
type DeepRecommendations = {
  budgetAudit: BudgetAudit;
  structureRec: { activeCampaigns: StructureRec[] };
  audienceTests: {
    freeBudget: number; maxTests: number; minBudgetPerTest: number;
    suggestions: AudienceSuggestion[]; note: string;
  };
  creativeVariants: CreativeVariantRec[];
  evaluationCalendar: CalendarItem[];
};

type CampaignStatus = {
  name: string;
  effective_status: string;
  started_at: string | null;
  days_old: number;
  is_running: boolean;
  is_paused: boolean;
  is_learning: boolean;
  label: "active" | "learning" | "paused" | "historical";
};


type GoogleData = {
  platform: "google";
  lastUpdated: string;
  rangeDays: 30 | 60 | 90;
  period: { start: string; end: string };
  totals30d: { spend: number; impressions: number; clicks: number; conversions: number; cpa: number; ctr: number; cpm: number };
  monthOverMonth: {
    current: { label: string; spend: number; impressions: number; conversions: number; cpa: number };
    prior: { label: string; spend: number; impressions: number; conversions: number; cpa: number };
    deltas: { spend: number; impressions: number; conversions: number; cpa: number };
  };
  last7vsPrev7: {
    spend: { now: number; prev: number; pct: number };
    conversions: { now: number; prev: number; pct: number };
    impressions: { now: number; prev: number; pct: number };
    cpa_now: number; cpa_prev: number;
  };
  campaignBreakdown: { name: string; status: string; spend: number; impressions: number; clicks: number; conversions: number; cpa: number | null; ctr: number }[];
  daily: { date: string; spend: number; impressions: number; clicks: number; conversions: number }[];
  campaignStatuses: { name: string; effective_status: string; label: "active" | "paused" | "historical" }[];
  activeCampaigns: string[];
};

type ChartConstructor = new (ctx: CanvasRenderingContext2D, cfg: unknown) => { destroy(): void };
type ChartLib = ChartConstructor & { getChart?: (canvas: HTMLCanvasElement) => { destroy(): void } | undefined };
declare global {
  interface Window { Chart?: ChartLib }
}

type Section = "resumen" | "leads" | "campanas" | "logros" | "tendencias" | "recomendaciones";

// COP currency formatting (no decimals — COP rarely needs them at these magnitudes)
const fmtCurr = (n: number) => "$" + Math.round(n).toLocaleString("es-CO");
const fmtCurrDec = (n: number) => "$" + Math.round(n).toLocaleString("es-CO");
const fmtNum = (n: number) => Math.round(n).toLocaleString("es-CO");
const fmtPct = (n: number) => (n * 100).toFixed(2) + "%";

const GOOGLE_SECTIONS: { id: Section; label: string; Icon: typeof LayoutDashboard }[] = [
  { id: "resumen",     label: "Resumen",   Icon: LayoutDashboard },
  { id: "campanas",    label: "Campañas",  Icon: Target },
  { id: "tendencias",  label: "Tendencias",Icon: TrendingUp },
];

const SECTIONS: { id: Section; label: string; Icon: typeof LayoutDashboard }[] = [
  { id: "resumen",         label: "Resumen",          Icon: LayoutDashboard },
  { id: "leads",           label: "Leads Diarios",    Icon: CalendarDays },
  { id: "campanas",        label: "Campañas",         Icon: Target },
  { id: "logros",          label: "Logros",           Icon: Trophy },
  { id: "tendencias",      label: "Tendencias",       Icon: TrendingUp },
  { id: "recomendaciones", label: "Recomendaciones",  Icon: Lightbulb },
];

function StatusBadge({ status }: { status: CampaignStatus | undefined }) {
  if (!status) return null;
  const config = {
    active:     { Icon: Activity,     bg: "bg-green-100", text: "text-green-800", label: "Activa" },
    learning:   { Icon: Sparkles,     bg: "bg-blue-100",  text: "text-blue-800",  label: `Nueva (${status.days_old}d)` },
    paused:     { Icon: PauseCircle,  bg: "bg-slate-200", text: "text-slate-700", label: "Pausada" },
    historical: { Icon: Clock,        bg: "bg-slate-100", text: "text-slate-500", label: "Histórica" },
  }[status.label];
  const Icon = config.Icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${config.bg} ${config.text}`}>
      <Icon size={11} />
      {config.label}
    </span>
  );
}

export default function Dashboard() {
  const [unlocked, setUnlocked] = useState(false);
  const [pw, setPw] = useState("");
  const [pwErr, setPwErr] = useState("");
  const [meta, setMeta] = useState<MetaData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const [showRefreshedToast, setShowRefreshedToast] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rangeDays, setRangeDays] = useState<30 | 60 | 90>(30);
  const [activeSection, setActiveSection] = useState<Section>("resumen");
  const [platform, setPlatform] = useState<"meta" | "google">("meta");
  const [googleData, setGoogleData] = useState<GoogleData | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [changes, setChanges] = useState<{ icon: string; text: string }[]>([]);
  const [lastVisitText, setLastVisitText] = useState<string>("");

  useEffect(() => {
    if (typeof window !== "undefined" && sessionStorage.getItem("cb_dash_unlocked") === "1") {
      setUnlocked(true);
    }
  }, []);

  useEffect(() => {
    if (!unlocked) return;
    loadAll(false, rangeDays);
  }, [unlocked, rangeDays]);

  // Lazy-load Google data the first time the user switches to that platform
  useEffect(() => {
    if (!unlocked || platform !== "google" || googleData) return;
    fetch(`/api/google-data?days=${rangeDays}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((g) => { if (!g.error) setGoogleData(g); })
      .catch(() => {});
  }, [unlocked, platform, rangeDays, googleData]);

  async function loadAll(isRefresh = false, range: 30 | 60 | 90 = rangeDays) {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    const bust = `t=${Date.now()}`;
    try {
      const m = await fetch(`/api/meta-data?days=${range}&${bust}`, { cache: "no-store" }).then((r) => r.json());
      if (m.error) throw new Error(m.error);

      // Compute diff vs previous snapshot
      const snapRaw = localStorage.getItem("cb_dash_snapshot");
      if (snapRaw) {
        try {
          const prev = JSON.parse(snapRaw);
          const diffs = computeDiff(prev, m);
          setChanges(diffs);
          if (prev.savedAt) {
            const mins = Math.round((Date.now() - new Date(prev.savedAt).getTime()) / 60000);
            setLastVisitText(mins < 60 ? `hace ${mins} min` : mins < 1440 ? `hace ${Math.round(mins/60)}h` : `hace ${Math.round(mins/1440)}d`);
          }
        } catch {}
      }

      setMeta(m);
      setRefreshedAt(new Date());
      // Save new snapshot for next comparison
      localStorage.setItem("cb_dash_snapshot", JSON.stringify({
        savedAt: new Date().toISOString(),
        campaignStatuses: m.campaignStatuses,
        adsets: m.adsets.map((a: { name: string; spend: number; leads: number; cpl: number | null }) =>
          ({ name: a.name, spend: a.spend, leads: a.leads, cpl: a.cpl })),
        cpl: m.totals30d.cpl,
        leads: m.totals30d.leads,
        leadsToday: m.leadsToday,
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando datos de Meta");
      setLoading(false);
      setRefreshing(false);
      return;
    }
    setLoading(false);
    setRefreshing(false);
    if (isRefresh) {
      setShowRefreshedToast(true);
      setTimeout(() => setShowRefreshedToast(false), 3500);
    }
  }

  function tryUnlock() {
    if (pw === (process.env.NEXT_PUBLIC_DASHBOARD_PASSWORD || "closets2026")) {
      sessionStorage.setItem("cb_dash_unlocked", "1");
      setUnlocked(true);
    } else {
      setPwErr("Contraseña incorrecta");
    }
  }

  if (!unlocked) {
    return (
      <div className="fixed inset-0 bg-[#0C1015] flex items-center justify-center p-6 z-50">
        <div className="bg-white rounded-xl p-12 max-w-md w-full text-center shadow-2xl">
          <div className="text-xs uppercase tracking-widest text-[#ff6900] font-semibold mb-3">Closets &amp; Blinds FL</div>
          <h2 className="font-serif text-2xl text-[#0C1015] font-normal mb-2">Acceso al Dashboard</h2>
          <p className="text-slate-600 text-sm mb-6">Ingrese la contraseña para ver el reporte</p>
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && tryUnlock()} placeholder="Contraseña"
            className="w-full p-4 border border-slate-200 rounded-lg text-base text-center mb-4 outline-none focus:border-[#ff6900]" autoFocus />
          <button onClick={tryUnlock} className="w-full p-4 bg-[#0C1015] text-white rounded-lg font-semibold text-sm uppercase tracking-widest hover:bg-[#ff6900] transition">Entrar</button>
          <div className="text-red-600 text-sm mt-3 min-h-[18px]">{pwErr}</div>
        </div>
      </div>
    );
  }

  if (loading) return <div className="p-20 text-center text-slate-500">Cargando datos en vivo de Meta Ads...</div>;
  if (error) return <div className="p-20 text-center"><div className="text-red-600 font-semibold">Error: {error}</div><button onClick={() => loadAll(true)} className="mt-4 px-4 py-2 bg-[#0C1015] text-white rounded">Reintentar</button></div>;
  if (!meta) return null;

  const t = meta.totals30d;
  const cmp = meta.last7vsPrev7;
  const cplChange = cmp.cpl_prev ? ((cmp.cpl_now - cmp.cpl_prev) / cmp.cpl_prev) * 100 : 0;
  const cr = meta.creativeRefresh;
  // Suppress fatigue warning if creatives were refreshed in last 7 days (still gathering data)
  const isCrisis = (cplChange > 50 || cmp.leads.pct < -40) && !cr?.isTestingNew;
  const isTestingPhase = !!cr?.isTestingNew;

  return (
    <div className="min-h-screen bg-slate-50 font-sans flex">
      {/* Toast */}
      {showRefreshedToast && (
        <div className="fixed top-6 right-6 z-50 bg-green-600 text-white px-5 py-3 rounded-lg shadow-lg text-sm font-semibold">
          ✓ Datos actualizados
        </div>
      )}
      {refreshing && (
        <div className="fixed top-0 left-0 right-0 z-40 bg-[#ff6900] text-white text-center text-xs py-1.5 font-semibold tracking-wider uppercase">
          Actualizando datos en vivo...
        </div>
      )}

      {/* SIDEBAR */}
      <aside className={`bg-[#0C1015] text-white w-64 flex-shrink-0 sticky top-0 h-screen overflow-y-auto p-5 flex flex-col z-30 max-lg:fixed max-lg:transition-transform ${mobileMenuOpen ? "max-lg:translate-x-0" : "max-lg:-translate-x-full"}`}>
        <div className="mb-5">
          <div className="text-[10px] uppercase tracking-widest text-[#ff6900] font-semibold mb-1">A-mudar</div>
          <h1 className="font-serif text-xl text-white leading-tight">Ads Dashboard</h1>
        </div>

        {/* Platform toggle */}
        <div className="mb-5 grid grid-cols-2 gap-1 bg-white/5 p-1 rounded-md border border-white/10">
          {(["meta", "google"] as const).map((p) => (
            <button key={p} onClick={() => setPlatform(p)}
              className={`px-2 py-1.5 rounded text-[11px] font-semibold uppercase tracking-wider transition ${platform === p ? "bg-[#ff6900] text-white" : "text-slate-300 hover:bg-white/5"}`}>
              {p === "meta" ? "Meta" : "Google"}
            </button>
          ))}
        </div>

        <nav className="flex-1 space-y-1">
          {(platform === "meta" ? SECTIONS : GOOGLE_SECTIONS).map((s) => {
            const Icon = s.Icon;
            const isActiveSection = activeSection === s.id;
            return (
              <button key={s.id} onClick={() => { setActiveSection(s.id); setMobileMenuOpen(false); }}
                className={`w-full text-left px-3 py-2.5 rounded-md text-sm font-medium transition flex items-center gap-3 ${isActiveSection ? "bg-[#ff6900] text-white" : "text-slate-300 hover:bg-white/5 hover:text-white"}`}>
                <Icon size={18} strokeWidth={isActiveSection ? 2.25 : 1.75} />
                <span>{s.label}</span>
                {platform === "meta" && s.id === "recomendaciones" && isCrisis && <span className="ml-auto w-2 h-2 bg-amber-400 rounded-full animate-pulse"></span>}
              </button>
            );
          })}
        </nav>
        <div className="pt-5 mt-5 border-t border-white/10 text-[11px] text-slate-400 leading-relaxed">
          <div className="mb-2">Última actualización:<br /><span className="text-white">{(refreshedAt || new Date(meta.lastUpdated)).toLocaleString("es-CO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span></div>
          <button onClick={() => loadAll(true)} disabled={refreshing}
            className="w-full mt-2 px-3 py-2 bg-[#ff6900] text-white rounded font-semibold text-[11px] uppercase tracking-widest hover:bg-[#cc5400] transition disabled:opacity-60 inline-flex items-center justify-center gap-2">
            <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
            {refreshing ? "Actualizando..." : "Refresh"}
          </button>
        </div>
      </aside>

      {/* MAIN */}
      <main className="flex-1 min-w-0 p-8 max-md:p-5 pb-16 max-w-[1200px]">
        {/* Mobile menu toggle */}
        <button onClick={() => setMobileMenuOpen(true)} className="lg:hidden mb-4 px-3 py-2 bg-[#0C1015] text-white rounded text-sm font-semibold inline-flex items-center gap-2">
          <Menu size={16} /> Menú
        </button>

        {/* Top bar: range selector */}
        <div className="flex justify-between items-center mb-6 flex-wrap gap-3">
          <div>
            <h2 className="font-serif text-2xl text-[#0C1015]">{SECTIONS.find(s => s.id === activeSection)?.label}</h2>
            <p className="text-xs text-slate-500 uppercase tracking-widest mt-0.5">Rango: últimos {rangeDays} días</p>
          </div>
          <div className="inline-flex border border-slate-300 rounded-md overflow-hidden">
            {[30, 60, 90].map((d) => (
              <button key={d} onClick={() => setRangeDays(d as 30 | 60 | 90)}
                className={`px-3 py-2 text-xs font-semibold uppercase tracking-widest transition ${rangeDays === d ? "bg-[#0C1015] text-white" : "bg-white text-slate-700 hover:bg-slate-100"}`}>
                {d}d
              </button>
            ))}
          </div>
        </div>

        {/* Testing new creatives banner — when ads were refreshed in last 7 days */}
        {isTestingPhase && activeSection !== "recomendaciones" && (
          <div className="bg-blue-50 border border-blue-200 border-l-4 border-l-blue-500 rounded-lg p-4 mb-6 text-sm flex items-start gap-3">
            <Sparkles size={20} className="text-blue-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <strong className="text-blue-800">Probando nueva creatividad:</strong> lanzamos {cr.recentAdsCount} ad{cr.recentAdsCount === 1 ? '' : 's'} nuevo{cr.recentAdsCount === 1 ? '' : 's'} hace {cr.newestAdDays} día{cr.newestAdDays === 1 ? '' : 's'}. Meta está en fase de aprendizaje — los datos definitivos llegarán entre los días 7-14. Hasta entonces, mantener el setup actual.
            </div>
          </div>
        )}

        {/* Warning banner — informativo, no alarmista (oculto durante testing phase) */}
        {isCrisis && activeSection !== "recomendaciones" && (
          <div className="bg-amber-50 border border-amber-200 border-l-4 border-l-amber-500 rounded-lg p-4 mb-6 text-sm flex items-start gap-3">
            <AlertTriangle size={20} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <strong className="text-amber-800">Aviso:</strong> esta semana el CPL ha subido <strong>{cplChange.toFixed(0)}%</strong>, consistente con fatiga creativa después de varias semanas con los mismos anuncios. Es parte normal del ciclo — recomendamos refrescar creatividad.
              <button onClick={() => setActiveSection("recomendaciones")} className="text-amber-800 font-semibold underline ml-2 inline-flex items-center gap-1">
                Ver acciones recomendadas <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}

        {/* Changes since last refresh */}
        {changes.length > 0 && (
          <div className="bg-blue-50 border border-blue-200 border-l-4 border-l-blue-500 rounded-lg p-4 mb-6 text-sm">
            <div className="flex items-start gap-3">
              <RefreshCw size={20} className="text-blue-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <strong className="text-blue-800">Cambios desde su última visita {lastVisitText && `(${lastVisitText})`}:</strong>
                <ul className="mt-2 space-y-1">
                  {changes.map((c, i) => (
                    <li key={i} className="flex items-start gap-2 text-slate-700">
                      <span className="text-blue-600 mt-0.5">{c.icon}</span>
                      <span>{c.text}</span>
                    </li>
                  ))}
                </ul>
                <button onClick={() => setChanges([])} className="text-blue-700 text-xs underline mt-2">Descartar</button>
              </div>
            </div>
          </div>
        )}

        {/* ===== SECTIONS ===== */}
        {platform === "meta" && (
          <>
            {activeSection === "resumen" && <SectionResumen meta={meta} cmp={cmp} cplChange={cplChange} isCrisis={isCrisis} />}
            {activeSection === "leads" && <SectionLeads meta={meta} />}
            {activeSection === "campanas" && <SectionCampanas meta={meta} />}
            {activeSection === "logros" && <SectionLogros meta={meta} />}
            {activeSection === "tendencias" && <SectionTendencias meta={meta} t={t} cmp={cmp} cplChange={cplChange} />}
            {activeSection === "recomendaciones" && <SectionRecomendaciones meta={meta} isCrisis={isCrisis} cplChange={cplChange} cmp={cmp} />}
          </>
        )}
        {platform === "google" && (
          !googleData ? (
            <div className="p-20 text-center text-slate-500">Cargando datos en vivo de Google Ads...</div>
          ) : (
            <GoogleView data={googleData} activeSection={activeSection} />
          )
        )}

        {/* Footer */}
        <div className="bg-slate-100 border border-slate-200 rounded-lg p-4 mt-8 text-xs text-slate-600 leading-relaxed">
          {platform === "meta" ? (
            <>
              <strong className="text-[#0C1015]">Fuente:</strong> Meta Ads (Windsor.ai REST API, cuenta {process.env.NEXT_PUBLIC_META_ACCOUNT_ID || "2237520487071255"}) · Métrica de leads: <code className="bg-white px-1 rounded">actions_lead</code> (formulario completado en Facebook). <strong>NO equivale a leads atendidos por el equipo.</strong>
            </>
          ) : (
            <>
              <strong className="text-[#0C1015]">Fuente:</strong> Google Ads (Windsor.ai REST API, cuenta 464-415-2268) · Métrica de conversiones: nativa de Google Ads (form submit / call / etc., depende de cómo esté configurado el goal).
            </>
          )}
        </div>
      </main>
    </div>
  );
}

/* ============================== SECTIONS ============================== */

function SectionResumen({ meta, cmp, cplChange, isCrisis }: { meta: MetaData; cmp: MetaData["last7vsPrev7"]; cplChange: number; isCrisis: boolean }) {
  const t = meta.totals30d;
  return (
    <div className="space-y-6">
      {/* Hero KPIs — los 3 que más le importan a Diego */}
      <div className="grid grid-cols-3 max-md:grid-cols-1 gap-4">
        <HeroKPI label={`Costo por Lead · promedio ${meta.rangeDays}d`} value={fmtCurrDec(t.cpl)}
          sub={`Últimos 7 días: ${fmtCurrDec(cmp.cpl_now)} (vs ${fmtCurrDec(cmp.cpl_prev)} previos · ${cplChange > 0 ? "+" : ""}${cplChange.toFixed(0)}%)`}
          accent={isCrisis ? "red" : "gold"} />
        <HeroKPI label={`Inversión ${meta.rangeDays}d`} value={fmtCurr(t.spend)}
          sub={`promedio $${Math.round(t.spend / meta.rangeDays)}/día`} accent="dark" />
        <HeroKPI label="Formularios Meta" value={fmtNum(t.leads)} delta={cmp.leads.pct}
          sub={`${meta.leadsToday} hoy · ${meta.leadsYesterday} ayer`} accent="dark" />
      </div>

      {/* TL;DR */}
      <div className={`bg-white border border-slate-200 ${isCrisis ? 'border-l-4 border-l-amber-500' : 'border-l-4 border-l-[#ff6900]'} rounded-lg p-6`}>
        <h3 className="font-serif text-lg text-[#0C1015] uppercase tracking-widest mb-3">Resumen ejecutivo</h3>
        <p className="mb-2 text-slate-900">En los últimos <strong>{meta.rangeDays} días</strong> invertimos <strong>{fmtCurr(t.spend)}</strong> y Meta registró <strong>{t.leads} formularios</strong> a costo de <strong>{fmtCurrDec(t.cpl)}</strong> por formulario.</p>
        <p className="mb-2 text-slate-900">Distribución sana — <strong>{fmtNum(t.impressions)}</strong> impresiones con CTR de <strong>{fmtPct(t.ctr)}</strong> (sobre benchmark del sector). El alcance y targeting están funcionando bien.</p>
        {isCrisis ? (
          <p className="bg-amber-50 border border-amber-200 p-3 rounded text-sm text-slate-700"><strong className="text-amber-800">Últimos 7 días:</strong> {cmp.leads.now} formularios (vs {cmp.leads.prev} previos) · CPL pasó de {fmtCurrDec(cmp.cpl_prev)} a {fmtCurrDec(cmp.cpl_now)}. Estamos refrescando creativos para revertir esta tendencia.</p>
        ) : (
          <p className="text-slate-900 text-sm">Últimos 7 días: <strong>{cmp.leads.now}</strong> formularios · CPL {fmtCurrDec(cmp.cpl_now)}.</p>
        )}
      </div>

      {/* Mini-cards: top campaña + ad set + creativo */}
      <div className="grid grid-cols-3 max-md:grid-cols-1 gap-4">
        <MiniWin title="Mejor campaña" Icon={Award} data={meta.campaignBreakdown30d.filter(c => c.cpl).sort((a,b) => (a.cpl ?? 9e9) - (b.cpl ?? 9e9))[0]} />
        <MiniWin title="Mejor ad set" Icon={Target} data={meta.adsets.filter(a => a.cpl).sort((a,b) => (a.cpl ?? 9e9) - (b.cpl ?? 9e9))[0]} />
        <MiniWin title="Mejor creativo" Icon={Trophy} data={meta.topAds.filter(a => a.cpl).sort((a,b) => (a.cpl ?? 9e9) - (b.cpl ?? 9e9))[0]} />
      </div>
    </div>
  );
}

function SectionLeads({ meta }: { meta: MetaData }) {
  const weekTotal = meta.dailyLeadsByCampaign.slice(0, 7).reduce((s, d) => s + d.total, 0);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-4 max-md:grid-cols-2 gap-4">
        <HeroKPI label="Hoy" value={String(meta.leadsToday)} sub="formularios" accent="gold" />
        <HeroKPI label="Ayer" value={String(meta.leadsYesterday)} sub="formularios" accent="dark" />
        <HeroKPI label="Esta semana" value={String(weekTotal)} sub="últimos 7 días" accent="dark" />
        <HeroKPI label="Campañas activas" value={String(meta.activeCampaigns.length)} sub="corriendo ahora" accent="dark" />
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-6 overflow-x-auto">
        <h3 className="font-serif text-lg mb-1">Leads diarios por campaña</h3>
        <p className="text-xs text-slate-500 mb-4">Últimos 14 días · solo campañas actualmente activas</p>
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="text-left p-2.5 bg-slate-100 text-slate-600 text-xs uppercase tracking-wider font-semibold">Fecha</th>
              {meta.activeCampaigns.map((c) => (
                <th key={c} className="text-center p-2.5 bg-slate-100 text-slate-600 text-xs uppercase tracking-wider font-semibold">{shortName(c)}</th>
              ))}
              <th className="text-right p-2.5 bg-slate-100 text-slate-600 text-xs uppercase tracking-wider font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {meta.dailyLeadsByCampaign.slice(0, 14).map((row, i) => {
              const isToday = row.date === new Date().toISOString().slice(0, 10);
              const isYesterday = row.date === new Date(Date.now() - 86400000).toISOString().slice(0, 10);
              const label = isToday ? "HOY" : isYesterday ? "Ayer" : new Date(row.date).toLocaleDateString("es-CO", { weekday: "short", day: "2-digit", month: "short" });
              return (
                <tr key={i} className={`border-b border-slate-100 hover:bg-slate-50 ${isToday ? "bg-amber-50" : ""}`}>
                  <td className={`p-2.5 font-semibold ${isToday ? "text-[#ff6900]" : ""}`}>{label}</td>
                  {meta.activeCampaigns.map((c) => (
                    <td key={c} className="p-2.5 text-center tabular-nums">{row.byCampaign[c] || <span className="text-slate-300">—</span>}</td>
                  ))}
                  <td className="p-2.5 text-right tabular-nums font-bold">{row.total}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SectionCampanas({ meta }: { meta: MetaData }) {
  const statusByName = new Map(meta.campaignStatuses.map(s => [s.name, s]));
  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-lg p-6 overflow-x-auto">
        <h3 className="font-serif text-lg mb-4">Desglose por Campaña · últimos {meta.rangeDays} días</h3>
        <table className="w-full text-sm">
          <thead>
            <tr>
              {["Campaña", "Estado", "Inversión", "Formularios", "CPL"].map((h, i) => (
                <th key={i} className={`p-3 bg-slate-100 text-slate-600 text-xs uppercase tracking-wider font-semibold ${i === 0 ? "text-left" : "text-right"}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {meta.campaignBreakdown30d.map((c, i) => {
              const dot = c.cpl && c.cpl < 50 ? "bg-green-600" : c.cpl && c.cpl < 100 ? "bg-amber-600" : "bg-red-600";
              return (
                <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="p-3 font-semibold"><span className={`inline-block w-2 h-2 rounded-full ${dot} mr-2`}></span>{c.name}</td>
                  <td className="p-3"><StatusBadge status={statusByName.get(c.name)} /></td>
                  <td className="p-3 text-right tabular-nums">{fmtCurr(c.spend)}</td>
                  <td className="p-3 text-right tabular-nums"><strong>{fmtNum(c.leads)}</strong></td>
                  <td className="p-3 text-right tabular-nums"><strong>{c.cpl ? fmtCurrDec(c.cpl) : "—"}</strong></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-6 overflow-x-auto">
        <h3 className="font-serif text-lg mb-4">Performance por Ad Set</h3>
        <table className="w-full text-sm">
          <thead>
            <tr>
              {["Ad Set", "Inversión", "Reach", "Freq", "CTR", "CPC", "Leads", "CPL"].map((h, i) => (
                <th key={i} className={`p-3 bg-slate-100 text-slate-600 text-xs uppercase tracking-wider font-semibold ${i === 0 ? "text-left" : "text-right"}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...meta.adsets].sort((a, b) => (b.leads || 0) - (a.leads || 0)).map((a, i) => {
              const status = a.cpl && a.cpl < 40 ? "bg-green-600" : a.cpl && a.cpl < 80 ? "bg-amber-600" : "bg-red-600";
              return (
                <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="p-3 font-semibold"><span className={`inline-block w-2 h-2 rounded-full ${status} mr-2`}></span>{a.name}</td>
                  <td className="p-3 text-right tabular-nums">{fmtCurr(a.spend)}</td>
                  <td className="p-3 text-right tabular-nums">{fmtNum(a.reach)}</td>
                  <td className="p-3 text-right tabular-nums">{a.frequency.toFixed(2)}</td>
                  <td className="p-3 text-right tabular-nums">{fmtPct(a.ctr)}</td>
                  <td className="p-3 text-right tabular-nums">{fmtCurrDec(a.cpc)}</td>
                  <td className="p-3 text-right tabular-nums">{a.leads || 0}</td>
                  <td className="p-3 text-right tabular-nums"><strong>{a.cpl ? fmtCurrDec(a.cpl) : "—"}</strong></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-6 overflow-x-auto">
        <h3 className="font-serif text-lg mb-4">Top Creativos</h3>
        <table className="w-full text-sm">
          <thead>
            <tr>
              {["Anuncio", "Ad Set", "Inversión", "CTR", "Leads", "CPL", "Status"].map((h, i) => (
                <th key={i} className={`p-3 bg-slate-100 text-slate-600 text-xs uppercase tracking-wider font-semibold ${i === 0 || i === 1 || i === 6 ? "text-left" : "text-right"}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...meta.topAds].sort((a, b) => (b.leads || 0) - (a.leads || 0)).map((a, i) => {
              const status = a.cpl && a.cpl < 30 ? "bg-green-600" : a.cpl && a.cpl < 60 ? "bg-amber-600" : "bg-red-600";
              const badge = a.leads >= 30 ? <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-800 text-xs font-semibold uppercase tracking-wider">Winner</span>
                : !a.leads || (a.cpl && a.cpl > 100) ? <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-800 text-xs font-semibold uppercase tracking-wider">Loser</span>
                : <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs font-semibold uppercase tracking-wider">OK</span>;
              return (
                <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="p-3 font-semibold"><span className={`inline-block w-2 h-2 rounded-full ${status} mr-2`}></span>{a.name}</td>
                  <td className="p-3 text-slate-600 text-xs">{a.adset}</td>
                  <td className="p-3 text-right tabular-nums">{fmtCurr(a.spend)}</td>
                  <td className="p-3 text-right tabular-nums">{fmtPct(a.ctr)}</td>
                  <td className="p-3 text-right tabular-nums"><strong>{a.leads || 0}</strong></td>
                  <td className="p-3 text-right tabular-nums"><strong>{a.cpl ? fmtCurrDec(a.cpl) : "—"}</strong></td>
                  <td className="p-3">{badge}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SectionLogros({ meta }: { meta: MetaData }) {
  const bestAd = [...meta.topAds].filter(a => (a.leads ?? 0) > 0).sort((a, b) => (b.leads || 0) - (a.leads || 0))[0];
  const bestAdset = [...meta.adsets].filter(a => (a.leads ?? 0) > 0 && a.cpl).sort((a, b) => (a.cpl ?? 9999) - (b.cpl ?? 9999))[0];
  const reachGrowth = meta.monthOverMonth.deltas.impressions;
  const cplDelta = meta.monthOverMonth.deltas.cpl;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 max-md:grid-cols-1 gap-4">
        {bestAd && (
          <div className="bg-white border border-slate-200 border-l-4 border-l-green-600 rounded-lg p-6">
            <div className="text-xs text-slate-600 uppercase tracking-widest font-semibold mb-2 flex items-center gap-1.5"><Trophy size={14} className="text-green-600" /> Mejor creativo del período</div>
            <div className="font-serif text-2xl text-[#0C1015] mb-1">{bestAd.name}</div>
            <div className="text-sm text-slate-600 mb-3">en {bestAd.adset}</div>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div><div className="text-xs text-slate-500">Leads</div><div className="font-bold text-lg">{bestAd.leads}</div></div>
              <div><div className="text-xs text-slate-500">CPL</div><div className="font-bold text-lg">{bestAd.cpl ? fmtCurrDec(bestAd.cpl) : "—"}</div></div>
              <div><div className="text-xs text-slate-500">CTR</div><div className="font-bold text-lg">{fmtPct(bestAd.ctr)}</div></div>
            </div>
          </div>
        )}
        {bestAdset && (
          <div className="bg-white border border-slate-200 border-l-4 border-l-green-600 rounded-lg p-6">
            <div className="text-xs text-slate-600 uppercase tracking-widest font-semibold mb-2 flex items-center gap-1.5"><Target size={14} className="text-green-600" /> Ad set más eficiente</div>
            <div className="font-serif text-2xl text-[#0C1015] mb-1">{bestAdset.name}</div>
            <div className="text-sm text-slate-600 mb-3">campaña: {shortName(bestAdset.campaign)}</div>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div><div className="text-xs text-slate-500">Leads</div><div className="font-bold text-lg">{bestAdset.leads}</div></div>
              <div><div className="text-xs text-slate-500">CPL</div><div className="font-bold text-lg">{fmtCurrDec(bestAdset.cpl!)}</div></div>
              <div><div className="text-xs text-slate-500">Reach</div><div className="font-bold text-lg">{fmtNum(bestAdset.reach)}</div></div>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 max-md:grid-cols-1 gap-4">
        <div className={`bg-white border border-slate-200 border-l-4 ${reachGrowth > 0 ? "border-l-green-600" : "border-l-amber-600"} rounded-lg p-6`}>
          <div className="text-xs text-slate-600 uppercase tracking-widest font-semibold mb-2 flex items-center gap-1.5"><TrendingUp size={14} className="text-slate-500" /> Crecimiento de alcance</div>
          <div className="font-serif text-4xl text-[#0C1015] mb-2">{reachGrowth > 0 ? "+" : ""}{reachGrowth.toFixed(0)}%</div>
          <div className="text-sm text-slate-600">{fmtNum(meta.monthOverMonth.current.impressions)} impresiones vs {fmtNum(meta.monthOverMonth.prior.impressions)} en el período anterior</div>
        </div>
        <div className={`bg-white border border-slate-200 border-l-4 ${cplDelta < 0 ? "border-l-green-600" : "border-l-amber-600"} rounded-lg p-6`}>
          <div className="text-xs text-slate-600 uppercase tracking-widest font-semibold mb-2 flex items-center gap-1.5"><Award size={14} className="text-slate-500" /> {cplDelta < 0 ? "Mejora en CPL" : "CPL del período"}</div>
          <div className="font-serif text-4xl text-[#0C1015] mb-2">{cplDelta > 0 ? "+" : ""}{cplDelta.toFixed(0)}%</div>
          <div className="text-sm text-slate-600">{fmtCurrDec(meta.monthOverMonth.prior.cpl)} → {fmtCurrDec(meta.monthOverMonth.current.cpl)}</div>
        </div>
      </div>
    </div>
  );
}

function SectionTendencias({ meta, t, cmp, cplChange }: { meta: MetaData; t: MetaData["totals30d"]; cmp: MetaData["last7vsPrev7"]; cplChange: number }) {
  const trendRef = useRef<HTMLCanvasElement>(null);
  const reachRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!trendRef.current || !reachRef.current) return;
    const ChartLib = window.Chart;
    if (!ChartLib) {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js";
      s.onload = () => render();
      document.head.appendChild(s);
    } else render();

    function render() {
      const C = window.Chart!;
      const oldT = C.getChart?.(trendRef.current!); if (oldT) oldT.destroy();
      const oldR = C.getChart?.(reachRef.current!); if (oldR) oldR.destroy();
      new C(trendRef.current!.getContext("2d")!, {
        type: "line",
        data: { labels: meta.daily.map(x => x.date.slice(5)), datasets: [
          { label: "Inversión", data: meta.daily.map(x => x.spend), borderColor: "#0C1015", backgroundColor: "rgba(12,16,21,0.05)", fill: true, tension: 0.32, yAxisID: "y", pointRadius: 0, borderWidth: 2 },
          { label: "Leads", data: meta.daily.map(x => x.leads), borderColor: "#ff6900", fill: false, tension: 0.32, yAxisID: "y1", pointRadius: 3, borderWidth: 2 },
        ]},
        options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
          plugins: { legend: { display: false }, tooltip: { backgroundColor: "#0C1015" } },
          scales: {
            x: { grid: { display: false }, ticks: { color: "#475569", font: { size: 11 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } },
            y: { position: "left", grid: { color: "#F1F5F9" }, ticks: { color: "#0C1015", callback: (v: number | string) => "$" + v } },
            y1: { position: "right", grid: { display: false }, ticks: { color: "#ff6900", stepSize: 2 }, min: 0 },
          } } });
      new C(reachRef.current!.getContext("2d")!, {
        type: "bar",
        data: { labels: meta.daily.map(x => x.date.slice(5)), datasets: [{ label: "Reach", data: meta.daily.map(x => x.reach), backgroundColor: "#ff6900", borderRadius: 4, maxBarThickness: 18 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { backgroundColor: "#0C1015", callbacks: { label: (c: { parsed: { y: number } }) => fmtNum(c.parsed.y) + " cuentas alcanzadas" } } },
          scales: { x: { grid: { display: false }, ticks: { color: "#475569", maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } }, y: { grid: { color: "#F1F5F9" }, ticks: { color: "#475569", callback: (v: number | string) => fmtNum(Number(v)) } } } } });
    }
  }, [meta]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-5 max-md:grid-cols-2 gap-3">
        <KPI label="Inversión" value={fmtCurr(t.spend)} sub={`últimos ${meta.rangeDays}d`} />
        <KPI label="Impresiones" value={fmtNum(t.impressions)} delta={cmp.impressions.pct} />
        <KPI label="Formularios" value={fmtNum(t.leads)} delta={cmp.leads.pct} />
        <KPI label="CPL" value={fmtCurrDec(t.cpl)} delta={cplChange} lowerBetter />
        <KPI label="CTR" value={fmtPct(t.ctr)} sub={fmtNum(t.clicks) + " clicks"} />
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-6">
        <h3 className="font-serif text-lg mb-4">Inversión + Leads por día</h3>
        <div className="relative h-72"><canvas ref={trendRef}></canvas></div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-6">
        <h3 className="font-serif text-lg mb-4">Alcance diario (cuentas únicas)</h3>
        <div className="relative h-64"><canvas ref={reachRef}></canvas></div>
      </div>

      <h3 className="font-serif text-lg uppercase tracking-widest text-[#0C1015] mt-8">Comparativa Período vs Período</h3>
      <div className="grid grid-cols-4 max-md:grid-cols-2 gap-3">
        {[
          { lbl: "Inversión", cur: fmtCurr(meta.monthOverMonth.current.spend), prev: fmtCurr(meta.monthOverMonth.prior.spend), delta: meta.monthOverMonth.deltas.spend, lowerBetter: false, neutral: true },
          { lbl: "Impresiones", cur: fmtNum(meta.monthOverMonth.current.impressions), prev: fmtNum(meta.monthOverMonth.prior.impressions), delta: meta.monthOverMonth.deltas.impressions, lowerBetter: false },
          { lbl: "Formularios", cur: fmtNum(meta.monthOverMonth.current.leads), prev: fmtNum(meta.monthOverMonth.prior.leads), delta: meta.monthOverMonth.deltas.leads, lowerBetter: false },
          { lbl: "CPL", cur: fmtCurrDec(meta.monthOverMonth.current.cpl), prev: fmtCurrDec(meta.monthOverMonth.prior.cpl), delta: meta.monthOverMonth.deltas.cpl, lowerBetter: true },
        ].map((m, i) => {
          const cls = m.neutral ? "text-slate-400" : m.delta > 0 ? (m.lowerBetter ? "text-red-600" : "text-green-600") : m.delta < 0 ? (m.lowerBetter ? "text-green-600" : "text-red-600") : "text-slate-400";
          const arrow = m.delta > 0 ? "▲" : m.delta < 0 ? "▼" : "■";
          return (
            <div key={i} className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="text-xs text-slate-600 uppercase tracking-widest font-semibold mb-2">{m.lbl}</div>
              <div className="flex justify-between text-xs text-slate-400"><span>Prev</span><span className="font-serif text-base text-[#0C1015]">{m.prev}</span></div>
              <div className="flex justify-between text-xs text-slate-400 mt-1"><span>Actual</span><span className="font-serif text-base text-[#0C1015]">{m.cur}</span></div>
              <div className={`mt-2 pt-2 border-t border-slate-100 text-sm font-semibold ${cls}`}>{arrow} {Math.abs(m.delta).toFixed(1)}%</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SectionRecomendaciones({ meta, isCrisis, cplChange, cmp }: { meta: MetaData; isCrisis: boolean; cplChange: number; cmp: MetaData["last7vsPrev7"] }) {
  const statusByName = new Map(meta.campaignStatuses.map(s => [s.name, s]));
  const sortedAdsets = [...meta.adsets].sort((a, b) => (b.leads || 0) - (a.leads || 0));
  const topAd = [...meta.topAds].filter(a => (a.leads ?? 0) > 0).sort((a, b) => (a.cpl ?? 9e9) - (b.cpl ?? 9e9))[0];

  // Build creative recommendations dynamically based on data
  type Reco = { priority: "high" | "med" | "low"; title: string; rationale: string; action: string; impact?: string };
  const recos: Reco[] = [];
  if (topAd) {
    recos.push({
      priority: "high",
      title: `Producir 2 variantes nuevas en el estilo de "${topAd.name}"`,
      rationale: `Es el creativo con mejor performance: ${topAd.leads} leads a ${topAd.cpl ? fmtCurr(topAd.cpl) : "—"} CPL vs ${fmtCurr(meta.totals30d.cpl)} promedio de la cuenta. Sumar variantes ahora — antes que se fatigue — sostiene este rendimiento.`,
      action: "Brief al equipo creativo: 2 variantes nuevas con el mismo hook, mensaje y formato. Agregar SIN pausar el original (preserva el learning de Meta).",
      impact: "Refrescar el formato ganador antes de la fatiga mantiene el CPL cerca del top performer en lugar de derivar hacia el promedio.",
    });
  }
  // Generic high-CPL warning (data-driven, vertical-agnostic)
  const fatiguedAdset = sortedAdsets.find(a => a.cpl && a.cpl > meta.totals30d.cpl * 2 && a.leads >= 1);
  if (fatiguedAdset) {
    recos.push({
      priority: "high",
      title: `Refrescar creativo en "${fatiguedAdset.name}"`,
      rationale: `Este ad set tiene CPL de ${fmtCurr(fatiguedAdset.cpl!)} — más del doble del promedio de la cuenta (${fmtCurr(meta.totals30d.cpl)}). La audiencia está fatigada o el creativo necesita renovación.`,
      action: "Producir 2 variantes creativas nuevas y agregarlas SIN pausar la existente (preserva el learning).",
      impact: "Refrescar ad sets fatigados típicamente devuelve el CPL al promedio de cuenta en 7-14 días.",
    });
  }

  // Compute "Next Step" — most urgent single action
  const nextStep = recos[0];

  return (
    <div className="space-y-6">
      {/* NEXT STEP — la card grande que llama la atención */}
      {nextStep && (
        <div className="bg-[#0C1015] text-white rounded-lg p-6 border-l-4 border-l-[#ff6900]">
          <div className="text-xs uppercase tracking-widest text-[#ff6900] font-semibold mb-2">Próximo paso · Esta semana</div>
          <h3 className="font-serif text-2xl mb-3">{nextStep.title}</h3>
          <p className="text-sm text-slate-200 mb-3">{nextStep.rationale}</p>
          <div className="bg-white/5 border border-white/10 rounded p-3 text-sm">
            <div className="text-xs uppercase tracking-widest text-[#ff6900] font-semibold mb-1">Acción concreta</div>
            <p className="text-slate-100">{nextStep.action}</p>
          </div>
          {nextStep.impact && <p className="text-xs text-slate-400 mt-3 italic"><Sparkles size={12} className="inline mr-1" />{nextStep.impact}</p>}
        </div>
      )}

      {isCrisis && (
        <div className="bg-amber-50 border border-amber-200 border-l-4 border-l-amber-500 rounded-lg p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle size={24} className="flex-shrink-0 mt-0.5 text-amber-600" />
            <div>
              <h3 className="font-serif text-lg mb-1 text-amber-800">Estamos viendo señales de fatiga creativa</h3>
              <p className="text-sm text-slate-700">Esta semana el CPL ha subido <strong>{cplChange.toFixed(0)}%</strong> ({fmtCurrDec(cmp.cpl_prev)} → {fmtCurrDec(cmp.cpl_now)}). Es parte normal del ciclo de vida de una campaña madura. Las recomendaciones de abajo están diseñadas para revertir esta tendencia.</p>
            </div>
          </div>
        </div>
      )}

      {/* Status overview */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <h3 className="font-serif text-lg mb-3 flex items-center gap-2"><Activity size={18} className="text-slate-500" /> Estado real de las campañas</h3>
        <div className="space-y-2">
          {meta.campaignStatuses.sort((a,b) => {
            const order = { active: 0, learning: 1, paused: 2, historical: 3 };
            return order[a.label] - order[b.label];
          }).map((s, i) => (
            <div key={i} className="flex items-center justify-between gap-3 py-2 border-b border-slate-100 last:border-0">
              <div className="flex items-center gap-3 min-w-0">
                <StatusBadge status={s} />
                <span className="font-semibold text-sm text-[#0C1015] truncate">{s.name}</span>
              </div>
              <div className="text-xs text-slate-500 whitespace-nowrap">
                {s.started_at && `Inició ${new Date(s.started_at).toLocaleDateString("es-CO", { day:"2-digit", month:"short", year:"2-digit" })}`}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* CREATIVE RECOMMENDATIONS — the new juicy section */}
      <div>
        <h3 className="font-serif text-xl mb-3 flex items-center gap-2 text-[#0C1015]"><Lightbulb size={20} className="text-[#ff6900]" /> Recomendaciones de creativos &amp; estrategia</h3>
        <p className="text-sm text-slate-500 mb-4">Basadas en lo que está funcionando en su cuenta.</p>
        <div className="space-y-3">
          {recos.map((r, i) => {
            const priColors = r.priority === "high" ? { border: "border-l-red-500", chip: "bg-red-100 text-red-800", label: "Prioridad alta" }
              : r.priority === "med" ? { border: "border-l-amber-500", chip: "bg-amber-100 text-amber-800", label: "Prioridad media" }
              : { border: "border-l-blue-500", chip: "bg-blue-100 text-blue-800", label: "Oportunidad" };
            return (
              <div key={i} className={`bg-white border border-slate-200 border-l-4 ${priColors.border} rounded-lg p-5`}>
                <div className="flex items-start justify-between gap-3 mb-2">
                  <h4 className="font-serif text-base text-[#0C1015] flex-1">{r.title}</h4>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${priColors.chip} whitespace-nowrap`}>{priColors.label}</span>
                </div>
                <p className="text-sm text-slate-700 mb-3">{r.rationale}</p>
                <div className="bg-slate-50 border border-slate-200 rounded p-3 text-sm mb-2">
                  <div className="text-xs uppercase tracking-widest text-slate-500 font-semibold mb-1">Acción concreta</div>
                  <p className="text-slate-900">{r.action}</p>
                </div>
                {r.impact && <p className="text-xs text-slate-500 italic"><Sparkles size={11} className="inline mr-1 text-[#ff6900]" />{r.impact}</p>}
              </div>
            );
          })}
        </div>
      </div>

      {/* === DEEP RECOMMENDATIONS (budget-aware) === */}
      {meta.deepRecommendations && (
        <DeepRecommendationsBlock dr={meta.deepRecommendations} />
      )}

      {/* Learning callout */}
      {meta.campaignStatuses.filter(s => s.label === "learning").length > 0 && (
        <div className="bg-blue-50 border border-blue-200 border-l-4 border-l-blue-600 rounded-lg p-5">
          <h4 className="font-serif text-base text-blue-800 mb-2 flex items-center gap-2"><Sparkles size={16} /> En aprendizaje · no tomar acción todavía</h4>
          <p className="text-sm text-slate-700 mb-3">Estas campañas tienen menos de 14 días corriendo. Meta sigue en Learning Phase. <strong>NO pausar ni cambiar nada</strong> antes de los 14 días.</p>
          <ul className="text-sm space-y-1">
            {meta.campaignStatuses.filter(s => s.label === "learning").map((s, i) => (
              <li key={i} className="flex justify-between"><strong>{s.name}</strong><span className="text-blue-800">{s.days_old} días</span></li>
            ))}
          </ul>
        </div>
      )}

      {/* Operational recos */}
      <div className="grid grid-cols-2 max-md:grid-cols-1 gap-4">
        <div className="bg-white border border-red-200 border-l-4 border-l-red-600 rounded-lg p-5">
          <h4 className="font-serif text-base text-red-700 mb-3 flex items-center gap-2"><Ban size={16} /> Pausar (ad sets activos)</h4>
          {(() => {
            const toCut = sortedAdsets.filter(a => {
              if (a.spend <= 100) return false;
              if (a.leads !== 0 && (a.cpl === null || a.cpl <= 100)) return false;
              const s = statusByName.get(a.campaign);
              return s?.label === "active";
            }).slice(0, 5);
            return toCut.length ? (
              <ul className="text-sm text-slate-900 space-y-2">
                {toCut.map((a, i) => (
                  <li key={i} className="flex justify-between gap-2 border-b border-slate-100 pb-2 last:border-0">
                    <span><strong>{a.name}</strong><br /><span className="text-xs text-slate-500">{shortName(a.campaign)}</span></span>
                    <span className="text-right text-xs whitespace-nowrap"><span className="text-red-600 font-semibold">${a.spend.toFixed(0)}</span><br /><span>{a.leads || 0} leads</span></span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-slate-600">Nada urgente que pausar entre las campañas activas.</p>;
          })()}
        </div>

        <div className="bg-white border border-green-200 border-l-4 border-l-green-600 rounded-lg p-5">
          <h4 className="font-serif text-base text-green-700 mb-3 flex items-center gap-2"><CheckCircle2 size={16} /> Mantener funcionando</h4>
          {(() => {
            const toKeep = sortedAdsets.filter(a => {
              if (a.cpl === null || a.cpl >= 60 || a.leads < 5) return false;
              const s = statusByName.get(a.campaign);
              return s?.label === "active";
            }).slice(0, 4);
            return toKeep.length ? (
              <ul className="text-sm text-slate-900 space-y-2">
                {toKeep.map((a, i) => (
                  <li key={i} className="flex justify-between gap-2 border-b border-slate-100 pb-2 last:border-0">
                    <span><strong>{a.name}</strong><br /><span className="text-xs text-slate-500">{shortName(a.campaign)}</span></span>
                    <span className="text-right text-xs whitespace-nowrap"><span className="text-green-600 font-semibold">{fmtCurrDec(a.cpl!)}</span><br /><span>{a.leads} leads</span></span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-slate-600">Ningún ad set sostiene CPL bajo ahora mismo.</p>;
          })()}
        </div>
      </div>

      {meta.campaignStatuses.filter(s => s.label === "paused").length > 0 && (
        <div className="bg-slate-100 border border-slate-200 rounded-lg p-4">
          <h4 className="font-serif text-sm text-slate-700 mb-2 flex items-center gap-2"><PauseCircle size={14} /> Recientemente pausadas (sin acción requerida)</h4>
          <ul className="text-sm text-slate-600 space-y-1">
            {meta.campaignStatuses.filter(s => s.label === "paused").map((s, i) => <li key={i}>{s.name}</li>)}
          </ul>
        </div>
      )}

    </div>
  );
}

/* ============================== HELPERS ============================== */

function DeltaIcon({ delta, lowerBetter, size = 12 }: { delta: number; lowerBetter?: boolean; size?: number }) {
  const cls = delta > 0 ? (lowerBetter ? "text-red-600" : "text-green-600") : delta < 0 ? (lowerBetter ? "text-green-600" : "text-red-600") : "text-slate-400";
  const Icon = delta > 0 ? ArrowUp : delta < 0 ? ArrowDown : Minus;
  return <span className={cls + " inline-flex items-center gap-1 text-xs font-semibold"}><Icon size={size} strokeWidth={2.5} />{Math.abs(delta).toFixed(0)}%</span>;
}

function HeroKPI({ label, value, delta, lowerBetter, sub, accent = "dark" }: { label: string; value: string; delta?: number; lowerBetter?: boolean; sub?: string; accent?: "dark" | "gold" | "red" }) {
  const accentBorder = accent === "gold" ? "border-l-[#ff6900]" : accent === "red" ? "border-l-red-600" : "border-l-[#0C1015]";
  return (
    <div className={`bg-white border border-slate-200 border-l-4 ${accentBorder} rounded-lg p-6`}>
      <div className="text-xs text-slate-600 uppercase tracking-widest font-semibold mb-2">{label}</div>
      <div className="font-serif text-4xl text-[#0C1015] mb-2 leading-none">{value}</div>
      {typeof delta === "number" && (
        <div className="flex items-center gap-1.5 text-sm">
          <DeltaIcon delta={delta} lowerBetter={lowerBetter} size={14} />
          <span className="text-slate-500 text-xs">vs 7d previos</span>
        </div>
      )}
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}

function KPI({ label, value, delta, lowerBetter, sub }: { label: string; value: string; delta?: number; lowerBetter?: boolean; sub?: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <div className="text-xs text-slate-600 uppercase tracking-widest font-semibold mb-2">{label}</div>
      <div className="font-serif text-2xl text-[#0C1015] mb-1 leading-none">{value}</div>
      {typeof delta === "number" && <DeltaIcon delta={delta} lowerBetter={lowerBetter} />}
      {sub && <div className="text-xs text-slate-400 mt-1">{sub}</div>}
    </div>
  );
}

function MiniWin({ title, Icon, data }: { title: string; Icon: typeof Award; data: { name: string; spend?: number; leads?: number; cpl: number | null } | undefined }) {
  if (!data) return null;
  return (
    <div className="bg-white border border-slate-200 border-l-4 border-l-green-600 rounded-lg p-4">
      <div className="text-xs text-slate-600 uppercase tracking-widest font-semibold mb-2 flex items-center gap-1.5">
        <Icon size={14} className="text-green-600" /> {title}
      </div>
      <div className="font-serif text-base text-[#0C1015] mb-1 leading-tight">{data.name}</div>
      <div className="text-xs text-slate-500">{data.leads || 0} leads · {data.cpl ? fmtCurrDec(data.cpl) : "—"} CPL</div>
    </div>
  );
}

type Snapshot = {
  savedAt: string;
  campaignStatuses: CampaignStatus[];
  adsets: { name: string; spend: number; leads: number; cpl: number | null }[];
  cpl: number;
  leads: number;
  leadsToday: number;
};

function computeDiff(prev: Snapshot, curr: MetaData): { icon: string; text: string }[] {
  const out: { icon: string; text: string }[] = [];
  if (!prev || !curr) return out;

  // Campaign status changes
  const prevStatusByName = new Map((prev.campaignStatuses || []).map((s: CampaignStatus) => [s.name, s]));
  const currStatusByName = new Map(curr.campaignStatuses.map((s) => [s.name, s]));

  for (const [name, currS] of currStatusByName.entries()) {
    const prevS = prevStatusByName.get(name);
    if (!prevS) {
      out.push({ icon: "🆕", text: `Nueva campaña detectada: ${name} (${currS.label === "learning" ? "en aprendizaje" : "activa"})` });
    } else if (prevS.label !== currS.label) {
      if (currS.label === "paused" && prevS.label === "active") {
        out.push({ icon: "⏸️", text: `Pausamos: ${name}` });
      } else if (currS.label === "active" && prevS.label === "paused") {
        out.push({ icon: "▶️", text: `Reactivamos: ${name}` });
      }
    }
  }
  for (const [name] of prevStatusByName.entries()) {
    if (!currStatusByName.has(name)) {
      out.push({ icon: "📦", text: `${name} ya no aparece en la cuenta` });
    }
  }

  // Ad set changes (new ad sets — sign of active work)
  const prevAdsetNames = new Set((prev.adsets || []).map((a) => a.name));
  const currAdsetNames = new Set(curr.adsets.map((a) => a.name));
  let newAdsetCount = 0;
  for (const name of currAdsetNames) {
    if (!prevAdsetNames.has(name)) newAdsetCount++;
  }
  if (newAdsetCount > 0) {
    out.push({ icon: "✨", text: `${newAdsetCount} ad set${newAdsetCount > 1 ? "s nuevos lanzados" : " nuevo lanzado"} desde la última visita` });
  }

  // CPL movement (only if significant)
  if (prev.cpl && curr.totals30d.cpl) {
    const pctChange = ((curr.totals30d.cpl - prev.cpl) / prev.cpl) * 100;
    if (Math.abs(pctChange) >= 5) {
      const better = pctChange < 0;
      out.push({
        icon: better ? "📉" : "📈",
        text: `CPL ${better ? "mejoró" : "subió"} ${Math.abs(pctChange).toFixed(0)}% (${fmtCurrDec(prev.cpl)} → ${fmtCurrDec(curr.totals30d.cpl)})`,
      });
    }
  }

  // Lead change
  const leadDiff = curr.totals30d.leads - prev.leads;
  if (Math.abs(leadDiff) >= 1) {
    out.push({
      icon: leadDiff > 0 ? "📈" : "📉",
      text: `${leadDiff > 0 ? "+" : ""}${leadDiff} formularios desde la última visita (total ${curr.totals30d.leads})`,
    });
  }

  return out.slice(0, 8); // cap at 8 items
}

function GoogleView({ data, activeSection }: { data: GoogleData; activeSection: Section }) {
  const t = data.totals30d;
  const cmp = data.last7vsPrev7;
  const cpaChange = cmp.cpa_prev ? ((cmp.cpa_now - cmp.cpa_prev) / cmp.cpa_prev) * 100 : 0;

  if (activeSection === "resumen") {
    return (
      <div className="space-y-6">
        {/* Hero KPIs */}
        <div className="grid grid-cols-3 max-md:grid-cols-1 gap-4">
          <HeroKPI label={`CPA promedio · ${data.rangeDays}d`} value={fmtCurr(t.cpa)}
            sub={`Últimos 7 días: ${fmtCurr(cmp.cpa_now)} (vs ${fmtCurr(cmp.cpa_prev)} previos · ${cpaChange > 0 ? "+" : ""}${cpaChange.toFixed(0)}%)`}
            delta={cpaChange} lowerBetter accent="gold" />
          <HeroKPI label={`Inversión ${data.rangeDays}d`} value={fmtCurr(t.spend)}
            sub={`Últimos 7 días: ${fmtCurr(cmp.spend.now)}`}
            delta={cmp.spend.pct} />
          <HeroKPI label={`Conversiones ${data.rangeDays}d`} value={fmtNum(t.conversions)}
            sub={`Últimos 7 días: ${fmtNum(cmp.conversions.now)} (vs ${fmtNum(cmp.conversions.prev)} previos)`}
            delta={cmp.conversions.pct} />
        </div>

        {/* Secondary stats */}
        <div className="grid grid-cols-4 max-md:grid-cols-2 gap-3">
          <KPI label="Impresiones" value={fmtNum(t.impressions)} />
          <KPI label="Clicks" value={fmtNum(t.clicks)} />
          <KPI label="CTR" value={fmtPct(t.ctr)} />
          <KPI label="CPM" value={fmtCurr(t.cpm)} />
        </div>

        {/* Status overview */}
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <h3 className="font-serif text-lg mb-3 flex items-center gap-2"><Activity size={18} className="text-slate-500" /> Estado real de las campañas</h3>
          <div className="space-y-2">
            {data.campaignStatuses.map((s, i) => (
              <div key={i} className="flex items-center justify-between gap-3 py-2 border-b border-slate-100 last:border-0">
                <div className="flex items-center gap-3 min-w-0">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${s.label === "active" ? "bg-green-100 text-green-800" : s.label === "paused" ? "bg-slate-200 text-slate-700" : "bg-slate-100 text-slate-500"}`}>
                    {s.label === "active" ? "Activa" : s.label === "paused" ? "Pausada" : "Histórica"}
                  </span>
                  <span className="font-semibold text-sm text-[#0C1015] truncate">{s.name}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (activeSection === "campanas") {
    return (
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-200 bg-slate-50">
                <th className="px-4 py-3">Campaña</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3 text-right">Spend</th>
                <th className="px-4 py-3 text-right">Conversiones</th>
                <th className="px-4 py-3 text-right">CPA</th>
                <th className="px-4 py-3 text-right">CTR</th>
              </tr>
            </thead>
            <tbody>
              {data.campaignBreakdown.map((c, i) => (
                <tr key={i} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3"><strong>{c.name}</strong></td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${c.status === "ENABLED" ? "bg-green-100 text-green-800" : "bg-slate-200 text-slate-700"}`}>
                      {c.status === "ENABLED" ? "Activa" : "Pausada"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmtCurr(c.spend)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmtNum(c.conversions)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{c.cpa !== null ? fmtCurr(c.cpa) : "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmtPct(c.ctr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (activeSection === "tendencias") {
    const max = Math.max(...data.daily.map(d => d.spend), 1);
    return (
      <div className="space-y-6">
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <h3 className="font-serif text-lg mb-4">Spend + Conversiones por día</h3>
          <div className="space-y-1">
            {data.daily.slice(-14).map((d, i) => {
              const pct = (d.spend / max) * 100;
              return (
                <div key={i} className="flex items-center gap-3 text-xs">
                  <span className="w-16 text-slate-500 tabular-nums">{new Date(d.date).toLocaleDateString("es-CO", { day: "2-digit", month: "short" })}</span>
                  <div className="flex-1 bg-slate-100 rounded h-6 relative overflow-hidden">
                    <div className="bg-[#ff6900] h-full" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-24 text-right tabular-nums text-slate-700">{fmtCurr(d.spend)}</span>
                  <span className="w-20 text-right tabular-nums font-semibold">{d.conversions.toFixed(0)} conv</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return <div className="text-slate-500 text-sm">Esta sección no aplica para Google Ads.</div>;
}

function shortName(campaign: string): string {
  const map: Record<string, string> = {
    "OUTCOME_LEADS_IDDENTIFY - Only Forms V2": "Lead Form V2",
    "FORM_Blinds_Ingles": "Blinds EN",
    "Ventas_InstaSwitch_Español - NEW": "InstaSwitch ES",
    "REMARKETING PROMOCION 15 + 40": "Remarketing",
  };
  if (map[campaign]) return map[campaign];
  return campaign.length > 20 ? campaign.slice(0, 18) + "…" : campaign;
}

function Row({ lbl, val, highlight }: { lbl: string; val: string; highlight?: string }) {
  return (
    <div className="flex justify-between items-baseline py-1 border-b border-slate-100 last:border-0">
      <span className="text-slate-600">{lbl}</span>
      <span className={`font-semibold tabular-nums ${highlight || "text-[#0C1015]"}`}>{val}</span>
    </div>
  );
}

function DeepRecommendationsBlock({ dr }: { dr: DeepRecommendations }) {
  const { budgetAudit: ba, structureRec, audienceTests, creativeVariants, evaluationCalendar } = dr;
  const fmtDate = (d: string) => new Date(d).toLocaleDateString("es-CO", { day: "2-digit", month: "short" });
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 pt-2">
        <div className="h-px flex-1 bg-slate-200" />
        <span className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">Análisis profundo · presupuesto + estructura</span>
        <div className="h-px flex-1 bg-slate-200" />
      </div>

      {/* Budget audit */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <h3 className="font-serif text-lg mb-1 flex items-center gap-2 text-[#0C1015]">
          <Activity size={18} className="text-[#ff6900]" /> Auditoría de presupuesto
        </h3>
        <p className="text-xs text-slate-500 mb-4">
          Capacidad asignada (cap diario × 30): <strong className="text-[#0C1015]">${ba.totalMonthlyBudget.toFixed(0)}/mes</strong>. El gasto real depende del rendimiento — Meta gasta menos del cap cuando no encuentra demanda.
        </p>
        <div className="grid grid-cols-4 max-md:grid-cols-2 gap-3 mb-4">
          {[
            { label: "Ganadores",  count: ba.winners.count,    money: ba.winners.monthlyBudget,    cls: "border-green-200 text-green-700", help: "Proteger" },
            { label: "Borderline", count: ba.borderline.count, money: ba.borderline.monthlyBudget, cls: "border-amber-200 text-amber-700", help: "Optimizar creativo" },
            { label: "Perdedores", count: ba.losers.count,     money: ba.losers.monthlyBudget,     cls: "border-red-200 text-red-700",     help: "Pausar/reducir" },
            { label: "En learning",count: ba.learning.count,   money: ba.learning.monthlyBudget,   cls: "border-blue-200 text-blue-700",   help: "No tocar" },
          ].map((c, i) => (
            <div key={i} className={`border rounded p-3 ${c.cls}`}>
              <div className="text-[10px] uppercase tracking-wider font-semibold opacity-80">{c.label}</div>
              <div className="font-serif text-2xl my-1">{c.count}</div>
              <div className="text-xs tabular-nums">${c.money.toFixed(0)}/mes</div>
              <div className="text-[10px] opacity-70 mt-1">{c.help}</div>
            </div>
          ))}
        </div>
        {ba.reassignableBudget > 0 && (
          <div className="bg-[#0C1015] text-white rounded p-4 text-sm">
            <div className="text-xs uppercase tracking-widest text-[#ff6900] font-semibold mb-1">Presupuesto reasignable</div>
            <p>Pausando los <strong>{ba.losers.count} ad set{ba.losers.count !== 1 ? "s" : ""} perdedor{ba.losers.count !== 1 ? "es" : ""}</strong> se liberan <strong className="text-[#ff6900]">${ba.reassignableBudget.toFixed(0)}/mes</strong> para invertir en tests nuevos sin afectar lo que funciona.</p>
          </div>
        )}
      </div>

      {/* Audience tests (budget-constrained) */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <h3 className="font-serif text-lg mb-1 flex items-center gap-2 text-[#0C1015]">
          <Target size={18} className="text-[#ff6900]" /> Audiencias nuevas a probar
          <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 uppercase tracking-wider">Nuevo</span>
        </h3>
        <p className="text-xs text-slate-500 mb-4">{audienceTests.note}</p>
        {audienceTests.suggestions.length > 0 ? (
          <div className="space-y-3">
            {audienceTests.suggestions.map((s, i) => {
              const risk = s.riskLevel === "low" ? { cls: "bg-green-100 text-green-800", lbl: "Bajo riesgo" }
                : s.riskLevel === "medium" ? { cls: "bg-amber-100 text-amber-800", lbl: "Riesgo medio" }
                : { cls: "bg-red-100 text-red-800", lbl: "Experimental" };
              return (
                <div key={i} className="border border-slate-200 rounded p-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h4 className="font-semibold text-sm text-[#0C1015]">{s.title}</h4>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${risk.cls} whitespace-nowrap`}>{risk.lbl}</span>
                  </div>
                  <p className="text-xs text-slate-700 mb-2"><strong>Audiencia:</strong> {s.audience}</p>
                  <p className="text-xs text-slate-600 italic mb-2">{s.rationale}</p>
                  <div className="flex gap-3 text-[11px] text-slate-500">
                    <span>💰 ${s.monthlyBudget.toFixed(0)}/mes</span>
                    <span>📅 ~{s.daysToLearn}d para salir de learning</span>
                    {s.campaign && <span className="truncate">🎯 Anidar en: {shortName(s.campaign)}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="bg-slate-50 border border-slate-200 rounded p-4 text-xs text-slate-600">
            <strong>Foco esta semana:</strong> nuevos creativos dentro de las audiencias existentes ganadoras (ver tarjeta abajo). No hay presupuesto disponible para abrir audiencias nuevas sin sacrificar lo que ya funciona.
          </div>
        )}
      </div>

      {/* Creative variants per active ad set */}
      {creativeVariants.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <h3 className="font-serif text-lg mb-1 flex items-center gap-2 text-[#0C1015]">
            <Sparkles size={18} className="text-[#ff6900]" /> Variantes creativas por audiencia
            <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 uppercase tracking-wider">Nuevo</span>
          </h3>
          <p className="text-xs text-slate-500 mb-4">Probar creativos nuevos DENTRO de audiencias que ya funcionan = menor riesgo. Meta solo tiene que aprender el creativo, no la audiencia.</p>
          <div className="space-y-2">
            {creativeVariants.map((v, i) => (
              <div key={i} className="border border-slate-200 rounded p-3">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="min-w-0">
                    <h4 className="font-semibold text-sm text-[#0C1015] truncate">{v.adset}</h4>
                    <p className="text-[10px] text-slate-500 truncate">{shortName(v.campaign)}</p>
                  </div>
                  <span className="text-xs whitespace-nowrap">
                    <strong className="text-[#ff6900]">+{v.recommendedAdds} variantes</strong>
                  </span>
                </div>
                <div className="flex gap-3 text-[11px] text-slate-500 mb-1">
                  <span>{v.currentAdCount} ad{v.currentAdCount !== 1 ? "s" : ""} activos</span>
                  <span>Más viejo: {v.oldestAdDays}d</span>
                </div>
                <p className="text-xs text-slate-600">{v.reason}</p>
                {v.blockedReason && (
                  <p className="text-[11px] text-blue-700 mt-1 flex items-start gap-1">
                    <Sparkles size={11} className="mt-0.5 flex-shrink-0" /> {v.blockedReason}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Structure recommendation */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <h3 className="font-serif text-lg mb-1 flex items-center gap-2 text-[#0C1015]">
          <Award size={18} className="text-[#ff6900]" /> Estructura de campañas (CBO vs ABO)
          <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 uppercase tracking-wider">Nuevo</span>
        </h3>
        <p className="text-xs text-slate-500 mb-4">CBO = Meta decide presupuesto por ad set. ABO = nosotros decidimos. Cambio recomendado cuando hay señal suficiente (≥50 conversiones).</p>
        <div className="space-y-2">
          {structureRec.activeCampaigns.map((s, i) => {
            const recBadge = s.recommendation === "switch_to_cbo"
              ? { cls: "bg-amber-100 text-amber-800", lbl: "→ Pasar a CBO" }
              : s.recommendation === "switch_to_abo"
              ? { cls: "bg-amber-100 text-amber-800", lbl: "→ Volver a ABO" }
              : { cls: "bg-slate-100 text-slate-600", lbl: "Mantener" };
            return (
              <div key={i} className="border border-slate-200 rounded p-3">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <h4 className="font-semibold text-sm text-[#0C1015] truncate flex-1">{shortName(s.name)}</h4>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${recBadge.cls} whitespace-nowrap`}>{recBadge.lbl}</span>
                </div>
                <div className="flex gap-3 text-[11px] text-slate-500 mb-1">
                  <span>Actual: <strong>{s.currentStructure}</strong></span>
                  <span>{s.activeAdsetCount} ad set{s.activeAdsetCount !== 1 ? "s" : ""} activos</span>
                  <span>{s.totalConversions} conversiones</span>
                </div>
                <p className="text-xs text-slate-700">{s.reason}</p>
                {s.blockedReason && <p className="text-[11px] text-blue-700 italic mt-1">⏸ {s.blockedReason}</p>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Evaluation calendar */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <h3 className="font-serif text-lg mb-1 flex items-center gap-2 text-[#0C1015]">
          <CalendarDays size={18} className="text-[#ff6900]" /> Calendario de evaluación
          <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 uppercase tracking-wider">Nuevo</span>
        </h3>
        <p className="text-xs text-slate-500 mb-4">Reglas de Meta respetadas: no pausar campañas &lt;14d, no pausar creativos &lt;7d, no migrar CBO &lt;50 conversiones.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
                <th className="py-2 pr-3">Ad set</th>
                <th className="py-2 pr-3">Días corriendo</th>
                <th className="py-2 pr-3">Próxima revisión</th>
                <th className="py-2">Acción</th>
              </tr>
            </thead>
            <tbody>
              {evaluationCalendar.map((c, i) => (
                <tr key={i} className="border-b border-slate-100 last:border-0">
                  <td className="py-2 pr-3"><strong>{c.adset}</strong></td>
                  <td className="py-2 pr-3 tabular-nums">{c.daysRunning}d</td>
                  <td className="py-2 pr-3 tabular-nums">{fmtDate(c.nextEvalDate)}</td>
                  <td className="py-2 text-slate-700">{c.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
