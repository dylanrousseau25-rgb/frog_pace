import { CalendarDays } from "lucide-react";

export default function PlanPage() {
  return (
    <main>
      <div className="frog-kicker">Plan</div>
      <h1 className="frog-page-title">Ta préparation</h1>
      <p className="frog-page-subtitle">Le plan complet jusqu'au jour J apparaîtra ici après validation de ton objectif et de sa faisabilité.</p>

      <section className="frog-card frog-empty">
        <div className="frog-empty-icon"><CalendarDays size={24} /></div>
        <h2 className="frog-card-title">Pas encore de plan</h2>
        <p className="frog-card-text">Frog ne crée jamais de calendrier fictif. Un plan sera lié à un objectif accepté, versionné et expliqué.</p>
      </section>
    </main>
  );
}
