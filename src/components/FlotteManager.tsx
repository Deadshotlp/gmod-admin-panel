"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { PanelUser } from "@/lib/auth";
import { Notice, dateFormat, fetchWithTimeout, inputStyle, readJson } from "./ui";

interface Ship {
  id: number;
  serverKey: string;
  name: string;
  classId: string;
  factionId: string;
  systemId: string;
  state: string;
  order: string | null;
  orderCount: number;
  jumpTo: string | null;
  mapShip: boolean;
  hull: number;
  roe: string | null;
  target: number | null;
  fleetId: number | null;
  morale: number | null;
  surrendered: boolean;
  prisoner: boolean;
  interdictor: boolean;
  speed: number;
  distanceKm: number | null;
  updatedAt: number;
}

interface Fleet {
  id: number;
  serverKey: string;
  name: string;
  factionId: string;
  flagshipId: number;
  formation: string;
  mode: string;
}

interface Data {
  ships: Ship[];
  fleets: Fleet[];
  classes: Array<{ id: string; name: string; faction: string }>;
  factions: Array<{ id: string; name: string }>;
  systems: Array<{ id: string; name: string }>;
  bodies: Array<{ id: string; systemId: string; name: string; type: string }>;
}

const STATE_LABEL: Record<string, string> = {
  normal: "normal",
  spooling: "fährt hoch",
  jumping: "springt",
  hyperspace: "Hyperraum",
  exiting: "Austritt",
  disabled: "kampfunfähig",
  destroyed: "zerstört",
};

const ORDER_LABEL: Record<string, string> = {
  hold: "halten",
  move: "fliegt",
  patrol: "Patrouille",
  orbit: "Orbit",
  jump: "Sprung",
  attack: "Angriff",
};

const FORMATION_LABEL: Record<string, string> = {
  line: "Linie",
  column: "Kolonne",
  wedge: "Keil",
  wall: "Wand",
  sphere: "Kugel",
};

const MODE_LABEL: Record<string, string> = {
  formation: "Formation halten",
  engage: "Angreifen",
  hold: "Position halten",
};

const ROE_LABEL: Record<string, string> = {
  hold: "Feuer halten",
  return: "Nur zurückschießen",
  free: "Feuer frei (alle Feinde)",
};

