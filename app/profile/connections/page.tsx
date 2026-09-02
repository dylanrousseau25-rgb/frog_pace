"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, Watch } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function ConnectionsPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("disconnected");
  const [lastSync, setLastSync] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const { data } = await supabase
        .from("provider_connections")
        .select("status,last_sync_at")
        .eq("user_id", auth.user.id)
        .eq("provider", "coros")
        .maybeSingle();
      if (!active) return;
      if (data) {
        setStatus(data.status);
        setLastSync(data.last_sync_at);
      }
      setLoading(false);
    }
    load();
    return () => { active = false; };
  }, [supabase]);

  return <main>
    <div className="frog-kicker">Connexions</div>
    <h1 className="frog-page-title">Appareils & données</h1>
    <p className="frog-page-subtitle">Les fournisseurs sont isolés derrière un adaptateur. COROS est le premier connecteur prévu.</p>

    <section className="frog-card">
      <div className="frog-provider-head">
        <span className="frog-provider-icon"><Watch size={22} /></span>
        <div><h2 className="frog-card-title">COROS</h2><p className="frog-card-text">Activités, métriques disponibles et séances structurées quand l’accès le permet.</p></div>
      </div>

      {loading ? <div className="frog-status-line"><Loader2 size={16} className="frog-spin" /> Vérification…</div> : (
        <div className="frog-status-line" data-connected={status === "connected"}>
          {status === "connected" ? <CheckCircle2 size={16} /> : <span className="frog-status-dot" />}
          {status === "connected" ? "Connecté" : "Non connecté"}
          {lastSync && <small>Dernière synchro : {new Date(lastSync).toLocaleString("fr-FR")}</small>}
        </div>
      )}

      <button className="frog-button frog-button-secondary frog-button-wide" style={{ marginTop: 16 }} disabled>
        Connexion COROS — Lot 2
      </button>
      <p className="frog-footnote">Le bouton est volontairement désactivé tant que le flux OAuth sécurisé et le stockage durable des tokens ne sont pas prêts. Aucun faux statut de connexion.</p>
    </section>
  </main>;
}
