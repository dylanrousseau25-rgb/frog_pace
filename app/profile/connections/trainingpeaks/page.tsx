"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, ExternalLink, Loader2, RefreshCw, Send, Unplug, Waypoints, Watch } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type BridgeStatus = {
  partnerConfigured: boolean;
  connected: boolean;
  connectionStatus: string;
  scopes: string[];
  exports: { total: number; exported: number; blocked: number };
  blockerCode: string | null;
};

export default function TrainingPeaksConnectionPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: invokeError } = await supabase.functions.invoke("trainingpeaks-bridge", { body: { action: "status" } });
    if (invokeError) setError(invokeError.message);
    else if (data?.error) setError(String(data.error));
    else setStatus(data as BridgeStatus);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("trainingpeaks");
    const detail = params.get("message");
    if (result === "connected") setMessage("TrainingPeaks est connecté à Frog Pace.");
    else if (result === "blocked") setMessage(detail || "Le bridge est prêt mais l’accès partenaire TrainingPeaks doit encore être activé.");
    else if (result === "error") setError(detail || "La connexion TrainingPeaks n’a pas pu être finalisée.");
    load();
  }, [load]);

  async function exportPlan() {
    setBusy(true);
    setError(null);
    setMessage(null);
    const { data, error: invokeError } = await supabase.functions.invoke("trainingpeaks-bridge", { body: { action: "export_plan" } });
    setBusy(false);
    if (invokeError) {
      setError(invokeError.message);
      return;
    }
    if (data?.error) {
      setError(String(data.error));
      return;
    }
    setMessage(`${Number(data?.exported || 0)} séance(s) envoyée(s) sur ${Number(data?.total || 0)}. ${Number(data?.blocked || 0)} bloquée(s), ${Number(data?.failed || 0)} en erreur.`);
    await load();
  }

  async function disconnect() {
    if (!window.confirm("Déconnecter TrainingPeaks de Frog Pace ? Les séances déjà envoyées resteront dans TrainingPeaks.")) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/trainingpeaks/disconnect", { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "Déconnexion impossible");
      setMessage("TrainingPeaks est déconnecté de Frog Pace.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Déconnexion TrainingPeaks impossible");
    } finally {
      setBusy(false);
    }
  }

  return <main>
    <Link href="/profile/connections" className="frog-button frog-button-secondary" style={{ marginBottom: 14 }}><ArrowLeft size={17} /> Connexions</Link>
    <div className="frog-kicker">Lot 6 · Passerelle montre</div>
    <h1 className="frog-page-title">TrainingPeaks → COROS</h1>
    <p className="frog-page-subtitle">Frog envoie les séances structurées dans ton calendrier TrainingPeaks. COROS les récupère ensuite et les synchronise avec la montre.</p>

    {message && <div className="frog-success" style={{ marginBottom: 12 }}>{message}</div>}
    {error && <div className="frog-error" style={{ marginBottom: 12 }}>{error}</div>}

    <section className="frog-card frog-card-soft">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div className="frog-kicker">État du bridge</div>
          <h2 className="frog-card-title" style={{ marginTop: 6 }}>
            {loading ? "Vérification…" : status?.connected ? "TrainingPeaks connecté" : status?.partnerConfigured ? "Prêt à connecter ton compte" : "Code prêt · validation partenaire en attente"}
          </h2>
        </div>
        {loading ? <Loader2 size={22} className="frog-spin" /> : status?.connected ? <CheckCircle2 size={22} /> : <Waypoints size={22} />}
      </div>

      {!loading && <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 9, marginTop: 14 }}>
        <div className="frog-metric"><div className="frog-metric-label">Préparées</div><div className="frog-metric-value">{status?.exports.total ?? 0}</div></div>
        <div className="frog-metric"><div className="frog-metric-label">Envoyées</div><div className="frog-metric-value">{status?.exports.exported ?? 0}</div></div>
        <div className="frog-metric"><div className="frog-metric-label">Bloquées</div><div className="frog-metric-value">{status?.exports.blocked ?? 0}</div></div>
      </div>}

      {!loading && !status?.partnerConfigured && <div style={{ marginTop: 16 }}>
        <div className="frog-status-line"><AlertTriangle size={16} /> Accès API partenaire requis</div>
        <p className="frog-card-text">TrainingPeaks réserve son API aux applications approuvées. Frog Pace demande les permissions <strong>workouts:plan</strong>, <strong>workouts:read</strong> et <strong>athlete:profile</strong>.</p>
        <p className="frog-card-text">URL de retour à déclarer : <code>https://frog-pace.vercel.app/api/trainingpeaks/callback</code></p>
        <a href="https://api.trainingpeaks.com/request-access" target="_blank" rel="noreferrer" className="frog-button frog-button-primary frog-button-wide" style={{ marginTop: 10 }}>
          Demander l’accès API TrainingPeaks <ExternalLink size={17} />
        </a>
      </div>}

      {!loading && status?.partnerConfigured && !status.connected && <a href="/api/trainingpeaks/start" className="frog-button frog-button-primary frog-button-wide" style={{ marginTop: 16 }}>
        <Waypoints size={18} /> Connecter mon compte TrainingPeaks
      </a>}

      {!loading && status?.connected && <div style={{ display: "grid", gap: 9, marginTop: 16 }}>
        <button className="frog-button frog-button-primary frog-button-wide" disabled={busy} onClick={exportPlan}>
          {busy ? <><Loader2 size={17} className="frog-spin" /> Envoi du plan…</> : <><Send size={17} /> Envoyer tout le plan vers TrainingPeaks</>}
        </button>
        <button className="frog-button frog-button-secondary frog-button-wide" disabled={busy} onClick={load}><RefreshCw size={17} /> Actualiser l’état</button>
        <button className="frog-button frog-button-secondary frog-button-wide" disabled={busy} onClick={disconnect}><Unplug size={17} /> Déconnecter TrainingPeaks</button>
      </div>}
    </section>

    <section className="frog-card">
      <div className="frog-kicker">À faire une seule fois dans COROS</div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 7 }}><Watch size={20} /><h2 className="frog-card-title">Relier TrainingPeaks à COROS</h2></div>
      <ol className="frog-card-text" style={{ paddingLeft: 20, display: "grid", gap: 8 }}>
        <li>Dans l’app COROS : Profil → Paramètres → Applications tierces → Synchronisation des données → TrainingPeaks.</li>
        <li>Autorise le même compte TrainingPeaks que celui connecté à Frog Pace.</li>
        <li>Dans COROS, ouvre la bibliothèque de plans TrainingPeaks et démarre le plan si nécessaire.</li>
        <li>Actualise le calendrier COROS puis utilise « Synchroniser avec ton appareil ».</li>
      </ol>
      <p className="frog-footnote">Les futures modifications faites par Frog sont envoyées à TrainingPeaks. COROS demande parfois une actualisation manuelle du calendrier pour récupérer les changements.</p>
    </section>

    <section className="frog-card">
      <div className="frog-kicker">Compatibilité</div>
      <h2 className="frog-card-title" style={{ marginTop: 7 }}>Course et vélo structurés en priorité</h2>
      <p className="frog-card-text">Les 21 séances déjà marquées compatibles par le Workout Builder peuvent utiliser cette passerelle. Les séances guidées uniquement dans Frog Pace restent volontairement hors export.</p>
      <p className="frog-card-text">TrainingPeaks peut refuser la planification de séances futures sur certains comptes Basic ; Frog affichera alors le blocage réel renvoyé par l’API au lieu de déclarer l’export réussi.</p>
    </section>
  </main>;
}
