"use client";

import { useEffect, useMemo, useState } from "react";
import type { PanelUser } from "@/lib/auth";
import {
  ATTACHMENT_FIELDS,
  ATTACHMENT_KEYS,
  WEAPON_FIELDS,
  WEAPON_KEYS,
  ZONE_FIELDS,
  ZONE_KEYS,
  type FieldSpec,
  type Values,
} from "@/lib/arccw";
import { fetchWithTimeout, inputStyle, Notice, readJson } from "./ui";

/**
 * Werte der ArcCW-Waffen.
 *
 * Überall gilt dasselbe: der graue Wert im Feld ist der Ausgangswert aus dem
 * Addon, ein leeres Feld heißt "so lassen". Nur ausgefüllte Felder werden zur
 * Abweichung und landen in der Datenbank. Damit bleibt sichtbar, was absichtlich
 * geändert wurde, und ein Leeren stellt das Original wieder her.
 */

interface Weapon {
  class: string;
  name: string;
  category: string;
  slots: string[];
  defaults: Values;
  override: Values;
  note: string;
}

interface Attachment {
  id: string;
  name: string;
  slot: string;
  defaults: Values;
  override: Values;
  note: string;
}

interface Zone {
  class: string;
  values: Values;
}

interface Block {
  class: string;
  atts: string[];
}

interface Payload {
  configured: boolean;
  weapons?: Weapon[];
  attachments?: Attachment[];
  zones?: Zone[];
  blocks?: Block[];
  hint?: string;
}

type Sheet = Record<string, Record<string, string>>;

const TABS = [
  { id: "weapons", label: "Waffen" },
  { id: "zones", label: "Trefferzonen" },
  { id: "attachments", label: "Aufsätze" },
  { id: "blocks", label: "Freigaben" },
] as const;

type TabId = (typeof TABS)[number]["id"];

/** Text ins Zahlenfeld: leer bleibt leer, Komma zählt wie Punkt. */
function toNumber(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;

  const value = Number(trimmed.replace(",", "."));

  return Number.isFinite(value) ? value : Number.NaN;
}

/**
 * Steht im Feld noch der Ausgangswert?
 *
 * Danach entscheidet sich, ob eine Abweichung in die Datenbank wandert. Es
 * genügt nicht, auf Gleichheit der Zahlen zu prüfen: "0,20" und "0.2" sind
 * dasselbe, und der angezeigte Wert ist auf drei Stellen gerundet. Deshalb erst
 * der Text, dann die Zahl mit Spielraum.
 */
function sameAsDefault(text: string, fallback: number | undefined): boolean {
  const trimmed = text.trim();

  // Leergeräumt heißt: zurück auf den Ausgangswert.
  if (trimmed === "") return true;
  if (fallback === undefined) return false;
  if (trimmed === format(fallback)) return true;

  const value = Number(trimmed.replace(",", "."));
  if (!Number.isFinite(value)) return false;

  return Math.abs(value - fallback) <= Math.max(1e-9, Math.abs(fallback) * 1e-9);
}

/**
 * Die Felder werden mit dem Wert gefüllt, den die Waffe gerade hat — also der
 * eigenen Änderung, sonst dem Ausgangswert aus dem Addon. Man liest damit
 * immer den geltenden Wert und muss ihn nicht aus Platzhalter und Eingabe
 * zusammensetzen.
 */
function sheetFrom(
  rows: Array<{ id: string; defaults: Values; override: Values; note?: string }>,
  keys: string[],
): Sheet {
  const sheet: Sheet = {};

  for (const row of rows) {
    const entry: Record<string, string> = {};

    for (const key of keys) {
      const value = row.override[key] ?? row.defaults[key];
      entry[key] = value === undefined ? "" : format(value);
    }

    if (row.note !== undefined) entry.__note = row.note;
    sheet[row.id] = entry;
  }

  return sheet;
}

/** Trefferzonen haben keinen Ausgangswert im Addon: 1 heißt unverändert. */
const ZONE_DEFAULTS: Values = Object.fromEntries(ZONE_KEYS.map((key) => [key, 1]));

/**
 * Sichtbare Spalten.
 *
 * Alle 33 Waffenwerte nebeneinander sind unbrauchbar. Voreingestellt ist
 * deshalb das, was man tatsächlich häufig anfasst; der Rest lässt sich
 * dazuschalten. Die Auswahl liegt im Browser und gilt je Bereich.
 */
