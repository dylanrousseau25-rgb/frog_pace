"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Send, Waypoints } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type ExportRow = {
  id: string;
  status: "ready" | "blocked" | "pending" | "exported" | "failed";
  blocker_code: string | null;
  blocker_message: string | null;
  provider_reference: string | null;
  attempt_count: number;
  last_attempt_at: string | null;
  exported_at: string | null;
};

export default function TrainingPeaksWorkoutExportCard({ workoutId, compatible }: { workoutId: string; compatible: boolean }) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [row, setRow] = useState<ExportRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!compatible) return;
    const { data, error: queryError } = await supabase
      .from("workout_exports")
      .select("id,status,blocker_code,blocker_message,provider_reference,attempt_count,last_attempt_at,exported_at")
      .eq("planned_workout_id", workoutId)
      .eq("provider", "trainingpeaks")
      .maybeSingle();
    if (queryError) setError(queryError.message);
    else setRow(data as ExportRow | null);
  }, [compatible, supabase, workoutId]);

  useEffect(() => { load(); }, [load]);

  async function exportNow() {
    setBusy(true);
    setError(null);
    const { data, error: invokeError } = await supabase.functions.invoke("trainingpeaks-bridge", {
      body: { action: "export", workoutId }
    });
    setBusy(false);
    if (invokeError) {
      setError(invokeError.message);
      return;
    }
    if (data?.error) {
      setError(String(data.error));
      return;
    }
    setRow((data?.export || null) as ExportRow | null);
  }

  if (!compatible) return null;

  const exported = row?.status === "exported";
  const partnerBlocked = row?.blocker_code === "TRAININGPEAKS_PARTNER_ACCESS_REQUIRED";
  const notConnected = row?.blocker_code === "TRAININGPEAKS_NOT_CONNECTED";
  const blocked = row?.status === "blocked";

  return <section className="frog-card" style={{ marginTop: 14 }}>
    <div className="frog-kicker">Lot 6 · Passerelle TrainingPeaks</div>
    <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 7 }}>
      {exported ? <CheckCircle2 size={20} /> : blocked ? <AlertTriangle size={20} /> : <Waypoints size={20} />}
      <h2 className="frog-card-title">
        {exported ? "Présente dans TrainingPeaks" : partnerBlocked ? "Bridge prêt · accès partenaire requis" : notConnected ? "TrainingPeaks à connecter" : "Prête pour TrainingPeaks"}
      </h2>
    </div>

    <p className="frog-card-text">
      {row?.blocker_message || "Frog convertit cette séance en Workout Builder TrainingPeaks, puis TrainingPeaks la transmet au calendrier COROS."}
    </p>

    {exported && <div className="frog-status-line" data-connected style={{ marginTop: 10 }}>
      Export confirmé{row.provider_reference ? ` · TP #${row.provider_reference}` : ""}
    </div>}

    {row?.last_attempt_at && <p className="frog-card-text" style={{ marginTop: 8 }}>
      Dernière tentative : {new Date(row.last_attempt_at).toLocaleString("fr-FR")} · {row.attempt_count} tentative(s)
    </p>}
    {error && <div className="frog-error" style={{ marginTop: 10 }}>{error}</div>}

    <div style={{ display: "grid", gap: 9, marginTop: 12 }}>
      {!exported && !partnerBlocked && !notConnected && <button className="frog-button frog-button-primary frog-button-wide" disabled={busy} onClick={exportNow}>
        {busy ? <><Loader2 size={16} className="frog-spin" /> Envoi…</> : <><Send size={16} /> Envoyer via TrainingPeaks</>}
      </button>}
      <Link href="/profile/connections/trainingpeaks" className="frog-button frog-button-secondary frog-button-wide">
        <Waypoints size={16} /> Gérer la passerelle TrainingPeaks
      </Link>
    </div>
  </section>;
}
