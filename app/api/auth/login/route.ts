import { NextResponse } from "next/server";
import { authenticateUser, createSession } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const email = String(body?.email || "");
    const password = String(body?.password || "");
    const user = await authenticateUser(email, password);
    if (!user) return NextResponse.json({ error: "E-mail ou mot de passe incorrect." }, { status: 401 });
    await createSession(user.id);
    return NextResponse.json({ user });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Connexion impossible." }, { status: 400 });
  }
}
