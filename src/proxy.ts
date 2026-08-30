import { NextResponse, type NextRequest } from "next/server";

/**
 * Content-Security-Policy mit Nonce.
 *
 * Next fügt für die Hydration Inline-Skripte ein (sie tragen die vom Server
 * gerenderten Daten). Erlaubt die CSP nur 'self', blockiert der Browser sie -
 * die Seite ist dann sichtbar, aber tot: keine Zustandsänderung, kein useEffect,
 * kein Datenabruf. Im Serverprotokoll steht dazu nichts, weil der Fehler
 * ausschließlich im Browser passiert.
 *
 * Statt pauschal 'unsafe-inline' zu erlauben, bekommt jede Anfrage eine frische
 * Nonce. Next liest sie aus dem Anfrage-Header und hängt sie an seine eigenen
 * Skripte. 'strict-dynamic' erlaubt zusätzlich die Bundles, die diese Skripte
 * nachladen.
 */
export default function proxy(request: NextRequest) {
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const isDev = process.env.NODE_ENV !== "production";

  const csp = [
    "default-src 'self'",
    // unsafe-eval nur in der Entwicklung, dort braucht es das Hot Reloading.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Die Komponenten nutzen style-Attribute, die lassen sich nicht mit einer
    // Nonce versehen.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://avatars.steamstatic.com",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    // Der Steam-Login springt per Formular zu steamcommunity.com.
    "form-action 'self' https://steamcommunity.com",
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);

  return response;
}

export const config = {
  matcher: [
    /*
     * Statische Dateien ausnehmen: sie brauchen keine Nonce, und den Proxy bei
     * jedem Chunk laufen zu lassen kostet nur Zeit.
     */
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
