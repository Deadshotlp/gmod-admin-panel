import crypto from "node:crypto";
import { cookies } from "next/headers";
import { sessionSecret } from "./env";

/**
 * Session als signiertes Cookie, ohne Serverspeicher.
 *
 * Format: <steamId64>.<ablaufZeitpunkt>.<HMAC-SHA256 der ersten beiden Teile>
 * Der Vergleich läuft über timingSafeEqual, damit sich die Signatur nicht über
 * Antwortzeiten erraten lässt.
 */

const COOKIE_NAME = "swrp_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 14; // 14 Tage

function sign(payload: string): string {
  return crypto
    .createHmac("sha256", sessionSecret())
    .update(payload)
    .digest("hex");
}

export function createToken(steamId: string): string {
  const expiresAt = Date.now() + MAX_AGE_SECONDS * 1000;
  const payload = `${steamId}.${expiresAt}`;

  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token: string | undefined): string | null {
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [steamId, expiresAtRaw, signature] = parts;

  if (!/^\d{17}$/.test(steamId)) return null;

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return null;

  const expected = sign(`${steamId}.${expiresAtRaw}`);

  const a = Buffer.from(signature, "utf8");
  const b = Buffer.from(expected, "utf8");

  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;

  return steamId;
}

export async function setSessionCookie(steamId: string): Promise<void> {
  const store = await cookies();

  store.set(COOKIE_NAME, createToken(steamId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

/** SteamID64 des angemeldeten Nutzers, oder null. */
export async function getSessionSteamId(): Promise<string | null> {
  const store = await cookies();
  return verifyToken(store.get(COOKIE_NAME)?.value);
}
