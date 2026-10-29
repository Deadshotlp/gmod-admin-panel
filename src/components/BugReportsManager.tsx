"use client";

import { useCallback, useEffect, useState } from "react";
import { dateFormat, fetchWithTimeout, inputStyle, readJson } from "./ui";

interface Entry {
  id: number;
  time: number;
  player: string;
  category: string;
  title: string;
  status: string;
  hasShot: boolean;
}

interface ListResult {
  configured: boolean;
  hint?: string;
  statuses?: string[];
  counts?: Record<string, number>;
  entries?: Entry[];
  total?: number;
  page?: number;
  pageSize?: number;
}

interface LogEntry {
  t: number;
  text: string;
}

interface ErrorEntry {
  time: number;
  err: string;
  addon?: string;
}

interface Report {
  id: number;
  time: number;
  steamid64: string;
  player: string;
  charId: string;
  category: string;
  title: string;
  description: string;
  status: string;
  note: string;
  context: Record<string, unknown>;
  log: LogEntry[];
  errors: { client?: ErrorEntry[]; server?: ErrorEntry[] };
  screenshot: string | null;
}

const STATUS_COLOR: Record<string, string> = {
  offen: "var(--accent-red, #d9534f)",
  "in Arbeit": "var(--accent-orange, #f0ad4e)",
  erledigt: "var(--accent-green, #5cb85c)",
  abgelehnt: "var(--text-muted)",
};

const timeOnly = (seconds: number): string =>
  new Date(seconds * 1000).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function ErrorList({ title, list }: { title: string; list?: ErrorEntry[] }) {
  return (
    <>
      <div className="card-label" style={{ marginTop: 12 }}>
        {title}
      </div>
      {!list || list.length === 0 ? (
        <p className="subtitle" style={{ margin: 0 }}>
          Keine
        </p>
      ) : (
        <pre className="mono" style={{ whiteSpace: "pre-wrap", fontSize: 12, margin: 0 }}>
          {list.map((e) => `${timeOnly(e.time)}  ${e.err}${e.addon ? `  [${e.addon}]` : ""}`).join("\n")}
        </pre>
      )}
    </>
  );
}

