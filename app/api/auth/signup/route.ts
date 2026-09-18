import { NextResponse } from "next/server";
import { createSession, createUser } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const email = String(body?.email || "");
    const password = String(body?.password || "");
    const displayName = String(body?.displayName || "");
    if (!displayName.trim()) return NextResponse.json({ error: "Prénom requis." }, { status: 400 });
    const user = await createUser(email, password, displayName);
    await createSession(user.id);
    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Création du compte impossible." }, { status: 400 });
  }
}
