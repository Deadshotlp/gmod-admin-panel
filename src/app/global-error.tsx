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
          background: "#0b0e13",
          color: "#e6ebf2",
          fontFamily: "Inter, Segoe UI, system-ui, sans-serif",
        }}
      >
        <div
          style={{
            maxWidth: 460,
            padding: 36,
            border: "1px solid #2a3444",
            borderRadius: 4,
            background: "#141922",
          }}
        >
          <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>
            Da ist etwas schiefgegangen
          </h1>

          <p style={{ color: "#9aa7b8", fontSize: 14, marginTop: 0 }}>
            Das Panel konnte die Seite nicht darstellen. Meist hilft ein neuer
            Versuch. Bleibt es dabei, steht der Grund im Serverprotokoll.
          </p>

          {error.digest && (
            <p
              style={{
                fontFamily: "Consolas, monospace",
                fontSize: 12,
                color: "#6b7688",
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
              borderRadius: 4,
              border: "1px solid #3a86d4",
              background: "#3a86d4",
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