export default function FlotteManager({ user }: { user: PanelUser }) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [filter, setFilter] = useState("");

  // Formulare
  const [spawn, setSpawn] = useState({ classId: "", factionId: "", distanceKm: 10, name: "" });
  const [jumpText, setJumpText] = useState("");
  const [bodyId, setBodyId] = useState("");
  const [radiusKm, setRadiusKm] = useState("");
  const [move, setMove] = useState({ x: 10, y: 0, z: 0 });
  const [edit, setEdit] = useState({ name: "", factionId: "" });
  const [attackId, setAttackId] = useState("");
  const [fleetName, setFleetName] = useState("");
  const [fleetPick, setFleetPick] = useState("");

  const canEdit = user.role === "editor" || user.role === "admin";

  const load = useCallback(async (refresh = false) => {
    try {
      const response = await fetchWithTimeout(`/api/flotte${refresh ? "?refresh=1" : ""}`, { cache: "no-store" });
      const { data: result, error } = await readJson<Data & { refreshed?: { ok: boolean; message: string } | null }>(
        response,
      );

      if (error) {
        setMessage({ ok: false, text: error });
        return;
      }

      if (result) {
        setData(result);
        if (refresh && result.refreshed && !result.refreshed.ok) {
          setMessage({ ok: false, text: `Server nicht erreicht: ${result.refreshed.message}` });
        }
      }
    } catch {
      setMessage({ ok: false, text: "Flotte konnte nicht geladen werden" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(true);
  }, [load]);

  const send = async (body: Record<string, unknown>, success: string) => {
    setBusy(true);
    setMessage(null);

    try {
      const response = await fetchWithTimeout("/api/flotte", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const { data: result, error } = await readJson<{ ok: boolean; message: string }>(response);

      if (error) {
        setMessage({ ok: false, text: error });
        return;
      }

      setMessage({ ok: Boolean(result?.ok), text: result?.ok ? success : result?.message ?? "Fehlgeschlagen" });

      // Kurz warten, dann gespeicherten Stand holen
      if (result?.ok) setTimeout(() => void load(true), 800);
    } catch {
      setMessage({ ok: false, text: "Anfrage fehlgeschlagen" });
    } finally {
      setBusy(false);
    }
  };

  const systemName = useMemo(() => {
    const map = new Map((data?.systems ?? []).map((s) => [s.id, s.name]));
    return (id: string | null) => (id ? map.get(id) ?? id : "-");
  }, [data]);

  if (loading) return <p className="subtitle">Flotte wird geladen…</p>;
  if (!data) return <div className="notice error">Keine Daten erhalten.</div>;

  const className = (id: string) => data.classes.find((c) => c.id === id)?.name ?? id;
  const factionName = (id: string) => data.factions.find((f) => f.id === id)?.name ?? id;
  const fleets = data.fleets ?? [];
  const fleetOf = (s: Ship) => fleets.find((fl) => fl.id === s.fleetId && fl.serverKey === s.serverKey) ?? null;

  const ship = data.ships.find((s) => s.id === selected) ?? null;
  const shipBodies = ship ? data.bodies.filter((b) => b.systemId === ship.systemId) : [];
  const f = filter.trim().toLowerCase();
  const shown = data.ships.filter(
    (s) =>
      !f ||
      s.name.toLowerCase().includes(f) ||
      systemName(s.systemId).toLowerCase().includes(f) ||
      className(s.classId).toLowerCase().includes(f) ||
      factionName(s.factionId).toLowerCase().includes(f),
  );

  const findSystem = (text: string) => {
    const t = text.trim().toLowerCase();
    return (
      data.systems.find((s) => s.name.toLowerCase() === t) ??
      data.systems.find((s) => s.id === t) ??
      data.systems.find((s) => s.name.toLowerCase().includes(t))
    );
  };

  return (
    <>
      {message && <Notice ok={message.ok}>{message.text}</Notice>}

      <div className="button-row" style={{ marginBottom: 14, flexWrap: "wrap" }}>
        <button onClick={() => void load(true)} disabled={busy}>
          Aktualisieren
        </button>
        {canEdit && (
          <button onClick={() => void send({ action: "pause" }, "Simulation umgeschaltet")} disabled={busy}>
            Simulation pausieren / fortsetzen
          </button>
        )}
        <input
          placeholder="Filter: Name, System, Klasse, Fraktion"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          style={{ ...inputStyle, maxWidth: 320 }}
        />
      </div>

      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div className="panel" style={{ flex: 2, minWidth: 520 }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 44 }}>#</th>
                <th>Name</th>
                <th>Klasse</th>
                <th>Fraktion</th>
                <th>System</th>
                <th>Befehl</th>
                <th>Zustand</th>
                <th>Flotte</th>
                <th style={{ textAlign: "right" }}>Hülle</th>
                <th style={{ textAlign: "right" }}>Abstand</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => (
                <tr
                  key={`${s.serverKey}-${s.id}`}
                  onClick={() => {
                    setSelected(s.id);
                    setEdit({ name: s.name, factionId: s.factionId });
                    setBodyId("");
                  }}
                  style={{ cursor: "pointer", background: s.id === selected ? "var(--bg-panel-light)" : undefined }}
                >
                  <td>{s.id}</td>
                  <td>
                    {s.mapShip ? "★ " : ""}
                    {s.name}
                  </td>
                  <td>{className(s.classId)}</td>
                  <td>{factionName(s.factionId)}</td>
                  <td>
                    {systemName(s.systemId)}
                    {s.jumpTo && <span style={{ color: "var(--text-muted)" }}> → {systemName(s.jumpTo)}</span>}
                  </td>
                  <td>
                    {s.order ? ORDER_LABEL[s.order] ?? s.order : "-"}
                    {s.orderCount > 1 ? ` (+${s.orderCount - 1})` : ""}
                  </td>
                  <td>
                    {STATE_LABEL[s.state] ?? s.state}
                    {s.surrendered ? (s.prisoner ? " · gefangen" : " · kapituliert") : ""}
                  </td>
                  <td>
                    {fleetOf(s)?.name ?? "-"}
                    {fleetOf(s)?.flagshipId === s.id ? " (Flagge)" : ""}
                  </td>
                  <td style={{ textAlign: "right", color: s.hull > 50 ? "var(--text)" : s.hull > 25 ? "#d8c95a" : "#f05046" }}>
                    {s.hull} %
                  </td>
                  <td style={{ textAlign: "right" }}>{s.distanceKm !== null ? `${s.distanceKm} km` : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.ships.length > 0 && (
            <p className="subtitle" style={{ marginBottom: 0 }}>
              Stand: {dateFormat(Math.max(...data.ships.map((s) => s.updatedAt)))}. Abstand = Entfernung zum Map-Schiff
              (★) im selben System.
            </p>
          )}
        </div>

        <div style={{ flex: 1, minWidth: 320 }}>
          {canEdit && (
            <div className="panel" style={{ marginBottom: 16 }}>
              <h3 style={{ marginTop: 0 }}>Schiff erzeugen</h3>
              <p className="subtitle" style={{ marginTop: 0 }}>Erscheint vor dem Map-Schiff.</p>
              <select
                value={spawn.classId}
                onChange={(event) => setSpawn({ ...spawn, classId: event.target.value })}
                style={{ ...inputStyle, marginBottom: 8 }}
              >
                <option value="">Klasse wählen…</option>
                {data.classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select
                value={spawn.factionId}
                onChange={(event) => setSpawn({ ...spawn, factionId: event.target.value })}
                style={{ ...inputStyle, marginBottom: 8 }}
              >
                <option value="">Fraktion der Klasse</option>
                {data.factions.map((fa) => (
                  <option key={fa.id} value={fa.id}>
                    {fa.name}
                  </option>
                ))}
              </select>
              <input
                placeholder="Name (optional)"
                value={spawn.name}
                onChange={(event) => setSpawn({ ...spawn, name: event.target.value })}
                style={{ ...inputStyle, marginBottom: 8 }}
              />
              <input
                type="number"
                min={0.5}
                value={spawn.distanceKm}
                onChange={(event) => setSpawn({ ...spawn, distanceKm: Number(event.target.value) || 10 })}
                style={{ ...inputStyle, marginBottom: 8 }}
              />
              <button
                className="primary"
                disabled={busy || !spawn.classId}
                onClick={() =>
                  void send(
                    {
                      action: "spawn",
                      classId: spawn.classId,
                      factionId: spawn.factionId || undefined,
                      distanceKm: spawn.distanceKm,
                      name: spawn.name || undefined,
                    },
                    "Schiff wird erzeugt",
                  )
                }
              >
                Erzeugen ({spawn.distanceKm} km voraus)
              </button>
            </div>
          )}

          {fleets.length > 0 && (
            <div className="panel" style={{ marginBottom: 16 }}>
              <h3 style={{ marginTop: 0 }}>Flotten</h3>
              {fleets.map((fl) => (
                <div key={`${fl.serverKey}-${fl.id}`} style={{ marginBottom: 10 }}>
                  <strong>{fl.name}</strong>
                  <span className="subtitle">
                    {" "}
                    · Flaggschiff {data.ships.find((s) => s.id === fl.flagshipId && s.serverKey === fl.serverKey)?.name ?? "#" + fl.flagshipId}
                    {" "}· {data.ships.filter((s) => s.fleetId === fl.id && s.serverKey === fl.serverKey).length} Schiffe
                  </span>
                  {canEdit && (
                    <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                      <select
                        value={fl.formation}
                        onChange={(event) =>
                          void send({ action: "fleet", op: "formation", fleetId: fl.id, value: event.target.value }, "Formation gesetzt")
                        }
                        style={inputStyle}
                      >
                        {Object.entries(FORMATION_LABEL).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <select
                        value={fl.mode}
                        onChange={(event) => void send({ action: "fleet", op: "mode", fleetId: fl.id, value: event.target.value }, "Befehl gesetzt")}
                        style={inputStyle}
                      >
                        {Object.entries(MODE_LABEL).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <button
                        disabled={busy}
                        onClick={() => {
                          if (!confirm(`Flotte ${fl.name} auflösen? Die Schiffe bleiben erhalten.`)) return;
                          void send({ action: "fleet", op: "delete", fleetId: fl.id }, "Flotte aufgelöst");
                        }}
                      >
                        Auflösen
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="panel">
            <h3 style={{ marginTop: 0 }}>{ship ? `#${ship.id} ${ship.name}` : "Schiff auswählen"}</h3>

            {ship && (
              <>
                <p className="subtitle" style={{ marginTop: 0 }}>
                  {className(ship.classId)} · {factionName(ship.factionId)} · {systemName(ship.systemId)} ·{" "}
                  {ship.speed} m/s
                </p>

                {ship.mapShip ? (
                  <div className="notice">
                    Das Map-Schiff steuern die Konsolen auf der Brücke. Umbenennen und Reparieren gehen hier.
                  </div>
                ) : (
                  canEdit && (
                    <>
                      <div className="card-label">Befehle</div>
                      <div className="button-row" style={{ flexWrap: "wrap", marginBottom: 10 }}>
                        <button disabled={busy} onClick={() => void send({ action: "order", id: ship.id, type: "hold" }, "Halten")}>
                          Halten
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => void send({ action: "order", id: ship.id, type: "jumpnear" }, "Springt zum Map-Schiff")}
                        >
                          Zum Map-Schiff springen
                        </button>
                      </div>

                      <div className="card-label">Gefecht</div>
                      <p className="subtitle" style={{ margin: "0 0 6px" }}>
                        Hülle {ship.hull} % · {ROE_LABEL[ship.roe ?? ""] ?? "-"}
                        {ship.target ? ` · Ziel: ${data.ships.find((t) => t.id === ship.target)?.name ?? "#" + ship.target}` : ""}
                      </p>
                      <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                        <select value={attackId} onChange={(event) => setAttackId(event.target.value)} style={inputStyle}>
                          <option value="">Angriffsziel wählen…</option>
                          {data.ships
                            .filter((t) => t.id !== ship.id && t.systemId === ship.systemId && t.serverKey === ship.serverKey)
                            .map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name} ({factionName(t.factionId)})
                              </option>
                            ))}
                        </select>
                        <button
                          disabled={busy || !attackId}
                          onClick={() =>
                            void send({ action: "order", id: ship.id, type: "attack", targetId: Number(attackId) }, "Greift an")
                          }
                        >
                          Angreifen
                        </button>
                      </div>
                      <select
                        value={ship.roe ?? "return"}
                        onChange={(event) => void send({ action: "roe", id: ship.id, roe: event.target.value }, "Feuerverhalten gesetzt")}
                        style={{ ...inputStyle, marginBottom: 10 }}
                      >
                        {Object.entries(ROE_LABEL).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>

                      <div className="card-label">Sprung</div>
                      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                        <input
                          list="flotte-systems"
                          placeholder="Zielsystem"
                          value={jumpText}
                          onChange={(event) => setJumpText(event.target.value)}
                          style={inputStyle}
                        />
                        <button
                          disabled={busy || !jumpText}
                          onClick={() => {
                            const target = findSystem(jumpText);
                            if (!target) {
                              setMessage({ ok: false, text: "System nicht gefunden" });
                              return;
                            }
                            void send({ action: "order", id: ship.id, type: "jump", systemId: target.id }, `Springt nach ${target.name}`);
                          }}
                        >
                          Springen
                        </button>
                      </div>

                      <div className="card-label">Himmelskörper im System</div>
                      <select value={bodyId} onChange={(event) => setBodyId(event.target.value)} style={{ ...inputStyle, marginBottom: 6 }}>
                        <option value="">Wählen…</option>
                        {shipBodies.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name} ({b.type})
                          </option>
                        ))}
                      </select>
                      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                        <input
                          type="number"
                          placeholder="Orbit-Radius km (optional)"
                          value={radiusKm}
                          onChange={(event) => setRadiusKm(event.target.value)}
                          style={inputStyle}
                        />
                        <button
                          disabled={busy || !bodyId}
                          onClick={() => void send({ action: "order", id: ship.id, type: "approach", bodyId }, "Fliegt an")}
                        >
                          Anfliegen
                        </button>
                        <button
                          disabled={busy || !bodyId}
                          onClick={() =>
                            void send(
                              { action: "order", id: ship.id, type: "orbit", bodyId, radiusKm: Number(radiusKm) || undefined },
                              "Orbit",
                            )
                          }
                        >
                          Orbit
                        </button>
                      </div>

                      <div className="card-label">Bewegen relativ zum Map-Schiff (km, x/y/z)</div>
                      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                        {(["x", "y", "z"] as const).map((axis) => (
                          <input
                            key={axis}
                            type="number"
                            value={move[axis]}
                            onChange={(event) => setMove({ ...move, [axis]: Number(event.target.value) || 0 })}
                            style={inputStyle}
                          />
                        ))}
                        <button
                          disabled={busy}
                          onClick={() => void send({ action: "order", id: ship.id, type: "move", ...move }, "Fliegt los")}
                        >
                          Los
                        </button>
                      </div>
                    </>
                  )
                )}

                {canEdit && (
                  <>
                    <div className="card-label">Flotte</div>
                    <p className="subtitle" style={{ margin: "0 0 6px" }}>
                      {fleetOf(ship) ? `${fleetOf(ship)?.name}${fleetOf(ship)?.flagshipId === ship.id ? " (Flaggschiff)" : ""}` : "In keiner Flotte"}
                    </p>
                    <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                      <select value={fleetPick} onChange={(event) => setFleetPick(event.target.value)} style={inputStyle}>
                        <option value="">Flotte wählen…</option>
                        {fleets
                          .filter((fl) => fl.serverKey === ship.serverKey)
                          .map((fl) => (
                            <option key={fl.id} value={fl.id}>
                              {fl.name}
                            </option>
                          ))}
                      </select>
                      <button
                        disabled={busy || !fleetPick}
                        onClick={() => void send({ action: "fleet", op: "add", fleetId: Number(fleetPick), id: ship.id }, "Zur Flotte hinzugefügt")}
                      >
                        Hinzufügen
                      </button>
                    </div>
                    <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                      <input
                        placeholder="Name der neuen Flotte"
                        value={fleetName}
                        onChange={(event) => setFleetName(event.target.value)}
                        style={inputStyle}
                      />
                      <button
                        disabled={busy}
                        onClick={() => {
                          void send({ action: "fleet", op: "create", id: ship.id, name: fleetName || undefined }, "Flotte gebildet");
                          setFleetName("");
                        }}
                      >
                        Neue Flotte
                      </button>
                    </div>
                    {ship.fleetId && (
                      <div className="button-row" style={{ marginBottom: 10 }}>
                        <button disabled={busy} onClick={() => void send({ action: "fleet", op: "flagship", id: ship.id }, "Flaggschiff gesetzt")}>
                          Zum Flaggschiff
                        </button>
                        <button disabled={busy} onClick={() => void send({ action: "fleet", op: "remove", id: ship.id }, "Aus der Flotte genommen")}>
                          Aus Flotte nehmen
                        </button>
                      </div>
                    )}

                    {!ship.mapShip && (
                      <>
                        <div className="card-label">Moral und Sonderzustände</div>
                        <p className="subtitle" style={{ margin: "0 0 6px" }}>
                          Moral {ship.morale ?? "-"} %{ship.surrendered ? (ship.prisoner ? " · gefangen" : " · kapituliert") : ""}
                          {ship.interdictor ? " · Abfangfeld an" : ""}
                        </p>
                        <div className="button-row" style={{ marginBottom: 10 }}>
                          <button
                            disabled={busy}
                            onClick={() =>
                              void send({ action: "interdict", id: ship.id, on: !ship.interdictor }, ship.interdictor ? "Abfangfeld aus" : "Abfangfeld an")
                            }
                          >
                            Abfangfeld {ship.interdictor ? "aus" : "an"}
                          </button>
                          <button
                            disabled={busy}
                            onClick={() =>
                              void send({ action: "surrender", id: ship.id, undo: ship.surrendered }, ship.surrendered ? "Kapitulation aufgehoben" : "Kapituliert")
                            }
                          >
                            {ship.surrendered ? "Kapitulation aufheben" : "Kapitulieren lassen"}
                          </button>
                        </div>
                      </>
                    )}

                    <div className="card-label">Bearbeiten</div>
                    <input
                      value={edit.name}
                      onChange={(event) => setEdit({ ...edit, name: event.target.value })}
                      style={{ ...inputStyle, marginBottom: 6 }}
                    />
                    {!ship.mapShip && (
                      <select
                        value={edit.factionId}
                        onChange={(event) => setEdit({ ...edit, factionId: event.target.value })}
                        style={{ ...inputStyle, marginBottom: 6 }}
                      >
                        {data.factions.map((fa) => (
                          <option key={fa.id} value={fa.id}>
                            {fa.name}
                          </option>
                        ))}
                      </select>
                    )}
                    <div className="button-row">
                      <button
                        disabled={busy}
                        onClick={() =>
                          void send(
                            {
                              action: "edit",
                              id: ship.id,
                              name: edit.name !== ship.name ? edit.name : undefined,
                              factionId: !ship.mapShip && edit.factionId !== ship.factionId ? edit.factionId : undefined,
                            },
                            "Gespeichert",
                          )
                        }
                      >
                        Übernehmen
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => {
                          if (!confirm(`${ship.name} vollständig reparieren?`)) return;
                          void send({ action: "repair", id: ship.id }, "Repariert");
                        }}
                      >
                        Reparieren
                      </button>
                      {!ship.mapShip && (
                        <button
                          disabled={busy}
                          onClick={() => {
                            if (!confirm(`${ship.name} wirklich löschen?`)) return;
                            void send({ action: "delete", id: ship.id }, "Gelöscht");
                            setSelected(null);
                          }}
                        >
                          Löschen
                        </button>
                      )}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <datalist id="flotte-systems">
        {data.systems.map((s) => (
          <option key={s.id} value={s.name} />
        ))}
      </datalist>
    </>
  );
}
