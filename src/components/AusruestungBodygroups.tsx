"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { PanelUser } from "@/lib/auth";
import { Notice, fetchWithTimeout, inputStyle, readJson } from "./ui";

/**
 * Ausrüstung an Bodygroups binden (Gamemode modules/ausruestung): solange ein
 * Spieler das Item besitzt, steht die Bodygroup auf "mit Item" und ist in der
 * Umkleide gesperrt. "Aktiv" nur für aktivierbare Items (Makrofernglas).
 */

interface Binding {
  class: string;
  model: string;
  bodygroup: string;
  valueOff: number;
  valueOn: number;
  valueActive: number;
}

interface ModelInfo {
  model: string;
  bodygroups: Array<{ index: number; name: string; count: number }>;
}

const ANY = "*";

// Trageplaetze: Items auf demselben Platz schliessen sich aus (Gamemode PD.Gear.SlotNames)
const SLOT_OPTIONS: Array<[string, string]> = [
  ["", "kein Platz"],
  ["ruecken", "Rücken"],
  ["kopf", "Kopf"],
  ["brust", "Brust"],
  ["guertel", "Gürtel"],
  ["arme", "Arme"],
  ["beine", "Beine"],
];
// Alle Felder einer Zeile gleich hoch und oben ausgerichtet (der Hinweis unter
// der Bodygroup schiebt sonst nur diese Zelle nach oben)
const small = { ...inputStyle, padding: "4px 6px", height: 34, boxSizing: "border-box" as const };
const cell = { verticalAlign: "top" as const, paddingTop: 8 };

