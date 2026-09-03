"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarDays, CheckCircle2, Gauge, HelpCircle, Loader2, Pencil, Plus, RefreshCw, Target, Trash2, XCircle } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Goal = {
  id: string;
  parent_goal_id: string | null;
  goal_type: "primary" | "secondary";
  sport: "running" | "trail" | "road_cycling" | "gravel";
  event_name: string;
  event_date: string;
  distance_m: number | string;
  target_duration_s: number | null;
  priority: number;
  status: string;
};

type Reason = { tone?: string; code?: string; text?: string };
type Assessment = {
  id: string;
  goal_id: string;
  verdict: "feasible" | "challenging" | "not_recommended" | "insufficient_data";
  score: number;
  confidence: number;
  summary: string;
  reasons: Reason[] | null;
  metrics: Record<string, number | string | null> | null;
  model_version: string;
  created_at: string;
};

const SPORTS = [
  ["running", "Course route"],
  ["trail", "Trail"],
  ["road_cycling", "Vélo route"],
  ["gravel", "Gravel"],
] as const;

function sportLabel(value: string) {
  return SPORTS.find(([key]) => key === value)?.[1] || value;
}

function parseTargetTime(value: string) {
  const text = value.trim();
  if (!text) return null;
  const parts = text.split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part) || part < 0)) return NaN;
  if (parts.length === 2) return Math.round(parts[0] * 3600 + parts[1] * 60);
  if (parts.length === 3) return Math.round(parts[0] * 3600 + parts[1] * 60 + parts[2]);
  return NaN;
}

