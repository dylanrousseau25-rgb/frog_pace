import { NextResponse } from "next/server";
import { deleteCurrentSession } from "@/lib/auth";

export async function POST() {
  await deleteCurrentSession();
  return NextResponse.json({ ok: true });
}
