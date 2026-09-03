import Link from "next/link";

export default function DataControlPage() {
  return <main>
    <Link href="/legal" className="frog-button frog-button-secondary" style={{ marginBottom: 14 }}>← Informations légales</Link>
    <div className="frog-kicker">Contrôle utilisateur</div>
    <h1 className="frog-page-title">Contrôle & suppression des données</h1>
    <p className="frog-page-subtitle">Frog Pace sépare les données du compte, la mémoire du Coach et les connexions externes afin que tu puisses agir sur chacune d’elles.</p>

    <section className="frog-card"><h2 className="frog-card-title">Déconnecter un fournisseur</h2><p className="frog-card-text">Profil → Connexions & appareils permet de déconnecter COROS ou TrainingPeaks. Frog supprime alors les identifiants d’accès stockés côté serveur. Les activités déjà importées peuvent être conservées dans Frog tant que le compte existe.</p></section>
    <section className="frog-card"><h2 className="frog-card-title">Supprimer une mémoire Frog</h2><p className="frog-card-text">Profil → Ce que Frog sait de moi permet de gérer les mémoires du Coach indépendamment du reste du compte.</p></section>
    <section className="frog-card"><h2 className="frog-card-title">Abandonner un objectif</h2><p className="frog-card-text">L’objectif principal peut être archivé sans effacer l’historique de ses évaluations. Le plan actif est alors annulé et les séances futures encore planifiées passent en annulé.</p></section>
    <section className="frog-card"><h2 className="frog-card-title">Supprimer le compte</h2><p className="frog-card-text">Profil → Compte & données permet une suppression définitive après confirmation explicite. Cette action supprime l’utilisateur Frog, le profil, les activités stockées dans Frog, objectifs, plans, feedbacks, analyses, conversations Coach, mémoires, snapshots, connexions et jetons fournisseurs associés.</p><p className="frog-card-text"><strong>Attention :</strong> les données déjà copiées dans un service tiers comme COROS ou TrainingPeaks ne sont pas supprimées de ce service par la suppression du compte Frog. Elles doivent être gérées dans le service concerné.</p></section>

    <p className="frog-footnote">Dernière mise à jour : 3 septembre 2026.</p>
  </main>;
}
