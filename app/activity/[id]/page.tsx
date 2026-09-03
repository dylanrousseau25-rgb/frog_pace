import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Gauge, HeartPulse, Mountain, Route, Timer } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import ActivityReview from "./activity-review";

type Activity = {
  id: string;
  sport: string | null;
  sport_type: number | null;
  started_at: string | null;
  distance_m: number | string | null;
  duration_s: number | null;
  pace_seconds_per_km: number | string | null;
  avg_speed_kmh: number | string | null;
  avg_hr: number | null;
  elevation_gain_m: number | string | null;
  training_load: number | string | null;
};

function formatDuration(seconds?: number | null) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return "—";
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  const s = Math.round(value % 60);
  return h ? `${h} h ${String(m).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

function formatDistance(value?: number | string | null) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? `${(n / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} km` : "—";
}

function pace(value?: number | string | null) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const m = Math.floor(n / 60);
  const s = Math.round(n % 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
}

function isCycling(type: number | null) {
  return type != null && type >= 200 && type < 300;
}

function sportCompatible(sport: string, type: number | null) {
  if (type == null) return false;
  if (sport === "running") return [100, 101, 103].includes(type);
  if (sport === "trail") return [102, 104, 105].includes(type);
  if (sport === "road_cycling") return [200, 201, 202, 204, 205, 299].includes(type);
  if (sport === "gravel") return type === 203;
  if (sport === "strength") return [400, 402, 9901].includes(type);
  if (sport === "mobility") return [904, 905].includes(type);
  return false;
}

export default async function ActivityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const { data: activityRow } = await supabase
    .from("activities")
    .select("id,sport,sport_type,started_at,distance_m,duration_s,pace_seconds_per_km,avg_speed_kmh,avg_hr,elevation_gain_m,training_load")
    .eq("id", id)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (!activityRow) notFound();
  const activity = activityRow as Activity;

  const { data: matchRow } = await supabase
    .from("workout_matches")
    .select("id,planned_workout_id,status,match_method,confidence")
    .eq("activity_id", activity.id)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  let plannedWorkout: any = null;
  let feedback: any = null;
  let analysis: any = null;
  if (matchRow) {
    const [{ data: planned }, { data: feedbackRow }, { data: analysisRow }] = await Promise.all([
      supabase.from("planned_workouts").select("id,scheduled_date,title,sport,workout_type,duration_s,distance_m").eq("id", matchRow.planned_workout_id).eq("user_id", auth.user.id).maybeSingle(),
      supabase.from("workout_feedback").select("perceived_effort,feeling,completed_as_planned,pain_or_discomfort,notes").eq("match_id", matchRow.id).eq("user_id", auth.user.id).maybeSingle(),
      supabase.from("workout_analyses").select("adherence_score,outcome,summary,recommendations").eq("match_id", matchRow.id).eq("user_id", auth.user.id).maybeSingle(),
    ]);
    plannedWorkout = planned;
    feedback = feedbackRow;
    analysis = analysisRow;
  }

  const { data: activePlan } = await supabase
    .from("training_plans")
    .select("id")
    .eq("user_id", auth.user.id)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let candidates: any[] = [];
  if (!matchRow && activePlan && activity.started_at) {
    const activityDate = new Date(activity.started_at);
    const start = new Date(activityDate);
    const end = new Date(activityDate);
    start.setUTCDate(start.getUTCDate() - 2);
    end.setUTCDate(end.getUTCDate() + 2);
    const { data: rows } = await supabase
      .from("planned_workouts")
      .select("id,scheduled_date,title,sport,workout_type,duration_s,distance_m")
      .eq("plan_id", activePlan.id)
      .eq("user_id", auth.user.id)
      .gte("scheduled_date", start.toISOString().slice(0, 10))
      .lte("scheduled_date", end.toISOString().slice(0, 10))
      .order("scheduled_date");
    candidates = (rows || []).filter((row) => sportCompatible(row.sport, activity.sport_type));
  }

  const speed = Number(activity.avg_speed_kmh);
  const paceValue = pace(activity.pace_seconds_per_km);
  const startedLabel = activity.started_at
    ? new Date(activity.started_at).toLocaleString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "Date indisponible";

  return <main>
    <Link href="/activity" className="frog-button frog-button-secondary" style={{ marginBottom: 14 }}><ArrowLeft size={17} /> Retour aux activités</Link>
    <div className="frog-kicker">Lot 7 · Activité réalisée</div>
    <h1 className="frog-page-title">{activity.sport || "Activité COROS"}</h1>
    <p className="frog-page-subtitle">{startedLabel}</p>

    <section className="frog-grid" aria-label="Données réalisées">
      <div className="frog-metric"><div className="frog-metric-label"><Route size={14} /> Distance</div><div className="frog-metric-value">{formatDistance(activity.distance_m)}</div></div>
      <div className="frog-metric"><div className="frog-metric-label"><Timer size={14} /> Durée</div><div className="frog-metric-value">{formatDuration(activity.duration_s)}</div></div>
      <div className="frog-metric"><div className="frog-metric-label"><Gauge size={14} /> {isCycling(activity.sport_type) ? "Vitesse" : "Allure"}</div><div className="frog-metric-value" style={{ fontSize: "1.05rem" }}>{isCycling(activity.sport_type) && Number.isFinite(speed) ? `${speed.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km/h` : paceValue || "—"}</div></div>
      <div className="frog-metric"><div className="frog-metric-label"><HeartPulse size={14} /> FC moyenne</div><div className="frog-metric-value">{activity.avg_hr == null ? "—" : `${activity.avg_hr}`}</div></div>
    </section>

    <section className="frog-card" style={{ marginTop: 12 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <span className="frog-card-text" style={{ display: "inline-flex", gap: 5, alignItems: "center" }}><Mountain size={15} /> D+ {activity.elevation_gain_m == null ? "—" : `${Math.round(Number(activity.elevation_gain_m))} m`}</span>
        <span className="frog-card-text">Charge COROS {activity.training_load == null ? "—" : Math.round(Number(activity.training_load))}</span>
      </div>
    </section>

    <div style={{ marginTop: 12 }}>
      <ActivityReview
        activityId={activity.id}
        match={matchRow as any}
        plannedWorkout={plannedWorkout}
        candidates={candidates}
        feedback={feedback}
        analysis={analysis}
      />
    </div>

    <p className="frog-footnote">Le Lot 7 analyse la séance terminée et ton ressenti. Il ne modifie pas encore les séances suivantes : cette décision appartient au Lot 8.</p>
  </main>;
}
