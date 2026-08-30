import { NextResponse } from "next/server";
import { panelUrl, steamApiKey } from "@/lib/env";
import { setSessionCookie } from "@/lib/session";
import { refreshDisplayName } from "@/lib/auth";
import { checkRateLimit, rateLimitKey } from "@/lib/rateLimit";

/**
 * Rücksprung von Steam.
 *
 * Entscheidend: die Angaben aus der URL werden NICHT geglaubt, sondern per
 * check_authentication an Steam zurückgeschickt. Ohne diesen Schritt könnte
 * jeder eine beliebige SteamID in die Adresszeile schreiben.
 */
export async function GET(request: Request) {
  if (!checkRateLimit(rateLimitKey(request, "steam-callback"), 20, 60_000)) {
    return NextResponse.json({ error: "Zu viele Versuche" }, { status: 429 });
  }

  const url = new URL(request.url);
  const base = panelUrl().replace(/\/+$/, "");

  const params = new URLSearchParams();

  for (const [key, value] of url.searchParams) {
    params.set(key, value);
  }

  params.set("openid.mode", "check_authentication");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  let verified = false;

  try {
    const response = await fetch("https://steamcommunity.com/openid/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      signal: controller.signal,
      cache: "no-store",
    });

    const text = await response.text();
    verified = /is_valid\s*:\s*true/i.test(text);
  } catch {
    return NextResponse.redirect(`${base}/login?error=steam_unreachable`);
  } finally {
    clearTimeout(timeout);
  }

  if (!verified) {
    return NextResponse.redirect(`${base}/login?error=invalid`);
  }

  const claimedId = url.searchParams.get("openid.claimed_id") ?? "";
  const match = claimedId.match(/\/id\/(\d{17})$/);

  if (!match) {
    return NextResponse.redirect(`${base}/login?error=no_steamid`);
  }

  const steamId = match[1];

  await setSessionCookie(steamId);

  // Anzeigename nachziehen, falls der Nutzer bereits eingetragen ist. Legt
  // bewusst niemanden neu an - Zugang vergibt ein Admin.
  const apiKey = steamApiKey();

  if (apiKey) {
    try {
      const profile = await fetch(
        `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${apiKey}&steamids=${steamId}`,
        { cache: "no-store" },
      );

      const data = (await profile.json()) as {
        response?: { players?: Array<{ personaname?: string }> };
      };

      const name = data.response?.players?.[0]?.personaname;

      if (name) await refreshDisplayName(steamId, name);
    } catch {
      // Der Anzeigename ist Beiwerk - ein Fehler hier darf die Anmeldung nicht
      // scheitern lassen.
    }
  }

  return NextResponse.redirect(base);
}
