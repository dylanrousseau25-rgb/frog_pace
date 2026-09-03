"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, CalendarDays, CheckCircle2, Loader2, LockKeyhole, RefreshCw, Target, Trash2 } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Goal = {
  id: string;
  event_name: string;
  event_date: string;
  distance_m: number | string;
  target_duration_s: number | null;
  accepted_assessment_id: string | null;
};

type Assessment = {
  id: string;
  verdict: "feasible" | "challenging" | "not_recommended" | "insufficient_data";
  score: number;
  summary: string;
};

type Plan = {
  id: string;
  version: number;
  engine_version: string;
  status: string;
  starts_on: string;
  ends_on: string;
  sessions_per_week: number;
  summary: string;
  assessment_id: string;
};

type PlanWeek = {
  id: string;
  week_index: number;
  starts_on: string;
  ends_on: string;
  phase: "build" | "taper" | "race";
  target_sessions: number;
  load_scale: number | string;
  notes: string | null;
};

type Workout = {
  id: string;
  plan_week_id: string;
  scheduled_date: string;
  sport: string;
  workout_type: string;
  title: string;
  description: string | null;
  duration_s: number | null;
  distance_m: number | string | null;
  intensity: string | null;
  structured_steps: Array<Record<string, unknown>> | null;
  status: string;
};

function verdictLabel(verdict?: string | null) {
  if (verdict === "feasible") return "Faisable";
  if (verdict === "challenging") return "Ambitieux";
  if (verdict === "not_recommended") return "Non recommandé";
  if (verdict === "insufficient_data") return "Données insuffisantes";
  return "À analyser";
}

function phaseLabel(phase: PlanWeek["phase"]) {
  if (phase === "build") return "Construction";
  if (phase === "taper") return "Allègement";
  return "Semaine course";
}

function sportLabel(sport: string) {
  if (sport === "running") return "Course";
  if (sport === "trail") return "Trail";
  if (sport === "road_cycling") return "Vélo route";
  if (sport === "gravel") return "Gravel";
  if (sport === "strength") return "Renforcement";
  if (sport === "mobility") return "Mobilité";
  return sport;
}

function intensityLabel(intensity?: string | null) {
  if (intensity === "recovery") return "Récupération";
  if (intensity === "easy") return "Facile";
  if (intensity === "moderate") return "Modéré";
  if (intensity === "quality") return "Qualité";
  if (intensity === "race") return "Course";
  return "";
}

function dateLabel(value: string, long = false) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("fr-FR", long
    ? { weekday: "long", day: "numeric", month: "long" }
    : { day: "numeric", month: "short" });
}