export default function AusruestungBodygroups({ user }: { user: PanelUser }) {
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [classes, setClasses] = useState<string[]>([]);
  const [slots, setSlots] = useState<Record<string, string>>({});
  const [configured, setConfigured] = useState(true);
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const canEdit = user.role === "editor" || user.role === "admin";

  const load = useCallback(async () => {
    const { data, error } = await readJson<{
      configured: boolean;
      hint?: string;
      bindings?: Binding[];
      models?: ModelInfo[];
      classes?: string[];
      slots?: Array<{ class: string; slot: string }>;
    }>(await fetchWithTimeout("/api/waffen/bodygroups", { cache: "no-store" }));

    if (error || !data) {
      setMessage({ ok: false, text: error ?? "Fehler" });
      return;
    }

    setConfigured(data.configured);
    setHint(data.hint ?? null);
    setBindings(data.bindings ?? []);
    setModels(data.models ?? []);
    setClasses(data.classes ?? []);
    setSlots(Object.fromEntries((data.slots ?? []).map((s) => [s.class, s.slot])));
  }, []);

  // Items mit Bodygroup-Bindung plus solche, die schon einen Platz haben
  const slotItems = useMemo(() => {
    const set = new Set<string>();
    for (const b of bindings) if (b.class.trim()) set.add(b.class.trim());
    for (const c of Object.keys(slots)) set.add(c);
    return [...set].sort();
  }, [bindings, slots]);

  useEffect(() => {
    void load();
  }, [load]);

  // Bodygroup-Namen: je Model, und für "*" alle bekannten Namen
  const namesFor = useMemo(() => {
    const all = new Map<string, number>();
    const byModel = new Map<string, Map<string, number>>();

    for (const m of models) {
      const map = new Map<string, number>();
      for (const bg of m.bodygroups) {
        map.set(bg.name, bg.count);
        all.set(bg.name, Math.max(all.get(bg.name) ?? 0, bg.count));
      }
      byModel.set(m.model, map);
    }

    return (model: string) => (model === ANY ? all : byModel.get(model) ?? new Map<string, number>());
  }, [models]);

  const update = (index: number, patch: Partial<Binding>) => {
    setBindings(bindings.map((b, i) => (i === index ? { ...b, ...patch } : b)));
  };

  const save = async () => {
    setBusy(true);
    setMessage(null);

    try {
      const { data, error } = await readJson<{ ok: boolean; reload?: { ok: boolean; message: string } }>(
        await fetchWithTimeout("/api/waffen/bodygroups", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bindings: bindings.filter((b) => b.class.trim() && b.bodygroup.trim()),
            slots: slotItems.filter((c) => slots[c]).map((c) => ({ class: c, slot: slots[c] })),
          }),
        }),
      );

      if (error || !data) {
        setMessage({ ok: false, text: error ?? "Fehler" });
        return;
      }

      setMessage({
        ok: data.reload?.ok ?? true,
        text: data.reload?.ok ? `Gespeichert, Server neu geladen: ${data.reload.message}` : `Gespeichert. Server nicht erreichbar: ${data.reload?.message ?? ""}`,
      });
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (!configured) {
    return (
      <div className="panel">
        <Notice ok={false}>{hint}</Notice>
      </div>
    );
  }

  return (
    <div className="panel">
      {message && <Notice ok={message.ok}>{message.text}</Notice>}

      <p className="subtitle" style={{ marginTop: 0 }}>
        Solange ein Spieler das Item besitzt (aus der Waffenkiste), steht die Bodygroup auf <b>Mit Item</b> und lässt sich in
        der Umkleide nicht ändern. <b>Ohne Item</b>: Wert ohne das Item (gesperrt), −1 = in der Umkleide frei wählbar.{" "}
        <b>Aktiv</b>: Wert, wenn das Item aktiviert ist (Makrofernglas, Taste B), −1 = nicht aktivierbar. Bodygroups werden
        per <b>Name</b> gesucht, weil sich die Nummern je Model unterscheiden; ein Eintrag für ein bestimmtes Model geht vor
        „alle Models“. Die Namen kennt das Panel von Models, die schon jemand im Spiel getragen hat ({models.length} bisher).
      </p>

      <datalist id="gear-classes">
        {classes.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      <div style={{ overflowX: "auto" }}>
        <table style={{ fontSize: 14 }}>
          <thead>
            <tr>
              <th>Item</th>
              <th>Model</th>
              <th>Bodygroup</th>
              <th>Ohne Item</th>
              <th>Mit Item</th>
              <th>Aktiv</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {bindings.map((b, i) => {
              const names = namesFor(b.model);
              const count = names.get(b.bodygroup);
              const listId = `gear-bg-${i}`;
              return (
                <tr key={i}>
                  <td style={{ ...cell, minWidth: 170 }}>
                    <input list="gear-classes" value={b.class} disabled={!canEdit} onChange={(e) => update(i, { class: e.target.value })} style={small} />
                  </td>
                  <td style={{ ...cell, minWidth: 220 }}>
                    <select value={b.model} disabled={!canEdit} onChange={(e) => update(i, { model: e.target.value })} style={small}>
                      <option value={ANY}>Alle Models</option>
                      {models.map((m) => (
                        <option key={m.model} value={m.model}>
                          {m.model.replace(/^models\//, "")}
                        </option>
                      ))}
                      {b.model !== ANY && !models.some((m) => m.model === b.model) && <option value={b.model}>{b.model}</option>}
                    </select>
                  </td>
                  <td style={{ ...cell, minWidth: 170 }}>
                    <input list={listId} value={b.bodygroup} disabled={!canEdit} onChange={(e) => update(i, { bodygroup: e.target.value })} style={small} />
                    <datalist id={listId}>
                      {[...names.keys()].sort().map((n) => (
                        <option key={n} value={n} />
                      ))}
                    </datalist>
                    {b.bodygroup && count === undefined && <div style={{ fontSize: 11, color: "#f0a030" }}>bei diesem Model unbekannt</div>}
                    {count !== undefined && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Werte 0–{count - 1}</div>}
                  </td>
                  {(["valueOff", "valueOn", "valueActive"] as const).map((k) => (
                    <td key={k} style={{ ...cell, width: 80 }}>
                      <input
                        type="number"
                        min={k === "valueOn" ? 0 : -1}
                        max={count !== undefined ? count - 1 : 255}
                        value={b[k]}
                        disabled={!canEdit}
                        onChange={(e) => update(i, { [k]: Math.round(Number(e.target.value)) } as Partial<Binding>)}
                        style={small}
                      />
                    </td>
                  ))}
                  <td style={cell}>
                    {canEdit && (
                      <button style={{ padding: "0 10px", height: 34 }} onClick={() => setBindings(bindings.filter((_, j) => j !== i))}>
                        Entfernen
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h3 style={{ marginTop: 24 }}>Trageplätze</h3>
      <p className="subtitle" style={{ marginTop: 0 }}>
        Items auf demselben Platz schließen sich aus: Trägt ein Spieler z. B. das Jetpack auf dem <b>Rücken</b>, gibt die
        Waffenkiste keinen Rucksack heraus, bis das Jetpack abgelegt ist.
      </p>
      <table style={{ fontSize: 14 }}>
        <thead>
          <tr>
            <th>Item</th>
            <th>Platz</th>
          </tr>
        </thead>
        <tbody>
          {slotItems.map((c) => (
            <tr key={c}>
              <td style={{ ...cell, minWidth: 220 }}>{c}</td>
              <td style={{ ...cell, minWidth: 160 }}>
                <select value={slots[c] ?? ""} disabled={!canEdit} onChange={(e) => setSlots({ ...slots, [c]: e.target.value })} style={small}>
                  {SLOT_OPTIONS.map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                  {slots[c] && !SLOT_OPTIONS.some(([v]) => v === slots[c]) && <option value={slots[c]}>{slots[c]}</option>}
                </select>
              </td>
            </tr>
          ))}
          {slotItems.length === 0 && (
            <tr>
              <td colSpan={2} style={{ color: "var(--text-muted)" }}>
                Noch keine Items - erst oben eine Bodygroup-Zeile anlegen.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {canEdit && (
        <div className="button-row" style={{ marginTop: 12 }}>
          <button
            onClick={() => setBindings([...bindings, { class: "", model: ANY, bodygroup: "", valueOff: 0, valueOn: 1, valueActive: -1 }])}
          >
            Zeile hinzufügen
          </button>
          <button className="primary" onClick={() => void save()} disabled={busy}>
            Bodygroups und Plätze speichern
          </button>
        </div>
      )}
    </div>
  );
}
