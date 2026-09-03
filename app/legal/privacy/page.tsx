import Link from "next/link";

export default function PrivacyPage() {
  return <main>
    <Link href="/legal" className="frog-button frog-button-secondary" style={{ marginBottom: 14 }}>← Informations légales</Link>
    <div className="frog-kicker">Confidentialité</div>
    <h1 className="frog-page-title">Politique de confidentialité</h1>
    <p className="frog-page-subtitle">Frog Pace collecte uniquement les données nécessaires au fonctionnement du coaching, du plan d’entraînement et des services que tu choisis de connecter.</p>

    <section className="frog-card"><h2 className="frog-card-title">1. Données traitées</h2><p className="frog-card-text">Selon les fonctionnalités utilisées : informations de compte et d’authentification, profil sportif, disponibilités et préférences, objectifs, plans et séances, activités et métriques importées depuis des fournisseurs sportifs, feedbacks post-séance, analyses Frog, conversations avec le Coach, mémoires Frog, ainsi que les informations techniques nécessaires aux connexions OAuth.</p></section>

    <section className="frog-card"><h2 className="frog-card-title">2. Pourquoi Frog les utilise</h2><p className="frog-card-text">Pour authentifier ton compte, importer tes données avec ton autorisation, évaluer un objectif, générer et adapter un plan, comparer les séances prévues et réalisées, produire les tableaux de progression, fournir les réponses du Coach et préparer les exports de séances vers les plateformes que tu connectes.</p></section>

    <section className="frog-card"><h2 className="frog-card-title">3. Services tiers</h2><p className="frog-card-text">Frog Pace utilise notamment Supabase pour l’authentification et la base de données, Vercel pour l’hébergement de l’application, COROS lorsque tu connectes ton compte, et TrainingPeaks uniquement si tu choisis de connecter ce service. Chaque fournisseur conserve ses propres règles et politiques pour les données présentes dans son service.</p></section>

    <section className="frog-card"><h2 className="frog-card-title">4. Jetons et sécurité</h2><p className="frog-card-text">Les jetons d’accès aux fournisseurs sportifs sont stockés côté serveur et ne sont pas exposés au navigateur. Les données applicatives sont isolées par utilisateur grâce aux politiques RLS PostgreSQL. Frog Pace ne vend pas les données personnelles de ses utilisateurs.</p></section>

    <section className="frog-card"><h2 className="frog-card-title">5. Conservation</h2><p className="frog-card-text">Les données Frog Pace sont conservées tant que ton compte reste actif et qu’elles sont nécessaires au service. Tu peux supprimer des mémoires individuelles, déconnecter un fournisseur ou supprimer entièrement ton compte. La suppression du compte supprime les données Frog associées et les identifiants de connexion stockés par Frog Pace.</p></section>

    <section className="frog-card"><h2 className="frog-card-title">6. Tes choix</h2><p className="frog-card-text">Tu peux consulter et corriger ton profil, gérer la mémoire Frog, déconnecter les plateformes, abandonner un objectif et supprimer ton compte depuis l’application. Les données déjà transmises à un fournisseur tiers doivent aussi être gérées dans ce fournisseur lorsqu’elles y ont été copiées.</p></section>

    <section className="frog-card"><h2 className="frog-card-title">7. Contact</h2><p className="frog-card-text">Pour une demande concernant tes données ou Frog Pace, utilise les coordonnées de contact publiées sur kumazel.fr. Une demande de suppression peut également être exécutée directement dans Profil → Compte & données.</p></section>

    <p className="frog-footnote">Dernière mise à jour : 3 septembre 2026.</p>
  </main>;
}
