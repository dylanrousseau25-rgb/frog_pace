import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { runUserQuery, type QuerySpec } from "@/lib/local/query";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ data: null, error: { message: "Non authentifié" } }, { status: 401 });

  try {
    const spec = await request.json() as QuerySpec;
    const result = await runUserQuery(user.id, spec);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ data: null, error: { message: error instanceof Error ? error.message : "Requête impossible" } }, { status: 400 });
  }
}
