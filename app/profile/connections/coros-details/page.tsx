"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, DatabaseZap, Loader2, RefreshCw } from "lucide-react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Progress = {
  total: number;
  completed: number;
  success: number;
  failed: number;
};

export default function CorosDetailsPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress>({ total: 0, completed: 0, success: 0, failed: 0 });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadProgress = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      setLoading(false);
      return;
    }

    const [totalResult, completedResult, successResult, failedResult] = await Promise.all([
      supabase.from("activities").select("id", { count: "exact", head: true }).eq("user_id", auth.user.id).eq("provider", "coros"),
      supabase.from("activities").select("id", { count: "exact", head: true }).eq("user_id", auth.user.id).eq("provider", "coros").not("detail_sync_attempted_at", "is", null),
      supabase.from("activities").select("id", { count: "exact", head: true }).eq("user_id", auth.user.id).eq("provider", "coros").not("detail_fetched_at", "is", null),
      supabase.from("activities").select("id", { count: "exact", head: true }).eq("user_id", auth.user.id).eq("provider", "coros").not("detail_sync_error", "is", null),
    ]);

    setProgress({
      total: totalResult.count || 0,
      completed: completedResult.count || 0,
      success: successResult.count || 0,
      failed: failedResult.count || 0,
    });
    setLoading(false);
  }, [supabase]);

  useEffect(() => { loadProgress(); }, [loadProgress]);

  async function enrichAll() {
    setRunning(true);
    setError(null);
    setMessage("Enrichissement COROS en cours… Tu peux laisser cette page ouverte.");

    try {
      let remaining = Math.max(0, progress.total - progress.completed);
      let loops = 0;
      while (remaining > 0 && loops < 100) {
        const { data, error: invokeError } = await supabase.functions.invoke("coros-activity-details", {
          body: { batchSize: 8 }
        });
        if (invokeError) throw invokeError;
        if (data?.error) throw new Error(data.error);
        remaining = Number(data?.remaining || 0);
        loops += 1;
        await loadProgress();
        if (Number(data?.processed || 0) === 0) break;
      }
      await loadProgress();
      setMessage(remaining === 0
        ? "Enrichissement terminé. Les détails disponibles chez COROS ont été enregistrés dans Frog Pace."
        : `Enrichissement interrompu avec ${remaining} activité(s) encore à traiter. Tu peux relancer sans doublon.`);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Enrichissement COROS impossible");
      setMessage(null);
      await loadProgress();
    } finally {
      setRunning(false);
    }
  }

  async function retryFailed() {
    setRunning(true);
    setError(null);
    setMessage("Nouvelle tentative sur les activités en erreur…");
    try {
      for (let i = 0; i < 50; i++) {
        const { data, error: invokeError } = await supabase.functions.invoke("coros-activity-details", {
          body: { batchSize: 8, retryFailed: true }
        });
        if (invokeError) throw invokeError;
        if (data?.error) throw new Error(data.error);
        await loadProgress();
        if (Number(data?.processed || 0) === 0 || Number(data?.failed || 0) === 0) break;
      }
      await loadProgress();
      setMessage("Nouvelle tentative terminée.");
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : "Nouvelle tentative impossible");
      setMessage(null);
      await loadProgress();
    } finally {
      setRunning(false);
    }
  }

  const percent = progress.total ? Math.round((progress.completed / progress.total) * 100) : 0;
  const complete = progress.total > 0 && progress.completed >= progress.total;

  return <main>
    <Link href="/profile/connections" className="frog-button frog-button-secondary" style={{ marginBottom: 18 }}>
      <ArrowLeft size={16} /> Retour aux connexions
    </Link>

    <div className="frog-kicker">COROS · Lot 2.5</div>
    <h1 className="frog-page-title">Détails des activités</h1>
    <p className="frog-page-subtitle">Frog récupère les détails disponibles pour chaque activité : fréquence cardiaque maximale, dénivelé, cadence, charge et autres données exposées par COROS.</p>

    {message && <div className="frog-success" style={{ marginBottom: 12 }}>{message}</div>}
    {error && <div className="frog-error" style={{ marginBottom: 12 }}>{error}</div>}

    <section className="frog-card">
      {loading ? <div className="frog-status-line"><Loader2 size={16} className="frog-spin" /> Vérification…</div> : <>
        <div className="frog-provider-head">
          <span className="frog-provider-icon">{complete ? <CheckCircle2 size={22} /> : <DatabaseZap size={22} />}</span>
          <div>
            <h2 className="frog-card-title">{complete ? "Historique traité" : "Enrichissement de l’historique"}</h2>
            <p className="frog-card-text">{progress.completed} / {progress.total} activité(s) analysée(s) · {percent}%</p>
          </div>
        </div>

        <div style={{ height: 10, background: "var(--frog-surface-soft)", borderRadius: 999, overflow: "hidden", marginTop: 16 }}>
          <div style={{ height: "100%", width: `${percent}%`, background: "var(--frog-green)", transition: "width .2s ease" }} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 16 }}>
          <div style={{ border: "1px solid var(--frog-border)", borderRadius: 16, padding: 12 }}>
            <strong style={{ fontSize: 20 }}>{progress.success}</strong>
            <div className="frog-card-text">détail(s) récupéré(s)</div>
          </div>
          <div style={{ border: "1px solid var(--frog-border)", borderRadius: 16, padding: 12 }}>
            <strong style={{ fontSize: 20 }}>{progress.failed}</strong>
            <div className="frog-card-text">erreur(s)</div>
          </div>
        </div>

        {!complete && <button className="frog-button frog-button-primary frog-button-wide" style={{ marginTop: 16 }} onClick={enrichAll} disabled={running}>
          {running ? <Loader2 size={18} className="frog-spin" /> : <DatabaseZap size={18} />}
          {running ? "Enrichissement en cours…" : "Enrichir toutes les activités"}
        </button>}

        {progress.failed > 0 && <button className="frog-button frog-button-secondary frog-button-wide" style={{ marginTop: 10 }} onClick={retryFailed} disabled={running}>
          {running ? <Loader2 size={18} className="frog-spin" /> : <RefreshCw size={18} />} Réessayer les erreurs
        </button>}
      </>}
    </section>

    <p className="frog-footnote">Le traitement se fait par petits lots et peut être relancé sans doublon. Frog conserve séparément le résumé d’activité et le détail brut renvoyé par COROS.</p>
  </main>;
}
