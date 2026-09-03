import Link from "next/link";

export default function LegalPage() {
  return <main>
    <div className="frog-kicker">Frog Pace</div>
    <h1 className="frog-page-title">Informations légales & données</h1>
    <p className="frog-page-subtitle">Les règles essentielles sur l’utilisation de Frog Pace, la confidentialité et le contrôle de tes données.</p>

    <div className="frog-menu-list">
      <Link href="/legal/privacy" className="frog-menu-card">
        <span><strong>Politique de confidentialité</strong><small>Données collectées, finalités, services connectés et conservation</small></span>
        <span>›</span>
      </Link>
      <Link href="/legal/terms" className="frog-menu-card">
        <span><strong>Conditions d’utilisation</strong><small>Règles d’utilisation de Frog Pace et limites du service</small></span>
        <span>›</span>
      </Link>
      <Link href="/legal/data" className="frog-menu-card">
        <span><strong>Contrôle & suppression des données</strong><small>Déconnexion des services, suppression du compte et conséquences</small></span>
        <span>›</span>
      </Link>
    </div>

    <section className="frog-card" style={{ marginTop: 18 }}>
      <h2 className="frog-card-title">Éditeur</h2>
      <p className="frog-card-text">Frog Pace est un projet exploité par Kumazel, France. Pour une demande relative au service ou aux données, utilise les coordonnées de contact publiées sur kumazel.fr.</p>
    </section>

    <p className="frog-footnote">Dernière mise à jour : 3 septembre 2026.</p>
  </main>;
}
