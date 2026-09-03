"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Flag, Loader2, RefreshCw, ShieldCheck, Timer } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Segment = { fromKm: number; toKm: number; paceSecondsPerKm: number; cumulativeTargetS: number; instruction: string };
type Fuel = { when: string; instruction: string };
type Checklist = { phase: string; items: string[] };
type Strategy = {
  id: string;
  version: number;
  strategy_version: string;
  target_duration_s: number;
  target_pace_s_per_km: number;
  segments: Segment[];
  fueling: Fuel[];
  checklist: Checklist[];
  context: Record<string, unknown>;
  created_at: string;
};
type Goal = { event_name: string; event_date: string; distance_m: number | string; target_duration_s: number | null };

function duration(seconds?: number | null) {
  if (!seconds) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  return h ? `${h} h ${String(m).padStart(2, "0")}${s ? `:${String(s).padStart(2, "0")}` : ""}` : `${m}:${String(s).padStart(2, "0")}`;
}
function pace(seconds?: number | null) {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
}
function km(value?: number | string | null) {
  const x = Number(value);
  return Number.isFinite(x) ? `${(x / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km` : "—";
}

export default function RaceDayPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) { setLoading(false); return; }
    const [{ data: goalRow }, { data: strategyRow, error: strategyError }] = await Promise.all([
      supabase.from("goals").select("event_name,event_date,distance_m,target_duration_s").eq("user_id", auth.user.id).eq("goal_type", "primary").eq("status", "active").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("race_strategies").select("id,version,strategy_version,target_duration_s,target_pace_s_per_km,segments,fueling,checklist,context,created_at").eq("user_id", auth.user.id).eq("status", "active").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    setGoal(goalRow as Goal | null);
    if (strategyError) setError(strategyError.message);
    setStrategy(strategyRow as Strategy | null);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  async function regenerate() {
    setBusy(true);
    setError(null);
    setMessage(null);
    const { error: rpcError } = await supabase.rpc("generate_race_strategy");
    setBusy(false);
    if (rpcError) { setError(rpcError.message); return; }
    setMessage("Stratégie recalculée avec les données les plus récentes.");
    await load();
  }

  if (loading) return <main className="frog-centered"><Loader2 className="frog-spin" /> Chargement de Race Day…</main>;

  const context = strategy?.context || {};
  const recovery = Number(context.recovery);
  const readiness = Number(context.readinessScore);

  return <main>
    <Link href="/coach" className="frog-button frog-button-secondary" style={{ marginBottom: 14 }}><ArrowLeft size={16} /> Coach</Link>
    <div className="frog-kicker">Lot 9 · Race Day</div>
    <h1 className="frog-page-title">Stratégie jour J</h1>
    <p className="frog-page-subtitle">Une stratégie versionnée, construite depuis l’objectif validé, le plan et les derniers signaux disponibles.</p>

    {message && <div className="frog-success" style={{ marginBottom: 12 }}>{message}</div>}
    {error && <div className="frog-error" style={{ marginBottom: 12 }}>{error}</div>}

    {!goal ? <section className="frog-card frog-empty"><h2 className="frog-card-title">Aucun objectif actif</h2><p className="frog-card-text">Crée d’abord un objectif principal.</p></section> : !strategy ? <section className="frog-card frog-card-soft">
      <h2 className="frog-card-title">Prêt à créer la stratégie</h2>
      <p className="frog-card-text">{goal.event_name} · {km(goal.distance_m)} · {new Date(`${goal.event_date}T12:00:00`).toLocaleDateString("fr-FR")}</p>
      <button className="frog-button frog-button-primary frog-button-wide" onClick={regenerate} disabled={busy}>{busy ? <><Loader2 size={17} className="frog-spin" /> Calcul…</> : <><Flag size={17} /> Générer Race Day</>}</button>
    </section> : <>
      <section className="frog-card frog-card-soft">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start" }}>
          <div>
            <div className="frog-kicker">{goal.event_name} · stratégie v{strategy.version}</div>
            <h2 className="frog-card-title" style={{ marginTop: 6 }}>{duration(strategy.target_duration_s)} · {pace(strategy.target_pace_s_per_km)}</h2>
            <p className="frog-card-text">{km(goal.distance_m)} · {new Date(`${goal.event_date}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
          </div>
          <Flag size={24} />
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
          {Number.isFinite(recovery) && <span className="frog-status-line" data-connected>Récupération {Math.round(recovery)}%</span>}
          {Number.isFinite(readiness) && <span className="frog-status-line" data-connected>Disponibilité {Math.round(readiness)}/100</span>}
          {context.feasibilityScore != null && <span className="frog-status-line">Faisabilité {String(context.feasibilityScore)}/100</span>}
        </div>
        <button className="frog-button frog-button-secondary frog-button-wide" style={{ marginTop: 14 }} onClick={regenerate} disabled={busy}>{busy ? <Loader2 size={17} className="frog-spin" /> : <RefreshCw size={17} />} Actualiser avec les données du jour</button>
      </section>

      <section className="frog-card">
        <div style={{ display: "flex", gap: 9, alignItems: "center" }}><Timer size={21} /><h2 className="frog-card-title">Plan d’allure</h2></div>
        <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
          {(strategy.segments || []).map((segment, index) => <article key={`${segment.fromKm}-${segment.toKm}`} style={{ border: "1px solid var(--frog-border)", borderRadius: 15, padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <div><div className="frog-kicker">Bloc {index + 1}</div><strong>{segment.fromKm} → {segment.toKm} km</strong></div>
              <div style={{ textAlign: "right" }}><strong>{pace(segment.paceSecondsPerKm)}</strong><div className="frog-card-text">cumul {duration(segment.cumulativeTargetS)}</div></div>
            </div>
            <p className="frog-card-text" style={{ marginBottom: 0 }}>{segment.instruction}</p>
          </article>)}
        </div>
      </section>

      <section className="frog-card">
        <h2 className="frog-card-title">Ravitaillement & hydratation</h2>
        <p className="frog-card-text">La règle Frog : uniquement ce qui a déjà été testé à l’entraînement.</p>
        <div style={{ display: "grid", gap: 9, marginTop: 12 }}>
          {(strategy.fueling || []).map((item) => <div key={item.when}><div className="frog-kicker">{item.when}</div><p className="frog-card-text" style={{ marginTop: 4 }}>{item.instruction}</p></div>)}
        </div>
      </section>

      <section className="frog-card">
        <div style={{ display: "flex", gap: 9, alignItems: "center" }}><ShieldCheck size={21} /><h2 className="frog-card-title">Checklist & plan B</h2></div>
        <div style={{ display: "grid", gap: 14, marginTop: 14 }}>
          {(strategy.checklist || []).map((block) => <div key={block.phase}>
            <div className="frog-kicker">{block.phase}</div>
            <ul className="frog-card-text" style={{ marginTop: 7, paddingLeft: 20 }}>{(block.items || []).map((item) => <li key={item} style={{ marginBottom: 5 }}>{item}</li>)}</ul>
          </div>)}
        </div>
      </section>
    </>}

    <p className="frog-footnote">Race Day est recalculable jusqu’au jour J. Une stratégie de course ne doit jamais passer devant un signal inhabituel de douleur, malaise ou sécurité.</p>
  </main>;
}