function formatDuration(seconds?: number | null) {
  if (!seconds) return null;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h} h${m ? ` ${String(m).padStart(2, "0")}` : ""}`;
}

function formatDistance(value?: number | string | null) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return `${(number / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km`;
}

function pace(seconds: unknown) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return null;
  const m = Math.floor(value / 60);
  const s = Math.round(value % 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
}

function stepLabel(step: Record<string, unknown>) {
  const kind = String(step.kind || "bloc");
  if (kind === "warmup") return `Échauffement · ${formatDuration(Number(step.duration_s)) || "—"}`;
  if (kind === "cooldown") return `Retour au calme · ${formatDuration(Number(step.duration_s)) || "—"}`;
  if (kind === "steady") return `Continu · ${formatDuration(Number(step.duration_s)) || formatDistance(step.distance_m as number | string) || "—"} · facile`;
  if (kind === "strength") return `Renforcement · ${formatDuration(Number(step.duration_s)) || "—"}`;
  if (kind === "mobility") return `Mobilité · ${formatDuration(Number(step.duration_s)) || "—"}`;
  if (kind === "repeat") {
    const repetitions = Number(step.repetitions) || 1;
    const work = formatDuration(Number(step.work_duration_s));
    const recovery = formatDuration(Number(step.recovery_duration_s));
    const target = pace(step.target_pace_seconds_per_km);
    return `${repetitions} × ${work || "bloc"}${recovery ? ` · récup ${recovery}` : ""}${target ? ` · ${target}` : ""}`;
  }
  if (kind === "race") return `Jour J · ${formatDistance(step.distance_m as number | string) || "course"}${pace(step.target_pace_seconds_per_km) ? ` · cible ${pace(step.target_pace_seconds_per_km)}` : ""}`;
  if (kind === "guidance") return pace(step.target_pace_seconds_per_km) ? `Repère allure facile ≈ ${pace(step.target_pace_seconds_per_km)}` : "Repère d’intensité facile";
  return kind;
}

export default function PlanPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [weeks, setWeeks] = useState<PlanWeek[]>([]);
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      setLoading(false);
      return;
    }

    const { data: goalRow, error: goalError } = await supabase
      .from("goals")
      .select("id,event_name,event_date,distance_m,target_duration_s,accepted_assessment_id")
      .eq("user_id", auth.user.id)
      .eq("goal_type", "primary")
      .eq("status", "active")
      .maybeSingle();

    if (goalError) {
      setError(goalError.message);
      setLoading(false);
      return;
    }

    const typedGoal = goalRow as Goal | null;
    setGoal(typedGoal);

    let latest: Assessment | null = null;
    if (typedGoal) {
      const { data: assessmentRow } = await supabase
        .from("goal_feasibility_assessments")
        .select("id,verdict,score,summary")
        .eq("goal_id", typedGoal.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      latest = assessmentRow as Assessment | null;
    }
    setAssessment(latest);

    const { data: planRow, error: planError } = await supabase
      .from("training_plans")
      .select("id,version,engine_version,status,starts_on,ends_on,sessions_per_week,summary,assessment_id")
      .eq("user_id", auth.user.id)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (planError) {
      setError(planError.message);
      setLoading(false);
      return;
    }

    const typedPlan = planRow as Plan | null;
    setPlan(typedPlan);

    if (typedPlan) {
      const [{ data: weekRows }, { data: workoutRows }] = await Promise.all([
        supabase.from("training_plan_weeks").select("id,week_index,starts_on,ends_on,phase,target_sessions,load_scale,notes").eq("plan_id", typedPlan.id).order("week_index"),
        supabase.from("planned_workouts").select("id,plan_week_id,scheduled_date,sport,workout_type,title,description,duration_s,distance_m,intensity,structured_steps,status").eq("plan_id", typedPlan.id).order("scheduled_date"),
      ]);
      setWeeks((weekRows || []) as PlanWeek[]);
      setWorkouts((workoutRows || []) as Workout[]);
    } else {
      setWeeks([]);
      setWorkouts([]);
    }

    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  async function generate(force: boolean) {
    setBusy(true);
    setError(null);
    setMessage(null);
    const { error: rpcError } = await supabase.rpc("generate_training_plan", { p_force: force });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setMessage(force ? "Une nouvelle version du plan a été générée." : "Ton plan a été généré.");
    await load();
  }

  async function deletePlan() {
    if (!plan) return;
    if (!window.confirm("Supprimer ce plan et toutes ses séances ? Ton objectif et tes activités COROS seront conservés.")) return;
    setBusy(true);
    setError(null);
    const { error: deleteError } = await supabase.from("training_plans").delete().eq("id", plan.id);
    setBusy(false);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    setMessage("Plan supprimé. Ton objectif et ton historique sont conservés.");
    await load();
  }

  if (loading) return <main className="frog-centered"><Loader2 className="frog-spin" /> Chargement du plan…</main>;

  const acceptedLatest = Boolean(goal?.accepted_assessment_id && assessment?.id === goal.accepted_assessment_id);
  const workoutCount = workouts.length;

  return <main>
    <div className="frog-kicker">Lot 4 · Plan</div>
    <h1 className="frog-page-title">Ta préparation</h1>
    <p className="frog-page-subtitle">Un plan versionné, construit depuis ton objectif validé et les contraintes de ton profil. Les adaptations automatiques après séance arriveront au Lot 8.</p>

    {message && <div className="frog-success" style={{ marginBottom: 12 }}>{message}</div>}
    {error && <div className="frog-error" style={{ marginBottom: 12 }}>{error}</div>}

    {!goal ? <section className="frog-card frog-empty">
      <div className="frog-empty-icon"><Target size={24} /></div>
      <h2 className="frog-card-title">Commence par ton objectif</h2>
      <p className="frog-card-text">Frog doit connaître et analyser ton jour J avant de construire le calendrier.</p>
      <Link href="/goals" className="frog-button frog-button-primary" style={{ marginTop: 16 }}>Créer mon objectif <ArrowRight size={18} /></Link>
    </section> : <>
      <section className="frog-card">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div className="frog-kicker">Objectif de référence</div>
            <h2 className="frog-card-title" style={{ marginTop: 7 }}>{goal.event_name}</h2>
            <p className="frog-card-text">{formatDistance(goal.distance_m)} · {new Date(`${goal.event_date}T12:00:00`).toLocaleDateString("fr-FR")}</p>
          </div>
          <CalendarDays size={22} />
        </div>
        <div className="frog-status-line" data-connected={assessment?.verdict === "feasible"} style={{ marginTop: 14 }}>
          {assessment ? `${verdictLabel(assessment.verdict)} · ${assessment.score}/100` : "Analyse manquante"}{acceptedLatest ? " · validé" : " · à valider"}
        </div>
        {assessment?.summary && <p className="frog-card-text">{assessment.summary}</p>}
        <Link href="/goals" className="frog-button frog-button-secondary" style={{ marginTop: 14 }}>Gérer l’objectif <ArrowRight size={17} /></Link>
      </section>

      {!acceptedLatest ? <section className="frog-card frog-empty">
        <div className="frog-empty-icon"><LockKeyhole size={24} /></div>
        <h2 className="frog-card-title">Plan verrouillé</h2>
        <p className="frog-card-text">La dernière analyse de faisabilité doit être explicitement validée avant toute génération.</p>
        <Link href="/goals/validate" className="frog-button frog-button-primary" style={{ marginTop: 16 }}>Valider la dernière analyse <ArrowRight size={18} /></Link>
      </section> : !plan ? <section className="frog-card frog-card-soft">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}><CheckCircle2 size={22} /><h2 className="frog-card-title">Prêt à générer</h2></div>
        <p className="frog-card-text">Frog va construire les semaines jusqu’au jour J en respectant les jours disponibles, le jour de sortie longue et les compléments prévus dans ton profil.</p>
        <button className="frog-button frog-button-primary frog-button-wide" style={{ marginTop: 16 }} disabled={busy} onClick={() => generate(false)}>
          {busy ? <><Loader2 size={17} className="frog-spin" /> Génération…</> : <>Générer mon plan <ArrowRight size={17} /></>}
        </button>
      </section> : <>
        <section className="frog-card frog-card-soft">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div className="frog-kicker">Plan actif · version {plan.version}</div>
              <h2 className="frog-card-title" style={{ marginTop: 7 }}>{workoutCount} séances planifiées</h2>
              <p className="frog-card-text">Du {dateLabel(plan.starts_on)} au {dateLabel(plan.ends_on)} · cible {plan.sessions_per_week} séances/semaine · {plan.engine_version}</p>
            </div>
            <CheckCircle2 size={22} />
          </div>
          <p className="frog-card-text">{plan.summary}</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 14 }}>
            <button className="frog-button frog-button-secondary" disabled={busy} onClick={() => generate(true)}>
              {busy ? <Loader2 size={16} className="frog-spin" /> : <RefreshCw size={16} />} Regénérer
            </button>
            <button className="frog-button frog-button-secondary" disabled={busy} onClick={deletePlan}><Trash2 size={16} /> Supprimer</button>
          </div>
        </section>

        {weeks.map((week) => {
          const weekWorkouts = workouts.filter((workout) => workout.plan_week_id === week.id);
          return <section className="frog-card" key={week.id}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start" }}>
              <div>
                <div className="frog-kicker">Semaine {week.week_index + 1} · {phaseLabel(week.phase)}</div>
                <h2 className="frog-card-title" style={{ marginTop: 6 }}>{dateLabel(week.starts_on)} → {dateLabel(week.ends_on)}</h2>
              </div>
              <div style={{ textAlign: "right" }}>
                <strong>{week.target_sessions} séances</strong>
                <div className="frog-card-text">charge {Math.round(Number(week.load_scale) * 100)}%</div>
              </div>
            </div>
            {week.notes && <p className="frog-card-text">{week.notes}</p>}

            <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
              {weekWorkouts.map((workout) => {
                const meta = [sportLabel(workout.sport), formatDuration(workout.duration_s), formatDistance(workout.distance_m), intensityLabel(workout.intensity)].filter(Boolean).join(" · ");
                const steps = Array.isArray(workout.structured_steps) ? workout.structured_steps : [];
                return <article key={workout.id} style={{ border: "1px solid var(--frog-border)", borderRadius: 16, padding: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <div>
                      <div className="frog-kicker">{dateLabel(workout.scheduled_date, true)}</div>
                      <h3 className="frog-card-title" style={{ marginTop: 5, fontSize: "1rem" }}>{workout.title}</h3>
                    </div>
                    {workout.workout_type === "race" && <Target size={20} />}
                  </div>
                  <div className="frog-card-text" style={{ marginTop: 5 }}>{meta}</div>
                  {workout.description && <p className="frog-card-text" style={{ marginBottom: 0 }}>{workout.description}</p>}
                  {steps.length > 0 && <details style={{ marginTop: 10 }}>
                    <summary className="frog-card-text" style={{ cursor: "pointer", fontWeight: 700 }}>Voir la structure de la séance</summary>
                    <div style={{ display: "grid", gap: 5, marginTop: 8 }}>
                      {steps.map((step, index) => <div key={index} className="frog-card-text">{index + 1}. {stepLabel(step)}</div>)}
                    </div>
                  </details>}
                </article>;
              })}
            </div>
          </section>;
        })}
      </>}
    </>}

    <p className="frog-footnote">Le Lot 4 crée la structure initiale. Le détail visuel des exercices et l’export montre arrivent dans les Lots 5 et 6 ; l’adaptation automatique selon les séances réalisées arrive au Lot 8.</p>
  </main>;
}
