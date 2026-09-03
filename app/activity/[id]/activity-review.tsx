"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Link2, Loader2, RefreshCw, Unlink } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type PlannedWorkout = {
  id: string;
  scheduled_date: string;
  title: string;
  sport: string;
  workout_type: string;
  duration_s: number | null;
  distance_m: number | string | null;
};

type Match = {
  id: string;
  planned_workout_id: string;
  status: "suggested" | "confirmed" | "rejected";
  match_method: "auto" | "manual";
  confidence: number | string;
};

type Feedback = {
  perceived_effort: number;
  feeling: "very_easy" | "easy" | "as_expected" | "hard" | "very_hard";
  completed_as_planned: boolean;
  pain_or_discomfort: boolean;
  notes: string | null;
} | null;

type Analysis = {
  adherence_score: number;
  outcome: string;
  summary: string;
  recommendations: unknown;
} | null;

function dateLabel(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
}

function formatDuration(seconds?: number | null) {
  if (!seconds) return null;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h} h${m ? ` ${String(m).padStart(2, "0")}` : ""}`;
}

function formatDistance(value?: number | string | null) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${(n / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km`;
}

function outcomeLabel(outcome: string) {
  if (outcome === "on_track") return "Conforme";
  if (outcome === "easier_than_expected") return "Plus facile que prévu";
  if (outcome === "harder_than_expected") return "Plus difficile que prévu";
  return "Écart au plan";
}