const DEFAULT_COLUMNS: Record<string, string[]> = {
  weapons: ["damage", "damage_min", "range_min", "range", "rpm", "num"],
  attachments: ["mult_damage", "mult_rpm", "mult_range", "mult_recoil"],
};

const COLUMN_STORAGE = "swrp:arccw:columns:v1";

function loadColumns(): Record<string, string[]> {
  try {
    const raw = window.localStorage.getItem(COLUMN_STORAGE);
    if (!raw) return DEFAULT_COLUMNS;

    const parsed = JSON.parse(raw) as Record<string, string[]>;

    return {
      weapons: Array.isArray(parsed.weapons) ? parsed.weapons : DEFAULT_COLUMNS.weapons,
      attachments: Array.isArray(parsed.attachments)
        ? parsed.attachments
        : DEFAULT_COLUMNS.attachments,
    };
  } catch {
    // Privates Fenster, geleerte Seitendaten, blockierter Speicher.
    return DEFAULT_COLUMNS;
  }
}

function saveColumns(columns: Record<string, string[]>) {
  try {
    window.localStorage.setItem(COLUMN_STORAGE, JSON.stringify(columns));
  } catch {
    // Nicht speichern zu können ist kein Grund, die Auswahl zu verweigern.
  }
}

export default function ArccwManager({ user }: { user: PanelUser }) {
  const canEdit = user.role !== "viewer";

  const [state, setState] = useState<Payload | null>(null);
  const [tab, setTab] = useState<TabId>("weapons");
  const [weaponSheet, setWeaponSheet] = useState<Sheet>({});
  const [attSheet, setAttSheet] = useState<Sheet>({});
  const [zoneSheet, setZoneSheet] = useState<Sheet>({});
  const [blocks, setBlocks] = useState<Record<string, string[]>>({});
  const [columns, setColumns] = useState<Record<string, string[]>>(DEFAULT_COLUMNS);
  const [search, setSearch] = useState("");
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function adopt(payload: Payload) {
    setState(payload);

    setWeaponSheet(
      sheetFrom(
        (payload.weapons ?? []).map((weapon) => ({
          id: weapon.class,
          defaults: weapon.defaults,
          override: weapon.override,
          note: weapon.note,
        })),
        WEAPON_KEYS,
      ),
    );

    setAttSheet(
      sheetFrom(
        (payload.attachments ?? []).map((att) => ({
          id: att.id,
          defaults: att.defaults,
          override: att.override,
          note: att.note,
        })),
        ATTACHMENT_KEYS,
      ),
    );

    // Die Grundregel für alle Waffen gibt es immer, auch wenn nichts gesetzt ist.
    const zoneRows = payload.zones ?? [];
    const withGeneral = zoneRows.some((zone) => zone.class === "*")
      ? zoneRows
      : [{ class: "*", values: {} as Values }, ...zoneRows];

    setZoneSheet(
      sheetFrom(
        withGeneral.map((zone) => ({
          id: zone.class,
          defaults: ZONE_DEFAULTS,
          override: zone.values,
        })),
        ZONE_KEYS,
      ),
    );

    setBlocks(
      Object.fromEntries((payload.blocks ?? []).map((block) => [block.class, block.atts])),
    );
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

  // Erst nach dem ersten Rendern lesen: auf dem Server gibt es kein localStorage.
  useEffect(() => {
    setColumns(loadColumns());
  }, []);

  function chooseColumns(area: string, keys: string[]) {
    const next = { ...columns, [area]: keys };

    setColumns(next);
    saveColumns(next);
  }

  const weaponColumns = useMemo(
    () => WEAPON_FIELDS.filter((field) => columns.weapons.includes(field.key)),
    [columns],
  );

  const attColumns = useMemo(
    () => ATTACHMENT_FIELDS.filter((field) => columns.attachments.includes(field.key)),
    [columns],
  );

  const weapons = state?.weapons ?? [];
  const attachments = state?.attachments ?? [];

  async function save() {
    setBusy(true);
    setMessage(null);

    // Nur was vom Ausgangswert abweicht, ist eine Änderung. Damit bleibt die
    // Datenbank frei von Zeilen, die nur den Originalwert wiederholen.
    function collect(sheet: Sheet, keys: string[], id: string, defaults: Values) {
      const entry = sheet[id] ?? {};
      const values: Record<string, number | null> = {};

      for (const key of keys) {
        const text = entry[key] ?? "";

        values[key] = sameAsDefault(text, defaults[key]) ? null : toNumber(text);
      }

      return { values, note: entry.__note ?? "" };
    }

    const body = {
      weapons: weapons.map((weapon) => ({
        class: weapon.class,
        ...collect(weaponSheet, WEAPON_KEYS, weapon.class, weapon.defaults),
      })),
      attachments: attachments.map((att) => ({
        id: att.id,
        ...collect(attSheet, ATTACHMENT_KEYS, att.id, att.defaults),
      })),
      zones: Object.keys(zoneSheet).map((className) => ({
        class: className,
        ...collect(zoneSheet, ZONE_KEYS, className, ZONE_DEFAULTS),
      })),
      blocks: Object.entries(blocks)
        .filter(([, atts]) => atts.length > 0)
        .map(([className, atts]) => ({ class: className, atts })),
    };

    const broken = [...body.weapons, ...body.attachments, ...body.zones].find((row) =>
      Object.values(row.values).some((value) => value !== null && Number.isNaN(value)),
    );

    if (broken) {
      setBusy(false);
      setMessage({
        ok: false,
        text: `Keine gültige Zahl bei ${"class" in broken ? broken.class : broken.id}`,
      });
      return;
    }

    try {
      const response = await fetchWithTimeout("/api/arccw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const { data, error } = await readJson<
        Payload & { reload: { ok: boolean; message: string } }
      >(response);

      if (error || !data) {
        setMessage({ ok: false, text: error ?? "Speichern fehlgeschlagen" });
        return;
      }

      adopt({ ...data, configured: true });

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
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          {TABS.map((entry) => (
            <button
              key={entry.id}
              className={tab === entry.id ? "primary" : undefined}
              onClick={() => setTab(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Suchen"
            style={{ ...inputStyle, flex: "1 1 240px" }}
          />

          {tab !== "zones" && (
            <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 14 }}>
              <input
                type="checkbox"
                checked={onlyChanged}
                onChange={(event) => setOnlyChanged(event.target.checked)}
              />
              Nur angepasste
            </label>
          )}

          {canEdit && (
            <button className="primary" onClick={() => void save()} disabled={busy}>
              {busy ? "…" : "Speichern & neu laden"}
            </button>
          )}
        </div>

        {tab === "weapons" && (
          <ColumnChooser
            fields={WEAPON_FIELDS}
            chosen={columns.weapons}
            fallback={DEFAULT_COLUMNS.weapons}
            onChange={(keys) => chooseColumns("weapons", keys)}
          />
        )}

        {tab === "attachments" && (
          <ColumnChooser
            fields={ATTACHMENT_FIELDS}
            chosen={columns.attachments}
            fallback={DEFAULT_COLUMNS.attachments}
            onChange={(keys) => chooseColumns("attachments", keys)}
          />
        )}
      </div>

      {tab === "weapons" && (
        <Grid
          fields={weaponColumns}
          sheet={weaponSheet}
          setSheet={setWeaponSheet}
          canEdit={canEdit}
          withNote
          rows={weapons
            .filter((weapon) => matches(weapon.class, [weapon.name, weapon.category], search))
            .filter(
              (weapon) =>
                !onlyChanged ||
                hasChange(weaponSheet, weapon.class, WEAPON_KEYS, weapon.defaults),
            )
            .map((weapon) => ({
              id: weapon.class,
              title: weapon.name,
              subtitle: weapon.class,
              defaults: weapon.defaults,
            }))}
          intro={
            <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
              In den Feldern steht, womit die Waffe gerade läuft. Geänderte Werte sind blau
              umrandet; gespeichert wird nur, was vom Ausgangswert abweicht. Ein Feld
              leeren stellt den Ausgangswert wieder her. Schuss/Minute rechnet der Server
              in den Schussabstand um, den ArcCW tatsächlich benutzt.
            </p>
          }
        />
      )}

      {tab === "zones" && (
        <ZoneEditor
          weapons={weapons}
          sheet={zoneSheet}
          setSheet={setZoneSheet}
          canEdit={canEdit}
          search={search}
        />
      )}

      {tab === "attachments" && (
        <Grid
          fields={attColumns}
          sheet={attSheet}
          setSheet={setAttSheet}
          canEdit={canEdit}
          withNote
          rows={attachments
            .filter((att) => matches(att.id, [att.name, att.slot], search))
            .filter(
              (att) =>
                !onlyChanged || hasChange(attSheet, att.id, ATTACHMENT_KEYS, att.defaults),
            )
            .map((att) => ({
              id: att.id,
              title: att.name,
              subtitle: `${att.id}${att.slot ? ` · ${att.slot}` : ""}`,
              defaults: att.defaults,
            }))}
          intro={
            attachments.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
                Der Server hat keine Aufsätze gemeldet. <code>pd_arccw_probe</code> in der
                Serverkonsole zeigt, unter welchem Namen ArcCW sie führt.
              </p>
            ) : (
              <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
                Faktoren auf den Wert der Waffe: 1 heißt unverändert, 0,9 sind zehn Prozent
                weniger, 1,2 zwanzig Prozent mehr. In den Feldern steht der geltende Wert,
                geänderte sind blau umrandet.
              </p>
            )
          }
        />
      )}
      {tab === "blocks" && (
        <BlockEditor
          weapons={weapons}
          attachments={attachments}
          blocks={blocks}
          setBlocks={setBlocks}
          canEdit={canEdit}
          search={search}
        />
      )}
    </div>
  );
}
/**
 * Freigaben.
 *
 * Zwei Ebenen: oben die Aufsätze, die es auf dem Server gar nicht geben soll —
 * dafür setzt der Server ArcCWs eigenes Feld `Blacklisted`. Darunter Sperren für
 * einzelne Waffen; die greifen über die Prüfung, die ArcCW selbst beim Anbauen
 * durchläuft.
 *
 * Angeboten werden je Waffe nur die Aufsätze, die überhaupt an sie passen: die
 * Waffe bringt eine Liste von Steckplatz-Kategorien mit, der Aufsatz gehört zu
 * genau einer davon.
 */
function BlockEditor({
  weapons,
  attachments,
  blocks,
  setBlocks,
  canEdit,
  search,
}: {
  weapons: Weapon[];
  attachments: Attachment[];
  blocks: Record<string, string[]>;
  setBlocks: (updater: (previous: Record<string, string[]>) => Record<string, string[]>) => void;
  canEdit: boolean;
  search: string;
}) {
  const [picked, setPicked] = useState("");

  const everywhere = blocks["*"] ?? [];

  function toggle(className: string, attId: string) {
    setBlocks((previous) => {
      const current = previous[className] ?? [];
      const next = current.includes(attId)
        ? current.filter((entry) => entry !== attId)
        : [...current, attId];

      return { ...previous, [className]: next };
    });
  }

  const weapon = weapons.find((entry) => entry.class === picked) ?? null;

  const fitting = useMemo(() => {
    if (!weapon) return [];

    const slots = new Set(weapon.slots);

    return attachments.filter((att) => att.slot !== "" && slots.has(att.slot));
  }, [weapon, attachments]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return attachments.filter(
      (att) =>
        needle === "" ||
        att.name.toLowerCase().includes(needle) ||
        att.id.toLowerCase().includes(needle) ||
        att.slot.toLowerCase().includes(needle),
    );
  }, [attachments, search]);

  if (attachments.length === 0) {
    return (
      <div className="card">
        <p>
          Der Server hat keine Aufsätze gemeldet. <code>pd_arccw_probe</code> in der
          Serverkonsole zeigt, ob ArcCW welche führt.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Überall gesperrt</h2>
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
          Diese Aufsätze soll es auf dem Server gar nicht geben — an keiner Waffe.
          {everywhere.length > 0 && ` Aktuell ${everywhere.length}.`}
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: 4,
            maxHeight: 320,
            overflowY: "auto",
          }}
        >
          {filtered.map((att) => (
            <label
              key={att.id}
              style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13 }}
            >
              <input
                type="checkbox"
                checked={everywhere.includes(att.id)}
                onChange={() => toggle("*", att.id)}
                disabled={!canEdit}
                style={{ marginTop: 3 }}
              />
              <span>
                {att.name}
                <span style={{ display: "block", fontFamily: "Consolas, monospace", fontSize: 11, color: "var(--text-muted)" }}>
                  {att.slot || att.id}
                </span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Nur für eine bestimmte Waffe sperren</h2>

        <select
          value={picked}
          onChange={(event) => setPicked(event.target.value)}
          style={{ ...inputStyle, maxWidth: 420 }}
        >
          <option value="">Waffe wählen …</option>
          {weapons.map((entry) => (
            <option key={entry.class} value={entry.class}>
              {entry.name} ({entry.class})
              {(blocks[entry.class]?.length ?? 0) > 0
                ? ` — ${blocks[entry.class]?.length} gesperrt`
                : ""}
            </option>
          ))}
        </select>

        {weapon && (
          <>
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
              {fitting.length > 0
                ? `${fitting.length} Aufsätze passen auf die Steckplätze dieser Waffe.`
                : "Zu den Steckplätzen dieser Waffe passt kein erfasster Aufsatz."}
            </p>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                gap: 4,
                maxHeight: 320,
                overflowY: "auto",
              }}
            >
              {fitting.map((att) => (
                <label
                  key={att.id}
                  style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13 }}
                >
                  <input
                    type="checkbox"
                    checked={(blocks[weapon.class] ?? []).includes(att.id)}
                    onChange={() => toggle(weapon.class, att.id)}
                    disabled={!canEdit || everywhere.includes(att.id)}
                    style={{ marginTop: 3 }}
                  />
                  <span style={{ opacity: everywhere.includes(att.id) ? 0.5 : 1 }}>
                    {att.name}
                    <span style={{ display: "block", fontFamily: "Consolas, monospace", fontSize: 11, color: "var(--text-muted)" }}>
                      {everywhere.includes(att.id) ? "bereits überall gesperrt" : att.slot}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
/**
 * Welche Spalten in der Tabelle stehen.
 *
 * Nach Gruppen sortiert, weil man in der Praxis ganze Themen ein- und
 * ausblendet — "jetzt Rückstoß", "jetzt Hitze" — und selten einzelne Werte.
 */
function ColumnChooser({
  fields,
  chosen,
  fallback,
  onChange,
}: {
  fields: FieldSpec[];
  chosen: string[];
  fallback: string[];
  onChange: (keys: string[]) => void;
}) {
  const [open, setOpen] = useState(false);

  const groups = useMemo(() => {
    const map = new Map<string, FieldSpec[]>();

    for (const field of fields) {
      const list = map.get(field.group) ?? [];
      list.push(field);
      map.set(field.group, list);
    }

    return Array.from(map.entries());
  }, [fields]);

  function toggle(key: string) {
    onChange(
      chosen.includes(key) ? chosen.filter((entry) => entry !== key) : [...chosen, key],
    );
  }

  function setGroup(group: string, on: boolean) {
    const keys = fields.filter((field) => field.group === group).map((field) => field.key);

    onChange(
      on
        ? Array.from(new Set([...chosen, ...keys]))
        : chosen.filter((entry) => !keys.includes(entry)),
    );
  }

  return (
    <div style={{ marginTop: 10 }}>
      <button type="button" onClick={() => setOpen(!open)}>
        Spalten ({chosen.length} von {fields.length})
      </button>

      {open && (
        <div
          style={{
            marginTop: 8,
            padding: 12,
            border: "1px solid var(--border)",
            borderRadius: 4,
            background: "var(--bg-panel-light)",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={() => onChange(fields.map((field) => field.key))}>
              Alle
            </button>
            <button type="button" onClick={() => onChange(fallback)}>
              Standardauswahl
            </button>
            <button type="button" onClick={() => onChange([])}>
              Keine
            </button>
          </div>

          {groups.map(([group, entries]) => {
            const all = entries.every((field) => chosen.includes(field.key));

            return (
              <div key={group} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="card-label" style={{ margin: 0 }}>
                    {group}
                  </span>
                  <button type="button" onClick={() => setGroup(group, !all)}>
                    {all ? "abwählen" : "alle"}
                  </button>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
                    gap: 4,
                  }}
                >
                  {entries.map((field) => (
                    <label
                      key={field.key}
                      style={{ display: "flex", gap: 7, alignItems: "center", fontSize: 13 }}
                    >
                      <input
                        type="checkbox"
                        checked={chosen.includes(field.key)}
                        onChange={() => toggle(field.key)}
                      />
                      {field.label}
                      {field.unit && (
                        <span style={{ color: "var(--text-muted)" }}>({field.unit})</span>
                      )}
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function matches(id: string, extra: string[], search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (needle === "") return true;

  return [id, ...extra].some((text) => text.toLowerCase().includes(needle));
}

function hasChange(sheet: Sheet, id: string, keys: string[], defaults: Values): boolean {
  const entry = sheet[id] ?? {};

  return keys.some((key) => !sameAsDefault(entry[key] ?? "", defaults[key]));
}

/**
 * Eine Zeile je Eintrag, eine Spalte je Feld. Ein Feld zeigt den Ausgangswert
 * als Platzhalter und färbt seinen Rand, sobald etwas darin steht.
 */
function Grid({
  fields,
  rows,
  sheet,
  setSheet,
  canEdit,
  withNote,
  intro,
}: {
  fields: FieldSpec[];
  rows: Array<{ id: string; title: string; subtitle: string; defaults: Values }>;
  sheet: Sheet;
  setSheet: (updater: (previous: Sheet) => Sheet) => void;
  canEdit: boolean;
  withNote?: boolean;
  intro?: React.ReactNode;
}) {
  function set(id: string, key: string, value: string) {
    setSheet((previous) => ({ ...previous, [id]: { ...previous[id], [key]: value } }));
  }

  // Zurücksetzen heißt hier: den Ausgangswert wieder eintragen, nicht leeren.
  function reset(id: string, defaults: Values) {
    setSheet((previous) => {
      const entry: Record<string, string> = { __note: "" };

      for (const field of fields) {
        const value = defaults[field.key];
        entry[field.key] = value === undefined ? "" : format(value);
      }

      return { ...previous, [id]: entry };
    });
  }

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {intro}

      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ ...th, position: "sticky", left: 0, background: "var(--bg-panel)" }}>
                Eintrag
              </th>
              {fields.map((field) => (
                <th key={field.key} style={{ ...th, textAlign: "right" }}>
                  {field.label}
                  {(field.unit || field.hint) && (
                    <span style={{ display: "block", fontWeight: 400, opacity: 0.6 }}>
                      {field.unit ?? field.hint}
                    </span>
                  )}
                </th>
              ))}
              {withNote && <th style={th}>Notiz</th>}
              <th style={th} />
            </tr>
          </thead>

          <tbody>
            {rows.map((row) => {
              const entry = sheet[row.id] ?? {};
              const touched = fields.some(
                (field) => !sameAsDefault(entry[field.key] ?? "", row.defaults[field.key]),
              );

              return (
                <tr key={row.id}>
                  <td style={{ ...td, position: "sticky", left: 0, background: "var(--bg-panel)" }}>
                    <div style={{ fontWeight: 600 }}>{row.title}</div>
                    <div style={mono}>{row.subtitle}</div>
                  </td>

                  {fields.map((field) => (
                    <td key={field.key} style={{ ...td, textAlign: "right" }}>
                      <input
                        value={entry[field.key] ?? ""}
                        onChange={(event) => set(row.id, field.key, event.target.value)}
                        placeholder={format(row.defaults[field.key])}
                        title={`Ausgangswert: ${format(row.defaults[field.key])}`}
                        disabled={!canEdit}
                        inputMode="decimal"
                        style={{
                          ...inputStyle,
                          width: 76,
                          textAlign: "right",
                          fontVariantNumeric: "tabular-nums",
                          borderColor: sameAsDefault(
                            entry[field.key] ?? "",
                            row.defaults[field.key],
                          )
                            ? "var(--border)"
                            : "#3a86d4",
                        }}
                      />
                    </td>
                  ))}

                  {withNote && (
                    <td style={td}>
                      <input
                        value={entry.__note ?? ""}
                        onChange={(event) => set(row.id, "__note", event.target.value)}
                        placeholder="warum geändert"
                        disabled={!canEdit}
                        style={{ ...inputStyle, minWidth: 130 }}
                      />
                    </td>
                  )}

                  <td style={td}>
                    {canEdit && touched && (
                      <button type="button" onClick={() => reset(row.id, row.defaults)}>
                        Zurücksetzen
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {rows.length === 0 && (
        <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Nichts passt zur Suche.</p>
      )}
    </div>
  );
}

/**
 * Trefferzonen.
 *
 * Oben die allgemeine Regel für alle Waffen, darunter Ausnahmen je Waffe. Der
 * Faktor wirkt zusätzlich zu dem, was ArcCW ohnehin schon rechnet — 1 heißt
 * also unverändert, nicht "kein Kopfschussbonus".
 */
function ZoneEditor({
  weapons,
  sheet,
  setSheet,
  canEdit,
  search,
}: {
  weapons: Weapon[];
  sheet: Sheet;
  setSheet: (updater: (previous: Sheet) => Sheet) => void;
  canEdit: boolean;
  search: string;
}) {
  const [adding, setAdding] = useState("");

  const exceptions = useMemo(
    () => Object.keys(sheet).filter((key) => key !== "*").sort(),
    [sheet],
  );

  const candidates = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return weapons
      .filter((weapon) => !(weapon.class in sheet))
      .filter(
        (weapon) =>
          needle === "" ||
          weapon.class.toLowerCase().includes(needle) ||
          weapon.name.toLowerCase().includes(needle),
      )
      .slice(0, 40);
  }, [weapons, sheet, search]);

  const byClass = useMemo(
    () => new Map(weapons.map((weapon) => [weapon.class, weapon])),
    [weapons],
  );

  function set(id: string, key: string, value: string) {
    setSheet((previous) => ({ ...previous, [id]: { ...previous[id], [key]: value } }));
  }

  function drop(id: string) {
    setSheet((previous) => {
      const next = { ...previous };
      delete next[id];
      return next;
    });
  }

  const rows: Array<{ id: string; title: string; subtitle: string }> = [
    { id: "*", title: "Alle Waffen", subtitle: "Grundregel" },
    ...exceptions.map((className) => ({
      id: className,
      title: byClass.get(className)?.name ?? className,
      subtitle: className,
    })),
  ];

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
        Faktor auf den Schaden je getroffener Körperstelle. 1 heißt unverändert, 2 ist
        doppelter Schaden, 0,5 halber. Der Wert wirkt <strong>zusätzlich</strong> zu dem,
        was ArcCW selbst schon rechnet — ein Kopfschuss bringt also auch bei 1 weiterhin
        mehr. Leer heißt: nicht anfassen.
      </p>

      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              <th style={th}>Gilt für</th>
              {ZONE_FIELDS.map((field) => (
                <th key={field.key} style={{ ...th, textAlign: "right" }}>
                  {field.label}
                </th>
              ))}
              <th style={th} />
            </tr>
          </thead>

          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td style={td}>
                  <div style={{ fontWeight: 600 }}>{row.title}</div>
                  <div style={mono}>{row.subtitle}</div>
                </td>

                {ZONE_FIELDS.map((field) => (
                  <td key={field.key} style={{ ...td, textAlign: "right" }}>
                    <input
                      value={sheet[row.id]?.[field.key] ?? ""}
                      onChange={(event) => set(row.id, field.key, event.target.value)}
                      placeholder="1"
                      disabled={!canEdit}
                      inputMode="decimal"
                      style={{
                        ...inputStyle,
                        width: 72,
                        textAlign: "right",
                        fontVariantNumeric: "tabular-nums",
                        borderColor: sameAsDefault(sheet[row.id]?.[field.key] ?? "", 1)
                          ? "var(--border)"
                          : "#3a86d4",
                      }}
                    />
                  </td>
                ))}

                <td style={td}>
                  {canEdit && row.id !== "*" && (
                    <button type="button" onClick={() => drop(row.id)}>
                      Entfernen
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select
            value={adding}
            onChange={(event) => setAdding(event.target.value)}
            style={{ ...inputStyle, maxWidth: 360 }}
          >
            <option value="">Ausnahme für eine bestimmte Waffe …</option>
            {candidates.map((weapon) => (
              <option key={weapon.class} value={weapon.class}>
                {weapon.name} ({weapon.class})
              </option>
            ))}
          </select>

          <button
            type="button"
            disabled={adding === ""}
            onClick={() => {
              setSheet((previous) => ({
                ...previous,
                [adding]: Object.fromEntries(ZONE_FIELDS.map((field) => [field.key, "1"])),
              }));
              setAdding("");
            }}
          >
            Hinzufügen
          </button>
        </div>
      )}
    </div>
  );
}

function format(value: number | undefined): string {
  if (value === undefined) return "";

  return Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000);
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

const mono: React.CSSProperties = {
  fontFamily: "Consolas, monospace",
  fontSize: 11,
  color: "var(--text-muted)",
};
