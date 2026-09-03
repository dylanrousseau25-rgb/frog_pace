import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CheckCircle2, Clock3, Dumbbell, Gauge, Repeat2, Route, Watch } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import CorosWorkoutExportCard from "@/components/coros-workout-export-card";

type Step = Record<string, unknown>;

type Workout = {
  id: string;
  scheduled_date: string;
  sport: string;
  workout_type: string;
  title: string;
  description: string | null;
  duration_s: number | null;
  distance_m: number | string | null;
  intensity: string | null;
  structured_steps: Step[] | null;
  workout_schema_version: string;
  device_export_ready: boolean;
  status: string;
};

function formatDuration(seconds?: number | null) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (value < 3600) return `${Math.round(value / 60)} min`;
  const h = Math.floor(value / 3600);
  const m = Math.round((value % 3600) / 60);
  return `${h} h${m ? ` ${String(m).padStart(2, "0")}` : ""}`;
}

function formatDistance(value?: number | string | null) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return `${(numeric / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km`;
}

function pace(seconds: unknown) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return null;
  const m = Math.floor(value / 60);
  const s = Math.round(value % 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
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
  return intensity || "—";
}

const EXERCISE_VISUALS: Record<string, string> = {
  chair_squat: "🪑",
  reverse_lunge: "🦵",
  calf_raise: "⬆️",
  dead_bug: "↔️",
  side_plank: "▰",
  ankle_rocks: "🦶",
  calf_mobility: "🦵",
  hip_flexor: "🧘",
  thoracic_rotation: "🔄",
  breathing: "🌬️",
};

function exercisePrescription(exercise: Step) {
  if (exercise.reps) return `${exercise.reps} répétitions`;
  if (exercise.reps_each_side) return `${exercise.reps_each_side} / côté`;
  if (exercise.duration_s_each_side) return `${exercise.duration_s_each_side}s / côté`;
  if (exercise.duration_s) return formatDuration(Number(exercise.duration_s));
  return null;
}

function ExerciseCard({ exercise }: { exercise: Step }) {
  const key = String(exercise.exercise || "");
  const prescription = exercisePrescription(exercise);
  const cue = exercise.cue == null ? null : String(exercise.cue);
  return <div style={{ border: "1px solid var(--frog-border)", borderRadius: 16, padding: 12, display: "grid", gridTemplateColumns: "48px 1fr", gap: 12, alignItems: "start" }}>
    <div aria-hidden="true" style={{ width: 48, height: 48, borderRadius: 14, display: "grid", placeItems: "center", background: "var(--frog-surface-soft)", fontSize: 24 }}>{EXERCISE_VISUALS[key] || "●"}</div>
    <div>
      <strong>{String(exercise.name || key || "Exercice")}</strong>
      {prescription && <div className="frog-card-text" style={{ marginTop: 3 }}>{prescription}</div>}
      {cue && <div className="frog-card-text" style={{ marginTop: 6 }}>{cue}</div>}
    </div>
  </div>;
}

