import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { execute } from "@/lib/db";
import { enrichCorosActivityDetails } from "@/lib/coros/activity-details";
import { runCorosWorkoutExport } from "@/lib/coros/workout-export";

export async function POST(request: Request, { params }: { params: Promise<{ name: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  const { name } = await params;

  try {
    const body = await request.json().catch(() => ({}));

    if (name === "account-delete") {
      if (body?.confirmation !== "SUPPRIMER") {
        return NextResponse.json({ error: "Confirmation invalide" }, { status: 400 });
      }
      await execute("delete from users where id=?", [user.id]);
      return NextResponse.json({ deleted: true });
    }

    if (name === "coros-activity-details") {
      const data = await enrichCorosActivityDetails(user.id, body?.batchSize, Boolean(body?.retryFailed));
      return NextResponse.json(data);
    }

    if (name === "coros-workout-export") {
      const data = await runCorosWorkoutExport(user.id, String(body?.action || "capabilities"), body || {});
      return NextResponse.json(data);
    }

    return NextResponse.json({ error: "Fonction locale inconnue" }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Fonction impossible" }, { status: 400 });
  }
}
