"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Watch } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import TrainingPeaksWorkoutExportCard from "@/components/trainingpeaks-workout-export-card";

type ExportRow = {
  id: string;
  status: "ready" | "blocked" | "pending" | "exported" | "failed";
  blocker_code: string | null;
  blocker_message: string | null;
  provider_tool: string | null;
  attempt_count: number;
  last_attempt_at: string | null;
  exported_at: string | null;
};

export default function CorosWorkoutExportCard({ workoutId, compatible }: { workoutId: string; compatible: boolean }) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [row, setRow] = useState<ExportRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!compatible) return;
    const { data, error: queryError } = await supabase
      .from("workout_exports")
      .select("id,status,blocker_code,blocker_message,provider_tool,attempt_count,last_attempt_at,exported_at")
      .eq("planned_workout_id", workoutId)
      .eq("provider", "coros")
      .maybeSingle();
    if (queryError) setError(queryError.message);
    else setRow(data as ExportRow | null);
  }, [compatible, supabase, workoutId]);

  useEffect(() => { load(); }, [load]);

  async function recheck() {
    setBusy(true);
    setError(null);
    const { data, error: invokeError } = await supabase.functions.invoke("coros-workout-export", {
      body: { action: "prepare", workoutId }
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

  if (!compatible) {
    return <>
      <section className="frog-card" style={{ marginTop: 14 }}>
        <div className="frog-kicker">Lot 6 · COROS</div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 7 }}><Watch size={20} /><h2 className="frog-card-title">Séance guidée dans Frog Pace</h2></div>
        <p className="frog-card-text">Ce type de séance n’est pas prévu pour un export automatique vers la montre.</p>
      </section>
      <TrainingPeaksWorkoutExportCard workoutId={workoutId} compatible={compatible} />
    </>;
  }

  const blocked = row?.status === "blocked";
  const exported = row?.status === "exported";

  return <>
    <section className="frog-card" style={{ marginTop: 14 }}>
      <div className="frog-kicker">Lot 6 · Export COROS direct</div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 7 }}>
        {exported ? <CheckCircle2 size={20} /> : blocked ? <AlertTriangle size={20} /> : <Watch size={20} />}
        <h2 className="frog-card-title">
          {exported ? "Envoyée vers COROS" : blocked ? "Frog est prêt · COROS bloque l’écriture" : "Prête pour COROS"}
        </h2>
      </div>

      <p className="frog-card-text">
        {row?.blocker_message || "La séance a été convertie au format d’export Frog→COROS et attend la capacité d’écriture du fournisseur."}
      </p>

      <div className="frog-status-line" data-connected={exported} style={{ marginTop: 10 }}>
        {exported ? "Export confirmé" : row?.blocker_code === "COROS_MCP_WRITE_UNAVAILABLE" ? "MCP COROS actuellement en lecture seule" : row?.status || "préparé"}
      </div>

      {row?.last_attempt_at && <p className="frog-card-text" style={{ marginTop: 8 }}>Dernière vérification : {new Date(row.last_attempt_at).toLocaleString("fr-FR")} · {row.attempt_count} tentative(s)</p>}
      {error && <div className="frog-error" style={{ marginTop: 10 }}>{error}</div>}

      {!exported && <button className="frog-button frog-button-secondary frog-button-wide" style={{ marginTop: 12 }} disabled={busy} onClick={recheck}>
        {busy ? <><Loader2 size={16} className="frog-spin" /> Vérification…</> : <><RefreshCw size={16} /> Revérifier la capacité COROS</>}
      </button>}
    </section>

    <TrainingPeaksWorkoutExportCard workoutId={workoutId} compatible={compatible} />
  </>;
}