function StepCard({ step, index }: { step: Step; index: number }) {
  const kind = String(step.kind || "bloc");
  const label = String(step.label || "");

  if (kind === "circuit") {
    const exercises = Array.isArray(step.exercises) ? step.exercises as Step[] : [];
    return <section className="frog-card">
      <div className="frog-kicker">Bloc {index + 1} · Circuit</div>
      <h2 className="frog-card-title" style={{ marginTop: 7 }}>{label || "Circuit principal"}</h2>
      <p className="frog-card-text">{Number(step.rounds) || 1} tours · récupération {Number(step.rest_between_exercises_s) || 0}s entre exercices · {Number(step.rest_between_rounds_s) || 0}s entre tours.</p>
      <div style={{ display: "grid", gap: 9, marginTop: 12 }}>{exercises.map((exercise, exerciseIndex) => <ExerciseCard key={exerciseIndex} exercise={exercise} />)}</div>
    </section>;
  }

  if (kind === "exercise") {
    return <section className="frog-card">
      <div className="frog-kicker">Mouvement {index + 1}</div>
      <div style={{ marginTop: 8 }}><ExerciseCard exercise={step} /></div>
    </section>;
  }

  if (kind === "repeat") {
    return <section className="frog-card">
      <div className="frog-kicker">Bloc {index + 1} · Répétitions</div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 7 }}><Repeat2 size={20} /><h2 className="frog-card-title">{Number(step.repetitions) || 1} × {formatDuration(Number(step.work_duration_s)) || "bloc"}</h2></div>
      <p className="frog-card-text">Récupération : {formatDuration(Number(step.recovery_duration_s)) || "—"}{pace(step.target_pace_seconds_per_km) ? ` · cible ${pace(step.target_pace_seconds_per_km)}` : ""}</p>
    </section>;
  }

  if (kind === "steady") {
    return <section className="frog-card">
      <div className="frog-kicker">Bloc {index + 1} · Continu</div>
      <h2 className="frog-card-title" style={{ marginTop: 7 }}>{label || "Endurance continue"}</h2>
      <p className="frog-card-text">{formatDuration(Number(step.duration_s)) || formatDistance(step.distance_m as number | string) || "Durée libre"} · intensité facile et contrôlée.</p>
    </section>;
  }

  if (kind === "guidance") {
    return <section className="frog-card frog-card-soft">
      <div className="frog-kicker">Repère Frog</div>
      <h2 className="frog-card-title" style={{ marginTop: 7 }}>{label || "Repère d’intensité"}</h2>
      <p className="frog-card-text">{pace(step.target_pace_seconds_per_km) ? `Allure indicative ≈ ${pace(step.target_pace_seconds_per_km)}. Elle reste un repère, pas une obligation si les sensations ou le terrain diffèrent.` : "Reste dans une intensité confortable et régulière."}</p>
    </section>;
  }

  if (kind === "race") {
    return <section className="frog-card">
      <div className="frog-kicker">Jour J</div>
      <h2 className="frog-card-title" style={{ marginTop: 7 }}>{formatDistance(step.distance_m as number | string) || "Course"}</h2>
      <p className="frog-card-text">{pace(step.target_pace_seconds_per_km) ? `Allure cible moyenne : ${pace(step.target_pace_seconds_per_km)}.` : "Pars contrôlé et suis la stratégie de course."}</p>
    </section>;
  }

  const title = kind === "warmup" ? "Échauffement" : kind === "cooldown" ? "Retour au calme" : kind === "activation" ? "Activation" : kind === "mobility" ? "Mobilité" : label || kind;
  const instructions = step.instructions == null ? null : String(step.instructions);
  return <section className="frog-card">
    <div className="frog-kicker">Bloc {index + 1}</div>
    <h2 className="frog-card-title" style={{ marginTop: 7 }}>{title}</h2>
    <p className="frog-card-text">{formatDuration(Number(step.duration_s)) || ""}{instructions ? `${step.duration_s ? " · " : ""}${instructions}` : ""}</p>
  </section>;
}

export default async function WorkoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const { data } = await supabase
    .from("planned_workouts")
    .select("id,scheduled_date,sport,workout_type,title,description,duration_s,distance_m,intensity,structured_steps,workout_schema_version,device_export_ready,status")
    .eq("id", id)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (!data) notFound();
  const workout = data as Workout;
  const steps = Array.isArray(workout.structured_steps) ? workout.structured_steps : [];
  const meta = [sportLabel(workout.sport), formatDuration(workout.duration_s), formatDistance(workout.distance_m), intensityLabel(workout.intensity)].filter(Boolean).join(" · ");

  return <main>
    <Link href="/plan" className="frog-button frog-button-secondary" style={{ marginBottom: 14 }}><ArrowLeft size={17} /> Retour au plan</Link>

    <div className="frog-kicker">Workout Builder</div>
    <h1 className="frog-page-title">{workout.title}</h1>
    <p className="frog-page-subtitle">{new Date(`${workout.scheduled_date}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>

    <section className="frog-grid" aria-label="Résumé de la séance">
      <div className="frog-metric"><div className="frog-metric-label"><Clock3 size={14} /> Durée</div><div className="frog-metric-value">{formatDuration(workout.duration_s) || "—"}</div></div>
      <div className="frog-metric"><div className="frog-metric-label"><Route size={14} /> Distance</div><div className="frog-metric-value">{formatDistance(workout.distance_m) || "—"}</div></div>
      <div className="frog-metric"><div className="frog-metric-label"><Gauge size={14} /> Intensité</div><div className="frog-metric-value" style={{ fontSize: "1.05rem" }}>{intensityLabel(workout.intensity)}</div></div>
      <div className="frog-metric"><div className="frog-metric-label"><Dumbbell size={14} /> Sport</div><div className="frog-metric-value" style={{ fontSize: "1.05rem" }}>{sportLabel(workout.sport)}</div></div>
    </section>

    <section className="frog-card frog-card-soft" style={{ marginTop: 14 }}>
      <div className="frog-kicker">Consigne générale</div>
      <h2 className="frog-card-title" style={{ marginTop: 7 }}>{meta}</h2>
      {workout.description && <p className="frog-card-text">{workout.description}</p>}
      <div className="frog-status-line" data-connected={workout.device_export_ready} style={{ marginTop: 12 }}>
        {workout.device_export_ready ? <><CheckCircle2 size={16} /> Structure compatible export montre</> : <><Watch size={16} /> Séance guidée dans Frog Pace</>}
      </div>
    </section>

    <CorosWorkoutExportCard workoutId={workout.id} compatible={workout.device_export_ready} />

    <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
      {steps.map((step, index) => <StepCard key={index} step={step} index={index} />)}
    </div>

    <p className="frog-footnote">Format {workout.workout_schema_version}. Frog distingue désormais la compatibilité technique du Workout Builder et la disponibilité réelle de l’écriture chez COROS.</p>
  </main>;
}
