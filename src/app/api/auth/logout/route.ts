import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/session";
import { panelUrl } from "@/lib/env";

export async function POST() {
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}

export async function GET() {
  await clearSessionCookie();
  return NextResponse.redirect(`${panelUrl().replace(/\/+$/, "")}/login`);
}
