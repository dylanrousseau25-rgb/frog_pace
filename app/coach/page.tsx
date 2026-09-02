import { MessageCircle } from "lucide-react";

export default function CoachPage() {
  return <main>
    <div className="frog-kicker">Coach</div>
    <h1 className="frog-page-title">Parle à Frog</h1>
    <p className="frog-page-subtitle">Le Coach utilisera ton profil, tes objectifs, ton plan, tes activités et sa mémoire pour te répondre avec du contexte.</p>
    <section className="frog-card frog-card-soft">
      <div className="frog-empty-icon"><MessageCircle size={24} /></div>
      <h2 className="frog-card-title">Le contexte avant la conversation</h2>
      <p className="frog-card-text">La mémoire et le moteur de coaching seront construits avant d'activer le chat. Ainsi Frog expliquera les vraies décisions du système au lieu d'inventer une justification.</p>
    </section>
  </main>;
}
