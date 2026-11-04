"use client";

/**
 * Auffangseite für Fehler, die bis in das Wurzel-Layout durchschlagen.
 *
 * Ist sie nicht definiert, erzeugt Next selbst eine Variante - und genau deren
 * Voraberzeugung (`/_global-error`) ist beim Bauen im Container abgebrochen.
 * Eine eigene, bewusst simple Seite nimmt diese Unbekannte aus dem Build und
 * ergibt nebenbei eine verständlichere Fehlerseite.
 *
 * global-error ersetzt das Wurzel-Layout, deshalb müssen html und body hier
 * selbst gerendert werden.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="de">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#0b0b0e",
          color: "#ededf0",
          fontFamily: "Inter, Segoe UI, system-ui, sans-serif",
        }}
      >
        <div
          style={{
            maxWidth: 460,
            padding: 36,
            border: "1px solid #25252c",
            borderRadius: 16,
            background: "#141418",
          }}
        >
          <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>
            Da ist etwas schiefgegangen
          </h1>

          <p style={{ color: "#acacb6", fontSize: 14, marginTop: 0 }}>
            Das Panel konnte die Seite nicht darstellen. Meist hilft ein neuer
            Versuch. Bleibt es dabei, steht der Grund im Serverprotokoll.
          </p>

          {error.digest && (
            <p
              style={{
                fontFamily: "Consolas, monospace",
                fontSize: 12,
                color: "#8b8b97",
              }}
            >
              Kennung: {error.digest}
            </p>
          )}

          <button
            onClick={() => reset()}
            style={{
              font: "inherit",
              fontSize: 14,
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid #6656e3",
              background: "#6656e3",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            Erneut versuchen
          </button>
        </div>
      </body>
    </html>
  );
}
