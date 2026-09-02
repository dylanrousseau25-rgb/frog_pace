import Link from "next/link";
import { ArrowRight, HeartPulse, MoonStar, Gauge, Sparkles } from "lucide-react";

export default function TodayPage() {
  return (
    <main>
      <div className="frog-kicker">Aujourd'hui</div>
      <h1 className="frog-page-title">Bonjour 👋</h1>
      <p className="frog-page-subtitle">Frog rassemblera ici ton état du jour, sa recommandation et ta prochaine séance.</p>

      <section className="frog-grid" aria-label="État du jour">
        <div className="frog-metric">
          <div className="frog-metric-label"><HeartPulse size={14} /> Récupération</div>
          <div className="frog-metric-value">—</div>
        </div>
        <div className="frog-metric">
          <div className="frog-metric-label"><MoonStar size={14} /> Sommeil</div>
          <div className="frog-metric-value">—</div>
        </div>
        <div className="frog-metric">
          <div className="frog-metric-label"><Gauge size={14} /> Charge</div>
          <div className="frog-metric-value">—</div>
        </div>
        <div className="frog-metric">
          <div className="frog-metric-label"><Sparkles size={14} /> Forme</div>
          <div className="frog-metric-value">—</div>
        </div>
      </section>

      <section className="frog-card frog-card-soft" style={{ marginTop: 14 }}>
        <div className="frog-kicker">Avis Frog</div>
        <h2 className="frog-card-title" style={{ marginTop: 8 }}>On commence par te connaître.</h2>
        <p className="frog-card-text">Ton profil sportif et ta connexion COROS permettront à Frog de construire un état du jour fiable sans inventer de données.</p>
      </section>

      <section className="frog-card frog-empty">
        <div className="frog-empty-icon">🎯</div>
        <h2 className="frog-card-title">Aucun objectif actif</h2>
        <p className="frog-card-text">Quand ton profil sera prêt, tu pourras créer un objectif. Frog évaluera d'abord sa faisabilité avant de proposer un plan.</p>
        <Link href="/profile" className="frog-button frog-button-primary" style={{ marginTop: 18 }}>
          Préparer mon profil <ArrowRight size={18} />
        </Link>
      </section>
    </main>
  );
}