function formatDuration(seconds: number | null) {
  if (!seconds) return "Sans chrono cible";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function inputDuration(seconds: number | null) {
  if (!seconds) return "";
  return formatDuration(seconds);
}

function formatDistance(value: number | string) {
  return `${(Number(value) / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} km`;
}

function formatDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

function verdictInfo(verdict: Assessment["verdict"]) {
  if (verdict === "feasible") return { label: "Faisable", icon: CheckCircle2 };
  if (verdict === "challenging") return { label: "Ambitieux", icon: AlertTriangle };
  if (verdict === "not_recommended") return { label: "Non recommandé", icon: XCircle };
  return { label: "Données insuffisantes", icon: HelpCircle };
}

function km(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";
  return `${(numeric / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km`;
}

function AssessmentPanel({ assessment }: { assessment?: Assessment }) {
  if (!assessment) {
    return <div className="frog-card-text" style={{ marginTop: 12 }}>Aucune analyse enregistrée pour cet objectif.</div>;
  }
  const info = verdictInfo(assessment.verdict);
  const Icon = info.icon;
  const metrics = assessment.metrics || {};
  const reasons = Array.isArray(assessment.reasons) ? assessment.reasons : [];

  return <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
      <div className="frog-status-line" data-connected={assessment.verdict === "feasible"} style={{ margin: 0 }}>
        <Icon size={16} /> {info.label}
      </div>
      <strong>{assessment.score}/100</strong>
    </div>
    <p className="frog-card-text" style={{ margin: 0 }}>{assessment.summary}</p>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
      <div style={{ border: "1px solid var(--frog-border)", borderRadius: 14, padding: 10 }}>
        <strong>{String(metrics.days_to_goal ?? "—")}</strong>
        <div className="frog-card-text">jours restants</div>
      </div>
      <div style={{ border: "1px solid var(--frog-border)", borderRadius: 14, padding: 10 }}>
        <strong>{String(metrics.frequency_per_week_12w ?? "—")}</strong>
        <div className="frog-card-text">séance(s) / sem.</div>
      </div>
      <div style={{ border: "1px solid var(--frog-border)", borderRadius: 14, padding: 10 }}>
        <strong>{km(metrics.longest_recent_distance_m)}</strong>
        <div className="frog-card-text">plus longue récente</div>
      </div>
      <div style={{ border: "1px solid var(--frog-border)", borderRadius: 14, padding: 10 }}>
        <strong>{km(metrics.weekly_distance_m_4w)}</strong>
        <div className="frog-card-text">moyenne / semaine</div>
      </div>
    </div>
    <div>
      <div className="frog-kicker">Pourquoi</div>
      <div style={{ display: "grid", gap: 7, marginTop: 8 }}>
        {reasons.map((reason, index) => <div key={`${reason.code || "reason"}-${index}`} className="frog-card-text" style={{ margin: 0 }}>
          {reason.tone === "positive" ? "✓" : reason.tone === "warning" ? "!" : "•"} {reason.text || "Signal pris en compte"}
        </div>)}
      </div>
    </div>
    <div className="frog-card-text" style={{ margin: 0 }}>Confiance : {assessment.confidence}% · {assessment.model_version}</div>
  </div>;
}

export default function GoalsPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [assessments, setAssessments] = useState<Record<string, Assessment>>({});
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [goalType, setGoalType] = useState<"primary" | "secondary">("primary");
  const [sport, setSport] = useState<Goal["sport"]>("running");
  const [eventName, setEventName] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [distanceKm, setDistanceKm] = useState(20);
  const [targetTime, setTargetTime] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const activePrimary = goals.find((goal) => goal.goal_type === "primary" && goal.status === "active") || null;
  const secondaryGoals = goals.filter((goal) => goal.goal_type === "secondary" && goal.status === "active");
  const minDate = new Date().toISOString().slice(0, 10);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      setLoading(false);
      return;
    }

    const [{ data: goalRows, error: goalError }, { data: profile }] = await Promise.all([
      supabase.from("goals").select("id,parent_goal_id,goal_type,sport,event_name,event_date,distance_m,target_duration_s,priority,status").eq("user_id", auth.user.id).eq("status", "active").order("event_date", { ascending: true }),
      supabase.from("athlete_profiles").select("primary_sports").eq("user_id", auth.user.id).maybeSingle(),
    ]);

    if (goalError) {
      setError(goalError.message);
      setLoading(false);
      return;
    }

    const loadedGoals = (goalRows || []) as Goal[];
    setGoals(loadedGoals);
    if (!loadedGoals.length && Array.isArray(profile?.primary_sports)) {
      const preferred = profile.primary_sports.find((item: string) => SPORTS.some(([key]) => key === item));
      if (preferred) setSport(preferred as Goal["sport"]);
    }

    const ids = loadedGoals.map((goal) => goal.id);
    if (ids.length) {
      const { data: assessmentRows } = await supabase
        .from("goal_feasibility_assessments")
        .select("id,goal_id,verdict,score,confidence,summary,reasons,metrics,model_version,created_at")
        .in("goal_id", ids)
        .order("created_at", { ascending: false });
      const latest: Record<string, Assessment> = {};
      for (const row of (assessmentRows || []) as Assessment[]) {
        if (!latest[row.goal_id]) latest[row.goal_id] = row;
      }
      setAssessments(latest);
    } else {
      setAssessments({});
    }

    if (!loadedGoals.some((goal) => goal.goal_type === "primary")) setShowForm(true);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  function resetForm() {
    setEditingId(null);
    setEventName("");
    setEventDate("");
    setDistanceKm(20);
    setTargetTime("");
    setError(null);
  }

  function startPrimary() {
    setGoalType("primary");
    resetForm();
    setShowForm(true);
  }

  function startSecondary() {
    setGoalType("secondary");
    resetForm();
    if (activePrimary) setSport(activePrimary.sport);
    setShowForm(true);
  }

  function editGoal(goal: Goal) {
    setEditingId(goal.id);
    setGoalType(goal.goal_type);
    setSport(goal.sport);
    setEventName(goal.event_name);
    setEventDate(goal.event_date);
    setDistanceKm(Number(goal.distance_m) / 1000);
    setTargetTime(inputDuration(goal.target_duration_s));
    setError(null);
    setMessage(null);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function assess(goalId: string) {
    setAnalyzingId(goalId);
    setError(null);
    const { error: rpcError } = await supabase.rpc("assess_goal_feasibility", { p_goal_id: goalId });
    setAnalyzingId(null);
    if (rpcError) {
      setError(rpcError.message);
      return false;
    }
    await load();
    return true;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    if (!eventName.trim()) return setError("Donne un nom à l’objectif.");
    if (!eventDate) return setError("Choisis la date de l’objectif.");
    if (eventDate < minDate) return setError("La date de l’objectif doit être aujourd’hui ou dans le futur.");
    if (!Number.isFinite(distanceKm) || distanceKm <= 0) return setError("Indique une distance valide.");
    const duration = parseTargetTime(targetTime);
    if (Number.isNaN(duration)) return setError("Utilise un chrono au format H:MM ou H:MM:SS.");
    if (goalType === "secondary" && !activePrimary) return setError("Crée d’abord ton objectif principal.");
    if (goalType === "primary" && activePrimary && !editingId) return setError("Un objectif principal est déjà actif. Modifie-le plutôt que d’en créer un second.");

    setSaving(true);
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      setSaving(false);
      return setError("Session expirée.");
    }

    const payload = {
      user_id: auth.user.id,
      parent_goal_id: goalType === "secondary" ? activePrimary?.id || null : null,
      goal_type: goalType,
      sport,
      event_name: eventName.trim(),
      event_date: eventDate,
      distance_m: Math.round(distanceKm * 1000),
      target_duration_s: duration,
      priority: goalType === "primary" ? 5 : 3,
      status: "active",
    };

    let goalId = editingId;
    if (editingId) {
      const { error: updateError } = await supabase.from("goals").update(payload).eq("id", editingId).eq("user_id", auth.user.id);
      if (updateError) {
        setSaving(false);
        return setError(updateError.message);
      }
    } else {
      const { data, error: insertError } = await supabase.from("goals").insert(payload).select("id").single();
      if (insertError || !data) {
        setSaving(false);
        return setError(insertError?.message || "Impossible de créer l’objectif.");
      }
      goalId = data.id;
    }

    if (goalId) {
      const { error: rpcError } = await supabase.rpc("assess_goal_feasibility", { p_goal_id: goalId });
      if (rpcError) {
        setSaving(false);
        await load();
        return setError(`Objectif enregistré, mais analyse impossible : ${rpcError.message}`);
      }
    }

    setSaving(false);
    resetForm();
    setShowForm(false);
    setMessage(goalType === "primary" ? "Objectif principal enregistré et analysé." : "Objectif intermédiaire enregistré et analysé.");
    await load();
  }

  async function deleteSecondary(goal: Goal) {
    if (goal.goal_type !== "secondary") return;
    if (!window.confirm(`Supprimer l’objectif intermédiaire « ${goal.event_name} » ?`)) return;
    const { error: deleteError } = await supabase.from("goals").delete().eq("id", goal.id);
    if (deleteError) return setError(deleteError.message);
    await load();
  }

  if (loading) return <main className="frog-centered"><Loader2 className="frog-spin" /> Chargement du Goal Engine…</main>;

  return <main>
    <div className="frog-kicker">Lot 3 · Goal Engine</div>
    <h1 className="frog-page-title">Tes objectifs</h1>
    <p className="frog-page-subtitle">Frog enregistre ton objectif, confronte sa distance et son calendrier à ton historique réel, puis explique son verdict avant de générer le moindre plan.</p>

    {message && <div className="frog-success" style={{ marginBottom: 12 }}>{message}</div>}
    {error && <div className="frog-error" style={{ marginBottom: 12 }}>{error}</div>}

    {showForm && <form onSubmit={submit} className="frog-stack" style={{ marginBottom: 14 }}>
      <section className="frog-card">
        <div className="frog-kicker">{editingId ? "Modifier" : goalType === "primary" ? "Objectif principal" : "Objectif intermédiaire"}</div>
        <h2 className="frog-card-title" style={{ marginTop: 8 }}>{editingId ? "Mettre à jour l’objectif" : goalType === "primary" ? "Quel est ton jour J ?" : "Ajouter une course de préparation"}</h2>

        {!editingId && activePrimary && <div className="frog-chip-grid" style={{ marginTop: 14 }}>
          <button type="button" className="frog-chip" data-active={goalType === "secondary"} onClick={() => setGoalType("secondary")}>Intermédiaire</button>
        </div>}

        <div className="frog-field" style={{ marginTop: 14 }}>
          <label htmlFor="goal-name">Nom de l’événement</label>
          <input id="goal-name" className="frog-input" value={eventName} onChange={(e) => setEventName(e.target.value)} placeholder="Ex. 20 km de…" maxLength={140} />
        </div>

        <div className="frog-field" style={{ marginTop: 14 }}>
          <label htmlFor="goal-sport">Sport</label>
          <select id="goal-sport" className="frog-input" value={sport} onChange={(e) => setSport(e.target.value as Goal["sport"])}>
            {SPORTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>

        <div className="frog-form-grid" style={{ marginTop: 14 }}>
          <div className="frog-field">
            <label htmlFor="goal-date">Date</label>
            <input id="goal-date" className="frog-input" type="date" min={minDate} value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
          </div>
          <div className="frog-field">
            <label htmlFor="goal-distance">Distance (km)</label>
            <input id="goal-distance" className="frog-input" type="number" min="0.1" step="0.1" value={distanceKm} onChange={(e) => setDistanceKm(Number(e.target.value))} />
          </div>
        </div>

        <div className="frog-field" style={{ marginTop: 14 }}>
          <label htmlFor="goal-time">Chrono cible <small style={{ color: "var(--frog-muted)" }}>(facultatif)</small></label>
          <input id="goal-time" className="frog-input" value={targetTime} onChange={(e) => setTargetTime(e.target.value)} placeholder="Ex. 1:59:59" inputMode="numeric" />
          <small className="frog-card-text">Format H:MM ou H:MM:SS. Pour trail/vélo, Frog conserve le chrono mais reste prudent sans profil de parcours comparable.</small>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 16 }}>
          <button type="button" className="frog-button frog-button-secondary" onClick={() => { resetForm(); setShowForm(false); }}>Annuler</button>
          <button className="frog-button frog-button-primary" disabled={saving}>
            {saving ? <><Loader2 size={17} className="frog-spin" /> Analyse…</> : <><Target size={17} /> Enregistrer & analyser</>}
          </button>
        </div>
      </section>
    </form>}

    {!activePrimary ? <section className="frog-card frog-empty">
      <div className="frog-empty-icon"><Target size={24} /></div>
      <h2 className="frog-card-title">Aucun objectif principal</h2>
      <p className="frog-card-text">Crée ton jour J pour que Frog puisse évaluer la faisabilité avant le Lot 4.</p>
      {!showForm && <button className="frog-button frog-button-primary" style={{ marginTop: 16 }} onClick={startPrimary}><Plus size={18} /> Créer mon objectif</button>}
    </section> : <>
      <section className="frog-card frog-card-soft">
        <div className="frog-kicker">Objectif principal</div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 8 }}>
          <div>
            <h2 className="frog-card-title">{activePrimary.event_name}</h2>
            <p className="frog-card-text">{sportLabel(activePrimary.sport)} · {formatDistance(activePrimary.distance_m)} · {formatDate(activePrimary.event_date)} · {formatDuration(activePrimary.target_duration_s)}</p>
          </div>
          <Target size={22} />
        </div>
        <AssessmentPanel assessment={assessments[activePrimary.id]} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 16 }}>
          <button className="frog-button frog-button-secondary" onClick={() => editGoal(activePrimary)}><Pencil size={17} /> Modifier</button>
          <button className="frog-button frog-button-secondary" disabled={analyzingId === activePrimary.id} onClick={() => assess(activePrimary.id)}>
            {analyzingId === activePrimary.id ? <Loader2 size={17} className="frog-spin" /> : <RefreshCw size={17} />} Réanalyser
          </button>
        </div>
      </section>

      <section className="frog-card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div className="frog-kicker">Préparation</div>
            <h2 className="frog-card-title" style={{ marginTop: 6 }}>Objectifs intermédiaires</h2>
          </div>
          <CalendarDays size={22} />
        </div>
        <p className="frog-card-text">Courses ou événements secondaires que le futur plan devra absorber sans déplacer librement les séances.</p>
        <button className="frog-button frog-button-secondary frog-button-wide" style={{ marginTop: 14 }} onClick={startSecondary}><Plus size={17} /> Ajouter un intermédiaire</button>
      </section>

      {secondaryGoals.map((goal) => <section key={goal.id} className="frog-card">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div className="frog-kicker">Intermédiaire</div>
            <h2 className="frog-card-title" style={{ marginTop: 6 }}>{goal.event_name}</h2>
            <p className="frog-card-text">{sportLabel(goal.sport)} · {formatDistance(goal.distance_m)} · {formatDate(goal.event_date)} · {formatDuration(goal.target_duration_s)}</p>
          </div>
          <Gauge size={22} />
        </div>
        <AssessmentPanel assessment={assessments[goal.id]} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 16 }}>
          <button className="frog-button frog-button-secondary" onClick={() => editGoal(goal)}><Pencil size={16} /> Modifier</button>
          <button className="frog-button frog-button-secondary" disabled={analyzingId === goal.id} onClick={() => assess(goal.id)}>{analyzingId === goal.id ? <Loader2 size={16} className="frog-spin" /> : <RefreshCw size={16} />} Analyser</button>
          <button className="frog-button frog-button-secondary" onClick={() => deleteSecondary(goal)}><Trash2 size={16} /> Suppr.</button>
        </div>
      </section>)}
    </>}

    <p className="frog-footnote">Chaque réanalyse crée une nouvelle évaluation versionnée. Frog ne remplace jamais silencieusement une ancienne décision.</p>
  </main>;
}
