export default function ProgressPage() {
  return <main>
    <div className="frog-kicker">Progrès</div>
    <h1 className="frog-page-title">Ta progression</h1>
    <p className="frog-page-subtitle">Les tendances apparaîtront ici quand Frog aura des données réelles à comparer.</p>
    <section className="frog-card frog-empty">
      <div className="frog-empty-icon">↗</div>
      <h2 className="frog-card-title">Pas encore assez de données</h2>
      <p className="frog-card-text">Objectif, forme, charge et régularité seront regroupés de façon lisible.</p>
    </section>
  </main>;
}
