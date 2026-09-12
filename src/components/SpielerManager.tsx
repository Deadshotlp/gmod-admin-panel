"use client";

import { useCallback, useEffect, useState } from "react";
import type { PanelUser } from "@/lib/auth";
import { Field, Notice, fetchWithTimeout, inputStyle, readJson } from "./ui";

interface CharacterRow {
  steamid64: string;
  char_id: string;
  char_name: string;
  char_rank: string;
  char_money: number;
  char_playtime: number;
  char_lastplaytime: string;
  char_cratedate: string;
  faction_unit: string;
  faction_subunit: string;
  faction_job: string;
  job_name: string;
}

interface CourseRow {
  fbKey: string;
  name: string;
  grantedAt: number;
  expiresAt: number;
  expired: boolean;
}

interface TreeJob {
  jobKey: string;
  name: string;
  position: number;
}

interface TreeSubunit {
  subunitKey: string;
  name: string;
  jobs: TreeJob[];
}

interface TreeUnit {
  unitKey: string;
  name: string;
  subunits: TreeSubunit[];
}

interface Draft {
  name: string;
  rank: string;
  money: string;
  unitKey: string;
  subunitKey: string;
  jobKey: string;
}

interface WriteResult {
  ok: boolean;
  character?: CharacterRow;
  reload?: { ok: boolean; message: string };
}

const MAX_MONEY = 2_147_483_647;

function playtime(seconds: number): string {
  if (!seconds || seconds <= 0) return "-";

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
}

function draftFrom(character: CharacterRow): Draft {
  return {
    name: character.char_name ?? "",
    rank: character.char_rank ?? "",
    money: String(character.char_money ?? 0),
    unitKey: character.faction_unit ?? "",
    subunitKey: character.faction_subunit ?? "",
    jobKey: character.faction_job ?? "",
  };
}

function sameCharacter(a: CharacterRow | null, b: CharacterRow): boolean {
  return a !== null && a.steamid64 === b.steamid64 && a.char_id === b.char_id;
}

function reloadText(reload?: { ok: boolean; message: string }): string {
  if (reload?.ok) {
    return "Der Server übernimmt die Änderung, verbundene Spieler werden sofort umgesetzt.";
  }

  return (
    `Der Server wurde aber nicht angestoßen (${reload?.message ?? "unbekannt"}). ` +
    "Die Änderung greift beim nächsten Neustart - ist der Spieler gerade online, " +
    "kann sein Stand sie beim Verlassen überschreiben."
  );
}

