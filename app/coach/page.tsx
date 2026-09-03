import { MessageCircle } from "lucide-react";
import CoachClient from "./coach-client";

export default function CoachPage() {
  return <main>
    <div className="frog-kicker">Lot 9 · Coach</div>
    <h1 className="frog-page-title">Parle à Frog</h1>
    <p className="frog-page-subtitle">Un Coach contextuel qui s’appuie sur les données réelles de ton compte avant de répondre.</p>
    <CoachClient />
    <section className="frog-card" style={{ marginTop: 12 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}><MessageCircle size={20} /><h2 className="frog-card-title">Pourquoi les réponses restent traçables</h2></div>
      <p className="frog-card-text">Chaque réponse du Coach est enregistrée avec le snapshot de contexte utilisé. Frog peut donc expliquer une décision à partir du plan, de COROS, des bilans et des analyses au lieu d’inventer une justification après coup.</p>
    </section>
  </main>;
}
