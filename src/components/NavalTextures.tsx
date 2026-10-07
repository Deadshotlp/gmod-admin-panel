"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { PanelUser } from "@/lib/auth";
import { Notice, fetchWithTimeout, inputStyle, readJson } from "./ui";

interface Texture {
  id: string;
  kind: string;
  type: string;
  name: string;
}

interface Body {
  id: string;
  name: string;
  bodyType: string;
  systemId: string;
  systemName: string;
  material: string;
  cloud: string;
  planetType: string | null;
  typeSource: string | null;
  climate: string;
  terrain: string;
  override: { material?: string; cloud?: string } | null;
}

const TYPE_LABEL: Record<string, string> = {
  city: "Stadt",
  desert: "Wüste",
  forest: "Wald",
  fungal: "Sumpf/Pilz",
  gas: "Gasriese",
  ice: "Eis",
  magma: "Lava",
  moon: "Mond/Fels",
  water: "Ozean",
};

const SOURCE_LABEL: Record<string, string> = {
  canon: "Kanon (fest zugeordnet)",
  terrain: "Wookieepedia: Gelände",
  climate: "Wookieepedia: nur Klima",
  estimated: "geschätzt (keine Wookieepedia-Angaben)",
};

const preview = (id: string) => `/api/naval/textures?preview=${encodeURIComponent(id)}`;

