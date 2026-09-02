"use client";

import { useCallback, useEffect, useState } from "react";
import type { PanelUser } from "@/lib/auth";
import { Field, Notice, dateFormat, fetchWithTimeout, inputStyle, readJson } from "./ui";
import AssetPicker from "./AssetPicker";

interface Course {
  fbKey: string;
  name: string;
  description: string;
  position: number;
  color: { r: number; g: number; b: number; a: number };
  equip: string[];
  model: string[];
  badge: { skin: number | null; bodygroups: Array<{ model: string; index: number; value: number }> };
  access: { units: string[]; subunits: string[]; jobs: string[] };
  teach: string[];
  requires: string[];
  durationDays: number;
  maxHolders: number;
  holders: number;
}

interface Grant {
  charId: string;
  fbKey: string;
  steamId: string;
  grantedAt: number;
  expiresAt: number;
  charName: string | null;
}

const hex = (c: Course["color"]) =>
  `#${[c.r, c.g, c.b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("")}`;

const fromHex = (value: string) => {
  const match = /^#?([0-9a-f]{6})$/i.exec(value);
  const n = match ? parseInt(match[1], 16) : 0xffffff;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 255 };
};

const parseList = (text: string) =>
  text.split(/[\n,]/).map((entry) => entry.trim()).filter((entry) => entry !== "");

