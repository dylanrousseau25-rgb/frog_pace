import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, CalendarDays, CheckCircle2, LockKeyhole, Target } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function verdictLabel(verdict?: string | null) {
  if (verdict === "feasible") return "Faisable";
  if (verdict === "challenging") return "Ambitieux";
  if (verdict === "not_recommended") return "Non recommandé";
  if (verdict === "insufficient_data") return "Données insuffisantes";
  return "À analyser";
}

export default async function PlanPage() {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const { data: goal } = await supabase
    .from("goals")
    .select("id,event_name,event_date,distance_m,target_duration_s,accepted_assessment_id,accepted_at")
    .eq("user_id", auth.user.id)
    .eq("goal_type", "primary")
    .eq("status", "active")
    .maybeSingle();

  const { data: latestAssessment } = goal
    ? await supabase
        .from("goal_feasibility_assessments")
        .select("id,verdict,score,summary")
        .eq("goal_id", goal.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };

  const accepted = Boolean(goal?.accepted_assessment_id);
  const acceptedLatest = Boolean(goal?.accepted_assessment_id && latestAssessment?.id === goal.accepted_assessment_id);

  return (
    <main>
      <div className="frog-kicker">Plan</div>
      <h1 className="frog-page-title">Ta préparation</h1>
      <p className="frog-page-subtitle">Le calendrier d’entraînement ne peut être créé qu’à partir d’un objectif analysé puis explicitement validé.</p>

      {!goal ? <section className="frog-card frog-empty">
        <div className="frog-empty-icon"><Target size={24} /></div>
        <h2 className="frog-card-title">Commence par ton objectif</h2>
        <p className="frog-card-text">Le Lot 4 restera verrouillé tant que Frog ne connaît pas ton jour J, sa distance et sa faisabilité.</p>
        <Link href="/goals" className="frog-button frog-button-primary" style={{ marginTop: 16 }}>Créer mon objectif <ArrowRight size={18} /></Link>
      </section> : <>
        <section className="frog-card">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div className="frog-kicker">Référence du plan</div>
              <h2 className="frog-card-title" style={{ marginTop: 7 }}>{goal.event_name}</h2>
              <p className="frog-card-text">{(Number(goal.distance_m) / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km · {new Date(`${goal.event_date}T12:00:00`).toLocaleDateString("fr-FR")}</p>
            </div>
            <CalendarDays size={22} />
          </div>

          <div className="frog-status-line" data-connected={latestAssessment?.verdict === "feasible"} style={{ marginTop: 14 }}>
            {latestAssessment ? `${verdictLabel(latestAssessment.verdict)} · ${latestAssessment.score}/100` : "Analyse manquante"}
          </div>
          {latestAssessment?.summary && <p className="frog-card-text">{latestAssessment.summary}</p>}
          <Link href="/goals" className="frog-button frog-button-secondary" style={{ marginTop: 14 }}>Gérer l’objectif <ArrowRight size={17} /></Link>
        </section>

        {!accepted ? <section className="frog-card frog-empty">
          <div className="frog-empty-icon"><LockKeyhole size={24} /></div>
          <h2 className="frog-card-title">Plan verrouillé</h2>
          <p className="frog-card-text">Une évaluation faisable ou ambitieuse doit être validée dans le Goal Engine avant que Frog construise le plan.</p>
          <Link href="/goals" className="frog-button frog-button-primary" style={{ marginTop: 16 }}>Valider mon objectif <ArrowRight size={18} /></Link>
        </section> : !acceptedLatest ? <section className="frog-card frog-empty">
          <div className="frog-empty-icon"><LockKeyhole size={24} /></div>
          <h2 className="frog-card-title">Nouvelle analyse à valider</h2>
          <p className="frog-card-text">Une nouvelle évaluation existe depuis ta dernière validation. Le futur plan reste lié à la version que tu as acceptée tant que tu ne valides pas la nouvelle.</p>
          <Link href="/goals" className="frog-button frog-button-primary" style={{ marginTop: 16 }}>Comparer et valider <ArrowRight size={18} /></Link>
        </section> : <section className="frog-card frog-card-soft">
          <div className="frog-kicker">Prêt pour le Lot 4</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
            <CheckCircle2 size={22} />
            <h2 className="frog-card-title">Objectif analysé et validé</h2>
          </div>
          <p className="frog-card-text">La référence est figée. Le prochain lot pourra générer un plan versionné jusqu’au jour J à partir de cet objectif.</p>
        </section>}
      </>}
    </main>
  );
}
