"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, Target, XCircle } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Goal = { id: string; event_name: string; event_date: string; sport: string; distance_m: number | string };

type Plan = { id: string; status: string; version: number };

function formatDistance(value: number | string) {
  return `${(Number(value) / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km`;
}

export default function GoalManagePage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) { setLoading(false); return; }
    const { data: goalData, error: goalError } = await supabase.from("goals")
      .select("id,event_name,event_date,sport,distance_m")
      .eq("user_id", auth.user.id).eq("goal_type", "primary").eq("status", "active").maybeSingle();
    if (goalError) setError(goalError.message);
    const activeGoal = goalData as Goal | null;
    setGoal(activeGoal);
    if (activeGoal) {
      const { data: planData } = await supabase.from("training_plans")
        .select("id,status,version").eq("user_id", auth.user.id).eq("goal_id", activeGoal.id).eq("status", "active").maybeSingle();
      setPlan(planData as Plan | null);
    } else setPlan(null);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  async function cancelGoal() {
    if (!goal) return;
    if (!window.confirm(`Abandonner l’objectif « ${goal.event_name} » ? Le plan actif et les séances futures seront annulés, mais l’historique restera conservé.`)) return;
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc("cancel_primary_goal", { p_goal_id: goal.id });
    setBusy(false);
    if (rpcError) return setError(rpcError.message);
    window.location.href = "/goals";
  }

  if (loading) return <main className="frog-centered"><Loader2 className="frog-spin" /> Chargement…</main>;

  return <main>
    <Link href="/goals" className="frog-button frog-button-secondary" style={{ marginBottom: 14 }}>← Retour aux objectifs</Link>
    <div className="frog-kicker">Cycle de préparation</div>
    <h1 className="frog-page-title">Gérer l’objectif principal</h1>

    {!goal ? <section className="frog-card frog-empty">
      <div className="frog-empty-icon"><Target size={24} /></div>
      <h2 className="frog-card-title">Aucun objectif actif</h2>
      <p className="frog-card-text">Tu peux créer un nouvel objectif principal depuis l’écran Objectifs.</p>
      <Link href="/goals" className="frog-button frog-button-primary" style={{ marginTop: 14 }}>Créer un objectif</Link>
    </section> : <>
      <section className="frog-card frog-card-soft">
        <div className="frog-kicker">Objectif actif</div>
        <h2 className="frog-card-title" style={{ marginTop: 6 }}>{goal.event_name}</h2>
        <p className="frog-card-text">{formatDistance(goal.distance_m)} · {new Date(`${goal.event_date}T12:00:00`).toLocaleDateString("fr-FR")} {plan ? `· plan v${plan.version} actif` : "· aucun plan actif"}</p>
      </section>

      <section className="frog-card">
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}><AlertTriangle size={21} /><h2 className="frog-card-title">Abandonner cet objectif</h2></div>
        <p className="frog-card-text">Frog archive l’objectif au lieu de le supprimer : les analyses de faisabilité restent dans l’historique, le plan actif passe en annulé, les objectifs intermédiaires associés sont annulés et les séances futures encore planifiées passent en annulé.</p>
        <p className="frog-card-text">Les activités COROS déjà importées ne sont jamais supprimées par cette action.</p>
        {error && <div className="frog-error" style={{ marginTop: 10 }}>{error}</div>}
        <button type="button" className="frog-button frog-button-secondary frog-button-wide" style={{ marginTop: 14 }} disabled={busy} onClick={cancelGoal}>
          {busy ? <><Loader2 size={17} className="frog-spin" /> Annulation…</> : <><XCircle size={17} /> Abandonner l’objectif</>}
        </button>
      </section>
    </>}
  </main>;
}
