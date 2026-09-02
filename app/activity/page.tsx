import { Activity } from "lucide-react";

export default function ActivityPage() {
  return <main>
    <div className="frog-kicker">Activité</div>
    <h1 className="frog-page-title">Tes séances réalisées</h1>
    <p className="frog-page-subtitle">Les activités de tes fournisseurs apparaîtront ici.</p>
    <section className="frog-card frog-empty">
      <div className="frog-empty-icon"><Activity size={24} /></div>
      <h2 className="frog-card-title">Aucune activité synchronisée</h2>
      <p className="frog-card-text">Frog affichera uniquement des données réellement importées.</p>
    </section>
  </main>;
}
