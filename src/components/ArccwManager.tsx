"use client";

import { useEffect, useMemo, useState } from "react";
import type { PanelUser } from "@/lib/auth";
import { fetchWithTimeout, inputStyle, Notice, readJson } from "./ui";

/**
 * Schadenswerte der ArcCW-Waffen.
 *
 * Jede Zeile zeigt den Ausgangswert aus dem Addon als Platzhalter. Ein leeres
 * Feld heißt: so lassen. Erst ein eingetragener Wert wird zur Abweichung, und
 * nur die landet in der Datenbank. Damit bleibt jederzeit sichtbar, was
 * absichtlich geändert wurde - und ein Leeren stellt den Originalwert wieder
 * her, ohne dass man ihn nachschlagen muss.
 */

const FIELDS = [
  { key: "damage", label: "Schaden nah", hint: "bis zur vollen Reichweite" },
  { key: "damage_min", label: "Schaden fern", hint: "ab der maximalen Reichweite" },
  { key: "range_min", label: "Voller Schaden bis", hint: "Meter" },
  { key: "range", label: "Mindestschaden ab", hint: "Meter" },
  { key: "penetration", label: "Durchschlag", hint: "" },
  { key: "num", label: "Projektile", hint: "je Schuss" },
] as const;

type FieldKey = (typeof FIELDS)[number]["key"];

interface Weapon {
  class: string;
  name: string;
  category: string;
  defaults: Record<FieldKey, number>;
  override: Partial<Record<FieldKey, number>>;
  note: string;
  updatedAt: number;
}

interface Payload {
  configured: boolean;
  weapons?: Weapon[];
  hint?: string;
}

type Draft = Record<string, Partial<Record<FieldKey | "note", string>>>;