function Detail({ id, statuses, onChanged }: { id: number; statuses: string[]; onChanged: () => void }) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("offen");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setReport(null);
    setError(null);
    setSaved(false);

    void (async () => {
      try {
        const response = await fetchWithTimeout(`/api/bugreports?id=${id}`, { cache: "no-store" });
        const { data, error: failure } = await readJson<{ report: Report }>(response);
        if (cancelled) return;
        if (failure || !data) {
          setError(failure ?? "Bericht konnte nicht geladen werden");
          return;
        }
        setReport(data.report);
        setStatus(data.report.status);
        setNote(data.report.note);
      } catch {
        if (!cancelled) setError("Bericht konnte nicht geladen werden");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetchWithTimeout("/api/bugreports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status, note }),
      });
      const { error: failure } = await readJson<{ ok: boolean }>(response);
      if (failure) {
        setError(failure);
        return;
      }
      setSaved(true);
      onChanged();
    } catch {
      setError("Speichern fehlgeschlagen");
    } finally {
      setSaving(false);
    }
  };

  if (error && !report) return <div className="notice error">{error}</div>;
  if (!report) return <p className="subtitle">Lädt …</p>;

  return (
    <div className="panel" style={{ marginTop: 18 }}>
      <h2 style={{ marginTop: 0 }}>
        #{report.id} {report.title}
      </h2>
      <p className="subtitle" style={{ marginTop: 0 }}>
        {dateFormat(report.time)} · {report.category} · {report.player} ({report.steamid64})
        {report.charId ? ` · Charakter ${report.charId}` : ""}
      </p>

      <div className="card-label">Beschreibung</div>
      <p style={{ whiteSpace: "pre-wrap", marginTop: 0 }}>{report.description}</p>

      <div style={{ display: "grid", gridTemplateColumns: "180px 1fr auto", gap: 10, alignItems: "end", marginBottom: 14 }}>
        <div>
          <div className="card-label">Status</div>
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={inputStyle}>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div className="card-label">Notiz (intern)</div>
          <input value={note} onChange={(e) => setNote(e.target.value)} style={inputStyle} maxLength={2000} />
        </div>
        <button className="primary" onClick={() => void save()} disabled={saving}>
          {saving ? "…" : "Speichern"}
        </button>
      </div>
      {error && <div className="notice error">{error}</div>}
      {saved && <div className="notice ok">Gespeichert.</div>}

      {report.screenshot && (
        <>
          <div className="card-label">Screenshot</div>
          <a href={report.screenshot} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={report.screenshot} alt="Screenshot" style={{ maxWidth: "100%", border: "1px solid var(--border)" }} />
          </a>
        </>
      )}

      <div className="card-label" style={{ marginTop: 12 }}>
        Kontext
      </div>
      <table>
        <tbody>
          {Object.entries(report.context).map(([key, value]) => (
            <tr key={key}>
              <td style={{ width: 160, fontSize: 13 }}>{key}</td>
              <td className="mono" style={{ fontSize: 13 }}>
                {String(value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="card-label" style={{ marginTop: 12 }}>
        Eingabe-Protokoll
      </div>
      {report.log.length === 0 ? (
        <p className="subtitle" style={{ margin: 0 }}>
          Nicht mitgeschickt oder leer
        </p>
      ) : (
        <pre className="mono" style={{ whiteSpace: "pre-wrap", fontSize: 12, maxHeight: 360, overflow: "auto", margin: 0 }}>
          {report.log.map((e) => `${timeOnly(e.t)}  ${e.text}`).join("\n")}
        </pre>
      )}

      <ErrorList title="Lua-Fehler (Client)" list={report.errors.client} />
      <ErrorList title="Lua-Fehler (Server, letzte 10 Minuten)" list={report.errors.server} />
    </div>
  );
}

export default function BugReportsManager() {
  const [result, setResult] = useState<ListResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("offen");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<number | null>(null);

  const load = useCallback(
    async (targetPage: number) => {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({ page: String(targetPage) });
      if (status) params.set("status", status);

      try {
        const response = await fetchWithTimeout(`/api/bugreports?${params.toString()}`, { cache: "no-store" });
        const { data, error: failure } = await readJson<ListResult>(response);
        if (failure) {
          setError(failure);
          return;
        }
        setResult(data);
        setPage(targetPage);
      } catch {
        setError("Bug Reports konnten nicht geladen werden");
      } finally {
        setLoading(false);
      }
    },
    [status],
  );

  useEffect(() => {
    void load(1);
  }, [load]);

  if (result && !result.configured) return <div className="notice">{result.hint}</div>;

  const statuses = result?.statuses ?? ["offen", "in Arbeit", "erledigt", "abgelehnt"];
  const total = result?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / (result?.pageSize ?? 50)));

  return (
    <>
      {error && <div className="notice error">{error}</div>}

      <div className="button-row" style={{ marginBottom: 14 }}>
        <button className={status === "" ? "primary" : ""} onClick={() => setStatus("")}>
          Alle
        </button>
        {statuses.map((s) => (
          <button key={s} className={status === s ? "primary" : ""} onClick={() => setStatus(s)}>
            {s} ({result?.counts?.[s] ?? 0})
          </button>
        ))}
      </div>

      <div className="panel">
        {result?.entries && result.entries.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th style={{ width: 60 }}>#</th>
                <th style={{ width: 150 }}>Zeit</th>
                <th style={{ width: 160 }}>Kategorie</th>
                <th>Titel</th>
                <th style={{ width: 160 }}>Spieler</th>
                <th style={{ width: 100 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {result.entries.map((entry) => (
                <tr
                  key={entry.id}
                  onClick={() => setSelected(entry.id)}
                  style={{ cursor: "pointer", background: selected === entry.id ? "var(--bg-panel-light)" : undefined }}
                >
                  <td>{entry.id}</td>
                  <td style={{ whiteSpace: "nowrap", fontSize: 13 }}>{dateFormat(entry.time)}</td>
                  <td style={{ fontSize: 13 }}>{entry.category}</td>
                  <td style={{ fontSize: 13 }}>
                    {entry.title}
                    {entry.hasShot ? " 📷" : ""}
                  </td>
                  <td style={{ fontSize: 13 }}>{entry.player}</td>
                  <td style={{ fontSize: 13, color: STATUS_COLOR[entry.status] ?? "var(--text)", fontWeight: 600 }}>
                    {entry.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          !loading && <p className="subtitle">Keine Bug Reports.</p>
        )}

        {pages > 1 && (
          <div className="button-row" style={{ marginTop: 14 }}>
            <button disabled={loading || page <= 1} onClick={() => void load(page - 1)}>
              ← Neuer
            </button>
            <button disabled={loading || page >= pages} onClick={() => void load(page + 1)}>
              Älter →
            </button>
          </div>
        )}
      </div>

      {selected !== null && <Detail id={selected} statuses={statuses} onChanged={() => void load(page)} />}
    </>
  );
}