export default function FortbildungManager({ user }: { user: PanelUser }) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [configured, setConfigured] = useState(true);
  const [hint, setHint] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string | number | boolean> | null>(null);
  const [showGrants, setShowGrants] = useState(false);

  const canEdit = user.role === "editor" || user.role === "admin";

  const load = useCallback(async (grantsFor?: string) => {
    try {
      const response = await fetchWithTimeout(
        `/api/fortbildungen${grantsFor ? `?grants=${encodeURIComponent(grantsFor)}` : ""}`,
        { cache: "no-store" },
      );

      const { data, error } = await readJson<{
        configured: boolean;
        hint?: string;
        courses?: Course[];
        grants?: Grant[];
      }>(response);

      if (error) {
        setMessage({ ok: false, text: error });
        return;
      }

      setConfigured(data?.configured ?? true);
      setHint(data?.hint ?? null);
      setCourses(data?.courses ?? []);
      setGrants(data?.grants ?? []);
    } catch {
      setMessage({ ok: false, text: "Fortbildungen konnten nicht geladen werden" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const send = async (payload: Record<string, unknown>, grantsFor?: string) => {
    setBusy(true);
    setMessage(null);

    try {
      const response = await fetchWithTimeout("/api/fortbildungen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const { data, error } = await readJson<{
        courses?: Course[];
        grants?: Grant[];
        reload?: { ok: boolean; message: string };
      }>(response);

      if (error) {
        setMessage({ ok: false, text: error });
        return;
      }

      setCourses(data?.courses ?? []);

      if (grantsFor) await load(grantsFor);

      setMessage({
        ok: Boolean(data?.reload?.ok),
        text: data?.reload?.ok
          ? "Gespeichert, der Server lädt die Fortbildungen neu."
          : `Gespeichert. Server nicht angestoßen: ${data?.reload?.message ?? "unbekannt"}`,
      });
    } catch {
      setMessage({ ok: false, text: "Anfrage fehlgeschlagen" });
    } finally {
      setBusy(false);
    }
  };

  const select = (course: Course) => {
    setSelected(course.fbKey);
    setShowGrants(false);
    setDraft({
      name: course.name,
      description: course.description,
      position: course.position,
      color: hex(course.color),
      equip: course.equip.join(", "),
      model: course.model.join(", "),
      units: course.access.units.join(", "),
      subunits: course.access.subunits.join(", "),
      jobs: course.access.jobs.join(", "),
      teach: course.teach.join(", "),
      requires: course.requires.join(", "),
      durationDays: course.durationDays,
      maxHolders: course.maxHolders,
      skin: course.badge.skin === null ? "" : String(course.badge.skin),
      bodygroups: course.badge.bodygroups
        .map((entry) => `${entry.model}|${entry.index}|${entry.value}`)
        .join("\n"),
    });
    setMessage(null);
  };

  const create = () => {
    setSelected("");
    setShowGrants(false);
    setDraft({
      name: "Neue Fortbildung",
      description: "",
      position: courses.length + 1,
      color: "#3c8c4f",
      equip: "",
      model: "",
      units: "",
      subunits: "",
      jobs: "",
      teach: "",
      requires: "",
      durationDays: 0,
      maxHolders: 0,
      skin: "",
      bodygroups: "",
    });
    setMessage(null);
  };

  const f = (name: string) => String(draft?.[name] ?? "");

  const set = (name: string, value: string | number) =>
    setDraft((previous) => ({ ...(previous ?? {}), [name]: value }));

  const save = async () => {
    if (!draft) return;

    // Abzeichen: eine Zeile je Bodygroup im Format model|index|wert
    const bodygroups = f("bodygroups")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "")
      .map((line) => {
        const [model, index, value] = line.split("|");
        return {
          model: (model ?? "*").trim() || "*",
          index: Number(index) || 0,
          value: Number(value) || 0,
        };
      });

    await send({
      action: "save",
      ...(selected ? { fbKey: selected } : {}),
      input: {
        name: f("name"),
        description: f("description"),
        position: Number(draft.position) || 0,
        color: fromHex(f("color")),
        equip: parseList(f("equip")),
        model: parseList(f("model")),
        badge: {
          skin: f("skin") === "" ? null : Number(f("skin")) || 0,
          bodygroups,
        },
        access: {
          units: parseList(f("units")),
          subunits: parseList(f("subunits")),
          jobs: parseList(f("jobs")),
        },
        teach: parseList(f("teach")),
        requires: parseList(f("requires")),
        durationDays: Number(draft.durationDays) || 0,
        maxHolders: Number(draft.maxHolders) || 0,
      },
    });

    setSelected(null);
    setDraft(null);
  };

  if (loading) return <p className="subtitle">Fortbildungen werden geladen…</p>;

  if (!configured) {
    return <div className="notice">{hint}</div>;
  }

  const current = courses.find((course) => course.fbKey === selected);

  return (
    <>
      {message && <Notice ok={message.ok}>{message.text}</Notice>}

      <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: 18 }}>
        <div className="panel" style={{ alignSelf: "start" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
            <strong style={{ fontSize: 13 }}>KATALOG</strong>
            {canEdit && (
              <button onClick={create} style={{ padding: "4px 10px", fontSize: 13 }}>
                + Neu
              </button>
            )}
          </div>

          {courses.length === 0 && (
            <p className="subtitle" style={{ margin: 0 }}>
              Noch keine Fortbildungen angelegt.
            </p>
          )}

          {courses.map((course) => (
            <div
              key={course.fbKey}
              onClick={() => select(course)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                padding: "8px 9px",
                cursor: "pointer",
                borderRadius: 3,
                background: selected === course.fbKey ? "var(--bg-hover)" : "transparent",
              }}
            >
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: 2,
                  background: hex(course.color),
                  flexShrink: 0,
                }}
              />
              <span style={{ flex: 1 }}>{course.name}</span>
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {course.holders}
              </span>
            </div>
          ))}
        </div>

        <div className="panel">
          {!draft ? (
            <p className="subtitle" style={{ margin: 0 }}>
              Links eine Fortbildung wählen oder eine neue anlegen.
            </p>
          ) : (
            <>
              <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                <button
                  onClick={() => setShowGrants(false)}
                  className={showGrants ? "" : "primary"}
                  style={{ padding: "5px 12px", fontSize: 13 }}
                >
                  Einstellungen
                </button>
                {selected && (
                  <button
                    onClick={() => {
                      setShowGrants(true);
                      void load(selected);
                    }}
                    className={showGrants ? "primary" : ""}
                    style={{ padding: "5px 12px", fontSize: 13 }}
                  >
                    Inhaber ({current?.holders ?? 0})
                  </button>
                )}
              </div>

              {showGrants ? (
                <>
                  {grants.length === 0 ? (
                    <p className="subtitle" style={{ margin: 0 }}>
                      Diese Fortbildung hat noch niemand.
                    </p>
                  ) : (
                    <table>
                      <thead>
                        <tr>
                          <th>Charakter</th>
                          <th>Erhalten</th>
                          <th>Gültig bis</th>
                          <th style={{ textAlign: "right" }}>Aktion</th>
                        </tr>
                      </thead>
                      <tbody>
                        {grants.map((grant) => (
                          <tr key={grant.charId}>
                            <td style={{ color: "var(--text)" }}>
                              {grant.charName ?? grant.charId}
                              <div className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>
                                {grant.charId}
                              </div>
                            </td>
                            <td>{dateFormat(grant.grantedAt)}</td>
                            <td>
                              {grant.expiresAt === 0 ? "unbefristet" : dateFormat(grant.expiresAt)}
                            </td>
                            <td style={{ textAlign: "right" }}>
                              {canEdit && (
                                <button
                                  disabled={busy}
                                  style={{ padding: "3px 9px", fontSize: 12 }}
                                  onClick={() => {
                                    if (!confirm("Fortbildung wirklich entziehen?")) return;
                                    void send(
                                      { action: "revoke", fbKey: grant.fbKey, charId: grant.charId },
                                      grant.fbKey,
                                    );
                                  }}
                                >
                                  Entziehen
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </>
              ) : (
                <>
                  <Field label="Name">
                    <input
                      value={f("name")}
                      onChange={(event) => set("name", event.target.value)}
                      disabled={!canEdit}
                      style={inputStyle}
                    />
                  </Field>

                  <Field label="Beschreibung">
                    <textarea
                      value={f("description")}
                      onChange={(event) => set("description", event.target.value)}
                      disabled={!canEdit}
                      rows={2}
                      style={inputStyle}
                    />
                  </Field>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 }}>
                    <Field label="Sortierung">
                      <input
                        type="number"
                        value={f("position")}
                        onChange={(event) => set("position", event.target.value)}
                        disabled={!canEdit}
                        style={inputStyle}
                      />
                    </Field>
                    <Field label="Gültig (Tage, 0 = dauerhaft)">
                      <input
                        type="number"
                        value={f("durationDays")}
                        onChange={(event) => set("durationDays", event.target.value)}
                        disabled={!canEdit}
                        style={inputStyle}
                      />
                    </Field>
                    <Field label="Max. Inhaber (0 = frei)">
                      <input
                        type="number"
                        value={f("maxHolders")}
                        onChange={(event) => set("maxHolders", event.target.value)}
                        disabled={!canEdit}
                        style={inputStyle}
                      />
                    </Field>
                    <Field label="Farbe">
                      <input
                        type="color"
                        value={f("color")}
                        onChange={(event) => set("color", event.target.value)}
                        disabled={!canEdit}
                        style={{ ...inputStyle, height: 36, padding: 2 }}
                      />
                    </Field>
                  </div>

                  <Field
                    label="Ausrüstung"
                    hint="Wird freigeschaltet, nicht ausgehändigt - abzuholen an der Waffenkiste"
                  >
                    <AssetPicker
                      kind="weapon"
                      value={f("equip")}
                      onChange={(next) => set("equip", next)}
                      disabled={!canEdit}
                      rows={2}
                    />
                  </Field>

                  <Field label="Playermodels" hint="Freigabe in der Umkleide">
                    <AssetPicker
                      kind="model"
                      value={f("model")}
                      onChange={(next) => set("model", next)}
                      disabled={!canEdit}
                      rows={2}
                    />
                  </Field>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 3fr", gap: 12 }}>
                    <Field label="Abzeichen: Skin" hint="leer = unverändert">
                      <input
                        value={f("skin")}
                        onChange={(event) => set("skin", event.target.value)}
                        disabled={!canEdit}
                        style={inputStyle}
                      />
                    </Field>

                    <Field
                      label="Abzeichen: Bodygroups"
                      hint="Eine Zeile je Eintrag im Format model|index|wert. * gilt für jedes Model."
                    >
                      <textarea
                        value={f("bodygroups")}
                        onChange={(event) => set("bodygroups", event.target.value)}
                        disabled={!canEdit}
                        rows={2}
                        placeholder="*|3|1"
                        style={{ ...inputStyle, fontFamily: "Consolas, monospace", fontSize: 13 }}
                      />
                    </Field>
                  </div>

                  <h2 style={{ marginTop: 20 }}>Zugang</h2>
                  <p className="subtitle" style={{ marginTop: -6 }}>
                    Schlüssel wie <span className="mono">JOB_1</span>, kommagetrennt. Alle
                    drei Felder leer bedeutet: für jeden freigegeben.
                  </p>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                    <Field label="Einheiten">
                      <input
                        value={f("units")}
                        onChange={(event) => set("units", event.target.value)}
                        disabled={!canEdit}
                        style={{ ...inputStyle, fontFamily: "Consolas, monospace", fontSize: 13 }}
                      />
                    </Field>
                    <Field label="Untereinheiten">
                      <input
                        value={f("subunits")}
                        onChange={(event) => set("subunits", event.target.value)}
                        disabled={!canEdit}
                        style={{ ...inputStyle, fontFamily: "Consolas, monospace", fontSize: 13 }}
                      />
                    </Field>
                    <Field label="Jobs">
                      <input
                        value={f("jobs")}
                        onChange={(event) => set("jobs", event.target.value)}
                        disabled={!canEdit}
                        style={{ ...inputStyle, fontFamily: "Consolas, monospace", fontSize: 13 }}
                      />
                    </Field>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <Field
                      label="Inhaber darf ausbilden"
                      hint="FB-Schlüssel der Kurse, die der Inhaber leiten darf"
                    >
                      <input
                        value={f("teach")}
                        onChange={(event) => set("teach", event.target.value)}
                        disabled={!canEdit}
                        style={{ ...inputStyle, fontFamily: "Consolas, monospace", fontSize: 13 }}
                      />
                    </Field>
                    <Field label="Voraussetzungen" hint="FB-Schlüssel, die vorher nötig sind">
                      <input
                        value={f("requires")}
                        onChange={(event) => set("requires", event.target.value)}
                        disabled={!canEdit}
                        style={{ ...inputStyle, fontFamily: "Consolas, monospace", fontSize: 13 }}
                      />
                    </Field>
                  </div>

                  {canEdit && (
                    <div className="button-row" style={{ marginTop: 16 }}>
                      <button className="primary" onClick={() => void save()} disabled={busy}>
                        {busy ? "…" : "Speichern"}
                      </button>

                      {selected && (
                        <button
                          disabled={busy}
                          onClick={() => {
                            if (
                              !confirm(
                                `"${current?.name}" löschen? ${current?.holders ?? 0} Charakter(e) verlieren sie. Die Kurshistorie bleibt erhalten.`,
                              )
                            )
                              return;

                            void send({ action: "delete", fbKey: selected });
                            setSelected(null);
                            setDraft(null);
                          }}
                        >
                          Löschen
                        </button>
                      )}

                      <button
                        onClick={() => {
                          setSelected(null);
                          setDraft(null);
                        }}
                        disabled={busy}
                      >
                        Abbrechen
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