export default function SpielerManager({ user }: { user: PanelUser }) {
  const canEdit = user.role === "editor" || user.role === "admin";

  const [characters, setCharacters] = useState<CharacterRow[]>([]);
  const [total, setTotal] = useState(0);
  const [limited, setLimited] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const [selected, setSelected] = useState<CharacterRow | null>(null);
  const [courses, setCourses] = useState<CourseRow[]>([]);

  const [units, setUnits] = useState<TreeUnit[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async (term: string) => {
    setLoading(true);

    try {
      const response = await fetchWithTimeout(
        `/api/spieler${term ? `?suche=${encodeURIComponent(term)}` : ""}`,
        { cache: "no-store" },
      );

      const { data, error } = await readJson<{
        characters: CharacterRow[];
        total: number;
        limited: boolean;
      }>(response);

      if (error) {
        setMessage(error);
        return;
      }

      setCharacters(data?.characters ?? []);
      setTotal(data?.total ?? 0);
      setLimited(data?.limited ?? false);
      setMessage(null);
    } catch {
      setMessage("Charaktere konnten nicht geladen werden");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load("");
  }, [load]);

  // Sucheingabe entprellen, sonst eine Abfrage je Tastendruck.
  useEffect(() => {
    const timer = setTimeout(() => void load(search), 350);
    return () => clearTimeout(timer);
  }, [search, load]);

  // Jobbaum für die Zuordnung - brauchen nur die, die bearbeiten dürfen.
  useEffect(() => {
    if (!canEdit) return;

    let active = true;

    void (async () => {
      try {
        const response = await fetchWithTimeout("/api/jobs", { cache: "no-store" });
        const { data } = await readJson<{ units: TreeUnit[] }>(response);

        if (active) setUnits(data?.units ?? []);
      } catch {
        // Ohne Baum lässt sich keine Zuordnung wählen, Speichern bleibt gesperrt.
      }
    })();

    return () => {
      active = false;
    };
  }, [canEdit]);

  const open = async (character: CharacterRow) => {
    setSelected(character);
    setDraft(draftFrom(character));
    setResult(null);
    setCourses([]);

    try {
      const response = await fetchWithTimeout(
        `/api/spieler?char=${encodeURIComponent(character.char_id)}`,
        { cache: "no-store" },
      );

      const { data } = await readJson<{ courses: CourseRow[] }>(response);
      setCourses(data?.courses ?? []);
    } catch {
      // Fortbildungen sind Beiwerk - die Grunddaten stehen schon.
    }
  };

  const setField = (name: keyof Draft, value: string) =>
    setDraft((previous) => (previous ? { ...previous, [name]: value } : previous));

  const unit = units.find((entry) => entry.unitKey === draft?.unitKey);
  const subunit = unit?.subunits.find((entry) => entry.subunitKey === draft?.subunitKey);
  const job = subunit?.jobs.find((entry) => entry.jobKey === draft?.jobKey);

  const money = Number(draft?.money);
  const valid =
    draft !== null &&
    draft.name.trim() !== "" &&
    Number.isInteger(money) &&
    money >= 0 &&
    money <= MAX_MONEY &&
    Boolean(job);

  // Steht die gespeicherte Zuordnung nicht (mehr) im Jobbaum, das sagen statt
  // leere Auswahlfelder kommentarlos anzuzeigen.
  const staleFaction =
    selected !== null &&
    draft !== null &&
    units.length > 0 &&
    !job &&
    draft.unitKey === selected.faction_unit &&
    draft.subunitKey === selected.faction_subunit &&
    draft.jobKey === selected.faction_job;

  const post = async (payload: Record<string, unknown>): Promise<WriteResult | null> => {
    setBusy(true);
    setResult(null);

    try {
      const response = await fetchWithTimeout("/api/spieler", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const { data, error } = await readJson<WriteResult>(response);

      if (error || !data) {
        setResult({ ok: false, text: error ?? "Änderung fehlgeschlagen" });
        return null;
      }

      return data;
    } catch {
      setResult({ ok: false, text: "Anfrage fehlgeschlagen" });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!selected || !draft || !valid) return;

    const data = await post({
      action: "save",
      steamId: selected.steamid64,
      charId: selected.char_id,
      input: {
        name: draft.name.trim(),
        rank: draft.rank.trim(),
        money,
        unitKey: draft.unitKey,
        subunitKey: draft.subunitKey,
        jobKey: draft.jobKey,
      },
    });

    if (!data?.character) return;

    const saved = data.character;

    setSelected(saved);
    setDraft(draftFrom(saved));
    setCharacters((list) => list.map((entry) => (sameCharacter(entry, saved) ? saved : entry)));
    setResult({ ok: Boolean(data.reload?.ok), text: `Gespeichert. ${reloadText(data.reload)}` });
  };

  const remove = async () => {
    if (!selected) return;

    const target = selected;

    if (
      !confirm(
        `Charakter ${target.char_id} ${target.char_name} wirklich löschen?\n\n` +
          "Seine Fortbildungen werden mit gelöscht. Das lässt sich nicht zurücknehmen.",
      )
    )
      return;

    const data = await post({
      action: "delete",
      steamId: target.steamid64,
      charId: target.char_id,
    });

    if (!data) return;

    setCharacters((list) => list.filter((entry) => !sameCharacter(entry, target)));
    setTotal((value) => Math.max(0, value - 1));
    setSelected(null);
    setDraft(null);
    setCourses([]);
    setResult({ ok: Boolean(data.reload?.ok), text: `Gelöscht. ${reloadText(data.reload)}` });
  };

  return (
    <>
      {message && <Notice ok={false}>{message}</Notice>}
      {result && <Notice ok={result.ok}>{result.text}</Notice>}

      <div className="notice">
        Die Einheitenzuordnung steht in <span className="mono">pd_characters</span>, der
        Server baut seinen Fraktionsbaum daraus. Nach dem Speichern lädt er die Charaktere
        neu und setzt verbundene Spieler sofort um.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 400px", gap: 18 }}>
        <div className="panel">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name, Kennung oder SteamID suchen…"
            style={{ ...inputStyle, marginBottom: 14 }}
          />

          <p className="subtitle" style={{ marginTop: 0 }}>
            {loading
              ? "Wird geladen…"
              : `${characters.length} von ${total} Charakteren${limited ? " (auf 200 begrenzt, bitte suchen)" : ""}`}
          </p>

          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Rang</th>
                <th>Job</th>
                <th style={{ textAlign: "right" }}>Spielzeit</th>
              </tr>
            </thead>
            <tbody>
              {characters.map((character) => (
                <tr
                  key={`${character.steamid64}-${character.char_id}`}
                  onClick={() => void open(character)}
                  style={{
                    cursor: "pointer",
                    background: sameCharacter(selected, character)
                      ? "var(--bg-hover)"
                      : undefined,
                  }}
                >
                  <td style={{ color: "var(--text)" }}>
                    {character.char_name}
                    <div className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      {character.char_id}
                    </div>
                  </td>
                  <td>{character.char_rank || "-"}</td>
                  <td>{character.job_name || "-"}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {playtime(Number(character.char_playtime))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!loading && characters.length === 0 && (
            <p className="subtitle" style={{ marginBottom: 0 }}>
              Keine Charaktere gefunden.
            </p>
          )}
        </div>

        <div className="panel" style={{ alignSelf: "start" }}>
          {!selected ? (
            <p className="subtitle" style={{ margin: 0 }}>
              Links einen Charakter wählen.
            </p>
          ) : (
            <>
              <h2 style={{ marginTop: 0 }}>
                {selected.char_id} {selected.char_name}
              </h2>

              <table>
                <tbody>
                  {(
                    [
                      ["SteamID64", selected.steamid64],
                      ["Rang", selected.char_rank || "-"],
                      ["Job", selected.job_name || "-"],
                      ["Einheit", selected.faction_unit || "-"],
                      ["Untereinheit", selected.faction_subunit || "-"],
                      ["Jobschlüssel", selected.faction_job || "-"],
                      ["Credits", String(selected.char_money ?? 0)],
                      ["Spielzeit", playtime(Number(selected.char_playtime))],
                      ["Erstellt", selected.char_cratedate || "-"],
                      ["Zuletzt gespielt", selected.char_lastplaytime || "-"],
                    ] as const
                  ).map(([label, value]) => (
                    <tr key={label}>
                      <td style={{ color: "var(--text-muted)", width: 140 }}>{label}</td>
                      <td className="mono" style={{ fontSize: 12, color: "var(--text)" }}>
                        {value}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {canEdit && draft && (
                <>
                  <h2>Bearbeiten</h2>

                  <Field label="Name" hint="Ohne Kennung - die steht davor und bleibt.">
                    <input
                      value={draft.name}
                      onChange={(event) => setField("name", event.target.value)}
                      maxLength={64}
                      disabled={busy}
                      style={inputStyle}
                    />
                  </Field>

                  <Field label="Rang">
                    <input
                      value={draft.rank}
                      onChange={(event) => setField("rank", event.target.value)}
                      maxLength={128}
                      disabled={busy}
                      style={inputStyle}
                    />
                  </Field>

                  <Field label="Credits">
                    <input
                      type="number"
                      min={0}
                      max={MAX_MONEY}
                      step={1}
                      value={draft.money}
                      onChange={(event) => setField("money", event.target.value)}
                      disabled={busy}
                      style={inputStyle}
                    />
                  </Field>

                  {staleFaction && (
                    <Notice ok={false}>
                      Die bisherige Zuordnung gibt es im Jobbaum nicht mehr. Bitte Einheit,
                      Untereinheit und Job neu wählen.
                    </Notice>
                  )}

                  <Field label="Einheit">
                    <select
                      value={draft.unitKey}
                      onChange={(event) =>
                        setDraft((previous) =>
                          previous
                            ? { ...previous, unitKey: event.target.value, subunitKey: "", jobKey: "" }
                            : previous,
                        )
                      }
                      disabled={busy || units.length === 0}
                      style={inputStyle}
                    >
                      <option value="">– wählen –</option>
                      {units.map((entry) => (
                        <option key={entry.unitKey} value={entry.unitKey}>
                          {entry.name}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field label="Untereinheit">
                    <select
                      value={draft.subunitKey}
                      onChange={(event) =>
                        setDraft((previous) =>
                          previous
                            ? { ...previous, subunitKey: event.target.value, jobKey: "" }
                            : previous,
                        )
                      }
                      disabled={busy || !unit}
                      style={inputStyle}
                    >
                      <option value="">– wählen –</option>
                      {(unit?.subunits ?? []).map((entry) => (
                        <option key={entry.subunitKey} value={entry.subunitKey}>
                          {entry.name}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field label="Job">
                    <select
                      value={draft.jobKey}
                      onChange={(event) => setField("jobKey", event.target.value)}
                      disabled={busy || !subunit}
                      style={inputStyle}
                    >
                      <option value="">– wählen –</option>
                      {(subunit?.jobs ?? []).map((entry) => (
                        <option key={entry.jobKey} value={entry.jobKey}>
                          {entry.position}. {entry.name}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <div className="button-row" style={{ marginTop: 8 }}>
                    <button className="primary" onClick={() => void save()} disabled={busy || !valid}>
                      {busy ? "…" : "Speichern"}
                    </button>
                    <button onClick={() => setDraft(draftFrom(selected))} disabled={busy}>
                      Zurücksetzen
                    </button>
                    <button onClick={() => void remove()} disabled={busy}>
                      Charakter löschen
                    </button>
                  </div>
                </>
              )}

              <h2>Fortbildungen</h2>
              {courses.length === 0 ? (
                <p className="subtitle" style={{ margin: 0 }}>
                  Keine Fortbildungen.
                </p>
              ) : (
                <table>
                  <tbody>
                    {courses.map((course) => (
                      <tr key={course.fbKey}>
                        <td style={{ color: course.expired ? "var(--text-muted)" : "var(--text)" }}>
                          {course.name}
                        </td>
                        <td style={{ textAlign: "right", fontSize: 12 }}>
                          {course.expired
                            ? "abgelaufen"
                            : course.expiresAt === 0
                              ? "unbefristet"
                              : "befristet"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
