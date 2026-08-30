import { NextResponse } from "next/server";
import { panelUrl } from "@/lib/env";

/**
 * Startet die Steam-Anmeldung (OpenID 2.0).
 *
 * Die Rücksprungadresse wird aus PANEL_URL gebaut, nicht aus dem Host-Header -
 * sonst ließe sich der Rücksprung über einen gefälschten Header umlenken.
 */
export async function GET() {
  const base = panelUrl().replace(/\/+$/, "");

  const params = new URLSearchParams({
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "checkid_setup",
    "openid.return_to": `${base}/api/auth/steam/callback`,
    "openid.realm": base,
    "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
    "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
  });

  return NextResponse.redirect(
    `https://steamcommunity.com/openid/login?${params.toString()}`,
  );
}
