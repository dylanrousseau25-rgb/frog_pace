"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, Unplug, Watch } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type SyncInfo = {
  status: string;
  started_at: string;
  completed_at: string | null;
  imported_activities: number;
  error_message: string | null;
};

function syncLabel(status?: string | null) {
  if (status === "success") return "Réussie";
  if (status === "partial") return "Partielle";
  if (status === "error") return "Erreur";
  if (status === "running") return "En cours";
  return "—";
}

export default function ConnectionsPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("disconnected");
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [activityCount, setActivityCount] = useState(0);
  const [latestSync, setLatestSync] = useState<SyncInfo | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      setLoading(false);
      return;
    }

    const [connectionResult, countResult, syncResult] = await Promise.all([
      supabase
        .from("provider_connections")
        .select("status,last_sync_at,last_error")
        .eq("user_id", auth.user.id)
        .eq("provider", "coros")
        .maybeSingle(),
      supabase
        .from("activities")
        .select("id", { count: "exact", head: true })
        .eq("user_id", auth.user.id)
        .eq("provider", "coros"),
      supabase
        .from("provider_syncs")
        .select("status,started_at,completed_at,imported_activities,error_message")
        .eq("user_id", auth.user.id)
        .eq("provider", "coros")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    ]);

    if (connectionResult.data) {
      setStatus(connectionResult.data.status);
      setLastSync(connectionResult.data.last_sync_at);
      if (connectionResult.data.last_error && connectionResult.data.status !== "connected") {
        setError(connectionResult.data.last_error);
      }
    } else {
      setStatus("disconnected");
      setLastSync(null);
    }
    setActivityCount(countResult.count || 0);
    setLatestSync(syncResult.data || null);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const coros = params.get("coros");
    const sync = params.get("sync");
    const detail = params.get("message");
    if (coros === "connected") {
      setMessage(sync === "error"
        ? "COROS est connecté. La première synchro a rencontré un problème : tu peux la relancer ci-dessous."
        : sync === "partial"
          ? "COROS est connecté. La première synchro est terminée avec quelques données indisponibles."
          : "COROS est connecté et la première synchronisation est terminée.");
    } else if (coros === "error") {
      setError(detail || "La connexion COROS n’a pas pu être finalisée.");
    }
    load();
  }, [load]);

  async function syncNow() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/coros/sync", { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "Synchronisation impossible");
      setMessage(body.status === "partial"
        ? `Synchronisation terminée avec quelques avertissements. ${body.importedActivities ?? 0} activité(s) traitée(s).`
        : `Synchronisation terminée. ${body.importedActivities ?? 0} activité(s) traitée(s).`);
      await load();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Synchronisation COROS impossible");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!window.confirm("Déconnecter COROS ? Les activités déjà importées resteront dans Frog Pace.")) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/coros/disconnect", { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "Déconnexion impossible");
      setMessage("COROS est déconnecté. Tes activités déjà importées sont conservées.");
      await load();
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : "Déconnexion COROS impossible");
    } finally {
      setBusy(false);
    }
  }

  const connected = status === "connected";

  return <main>
    <div className="frog-kicker">Connexions</div>
    <h1 className="frog-page-title">Appareils & données</h1>
    <p className="frog-page-subtitle">COROS alimente Frog Pace avec tes activités et les métriques réellement disponibles. Les tokens restent côté serveur.</p>

    {message && <div className="frog-success" style={{ marginBottom: 12 }}>{message}</div>}
    {error && <div className="frog-error" style={{ marginBottom: 12 }}>{error}</div>}

    <section className="frog-card">
      <div className="frog-provider-head">
        <span className="frog-provider-icon"><Watch size={22} /></span>
        <div>
          <h2 className="frog-card-title">COROS</h2>
          <p className="frog-card-text">Activités, récupération, charge, sommeil, HRV, VO₂max, seuil et prédictions quand COROS les expose.</p>
        </div>
      </div>

      {loading ? <div className="frog-status-line"><Loader2 size={16} className="frog-spin" /> Vérification…</div> : (
        <div className="frog-status-line" data-connected={connected}>
          {connected ? <CheckCircle2 size={16} /> : status === "connecting" ? <Loader2 size={16} className="frog-spin" /> : <span className="frog-status-dot" />}
          {connected ? "Connecté" : status === "connecting" ? "Connexion en cours" : status === "expired" ? "Connexion expirée" : "Non connecté"}
          {lastSync && <small>Dernière synchro : {new Date(lastSync).toLocaleString("fr-FR")}</small>}
        </div>
      )}

      {connected && !loading && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 14 }}>
          <div style={{ border: "1px solid var(--frog-border)", borderRadius: 16, padding: 12, background: "var(--frog-surface-soft)", display: "grid", gap: 3 }}>
            <strong style={{ fontSize: 20, lineHeight: 1 }}>{activityCount}</strong>
            <span style={{ color: "var(--frog-muted)", fontSize: 12 }}>activité(s) importée(s)</span>
          </div>
          <div style={{ border: "1px solid var(--frog-border)", borderRadius: 16, padding: 12, background: "var(--frog-surface-soft)", display: "grid", gap: 3 }}>
            <strong style={{ fontSize: 16, lineHeight: 1.2 }}>{syncLabel(latestSync?.status)}</strong>
            <span style={{ color: "var(--frog-muted)", fontSize: 12 }}>dernière synchro</span>
          </div>
        </div>
      )}

      {!connected ? (
        <a href="/api/coros/start" className="frog-button frog-button-primary frog-button-wide" style={{ marginTop: 16 }}>
          <Watch size={18} /> Connecter mon compte COROS
        </a>
      ) : (
        <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
          <button className="frog-button frog-button-primary frog-button-wide" onClick={syncNow} disabled={busy}>
            {busy ? <Loader2 size={18} className="frog-spin" /> : <RefreshCw size={18} />} Synchroniser maintenant
          </button>
          <button className="frog-button frog-button-secondary frog-button-wide" onClick={disconnect} disabled={busy}>
            <Unplug size={18} /> Déconnecter COROS
          </button>
        </div>
      )}

      <p className="frog-footnote">Déconnecter COROS supprime les jetons d’accès mais ne supprime jamais tes activités déjà importées dans Frog Pace.</p>
    </section>
  </main>;
}
