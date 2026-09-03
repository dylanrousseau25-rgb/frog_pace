import Link from "next/link";
import { Activity as ActivityIcon, ArrowRight, Bike, CheckCircle2, Footprints, Mountain, Timer } from "lucide-react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type ActivityRow = {
  id: string;
  sport: string | null;
  sport_type: number | null;
  started_at: string | null;
  distance_m: number | null;
  duration_s: number | null;
  pace_seconds_per_km: number | null;
  avg_speed_kmh: number | null;
  raw_provider_data: Record<string, unknown> | null;
};

type MatchRow = { id: string; activity_id: string; status: string };

function numeric(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const match = value.replace(",", ".").match(/\d+(?:\.\d+)?/);
    if (match) return Number(match[0]);
  }
  return null;
}

function formatDistance(activity: ActivityRow) {
  if (activity.distance_m != null) return `${(Number(activity.distance_m) / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} km`;
  const raw = activity.raw_provider_data || {};
  const value = raw.distanceKm ?? raw.distance ?? raw.totalDistance;
  const number = numeric(value);
  return number == null ? "—" : `${number.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} km`;
}

function formatDuration(activity: ActivityRow) {
  const seconds = activity.duration_s == null ? null : Number(activity.duration_s);
  if (seconds != null && seconds > 0) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h ? `${h} h ${String(m).padStart(2, "0")}` : `${m} min`;
  }
  const raw = activity.raw_provider_data || {};
  const value = raw.workoutTime ?? raw.duration ?? raw.durationMinutes;
  return value == null ? "—" : String(value);
}

function formatPace(seconds: number | null) {
  if (!seconds) return null;
  const minutes = Math.floor(Number(seconds) / 60);
  const rest = Math.round(Number(seconds) % 60);
  return `${minutes}:${String(rest).padStart(2, "0")}/km`;
}

function isCycling(type: number | null) {
  return type != null && type >= 200 && type < 300;
}

function SportIcon({ type }: { type: number | null }) {
  if (type === 102 || type === 104 || type === 105) return <Mountain size={20} />;
  if (isCycling(type)) return <Bike size={20} />;
  if (type != null && type >= 100 && type < 200) return <Footprints size={20} />;
  return <ActivityIcon size={20} />;
}

export default async function ActivityPage() {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const { data } = await supabase
    .from("activities")
    .select("id,sport,sport_type,started_at,distance_m,duration_s,pace_seconds_per_km,avg_speed_kmh,raw_provider_data")
    .eq("user_id", auth.user.id)
    .order("started_at", { ascending: false, nullsFirst: false })
    .limit(500);
  const activities = (data || []) as ActivityRow[];

  const activityIds = activities.map((activity) => activity.id);
  const { data: matchRows } = activityIds.length
    ? await supabase.from("workout_matches").select("id,activity_id,status").eq("user_id", auth.user.id).in("activity_id", activityIds)
    : { data: [] };
  const matches = new Map((matchRows || []).map((row) => [row.activity_id, row as MatchRow]));
  const confirmedMatchIds = (matchRows || []).filter((row) => row.status === "confirmed").map((row) => row.id);
  const { data: feedbackRows } = confirmedMatchIds.length
    ? await supabase.from("workout_feedback").select("match_id").eq("user_id", auth.user.id).in("match_id", confirmedMatchIds)
    : { data: [] };
  const feedbackMatchIds = new Set((feedbackRows || []).map((row) => row.match_id));

  return <main>
    <div className="frog-kicker">Activité</div>
    <h1 className="frog-page-title">Tes séances réalisées</h1>
    <p className="frog-page-subtitle">{activities.length} activité(s) importée(s). Frog peut maintenant comparer une activité à la séance prévue et recueillir ton ressenti.</p>

    {activities.length === 0 ? (
      <section className="frog-card frog-empty">
        <div className="frog-empty-icon"><ActivityIcon size={24} /></div>
        <h2 className="frog-card-title">Aucune activité synchronisée</h2>
        <p className="frog-card-text">Connecte COROS depuis ton profil puis lance la première synchronisation.</p>
      </section>
    ) : (
      <div className="frog-stack">
        {activities.map((activity) => {
          const pace = formatPace(activity.pace_seconds_per_km == null ? null : Number(activity.pace_seconds_per_km));
          const speed = activity.avg_speed_kmh == null ? null : Number(activity.avg_speed_kmh);
          const match = matches.get(activity.id);
          const hasFeedback = match?.status === "confirmed" && feedbackMatchIds.has(match.id);
          return <article className="frog-card" key={activity.id}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <span className="frog-provider-icon"><SportIcon type={activity.sport_type} /></span>
              <div style={{ flex: 1 }}>
                <div className="frog-kicker">{activity.started_at ? new Date(activity.started_at).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : "Date indisponible"}</div>
                <h2 className="frog-card-title" style={{ marginTop: 5 }}>{activity.sport || "Activité COROS"}</h2>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 10, color: "var(--frog-muted)", fontSize: 13 }}>
                  <span>{formatDistance(activity)}</span>
                  <span style={{ display: "inline-flex", gap: 5, alignItems: "center" }}><Timer size={14} /> {formatDuration(activity)}</span>
                  {isCycling(activity.sport_type) && speed != null ? <span>{speed.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km/h</span> : pace && <span>{pace}</span>}
                </div>
                {match && <div className="frog-status-line" data-connected={match.status === "confirmed"} style={{ marginTop: 10 }}>
                  {match.status === "suggested" ? "Lien au plan à confirmer" : hasFeedback ? <><CheckCircle2 size={15} /> Analyse post-séance disponible</> : "Plan lié · feedback à compléter"}
                </div>}
                <Link href={`/activity/${activity.id}`} className="frog-button frog-button-secondary" style={{ marginTop: 12 }}>
                  {match?.status === "confirmed" ? (hasFeedback ? "Voir l’analyse" : "Donner mon feedback") : "Ouvrir l’activité"} <ArrowRight size={17} />
                </Link>
              </div>
            </div>
          </article>;
        })}
      </div>
    )}
  </main>;
}