/** Planeten-Texturen ansehen und je Planet/Mond überschreiben (Stufe 4b). */
export default function NavalTextures({ user }: { user: PanelUser }) {
  const [textures, setTextures] = useState<Texture[]>([]);
  const [bodies, setBodies] = useState<Body[]>([]);
  const [overrideCount, setOverrideCount] = useState(0);
  const [search, setSearch] = useState("");
  const [showOverrides, setShowOverrides] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pick, setPick] = useState<{ material: string; cloud: string }>({ material: "", cloud: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const canEdit = user.role === "editor" || user.role === "admin";

  const load = useCallback(async (q: string, overrides: boolean) => {
    const params = overrides ? "overrides=1" : `q=${encodeURIComponent(q)}`;
    try {
      const response = await fetchWithTimeout(`/api/naval/textures?${params}`, { cache: "no-store" });
      const { data, error } = await readJson<{ textures: Texture[]; bodies: Body[]; overrideCount: number }>(response);
      if (error) {
        setMessage({ ok: false, text: error });
        return;
      }
      if (data) {
        setTextures(data.textures);
        setBodies(data.bodies);
        setOverrideCount(data.overrideCount);
      }
    } catch {
      setMessage({ ok: false, text: "Texturen konnten nicht geladen werden" });
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void load(search, showOverrides), 300);
    return () => clearTimeout(timer);
  }, [search, showOverrides, load]);

  const selected = bodies.find((b) => b.id === selectedId) ?? null;

  useEffect(() => {
    if (selected) setPick({ material: selected.material, cloud: selected.cloud });
    // nur beim Wechsel des Planeten neu setzen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const groups = useMemo(() => {
    const map = new Map<string, Texture[]>();
    for (const t of textures.filter((x) => x.kind === "terrain")) {
      const list = map.get(t.type) ?? [];
      list.push(t);
      map.set(t.type, list);
    }
    return [...map.entries()];
  }, [textures]);
  const clouds = textures.filter((t) => t.kind === "cloud");

  const save = async (reset: boolean) => {
    if (!selected) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetchWithTimeout("/api/naval/textures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reset ? { bodyId: selected.id, reset: true } : { bodyId: selected.id, material: pick.material, cloud: pick.cloud }),
      });
      const { data, error } = await readJson<{ ok: boolean; name: string; reload: { ok: boolean; message: string } }>(response);
      if (error) {
        setMessage({ ok: false, text: error });
        return;
      }
      setMessage({
        ok: Boolean(data?.reload.ok),
        text: data?.reload.ok
          ? `${data.name}: ${reset ? "Überschreibung entfernt" : "Textur gespeichert"} – Server lädt die Galaxie neu`
          : `Gespeichert, aber Neuladen fehlgeschlagen: ${data?.reload.message}`,
      });
      await load(search, showOverrides);
    } catch {
      setMessage({ ok: false, text: "Speichern fehlgeschlagen" });
    } finally {
      setBusy(false);
    }
  };

  const Thumb = ({ id, active, onClick, label }: { id: string; active: boolean; onClick: () => void; label: string }) => (
    <button
      onClick={onClick}
      title={label}
      style={{
        padding: 0,
        border: active ? "2px solid var(--accent, #4fa3ff)" : "2px solid transparent",
        background: "#000",
        cursor: canEdit ? "pointer" : "default",
        lineHeight: 0,
      }}
      disabled={!canEdit}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={preview(id)} alt={label} width={128} height={64} style={{ display: "block" }} />
    </button>
  );

  return (
    <>
      {message && <Notice ok={message.ok}>{message.text}</Notice>}
      <p className="subtitle" style={{ marginTop: 0 }}>
        Planeten bekommen ihre Textur aus Gelände und Klima ihrer Wookieepedia-Einträge. Hier lässt sich je Planet oder Mond eine
        andere Textur und Wolkendecke festlegen. Die Auswahl bleibt auch bei einem Neu-Import der Galaxie erhalten. {overrideCount}{" "}
        Überschreibungen aktiv.
      </p>

      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div className="panel" style={{ flex: 1, minWidth: 380 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <input
              placeholder="Planet, Mond oder System suchen (ab 2 Zeichen)"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setShowOverrides(false);
              }}
              style={inputStyle}
            />
            <button className={showOverrides ? "primary" : undefined} onClick={() => setShowOverrides(!showOverrides)}>
              Überschriebene
            </button>
          </div>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>System</th>
                <th>Typ</th>
                <th>Quelle</th>
              </tr>
            </thead>
            <tbody>
              {bodies.map((b) => (
                <tr
                  key={b.id}
                  onClick={() => setSelectedId(b.id)}
                  style={{ cursor: "pointer", background: b.id === selectedId ? "var(--bg-panel-light)" : undefined }}
                >
                  <td>
                    {b.name}
                    {b.bodyType === "moon" ? " (Mond)" : ""}
                    {b.override ? " ✎" : ""}
                  </td>
                  <td>{b.systemName}</td>
                  <td>{TYPE_LABEL[(b.material.match(/planets\/(\w+)\//) ?? [])[1] ?? ""] ?? "-"}</td>
                  <td style={{ color: b.typeSource === "estimated" ? "#d8c95a" : undefined }}>
                    {b.typeSource === "estimated" ? "geschätzt" : b.typeSource ?? "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {bodies.length === 0 && <p className="subtitle">Keine Treffer.</p>}
        </div>

        <div className="panel" style={{ flex: 1.4, minWidth: 460 }}>
          {!selected ? (
            <p className="subtitle" style={{ margin: 0 }}>
              Links einen Planeten wählen.
            </p>
          ) : (
            <>
              <h3 style={{ marginTop: 0 }}>
                {selected.name} <span className="subtitle">· {selected.systemName}</span>
              </h3>
              <div style={{ display: "flex", gap: 14, marginBottom: 12, alignItems: "flex-start" }}>
                <div style={{ position: "relative", width: 256, height: 128, background: "#000", flex: "none" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={preview(pick.material)} alt="" width={256} height={128} style={{ position: "absolute", inset: 0 }} />
                  {pick.cloud && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={preview(pick.cloud)} alt="" width={256} height={128} style={{ position: "absolute", inset: 0, opacity: 0.75 }} />
                  )}
                </div>
                <div style={{ fontSize: 14 }}>
                  <div>
                    <strong>Einordnung:</strong> {SOURCE_LABEL[selected.typeSource ?? ""] ?? "-"}
                  </div>
                  {selected.terrain && (
                    <div>
                      <strong>Gelände:</strong> {selected.terrain.replace(/\*/g, " ").trim()}
                    </div>
                  )}
                  {selected.climate && (
                    <div>
                      <strong>Klima:</strong> {selected.climate.replace(/\*/g, " ").trim()}
                    </div>
                  )}
                  {selected.override && <div style={{ color: "#d8c95a", marginTop: 6 }}>Textur ist überschrieben.</div>}
                </div>
              </div>

              <div className="card-label">Oberfläche</div>
              {groups.map(([type, list]) => (
                <div key={type} style={{ marginBottom: 8 }}>
                  <div className="subtitle" style={{ margin: "0 0 4px" }}>
                    {TYPE_LABEL[type] ?? type}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {list.map((t) => (
                      <Thumb key={t.id} id={t.id} label={t.name} active={pick.material === t.id} onClick={() => setPick({ ...pick, material: t.id })} />
                    ))}
                  </div>
                </div>
              ))}

              <div className="card-label">Wolken</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                <button className={pick.cloud === "" ? "primary" : undefined} onClick={() => setPick({ ...pick, cloud: "" })} disabled={!canEdit}>
                  Keine
                </button>
                {clouds.map((t) => (
                  <Thumb key={t.id} id={t.id} label={t.name} active={pick.cloud === t.id} onClick={() => setPick({ ...pick, cloud: t.id })} />
                ))}
              </div>

              {canEdit && (
                <div className="button-row">
                  <button
                    className="primary"
                    disabled={busy || (pick.material === selected.material && pick.cloud === selected.cloud)}
                    onClick={() => void save(false)}
                  >
                    Speichern
                  </button>
                  {selected.override && (
                    <button disabled={busy} onClick={() => void save(true)}>
                      Überschreibung entfernen
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
