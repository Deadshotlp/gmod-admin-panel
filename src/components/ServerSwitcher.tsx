"use client";

import { useState } from "react";
import { inputStyle } from "./ui";

/**
 * Umschalter zwischen mehreren Servern. Erscheint nur, wenn tatsächlich mehr als
 * einer konfiguriert ist - bei einem einzelnen wäre das nur Beiwerk.
 */
export default function ServerSwitcher({
  servers,
  activeId,
}: {
  servers: Array<{ id: string; label: string }>;
  activeId: string;
}) {
  const [busy, setBusy] = useState(false);

  if (servers.length < 2) return null;

  return (
    <div style={{ padding: "0 20px 14px" }}>
      <div className="card-label">Server</div>

      <select
        value={activeId}
        disabled={busy}
        style={{ ...inputStyle, padding: "6px 8px", fontSize: 13 }}
        onChange={async (event) => {
          setBusy(true);

          try {
            await fetch("/api/server/select", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: event.target.value }),
            });

            // Vollständig neu laden: sämtliche Ansichten hängen am gewählten
            // Server, ein Teilaustausch würde alte Daten stehen lassen.
            window.location.reload();
          } catch {
            setBusy(false);
          }
        }}
      >
        {servers.map((server) => (
          <option key={server.id} value={server.id}>
            {server.label}
          </option>
        ))}
      </select>
    </div>
  );
}
