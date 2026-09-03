import Link from "next/link";
import { ArrowRight, Activity, CalendarDays, Gauge, Mountain, TrendingUp } from "lucide-react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Period = { activities?: number; runningDistanceM?: number; durationS?: number; elevationM?: number; trainingLoad?: number };
type Weekly = { weekStart: string; activities: number; runningDistanceM: number; durationS: number; trainingLoad: number };
type Dashboard = {
  current28?: Period;
  previous28?: Period;
  last90?: { activities?: number; runningDistanceM?: number; longestRunM?: number };
  year?: { activities?: number; runningDistanceM?: number; longestRunM?: number; activeWeeks?: number };
  weekly?: Weekly[];
  fitness?: { recovery?: number; loadRatio?: number; vo2max?: number; thresholdPace?: string; restingHr?: number };
  plan?: { plannedDue?: number; completedDue?: number; remaining?: number };
  feedback?: { count?: number; avgRpe?: number | null };
  analyses?: { count?: number; avgAdherence?: number | null };
  adaptations?: { applied?: number };
};

function km(value?: number) { return `${((Number(value) || 0) / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km`; }
function hours(value?: number) {
  const seconds = Number(value) || 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, "0")}` : `${m} min`;
}
function delta(current?: number, previous?: number) {
  const c = Number(current) || 0;
  const p = Number(previous) || 0;
  if (!p) return null;
  return Math.round(((c - p) / p) * 100);
}
function deltaText(value: number | null) {
  if (value == null) return "Pas de comparaison précédente";
  if (value === 0) return "Stable vs 28 jours précédents";
  return `${value > 0 ? "+" : ""}${value}% vs 28 jours précédents`;
}

export default async function ProgressPage() {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const { data, error } = await supabase.rpc("get_progress_dashboard");
  const dashboard = (data || {}) as Dashboard;
  const current = dashboard.current28 || {};
  const previous = dashboard.previous28 || {};
  const weekly = Array.isArray(dashboard.weekly) ? dashboard.weekly : [];
  const maxWeekly = Math.max(1, ...weekly.map((week) => Number(week.runningDistanceM) || 0));
  const distanceDelta = delta(current.runningDistanceM, previous.runningDistanceM);
  const activityDelta = delta(current.activities, previous.activities);
  const plannedDue = Number(dashboard.plan?.plannedDue) || 0;
  const completedDue = Number(dashboard.plan?.completedDue) || 0;
  const adherence = plannedDue > 0 ? Math.round((completedDue / plannedDue) * 100) : 0;

  return <main>
    <div className="frog-kicker">Lot 9 · Progrès</div>
    <h1 className="frog-page-title">Ta progression</h1>
    <p className="frog-page-subtitle">Une lecture factuelle de ton historique COROS, de ta forme actuelle et de l’exécution de ton plan.</p>

    {error && <div className="frog-error" style={{ marginBottom: 12 }}>{error.message}</div>}

    <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
      <article className="frog-card">
        <div className="frog-kicker">28 derniers jours</div>
        <h2 className="frog-card-title" style={{ marginTop: 6 }}>{km(current.runningDistanceM)}</h2>
        <p className="frog-card-text">Course · {deltaText(distanceDelta)}</p>
      </article>
      <article className="frog-card">
        <div className="frog-kicker">Activités</div>
        <h2 className="frog-card-title" style={{ marginTop: 6 }}>{Number(current.activities) || 0}</h2>
        <p className="frog-card-text">{deltaText(activityDelta)}</p>
      </article>
      <article className="frog-card">
        <div className="frog-kicker">Temps total</div>
        <h2 className="frog-card-title" style={{ marginTop: 6 }}>{hours(current.durationS)}</h2>
        <p className="frog-card-text">Tous sports · 28 jours</p>
      </article>
      <article className="frog-card">
        <div className="frog-kicker">Dénivelé</div>
        <h2 className="frog-card-title" style={{ marginTop: 6 }}>{Math.round(Number(current.elevationM) || 0).toLocaleString("fr-FR")} m</h2>
        <p className="frog-card-text">Cumul 28 jours</p>
      </article>
    </section>

    <section className="frog-card">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start" }}>
        <div>
          <div className="frog-kicker">12 dernières semaines</div>
          <h2 className="frog-card-title" style={{ marginTop: 6 }}>Volume de course</h2>
        </div>
        <TrendingUp size={22} />
      </div>
      <div style={{ display: "flex", alignItems: "end", gap: 7, height: 150, marginTop: 18 }}>
        {weekly.map((week) => {
          const value = Number(week.runningDistanceM) || 0;
          const height = Math.max(4, Math.round((value / maxWeekly) * 120));
          return <div key={week.weekStart} title={`${new Date(`${week.weekStart}T12:00:00`).toLocaleDateString("fr-FR")} · ${km(value)}`} style={{ flex: 1, minWidth: 0 }}>
            <div style={{ height, borderRadius: "8px 8px 3px 3px", background: "var(--frog-accent, currentColor)", opacity: value ? 0.85 : 0.18 }} />
          </div>;
        })}
      </div>
      <p className="frog-footnote" style={{ marginBottom: 0 }}>Chaque barre représente la distance de course enregistrée pendant la semaine. Les semaines à zéro peuvent contenir du vélo, gravel ou d’autres sports.</p>
    </section>

    <section className="frog-card">
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}><Gauge size={21} /><h2 className="frog-card-title">Forme actuelle</h2></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 14 }}>
        <div><div className="frog-kicker">Récupération</div><strong>{dashboard.fitness?.recovery != null ? `${Math.round(Number(dashboard.fitness.recovery))}%` : "—"}</strong></div>
        <div><div className="frog-kicker">Ratio charge</div><strong>{dashboard.fitness?.loadRatio != null ? Number(dashboard.fitness.loadRatio).toFixed(2) : "—"}</strong></div>
        <div><div className="frog-kicker">VO₂max COROS</div><strong>{dashboard.fitness?.vo2max ?? "—"}</strong></div>
        <div><div className="frog-kicker">Allure seuil</div><strong>{dashboard.fitness?.thresholdPace || "—"}</strong></div>
      </div>
    </section>

    <section className="frog-card">
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}><CalendarDays size={21} /><h2 className="frog-card-title">Exécution du plan</h2></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 14 }}>
        <div><div className="frog-kicker">Séances dues</div><strong>{plannedDue}</strong></div>
        <div><div className="frog-kicker">Confirmées</div><strong>{completedDue}</strong></div>
        <div><div className="frog-kicker">Adhérence calendrier</div><strong>{plannedDue ? `${adherence}%` : "—"}</strong></div>
        <div><div className="frog-kicker">À venir</div><strong>{Number(dashboard.plan?.remaining) || 0}</strong></div>
      </div>
      <p className="frog-card-text">Feedbacks : {Number(dashboard.feedback?.count) || 0} · Analyses Frog : {Number(dashboard.analyses?.count) || 0} · Adaptations appliquées : {Number(dashboard.adaptations?.applied) || 0}</p>
      {dashboard.analyses?.avgAdherence != null && <p className="frog-card-text">Score moyen d’adhérence aux séances analysées : <strong>{Number(dashboard.analyses.avgAdherence).toFixed(0)}/100</strong>.</p>}
    </section>

    <section className="frog-card frog-card-soft">
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}><Mountain size={21} /><h2 className="frog-card-title">Repères de fond</h2></div>
      <p className="frog-card-text">90 jours : {km(dashboard.last90?.runningDistanceM)} de course · plus longue sortie {km(dashboard.last90?.longestRunM)}.</p>
      <p className="frog-card-text">12 mois : {Number(dashboard.year?.activities) || 0} activités tous sports · {km(dashboard.year?.runningDistanceM)} de course · plus longue sortie {km(dashboard.year?.longestRunM)}.</p>
      <Link href="/race-day" className="frog-button frog-button-primary" style={{ marginTop: 10 }}>Voir la stratégie Race Day <ArrowRight size={17} /></Link>
    </section>

    <p className="frog-footnote"><Activity size={13} style={{ display: "inline", verticalAlign: "-2px" }} /> Les tendances comparent les périodes, mais Frog donne plus de poids à la forme récente qu’aux performances anciennes.</p>
  </main>;
}
