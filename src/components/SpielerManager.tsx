"use client";

import { useCallback, useEffect, useState } from "react";
import { Notice, fetchWithTimeout, inputStyle, readJson } from "./ui";

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

function playtime(seconds: number): string {
  if (!seconds || seconds <= 0) return "-";

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
}

export default function SpielerManager() {
  const [characters, setCharacters] = useState<CharacterRow[]>([]);
  const [total, setTotal] = useState(0);
  const [limited, setLimited] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const [selected, setSelected] = useState<CharacterRow | null>(null);
  const [courses, setCourses] = useState<CourseRow[]>([]);

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

  const open = async (character: CharacterRow) => {
    setSelected(character);
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

  return (
    <>
      {message && <Notice ok={false}>{message}</Notice>}

      <div className="notice">
        <strong>Diese Ansicht ist nur lesend.</strong> Die Einheitenzuordnung liegt
        gleichzeitig in <span className="mono">pd_characters</span> und in der Datei{" "}
        <span className="mono">data/factions/players.json</span>, aus der der Server
        seinen Fraktionsbaum baut. Zusätzlich schreibt der Gamemode beim Verlassen
        eines Spielers dessen Zeilen komplett neu — eine Änderung von hier würde dabei
        überschrieben. Bearbeiten wird möglich, sobald die Mitgliedschaften nach SQL
        gewandert sind.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 18 }}>
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
                    background:
                      selected?.char_id === character.char_id
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
              <h2 style={{ marginTop: 0 }}>{selected.char_name}</h2>

              <table>
                <tbody>
                  {(
                    [
                      ["Kennung", selected.char_id],
                      ["SteamID64", selected.steamid64],
                      ["Rang", selected.char_rank || "-"],
                      ["Job", selected.job_name || "-"],
                      ["Einheit", selected.faction_unit || "-"],
                      ["Untereinheit", selected.faction_subunit || "-"],
                      ["Jobschlüssel", selected.faction_job || "-"],
                      ["Geld", String(selected.char_money ?? 0)],
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
