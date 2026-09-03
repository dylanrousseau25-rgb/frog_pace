import Link from "next/link";

export default function TermsPage() {
  return <main>
    <Link href="/legal" className="frog-button frog-button-secondary" style={{ marginBottom: 14 }}>← Informations légales</Link>
    <div className="frog-kicker">Conditions</div>
    <h1 className="frog-page-title">Conditions d’utilisation</h1>
    <p className="frog-page-subtitle">Ces conditions encadrent l’utilisation de la version V1 de Frog Pace.</p>

    <section className="frog-card"><h2 className="frog-card-title">1. Objet du service</h2><p className="frog-card-text">Frog Pace est un outil de coaching d’endurance qui aide à organiser des objectifs, générer des plans, analyser des activités et proposer des adaptations à partir des données disponibles. Certaines fonctions dépendent de services tiers.</p></section>
    <section className="frog-card"><h2 className="frog-card-title">2. Responsabilité de l’utilisateur</h2><p className="frog-card-text">Tu restes responsable des informations saisies, des services que tu connectes, de la validation des adaptations et de la décision d’effectuer ou non une séance. Les recommandations sont des aides à la décision et doivent être adaptées aux conditions réelles.</p></section>
    <section className="frog-card"><h2 className="frog-card-title">3. Santé et sécurité</h2><p className="frog-card-text">Frog Pace n’est pas un dispositif médical et ne remplace ni diagnostic, ni avis médical, ni suivi par un professionnel de santé. En cas de douleur inhabituelle, malaise, blessure suspectée ou doute concernant ta capacité à pratiquer, interromps l’effort et sollicite un professionnel compétent.</p></section>
    <section className="frog-card"><h2 className="frog-card-title">4. Services tiers</h2><p className="frog-card-text">Les connexions COROS, TrainingPeaks ou autres services sont soumises à leur disponibilité, leurs API et leurs propres conditions. Frog Pace ne peut pas garantir qu’une fonction dépendant d’un tiers restera disponible sans changement.</p></section>
    <section className="frog-card"><h2 className="frog-card-title">5. Disponibilité et V1</h2><p className="frog-card-text">La V1 peut évoluer rapidement. Des opérations de maintenance, changements de fournisseurs ou corrections peuvent temporairement modifier certaines fonctions. Frog Pace s’efforce de préserver l’intégrité des données et d’éviter les modifications silencieuses du plan.</p></section>
    <section className="frog-card"><h2 className="frog-card-title">6. Compte</h2><p className="frog-card-text">Tu dois protéger l’accès à ton compte. Tu peux te déconnecter, révoquer les connexions fournisseurs et supprimer définitivement ton compte depuis l’application.</p></section>
    <section className="frog-card"><h2 className="frog-card-title">7. Contact</h2><p className="frog-card-text">Pour toute question relative au service, utilise les coordonnées publiées sur kumazel.fr.</p></section>

    <p className="frog-footnote">Dernière mise à jour : 3 septembre 2026.</p>
  </main>;
}
