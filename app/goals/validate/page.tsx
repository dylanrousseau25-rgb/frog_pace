"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, HelpCircle, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Goal = {
  id: string;
  event_name: string;
  event_date: string;
  distance_m: number | string;
  accepted_assessment_id: string | null;
};

type Assessment = {
  id: string;
  verdict: "feasible" | "challenging" | "not_recommended" | "insufficient_data";
  score: number;
  confidence: number;
  summary: string;
  created_at: string;
};

function verdictInfo(verdict: Assessment["verdict"]) {
  if (verdict === "feasible") return { label: "Faisable", icon: CheckCircle2 };
  if (verdict === "challenging") return { label: "Ambitieux", icon: AlertTriangle };
  if (verdict === "not_recommended") return { label: "Non recommandé", icon: XCircle };
  return { label: "Données insuffisantes", icon: HelpCircle };
}

export default function ValidateGoalPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      setError("Session expirée.");
      setLoading(false);
      return;
    }

    const { data: goalRow, error: goalError } = await supabase
      .from("goals")
      .select("id,event_name,event_date,distance_m,accepted_assessment_id")
      .eq("user_id", auth.user.id)
      .eq("goal_type", "primary")
      .eq("status", "active")
      .maybeSingle();

    if (goalError) {
      setError(goalError.message);
      setLoading(false);
      return;
    }

    setGoal(goalRow as Goal | null);
    if (goalRow) {
      const { data: assessmentRow, error: assessmentError } = await supabase
        .from("goal_feasibility_assessments")
        .select("id,verdict,score,confidence,summary,created_at")
        .eq("goal_id", goalRow.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (assessmentError) setError(assessmentError.message);
      setAssessment(assessmentRow as Assessment | null);
    } else {
      setAssessment(null);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  async function accept() {
    if (!goal || !assessment) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    const { error: acceptError } = await supabase.rpc("accept_goal_assessment", {
      p_goal_id: goal.id,
      p_assessment_id: assessment.id,
    });
    setSaving(false);
    if (acceptError) {
      setError(acceptError.message);
      return;
    }
    setMessage("Cette version de l’objectif est maintenant la référence officielle du futur plan.");
    await load();
  }

  if (loading) return <main className="frog-centered"><Loader2 className="frog-spin" /> Vérification de l’objectif…</main>;

  if (!goal) return <main>
    <Link href="/goals" className="frog-button frog-button-secondary" style={{ marginBottom: 18 }}><ArrowLeft size={16} /> Retour</Link>
    <section className="frog-card frog-empty">
      <div className="frog-empty-icon">🎯</div>
      <h1 className="frog-card-title">Aucun objectif principal</h1>
      <p className="frog-card-text">Crée d’abord ton objectif dans le Goal Engine.</p>
      <Link href="/goals" className="frog-button frog-button-primary" style={{ marginTop: 16 }}>Créer mon objectif <ArrowRight size={17} /></Link>
    </section>
  </main>;

  const acceptedLatest = Boolean(assessment && goal.accepted_assessment_id === assessment.id);
  const canAccept = assessment?.verdict === "feasible" || assessment?.verdict === "challenging";
  const info = assessment ? verdictInfo(assessment.verdict) : null;
  const Icon = info?.icon || HelpCircle;

  return <main>
    <Link href="/goals" className="frog-button frog-button-secondary" style={{ marginBottom: 18 }}><ArrowLeft size={16} /> Goal Engine</Link>
    <div className="frog-kicker">Validation</div>
    <h1 className="frog-page-title">Figer la référence du plan</h1>
    <p className="frog-page-subtitle">Tu valides une évaluation précise. Si tu modifies ensuite la date, la distance, le sport ou le chrono, Frog demandera une nouvelle validation.</p>

    {message && <div className="frog-success" style={{ marginBottom: 12 }}>{message}</div>}
    {error && <div className="frog-error" style={{ marginBottom: 12 }}>{error}</div>}

    <section className="frog-card">
      <div className="frog-kicker">Objectif principal</div>
      <h2 className="frog-card-title" style={{ marginTop: 7 }}>{goal.event_name}</h2>
      <p className="frog-card-text">{(Number(goal.distance_m) / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km · {new Date(`${goal.event_date}T12:00:00`).toLocaleDateString("fr-FR")}</p>

      {assessment ? <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
        <div className="frog-status-line" data-connected={assessment.verdict === "feasible"} style={{ margin: 0 }}><Icon size={16} /> {info?.label} · {assessment.score}/100</div>
        <p className="frog-card-text" style={{ margin: 0 }}>{assessment.summary}</p>
        <div className="frog-card-text">Confiance de l’analyse : {assessment.confidence}%</div>
      </div> : <p className="frog-card-text">Aucune analyse disponible.</p>}
    </section>

    {acceptedLatest ? <section className="frog-card frog-card-soft">
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}><ShieldCheck size={22} /><h2 className="frog-card-title">Objectif validé</h2></div>
      <p className="frog-card-text">Cette évaluation est la référence officielle pour le futur moteur de planification.</p>
      <Link href="/plan" className="frog-button frog-button-primary" style={{ marginTop: 16 }}>Voir l’état du Plan <ArrowRight size={17} /></Link>
    </section> : canAccept && assessment ? <section className="frog-card frog-card-soft">
      <div className="frog-kicker">Décision</div>
      <h2 className="frog-card-title" style={{ marginTop: 7 }}>Valider cette évaluation ?</h2>
      <p className="frog-card-text">Le Lot 4 utilisera exactement cette version comme point de départ. Une nouvelle analyse ne la remplacera jamais sans ton accord.</p>
      <button className="frog-button frog-button-primary frog-button-wide" style={{ marginTop: 16 }} onClick={accept} disabled={saving}>
        {saving ? <><Loader2 size={17} className="frog-spin" /> Validation…</> : <><ShieldCheck size={17} /> Valider comme référence du plan</>}
      </button>
    </section> : <section className="frog-card frog-empty">
      <div className="frog-empty-icon"><XCircle size={24} /></div>
      <h2 className="frog-card-title">Validation indisponible</h2>
      <p className="frog-card-text">Frog ne permet pas de figer une évaluation « non recommandée » ou « données insuffisantes ». Modifie l’objectif ou enrichis l’historique avant de réanalyser.</p>
      <Link href="/goals" className="frog-button frog-button-primary" style={{ marginTop: 16 }}>Retour au Goal Engine <ArrowRight size={17} /></Link>
    </section>}
  </main>;
}