export default function ArccwManager({ user }: { user: PanelUser }) {
  const canEdit = user.role !== "viewer";

  const [state, setState] = useState<Payload | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [search, setSearch] = useState("");
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function adopt(payload: Payload) {
    setState(payload);

    const next: Draft = {};

    for (const weapon of payload.weapons ?? []) {
      const entry: Partial<Record<FieldKey | "note", string>> = {};

      for (const field of FIELDS) {
        const value = weapon.override[field.key];
        entry[field.key] = value === undefined ? "" : String(value);
      }

      entry.note = weapon.note;
      next[weapon.class] = entry;
    }

    setDraft(next);
  }

  async function load() {
    setBusy(true);

    try {
      const response = await fetchWithTimeout("/api/arccw");
      const { data, error } = await readJson<Payload>(response);

      if (error || !data) {
        setMessage({ ok: false, text: error ?? "Laden fehlgeschlagen" });
        return;
      }

      adopt(data);
    } catch {
      setMessage({ ok: false, text: "Panel nicht erreichbar" });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const weapons = state?.weapons ?? [];

  const changedCount = useMemo(
    () =>
      weapons.filter((weapon) =>
        FIELDS.some((field) => (draft[weapon.class]?.[field.key] ?? "") !== ""),
      ).length,
    [weapons, draft],
  );

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return weapons.filter((weapon) => {
      if (onlyChanged) {
        const hasValue = FIELDS.some(
          (field) => (draft[weapon.class]?.[field.key] ?? "") !== "",
        );
        if (!hasValue) return false;
      }

      if (needle === "") return true;

      return (
        weapon.class.toLowerCase().includes(needle) ||
        weapon.name.toLowerCase().includes(needle) ||
        weapon.category.toLowerCase().includes(needle)
      );
    });
  }, [weapons, search, onlyChanged, draft]);

  function set(weaponClass: string, field: FieldKey | "note", value: string) {
    setDraft((previous) => ({
      ...previous,
      [weaponClass]: { ...previous[weaponClass], [field]: value },
    }));
  }

  function reset(weaponClass: string) {
    setDraft((previous) => {
      const entry: Partial<Record<FieldKey | "note", string>> = { note: "" };
      for (const field of FIELDS) entry[field.key] = "";

      return { ...previous, [weaponClass]: entry };
    });
  }

  async function save() {
    setBusy(true);
    setMessage(null);

    const changes = weapons.map((weapon) => {
      const entry = draft[weapon.class] ?? {};
      const row: Record<string, unknown> = {
        class: weapon.class,
        note: entry.note ?? "",
      };

      for (const field of FIELDS) {
        const raw = (entry[field.key] ?? "").trim();
        // Leer heißt: nicht gesetzt. Eine 0 ist ein gültiger Wert und bleibt es.
        row[field.key] = raw === "" ? null : Number(raw.replace(",", "."));
      }

      return row;
    });

    const invalid = changes.find((row) =>
      FIELDS.some((field) => {
        const value = row[field.key];
        return value !== null && !Number.isFinite(value as number);
      }),
    );

    if (invalid) {
      setBusy(false);
      setMessage({ ok: false, text: `Keine gültige Zahl bei ${invalid.class}` });
      return;
    }

    try {
      const response = await fetchWithTimeout("/api/arccw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes }),
      });

      const { data, error } = await readJson<{
        weapons: Weapon[];
        reload: { ok: boolean; message: string };
      }>(response);

      if (error || !data) {
        setMessage({ ok: false, text: error ?? "Speichern fehlgeschlagen" });
        return;
      }

      adopt({ configured: true, weapons: data.weapons });

      setMessage({
        ok: data.reload.ok,
        text: data.reload.ok
          ? "Gespeichert. Der Server hat die Werte neu geladen."
          : `Gespeichert, aber der Server wurde nicht angestoßen: ${data.reload.message}`,
      });
    } catch {
      setMessage({ ok: false, text: "Panel nicht erreichbar" });
    } finally {
      setBusy(false);
    }
  }

  if (!state) {
    return <p className="subtitle">{busy ? "Wird geladen …" : "Keine Daten"}</p>;
  }

  if (!state.configured || weapons.length === 0) {
    return (
      <div className="card">
        <p>{state.hint ?? "Noch keine ArcCW-Waffen erfasst."}</p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {message && <Notice ok={message.ok}>{message.text}</Notice>}

      <div className="card">
        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Suchen nach Name, Klasse oder Kategorie"
            style={{ ...inputStyle, flex: "1 1 260px" }}
          />

          <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 14 }}>
            <input
              type="checkbox"
              checked={onlyChanged}
              onChange={(event) => setOnlyChanged(event.target.checked)}
            />
            Nur angepasste
          </label>

          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
            {changedCount} von {weapons.length} angepasst
          </span>

          {canEdit && (
            <button className="primary" onClick={() => void save()} disabled={busy}>
              {busy ? "…" : "Speichern & neu laden"}
            </button>
          )}
        </div>

        <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 10 }}>
          Der graue Wert im Feld ist der Ausgangswert aus dem Addon. Leer lassen heißt:
          so belassen. Eingetragene Werte überschreiben ihn, ohne das Addon anzufassen —
          ein Update der ArcCW-Pakete löscht deine Anpassungen also nicht.
        </p>
      </div>

      <div className="card" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              <th style={th}>Waffe</th>
              {FIELDS.map((field) => (
                <th key={field.key} style={{ ...th, textAlign: "right" }}>
                  {field.label}
                  {field.hint && (
                    <span style={{ display: "block", fontWeight: 400, opacity: 0.6 }}>
                      {field.hint}
                    </span>
                  )}
                </th>
              ))}
              <th style={th}>Notiz</th>
              <th style={th} />
            </tr>
          </thead>

          <tbody>
            {visible.map((weapon) => {
              const entry = draft[weapon.class] ?? {};
              const touched = FIELDS.some((field) => (entry[field.key] ?? "") !== "");

              return (
                <tr key={weapon.class}>
                  <td style={td}>
                    <div style={{ fontWeight: 600 }}>{weapon.name}</div>
                    <div
                      style={{
                        fontFamily: "Consolas, monospace",
                        fontSize: 11,
                        color: "var(--text-muted)",
                      }}
                    >
                      {weapon.class}
                    </div>
                  </td>

                  {FIELDS.map((field) => (
                    <td key={field.key} style={{ ...td, textAlign: "right" }}>
                      <input
                        value={entry[field.key] ?? ""}
                        onChange={(event) => set(weapon.class, field.key, event.target.value)}
                        placeholder={String(weapon.defaults[field.key])}
                        disabled={!canEdit}
                        inputMode="decimal"
                        style={{
                          ...inputStyle,
                          width: 78,
                          textAlign: "right",
                          fontVariantNumeric: "tabular-nums",
                          borderColor:
                            (entry[field.key] ?? "") !== ""
                              ? "var(--accent, #3a86d4)"
                              : "var(--border)",
                        }}
                      />
                    </td>
                  ))}

                  <td style={td}>
                    <input
                      value={entry.note ?? ""}
                      onChange={(event) => set(weapon.class, "note", event.target.value)}
                      placeholder="warum geändert"
                      disabled={!canEdit}
                      style={{ ...inputStyle, minWidth: 140 }}
                    />
                  </td>

                  <td style={td}>
                    {canEdit && touched && (
                      <button type="button" onClick={() => reset(weapon.class)}>
                        Zurücksetzen
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {visible.length === 0 && (
          <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
            Keine Waffe passt zur Suche.
          </p>
        )}
      </div>
    </div>
  );
}

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  borderBottom: "1px solid var(--border)",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--text-muted)",
  whiteSpace: "nowrap",
};

const td: React.CSSProperties = {
  padding: "8px 10px",
  borderBottom: "1px solid var(--border)",
  verticalAlign: "top",
};
