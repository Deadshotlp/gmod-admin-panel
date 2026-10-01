import WebSocket from "ws";
import { AuthError, requireUser } from "@/lib/auth";
import { getConsoleSocket } from "@/lib/pterodactyl";
import { checkRateLimit, rateLimitKey } from "@/lib/rateLimit";
import { getActiveServer } from "@/lib/servers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Live-Konsole als Server-Sent Events.
 *
 * Früher verband sich der Browser direkt mit dem Konsolen-Websocket von Wings.
 * Wings nimmt aber nur Verbindungen an, deren Origin-Header die Panel-Adresse
 * (Pelican/Pterodactyl) ist - ein Browser auf der Domain dieses Panels wurde
 * abgewiesen, die Konsole blieb auf "Fehler". Der Browser kann den Origin
 * nicht setzen, dieser Server schon: er hält die Verbindung und reicht die
 * Ausgabe weiter. Token und API-Schlüssel verlassen den Server dabei nicht.
 *
 * Ereignisse an den Browser:
 *   status  "verbinde" | "an"
 *   lines   string[]  (Konsolenzeilen, Farbcodes entfernt)
 *   failure string    (Fehlertext; danach endet der Strom)
 */

// ANSI-Farb- und Steuersequenzen aus der Spielkonsole entfernen.
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[A-Za-z]|\u001b\][^\u0007]*\u0007/g;

function cleanLine(line: string): string {
  return line.replace(ANSI, "").replace(/\r/g, "");
}

export async function GET(request: Request) {
  try {
    await requireUser("admin");
  } catch (error) {
    if (error instanceof AuthError) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: error.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Nicht verfügbar" }), { status: 503 });
  }

  if (!checkRateLimit(rateLimitKey(request, "console-stream"), 20, 60_000)) {
    return new Response(JSON.stringify({ error: "Zu viele Anfragen" }), { status: 429 });
  }

  const server = await getActiveServer();
  const first = await getConsoleSocket(server);

  if (!first.ok || !first.socket || !first.token || !server.pterodactyl) {
    return new Response(JSON.stringify({ error: first.message ?? "Keine Konsolenverbindung" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  const origin = new URL(server.pterodactyl.url).origin;
  const encoder = new TextEncoder();

  let finish: () => void = () => undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const send = (event: string, data: unknown) => {
        if (closed) return;

        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      const socket = new WebSocket(first.socket!, { headers: { Origin: origin } });

      // Kommentarzeilen halten Proxys davon ab, den Strom als tot zu kappen.
      const keepAlive = setInterval(() => {
        if (closed) return;

        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          finish();
        }
      }, 15_000);

      finish = () => {
        if (closed) return;
        closed = true;

        clearInterval(keepAlive);

        try {
          socket.close();
        } catch {
          // schon zu
        }

        try {
          controller.close();
        } catch {
          // schon zu
        }
      };

      const fail = (message: string) => {
        send("failure", message);
        finish();
      };

      send("status", "verbinde");

      socket.on("open", () => {
        socket.send(JSON.stringify({ event: "auth", args: [first.token] }));
      });

      socket.on("message", (raw) => {
        let payload: { event?: string; args?: unknown[] };

        try {
          payload = JSON.parse(raw.toString()) as typeof payload;
        } catch {
          return;
        }

        switch (payload.event) {
          case "auth success":
            send("status", "an");
            // Bisherige Ausgabe nachreichen, sonst startet man im Leeren.
            socket.send(JSON.stringify({ event: "send logs", args: [null] }));
            break;

          case "console output":
            if (payload.args && payload.args.length > 0) {
              send(
                "lines",
                payload.args.map((line) => cleanLine(String(line))),
              );
            }
            break;

          case "token expiring":
          case "token expired":
            // Token läuft nach ~10 Minuten ab - neues holen und weitermachen.
            void getConsoleSocket(server).then((fresh) => {
              if (fresh.ok && fresh.token && socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ event: "auth", args: [fresh.token] }));
              } else if (payload.event === "token expired") {
                fail(fresh.message ?? "Konsolen-Token konnte nicht erneuert werden");
              }
            });
            break;

          case "jwt error":
            fail(`Wings lehnt das Konsolen-Token ab: ${String(payload.args?.[0] ?? "")}`);
            break;

          case "daemon error":
            send("lines", [`[Wings] ${String(payload.args?.[0] ?? "Fehler")}`]);
            break;
        }
      });

      socket.on("unexpected-response", (_req, res) => {
        fail(
          res.statusCode === 403
            ? "Wings lehnt die Verbindung ab (403). Stimmt PTERODACTYL_URL mit der Panel-Adresse überein, die Wings kennt?"
            : `Wings antwortete mit HTTP ${res.statusCode}`,
        );
      });

      socket.on("error", (error) => {
        fail(`Verbindung zu Wings fehlgeschlagen: ${error.message}`);
      });

      socket.on("close", () => {
        fail("Verbindung zu Wings beendet");
      });

      request.signal.addEventListener("abort", () => finish());
    },

    cancel() {
      finish();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
