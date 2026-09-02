import { Activity as ActivityIcon, Bike, Footprints, Mountain, Timer } from "lucide-react";
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

  return <main>
    <div className="frog-kicker">Activité</div>
    <h1 className="frog-page-title">Tes séances réalisées</h1>
    <p className="frog-page-subtitle">{activities.length} activité(s) importée(s) depuis tes fournisseurs. Une synchronisation répétée ne crée pas de doublon.</p>

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
              </div>
            </div>
          </article>;
        })}
      </div>
    )}
  </main>;
}
