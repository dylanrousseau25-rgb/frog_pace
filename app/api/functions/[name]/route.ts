import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { execute } from "@/lib/db";

export async function POST(request: Request, { params }: { params: Promise<{ name: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  const { name } = await params;

  if (name !== "account-delete") {
    return NextResponse.json({ error: "Fonction locale inconnue" }, { status: 404 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    if (body?.confirmation !== "SUPPRIMER") {
      return NextResponse.json({ error: "Confirmation invalide" }, { status: 400 });
    }
    await execute("delete from users where id=?", [user.id]);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Suppression impossible" }, { status: 400 });
  }
}
