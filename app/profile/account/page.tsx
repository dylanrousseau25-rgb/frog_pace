"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertTriangle, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function AccountPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deleteAccount() {
    if (confirmation !== "SUPPRIMER") return;
    if (!window.confirm("Dernière confirmation : supprimer définitivement ton compte Frog Pace et toutes les données Frog associées ?")) return;
    setBusy(true);
    setError(null);
    const { data, error: invokeError } = await supabase.functions.invoke("account-delete", {
      body: { confirmation }
    });
    if (invokeError || data?.error || !data?.deleted) {
      setBusy(false);
      return setError(invokeError?.message || String(data?.error || "Suppression impossible"));
    }
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    window.location.href = "/login?account=deleted";
  }

  return <main>
    <div className="frog-kicker">Compte</div>
    <h1 className="frog-page-title">Compte & données</h1>
    <p className="frog-page-subtitle">Gère les actions sensibles séparément des réglages sportifs.</p>

    <section className="frog-card frog-card-soft">
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}><ShieldCheck size={21} /><h2 className="frog-card-title">Tes données</h2></div>
      <p className="frog-card-text">Tu peux déconnecter les services externes sans supprimer ton compte, ou supprimer uniquement les mémoires du Coach. Les détails sont décrits dans les pages publiques ci-dessous.</p>
      <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
        <Link href="/profile/connections" className="frog-button frog-button-secondary frog-button-wide">Connexions & appareils</Link>
        <Link href="/profile/memory" className="frog-button frog-button-secondary frog-button-wide">Ce que Frog sait de moi</Link>
        <Link href="/legal/data" className="frog-button frog-button-secondary frog-button-wide">Contrôle & suppression des données</Link>
        <Link href="/legal/privacy" className="frog-button frog-button-secondary frog-button-wide">Politique de confidentialité</Link>
      </div>
    </section>

    <section className="frog-card" style={{ borderColor: "var(--frog-danger, #c64b4b)" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}><AlertTriangle size={21} /><h2 className="frog-card-title">Supprimer définitivement le compte</h2></div>
      <p className="frog-card-text">Cette action supprime ton compte Frog Pace et les données Frog associées : activités importées, objectifs, plans, analyses, feedbacks, mémoire, conversations et jetons de connexion. Elle est irréversible.</p>
      <p className="frog-card-text">Les données déjà présentes dans COROS, TrainingPeaks ou un autre service tiers restent sous le contrôle de ce service.</p>

      <div className="frog-field" style={{ marginTop: 14 }}>
        <label htmlFor="delete-confirm">Tape <strong>SUPPRIMER</strong> pour confirmer</label>
        <input id="delete-confirm" className="frog-input" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" />
      </div>
      {error && <div className="frog-error" style={{ marginTop: 10 }}>{error}</div>}
      <button type="button" className="frog-button frog-button-secondary frog-button-wide" style={{ marginTop: 14 }} disabled={busy || confirmation !== "SUPPRIMER"} onClick={deleteAccount}>
        {busy ? <><Loader2 size={17} className="frog-spin" /> Suppression…</> : <><Trash2 size={17} /> Supprimer mon compte</>}
      </button>
    </section>
  </main>;
}
