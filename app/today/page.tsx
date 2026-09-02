import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, HeartPulse, MoonStar, Gauge, Sparkles } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findNumber(root: unknown, candidateKeys: string[]) {
  const wanted = new Set(candidateKeys.map(normalizeKey));
  const queue: unknown[] = [root];
  const seen = new Set<object>();
  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }
    for (const [key, value] of Object.entries(current as Record<string, unknown>)) {
      if (wanted.has(normalizeKey(key))) {
        if (typeof value === "number" && Number.isFinite(value)) return value;
        if (typeof value === "string") {
          const match = value.replace(",", ".").match(/-?\d+(?:\.\d+)?/);
          if (match) return Number(match[0]);
        }
      }
      if (value && typeof value === "object") queue.push(value);
    }
  }
  return null;
}

export default async function TodayPage() {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const [{ data: profile }, { data: connection }, { data: snapshot }] = await Promise.all([
    supabase
      .from("user_profiles")
      .select("display_name,onboarding_completed")
      .eq("user_id", auth.user.id)
      .maybeSingle(),
    supabase
      .from("provider_connections")
      .select("status,last_sync_at")
      .eq("user_id", auth.user.id)
      .eq("provider", "coros")
      .maybeSingle(),
    supabase
      .from("fitness_snapshots")
      .select("captured_at,recovery,sleep,short_load,load_ratio,vo2max")
      .eq("user_id", auth.user.id)
      .eq("provider", "coros")
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle()
  ]);

  if (!profile?.onboarding_completed) redirect("/onboarding");
  const firstName = profile.display_name?.trim() || "athlète";
  const connected = connection?.status === "connected";
  const recovery = snapshot?.recovery == null ? null : Number(snapshot.recovery);
  const sleepScore = findNumber(snapshot?.sleep, ["sleepScore", "score"]);
  const shortLoad = snapshot?.short_load == null ? null : Number(snapshot.short_load);
  const loadRatio = snapshot?.load_ratio == null ? null : Number(snapshot.load_ratio);
  const vo2max = snapshot?.vo2max == null ? null : Number(snapshot.vo2max);

  return (
    <main>
      <div className="frog-kicker">Aujourd'hui</div>
      <h1 className="frog-page-title">Bonjour {firstName} 👋</h1>
      <p className="frog-page-subtitle">Ton état du jour utilise uniquement les données réellement disponibles dans Frog Pace.</p>

      <section className="frog-grid" aria-label="État du jour">
        <div className="frog-metric">
          <div className="frog-metric-label"><HeartPulse size={14} /> Récupération</div>
          <div className="frog-metric-value">{recovery == null ? "—" : `${Math.round(recovery)}%`}</div>
        </div>
        <div className="frog-metric">
          <div className="frog-metric-label"><MoonStar size={14} /> Sommeil</div>
          <div className="frog-metric-value">{sleepScore == null ? "—" : Math.round(sleepScore)}</div>
        </div>
        <div className="frog-metric">
          <div className="frog-metric-label"><Gauge size={14} /> Charge</div>
          <div className="frog-metric-value">{shortLoad == null ? "—" : Math.round(shortLoad)}</div>
          {loadRatio != null && <div className="frog-card-text" style={{ marginTop: 2 }}>ratio {loadRatio.toFixed(2)}</div>}
        </div>
        <div className="frog-metric">
          <div className="frog-metric-label"><Sparkles size={14} /> VO₂max</div>
          <div className="frog-metric-value">{vo2max == null ? "—" : vo2max.toFixed(1)}</div>
        </div>
      </section>

      <section className="frog-card frog-card-soft" style={{ marginTop: 14 }}>
        <div className="frog-kicker">Avis Frog</div>
        <h2 className="frog-card-title" style={{ marginTop: 8 }}>
          {connected ? "COROS alimente maintenant ton état du jour." : "Ton profil est prêt. Connecte maintenant COROS."}
        </h2>
        <p className="frog-card-text">
          {connected
            ? `Dernière synchronisation : ${connection?.last_sync_at ? new Date(connection.last_sync_at).toLocaleString("fr-FR") : "en attente"}. Les métriques absentes restent à « — ».`
            : "Frog ne fabrique aucune métrique de forme : elles apparaîtront uniquement après une synchronisation réussie."}
        </p>
        <Link href="/profile/connections" className="frog-button frog-button-secondary" style={{ marginTop: 16 }}>
          {connected ? "Gérer COROS" : "Connecter COROS"} <ArrowRight size={18} />
        </Link>
      </section>

      <section className="frog-card frog-empty">
        <div className="frog-empty-icon">🎯</div>
        <h2 className="frog-card-title">Aucun objectif actif</h2>
        <p className="frog-card-text">La prochaine étape sera le Goal Engine : création de l’objectif puis analyse de faisabilité avant tout plan.</p>
        <Link href="/profile/memory" className="frog-button frog-button-primary" style={{ marginTop: 18 }}>Voir ce que Frog sait de moi <ArrowRight size={18} /></Link>
      </section>
    </main>
  );
}