export default function ActivityReview({
  activityId,
  match,
  plannedWorkout,
  candidates,
  feedback,
  analysis,
}: {
  activityId: string;
  match: Match | null;
  plannedWorkout: PlannedWorkout | null;
  candidates: PlannedWorkout[];
  feedback: Feedback;
  analysis: Analysis;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rpe, setRpe] = useState(feedback?.perceived_effort ?? 5);
  const [feeling, setFeeling] = useState<NonNullable<Feedback>["feeling"]>(feedback?.feeling ?? "as_expected");
  const [completed, setCompleted] = useState(feedback?.completed_as_planned ?? true);
  const [discomfort, setDiscomfort] = useState(feedback?.pain_or_discomfort ?? false);
  const [notes, setNotes] = useState(feedback?.notes ?? "");

  async function confirm(plannedWorkoutId: string) {
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc("confirm_workout_match", {
      p_planned_workout_id: plannedWorkoutId,
      p_activity_id: activityId,
    });
    setBusy(false);
    if (rpcError) return setError(rpcError.message);
    router.refresh();
  }

  async function unlink() {
    if (!window.confirm("Dissocier cette activité de la séance prévue ? Le feedback et l’analyse associés seront supprimés.")) return;
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc("remove_workout_match", { p_activity_id: activityId });
    setBusy(false);
    if (rpcError) return setError(rpcError.message);
    router.refresh();
  }

  async function saveFeedback() {
    if (!match || match.status !== "confirmed" || !plannedWorkout) return;
    setBusy(true);
    setError(null);
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      setBusy(false);
      return setError("Session expirée");
    }

    const { error: feedbackError } = await supabase.from("workout_feedback").upsert({
      user_id: auth.user.id,
      match_id: match.id,
      planned_workout_id: plannedWorkout.id,
      activity_id: activityId,
      perceived_effort: rpe,
      feeling,
      completed_as_planned: completed,
      pain_or_discomfort: discomfort,
      notes: notes.trim() || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "match_id" });

    if (feedbackError) {
      setBusy(false);
      return setError(feedbackError.message);
    }

    const { error: analysisError } = await supabase.rpc("analyze_workout_feedback", { p_match_id: match.id });
    setBusy(false);
    if (analysisError) return setError(analysisError.message);
    router.refresh();
  }

  const recommendations = Array.isArray(analysis?.recommendations)
    ? analysis.recommendations.map((value) => String(value))
    : [];

  return <div style={{ display: "grid", gap: 12 }}>
    {error && <div className="frog-error">{error}</div>}

    {!match ? <section className="frog-card">
      <div className="frog-kicker">Rapprochement avec le plan</div>
      <h2 className="frog-card-title" style={{ marginTop: 7 }}>Aucune séance liée automatiquement</h2>
      <p className="frog-card-text">Frog préfère ne rien inventer. Tu peux associer manuellement cette activité à une séance proche si nécessaire.</p>
      {candidates.length > 0 ? <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
        {candidates.map((candidate) => <button key={candidate.id} className="frog-button frog-button-secondary frog-button-wide" disabled={busy} onClick={() => confirm(candidate.id)}>
          <Link2 size={16} /> {dateLabel(candidate.scheduled_date)} · {candidate.title}
        </button>)}
      </div> : <p className="frog-card-text" style={{ marginTop: 12 }}>Aucune séance planifiée proche de cette activité.</p>}
    </section> : plannedWorkout && <section className="frog-card frog-card-soft">
      <div className="frog-kicker">Séance prévue associée</div>
      <h2 className="frog-card-title" style={{ marginTop: 7 }}>{plannedWorkout.title}</h2>
      <p className="frog-card-text">{dateLabel(plannedWorkout.scheduled_date)} · {[formatDuration(plannedWorkout.duration_s), formatDistance(plannedWorkout.distance_m)].filter(Boolean).join(" · ") || "structure définie dans le plan"}</p>
      <div className="frog-status-line" data-connected={match.status === "confirmed"} style={{ marginTop: 10 }}>
        {match.status === "confirmed" ? <><CheckCircle2 size={16} /> Lien confirmé</> : <>Suggestion Frog · confiance {Math.round(Number(match.confidence) * 100)} %</>}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
        {match.status !== "confirmed" && <button className="frog-button frog-button-primary" disabled={busy} onClick={() => confirm(plannedWorkout.id)}>{busy ? <Loader2 size={16} className="frog-spin" /> : <CheckCircle2 size={16} />} Confirmer</button>}
        <button className="frog-button frog-button-secondary" disabled={busy} onClick={unlink}><Unlink size={16} /> Dissocier</button>
      </div>
    </section>}

    {match?.status === "confirmed" && plannedWorkout && <section className="frog-card">
      <div className="frog-kicker">Feedback post-séance</div>
      <h2 className="frog-card-title" style={{ marginTop: 7 }}>Comment s’est passée la séance ?</h2>
      <p className="frog-card-text">Ce feedback complète les données COROS. Il n’adapte pas encore automatiquement le plan.</p>

      <label className="frog-card-text" style={{ display: "grid", gap: 6, marginTop: 14 }}>
        <strong>Effort perçu : {rpe}/10</strong>
        <input type="range" min={1} max={10} value={rpe} onChange={(event) => setRpe(Number(event.target.value))} />
      </label>

      <label className="frog-card-text" style={{ display: "grid", gap: 6, marginTop: 14 }}>
        <strong>Ressenti global</strong>
        <select value={feeling} onChange={(event) => setFeeling(event.target.value as NonNullable<Feedback>["feeling"])} className="frog-input">
          <option value="very_easy">Très facile</option>
          <option value="easy">Facile</option>
          <option value="as_expected">Comme prévu</option>
          <option value="hard">Difficile</option>
          <option value="very_hard">Très difficile</option>
        </select>
      </label>

      <label className="frog-card-text" style={{ display: "flex", gap: 9, alignItems: "center", marginTop: 14 }}>
        <input type="checkbox" checked={completed} onChange={(event) => setCompleted(event.target.checked)} />
        J’ai réalisé la séance globalement comme prévu
      </label>

      <label className="frog-card-text" style={{ display: "flex", gap: 9, alignItems: "center", marginTop: 10 }}>
        <input type="checkbox" checked={discomfort} onChange={(event) => setDiscomfort(event.target.checked)} />
        J’ai ressenti une douleur ou un inconfort inhabituel
      </label>

      <label className="frog-card-text" style={{ display: "grid", gap: 6, marginTop: 14 }}>
        <strong>Commentaire facultatif</strong>
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} className="frog-input" placeholder="Terrain, sensations, météo, raison d’un écart…" />
      </label>

      <button className="frog-button frog-button-primary frog-button-wide" style={{ marginTop: 14 }} disabled={busy} onClick={saveFeedback}>
        {busy ? <><Loader2 size={16} className="frog-spin" /> Analyse…</> : <><RefreshCw size={16} /> {feedback ? "Mettre à jour l’analyse" : "Enregistrer et analyser"}</>}
      </button>
    </section>}

    {analysis && <section className="frog-card frog-card-soft">
      <div className="frog-kicker">Analyse Frog · post-session-v1</div>
      <h2 className="frog-card-title" style={{ marginTop: 7 }}>{outcomeLabel(analysis.outcome)} · {analysis.adherence_score}/100</h2>
      <p className="frog-card-text">{analysis.summary}</p>
      {recommendations.length > 0 && <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
        {recommendations.map((recommendation, index) => <div className="frog-card-text" key={index}>• {recommendation}</div>)}
      </div>}
    </section>}
  </div>;
}
