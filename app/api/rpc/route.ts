import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { runRpc } from "@/lib/local/rpc";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ data: null, error: "Non authentifié" }, { status: 401 });

  try {
    const body = await request.json();
    const name = String(body?.name || "");
    const args = body?.args && typeof body.args === "object" ? body.args : {};
    const data = await runRpc(user.id, name, args);
    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json({ data: null, error: error instanceof Error ? error.message : "Opération impossible" }, { status: 400 });
  }
}
