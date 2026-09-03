"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Gauge, Loader2, RefreshCw, ShieldCheck, WandSparkles } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Review = {
  id: string;
  week_start: string;
  week_end: string;
  decision: "maintain" | "reduce" | "recovery";
  readiness_score: number;
  confidence: number | string;
  signals: Record<string, unknown>;
  summary: string;
  recommendation: string;
  status: "no_change" | "proposed" | "applied";
  applied_at: string | null;
  model_version: string;
};

type Adaptation = {
  id: string;
  action: "reduce" | "recovery";
  reduction_pct: number | string | null;
  reason: string;
  status: "proposed" | "applied" | "skipped";
  after_state: Record<string, unknown>;
  planned_workouts?: { scheduled_date?: string; title?: string } | Array<{ scheduled_date?: string; title?: string }> | null;
};

function decisionLabel(decision: Review["decision"]) {
  if (decision === "reduce") return "Alléger";
  if (decision === "recovery") return "Priorité récupération";
  return "Maintenir";
}

function numberValue(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function dateLabel(value?: string) {
  if (!value) return null;
  return new Date(`${value}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
}

function adaptationWorkout(adaptation: Adaptation) {
  const relation = adaptation.planned_workouts;
  return Array.isArray(relation) ? relation[0] : relation || null;
}

export default function WeeklyReviewCard({ planId, onPlanChanged }: { planId: string; onPlanChanged: () => Promise<void> | void }) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [review, setReview] = useState<Review | null>(null);
  const [adaptations, setAdaptations] = useState<Adaptation[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data: reviewRow, error: reviewError } = await supabase
      .from("weekly_reviews")
      .select("id,week_start,week_end,decision,readiness_score,confidence,signals,summary,recommendation,status,applied_at,model_version")
      .eq("plan_id", planId)
      .order("week_start", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (reviewError) {
      setError(reviewError.message);
      return;
    }

    const typed = reviewRow as Review | null;
    setReview(typed);
    if (!typed) {
      setAdaptations([]);
      return;
    }

    const { data: adaptationRows } = await supabase
      .from("plan_adaptations")
      .select("id,action,reduction_pct,reason,status,after_state,planned_workouts(scheduled_date,title)")
      .eq("review_id", typed.id)
      .order("created_at");
    setAdaptations((adaptationRows || []) as unknown as Adaptation[]);
  }, [planId, supabase]);

  const refresh = useCallback(async (silent = false) => {
    setBusy(true);
    setError(null);
    if (!silent) setMessage(null);
    const { error: rpcError } = await supabase.rpc("generate_weekly_review");
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    if (!silent) setMessage("Bilan recalculé avec les dernières données disponibles.");
    await load();
  }, [load, supabase]);

  useEffect(() => {
    let active = true;
    (async () => {
      await load();
      if (!active) return;
      const monday = new Date();
      const day = monday.getDay() || 7;
      monday.setDate(monday.getDate() - day + 1);
      const currentWeek = monday.toISOString().slice(0, 10);
      const { data } = await supabase.from("weekly_reviews").select("week_start").eq("plan_id", planId).eq("week_start", currentWeek).maybeSingle();
      if (!data && active) await refresh(true);
    })();
    return () => { active = false; };
  }, [load, planId, refresh, supabase]);

  async function applyAdaptations() {
    if (!review || review.status !== "proposed") return;
    if (!window.confirm("Appliquer les adaptations proposées ? Les dates des séances resteront inchangées.")) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    const { error: rpcError } = await supabase.rpc("apply_weekly_adaptation", { p_review_id: review.id });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setMessage("Adaptations appliquées au plan. Aucune séance n’a été déplacée.");
    await load();
    await onPlanChanged();
  }

  if (!review) {
    return <section className="frog-card frog-card-soft">
      <div className="frog-kicker">Lot 8 · Bilan hebdomadaire</div>
      <h2 className="frog-card-title" style={{ marginTop: 7 }}>Analyse de la semaine</h2>
      <p className="frog-card-text">Frog peut croiser les séances réalisées, ton feedback et les derniers signaux COROS pour vérifier si la charge doit rester identique.</p>
      <button className="frog-button frog-button-secondary" disabled={busy} onClick={() => refresh(false)} style={{ marginTop: 12 }}>
        {busy ? <Loader2 size={16} className="frog-spin" /> : <RefreshCw size={16} />} Générer le bilan
      </button>
      {error && <div className="frog-error" style={{ marginTop: 10 }}>{error}</div>}
    </section>;
  }

  const signals = review.signals || {};
  const recovery = numberValue(signals.recovery);
  const loadRatio = numberValue(signals.loadRatio);
  const avgRpe = numberValue(signals.avgRpe);
  const feedbackCount = numberValue(signals.feedbackCount) || 0;
  const completion = numberValue(signals.completionRatio);
  const confidence = Math.round((numberValue(review.confidence) || 0) * 100);

  return <section className="frog-card frog-card-soft">
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start" }}>
      <div>
        <div className="frog-kicker">Lot 8 · Bilan hebdomadaire</div>
        <h2 className="frog-card-title" style={{ marginTop: 7 }}>{decisionLabel(review.decision)}</h2>
        <p className="frog-card-text">Semaine du {dateLabel(review.week_start)} au {dateLabel(review.week_end)} · confiance {confidence}%</p>
      </div>
      {review.decision === "maintain" ? <CheckCircle2 size={23} /> : <WandSparkles size={23} />}
    </div>

    <div className="frog-grid" style={{ marginTop: 12 }}>
      <div className="frog-metric"><div className="frog-metric-label"><Gauge size={14} /> Disponibilité</div><div className="frog-metric-value">{review.readiness_score}/100</div></div>
      <div className="frog-metric"><div className="frog-metric-label">Récupération</div><div className="frog-metric-value">{recovery == null ? "—" : `${Math.round(recovery)}%`}</div></div>
      <div className="frog-metric"><div className="frog-metric-label">Ratio charge</div><div className="frog-metric-value">{loadRatio == null ? "—" : loadRatio.toFixed(2)}</div></div>
      <div className="frog-metric"><div className="frog-metric-label">RPE moyen</div><div className="frog-metric-value">{avgRpe == null ? "—" : avgRpe.toFixed(1)}</div></div>
    </div>

    <p className="frog-card-text" style={{ marginTop: 12 }}>{review.summary}</p>
    <p className="frog-card-text"><strong>Conseil Frog :</strong> {review.recommendation}</p>
    <div className="frog-status-line" data-connected={review.decision === "maintain" || review.status === "applied"} style={{ marginTop: 10 }}>
      <ShieldCheck size={16} /> {feedbackCount} feedback(s) récent(s){completion == null ? "" : ` · ${Math.round(completion * 100)}% des séances dues rapprochées`}
    </div>

    {adaptations.length > 0 && <div style={{ display: "grid", gap: 9, marginTop: 14 }}>
      <div className="frog-kicker">Adaptations proposées</div>
      {adaptations.map((adaptation) => {
        const workout = adaptationWorkout(adaptation);
        const afterTitle = String(adaptation.after_state?.title || workout?.title || "Séance adaptée");
        return <div key={adaptation.id} style={{ border: "1px solid var(--frog-border)", borderRadius: 14, padding: 11 }}>
          <strong>{workout?.scheduled_date ? `${dateLabel(workout.scheduled_date)} · ` : ""}{afterTitle}</strong>
          <div className="frog-card-text" style={{ marginTop: 4 }}>{adaptation.reason}{adaptation.reduction_pct ? ` · -${Number(adaptation.reduction_pct)}%` : ""}</div>
          {adaptation.status === "applied" && <div className="frog-status-line" data-connected style={{ marginTop: 7 }}><CheckCircle2 size={14} /> Appliquée</div>}
        </div>;
      })}
    </div>}

    {message && <div className="frog-success" style={{ marginTop: 12 }}>{message}</div>}
    {error && <div className="frog-error" style={{ marginTop: 12 }}>{error}</div>}

    <div style={{ display: "grid", gridTemplateColumns: review.status === "proposed" ? "1fr 1fr" : "1fr", gap: 9, marginTop: 14 }}>
      <button className="frog-button frog-button-secondary" disabled={busy || review.status === "applied"} onClick={() => refresh(false)}>
        {busy ? <Loader2 size={16} className="frog-spin" /> : <RefreshCw size={16} />} Actualiser le bilan
      </button>
      {review.status === "proposed" && <button className="frog-button frog-button-primary" disabled={busy} onClick={applyAdaptations}><WandSparkles size={16} /> Appliquer les adaptations</button>}
    </div>

    <p className="frog-footnote" style={{ marginBottom: 0 }}>Frog ne déplace aucune séance en V1 et ne modifie jamais automatiquement le jour J. Modèle {review.model_version}.</p>
  </section>;
}
