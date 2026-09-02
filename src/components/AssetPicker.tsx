"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchWithTimeout, inputStyle, readJson } from "./ui";

/**
 * Eingabefeld für Waffenklassen und Modelpfade mit Auswahlliste.
 *
 * Der Wert bleibt eine kommagetrennte Zeichenkette - so, wie ihn Jobs,
 * Fortbildungen und die Waffenkiste schon immer erwartet haben. Wer eine Liste
 * aus einer anderen Quelle hat, kann sie also weiterhin hineinkopieren.
 *
 * Dazu kommen zwei Dinge, die vorher fehlten: eine durchsuchbare Liste dessen,
 * was auf dem Server tatsächlich installiert ist, und eine Markierung für
 * Einträge, die es dort nicht gibt. Tippfehler fielen bisher erst im Spiel auf.
 */

interface Entry {
  key: string;
  label: string;
}

interface Inventory {
  available: boolean;
  weapons: Entry[];
  models: Entry[];
  hint?: string;
}

const EMPTY: Inventory = { available: false, weapons: [], models: [] };

/**
 * Der Bestand ändert sich nur beim Serverstart, wird aber von vielen Feldern
 * gleichzeitig gebraucht. Deshalb genau eine Abfrage je Seitenaufruf, an der
 * sich alle Felder bedienen.
 */
let pending: Promise<Inventory> | null = null;

function loadInventory(): Promise<Inventory> {
  if (!pending) {
    pending = fetchWithTimeout("/api/assets")
      .then(async (response) => {
        const { data } = await readJson<Inventory>(response);
        return data ?? EMPTY;
      })
      .catch(() => EMPTY);
  }

  return pending;
}

/** Für andere Ansichten, die denselben Bestand brauchen. */
export function useInventory(): Inventory {
  const [inventory, setInventory] = useState<Inventory>(EMPTY);

  useEffect(() => {
    let active = true;

    void loadInventory().then((data) => {
      if (active) setInventory(data);
    });

    return () => {
      active = false;
    };
  }, []);

  return inventory;
}

export const splitList = (text: string): string[] =>
  text
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");

export default function AssetPicker({
  kind,
  value,
  onChange,
  disabled,
  rows = 3,
}: {
  kind: "weapon" | "model";
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  rows?: number;
}) {
  const inventory = useInventory();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);

  const pool = kind === "weapon" ? inventory.weapons : inventory.models;
  const current = useMemo(() => splitList(value), [value]);

  const known = useMemo(
    () => new Set(pool.map((entry) => entry.key.toLowerCase())),
    [pool],
  );

  const unknown = useMemo(
    () =>
      inventory.available
        ? current.filter((entry) => !known.has(entry.toLowerCase()))
        : [],
    [current, known, inventory.available],
  );

  const chosen = useMemo(
    () => new Set(current.map((entry) => entry.toLowerCase())),
    [current],
  );

  const matches = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return pool
      .filter((entry) => {
        if (chosen.has(entry.key.toLowerCase())) return false;
        if (needle === "") return true;

        return (
          entry.key.toLowerCase().includes(needle) ||
          entry.label.toLowerCase().includes(needle)
        );
      })
      .slice(0, 60);
  }, [pool, search, chosen]);

  function add(entry: string) {
    onChange(current.length === 0 ? entry : `${current.join(", ")}, ${entry}`);
  }

  function remove(entry: string) {
    onChange(current.filter((item) => item !== entry).join(", "));
  }

  const noun = kind === "weapon" ? "Waffen" : "Playermodels";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        rows={rows}
        style={{ ...inputStyle, fontFamily: "Consolas, monospace", fontSize: 13 }}
      />

      {current.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {current.map((entry) => {
            const missing = inventory.available && !known.has(entry.toLowerCase());

            return (
              <span
                key={entry}
                title={missing ? "Auf dem Server nicht installiert" : entry}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "3px 8px",
                  borderRadius: 3,
                  fontSize: 12,
                  fontFamily: "Consolas, monospace",
                  background: missing ? "rgba(200, 80, 60, 0.14)" : "var(--bg-panel-light)",
                  border: `1px solid ${missing ? "rgba(200, 80, 60, 0.55)" : "var(--border)"}`,
                  color: missing ? "#e08a78" : "var(--text-dim)",
                }}
              >
                {missing && <span aria-hidden="true">!</span>}
                {entry}
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => remove(entry)}
                    aria-label={`${entry} entfernen`}
                    style={{
                      border: 0,
                      background: "none",
                      color: "inherit",
                      cursor: "pointer",
                      padding: 0,
                      font: "inherit",
                      opacity: 0.7,
                    }}
                  >
                    ×
                  </button>
                )}
              </span>
            );
          })}
        </div>
      )}

      {unknown.length > 0 && (
        <div style={{ fontSize: 12, color: "#e08a78" }}>
          {unknown.length === 1
            ? `${unknown[0]} ist auf dem Server nicht installiert.`
            : `${unknown.length} Einträge sind auf dem Server nicht installiert.`}
        </div>
      )}

      {!disabled && (
        <div>
          {!open ? (
            <button type="button" onClick={() => setOpen(true)}>
              {inventory.available
                ? `${noun} auswählen (${pool.length})`
                : `${noun} auswählen`}
            </button>
          ) : (
            <div
              style={{
                border: "1px solid var(--border)",
                borderRadius: 4,
                background: "var(--bg-panel-light)",
                padding: 8,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  autoFocus
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={kind === "weapon" ? "z. B. dc15" : "z. B. clone"}
                  style={{ ...inputStyle, flex: 1 }}
                />
                <button type="button" onClick={() => setOpen(false)}>
                  Schließen
                </button>
              </div>

              {!inventory.available ? (
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {inventory.hint ??
                    "Der Server hat noch keinen Bestand gemeldet. Solange bleibt nur die Eingabe von Hand."}
                </div>
              ) : (
                <>
                  <div
                    style={{
                      maxHeight: 260,
                      overflowY: "auto",
                      display: "flex",
                      flexDirection: "column",
                    }}
                  >
                    {matches.map((entry) => (
                      <button
                        type="button"
                        key={entry.key}
                        onClick={() => add(entry.key)}
                        style={{
                          textAlign: "left",
                          border: 0,
                          borderBottom: "1px solid var(--border)",
                          background: "none",
                          color: "var(--text)",
                          padding: "6px 4px",
                          cursor: "pointer",
                          font: "inherit",
                          fontSize: 13,
                        }}
                      >
                        <span>{entry.label}</span>
                        <span
                          style={{
                            display: "block",
                            fontFamily: "Consolas, monospace",
                            fontSize: 11,
                            color: "var(--text-muted)",
                            wordBreak: "break-all",
                          }}
                        >
                          {entry.key}
                        </span>
                      </button>
                    ))}

                    {matches.length === 0 && (
                      <div style={{ fontSize: 12, color: "var(--text-muted)", padding: 4 }}>
                        Nichts gefunden.
                      </div>
                    )}
                  </div>

                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    {matches.length === 60
                      ? "Erste 60 Treffer - weiter eingrenzen zeigt den Rest."
                      : `${matches.length} Treffer`}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
