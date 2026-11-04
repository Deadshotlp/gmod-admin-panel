"use client";

import { useState } from "react";
import Icon from "./Icon";

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
    <div className="sidebar-server">
      <label className="server-select">
        <Icon name="server" size={15} className="lead" />
        <select
          value={activeId}
          disabled={busy}
          aria-label="Server wechseln"
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
        <Icon name="chevrons" size={16} className="trail" />
      </label>
    </div>
  );
}
