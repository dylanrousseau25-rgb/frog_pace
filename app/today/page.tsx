import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, HeartPulse, MoonStar, Gauge, Sparkles } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function TodayPage() {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("display_name,onboarding_completed")
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (!profile?.onboarding_completed) redirect("/onboarding");
  const firstName = profile.display_name?.trim() || "athlète";

  return (
    <main>
      <div className="frog-kicker">Aujourd'hui</div>
      <h1 className="frog-page-title">Bonjour {firstName} 👋</h1>
      <p className="frog-page-subtitle">Frog rassemblera ici ton état du jour, sa recommandation et ta prochaine séance.</p>

      <section className="frog-grid" aria-label="État du jour">
        <div className="frog-metric"><div className="frog-metric-label"><HeartPulse size={14} /> Récupération</div><div className="frog-metric-value">—</div></div>
        <div className="frog-metric"><div className="frog-metric-label"><MoonStar size={14} /> Sommeil</div><div className="frog-metric-value">—</div></div>
        <div className="frog-metric"><div className="frog-metric-label"><Gauge size={14} /> Charge</div><div className="frog-metric-value">—</div></div>
        <div className="frog-metric"><div className="frog-metric-label"><Sparkles size={14} /> Forme</div><div className="frog-metric-value">—</div></div>
      </section>

      <section className="frog-card frog-card-soft" style={{ marginTop: 14 }}>
        <div className="frog-kicker">Avis Frog</div>
        <h2 className="frog-card-title" style={{ marginTop: 8 }}>Ton profil est prêt.</h2>
        <p className="frog-card-text">La prochaine source de données sera COROS. Tant qu’elle n’est pas connectée, Frog laisse les métriques à « — » au lieu de les inventer.</p>
        <Link href="/profile/connections" className="frog-button frog-button-secondary" style={{ marginTop: 16 }}>Voir mes connexions <ArrowRight size={18} /></Link>
      </section>

      <section className="frog-card frog-empty">
        <div className="frog-empty-icon">🎯</div>
        <h2 className="frog-card-title">Aucun objectif actif</h2>
        <p className="frog-card-text">La création et l’analyse de faisabilité de ton premier objectif arriveront avec le Goal Engine.</p>
        <Link href="/profile/memory" className="frog-button frog-button-primary" style={{ marginTop: 18 }}>Voir ce que Frog sait de moi <ArrowRight size={18} /></Link>
      </section>
    </main>
  );
}
