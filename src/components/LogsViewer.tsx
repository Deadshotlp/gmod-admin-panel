"use client";

import { useCallback, useEffect, useState } from "react";
import { dateFormat, fetchWithTimeout, inputStyle, readJson } from "./ui";

interface Entry {
  id: number;
  time: number;
  typ: string;
  text: string;
  color: string;
}

interface Result {
  configured: boolean;
  hint?: string;
  entries?: Entry[];
  total?: number;
  page?: number;
  pageSize?: number;
  types?: Array<{ typ: string; count: number }>;
}

function rgb(color: string): string {
  const [r, g, b] = color.split(",").map((value) => Number(value) || 255);
  return `rgb(${r}, ${g}, ${b})`;
}

export default function LogsViewer() {
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [typ, setTyp] = useState("");
  const [text, setText] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);

  const load = useCallback(
    async (targetPage: number) => {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (typ) params.set("typ", typ);
      if (text.trim()) params.set("q", text.trim());
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      params.set("page", String(targetPage));

      try {
        const response = await fetchWithTimeout(`/api/logs?${params.toString()}`, {
          cache: "no-store",
        });
        const { data, error: failure } = await readJson<Result>(response);

        if (failure) {
          setError(failure);
          return;
        }

        setResult(data);
        setPage(targetPage);
      } catch {
        setError("Logs konnten nicht geladen werden");
      } finally {
        setLoading(false);
      }
    },
    [typ, text, from, to],
  );

  useEffect(() => {
    void load(1);
    // Nur beim ersten Öffnen automatisch; danach über "Suchen".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (result && !result.configured) return <div className="notice">{result.hint}</div>;

  const total = result?.total ?? 0;
  const pageSize = result?.pageSize ?? 100;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <>
      {error && <div className="notice error">{error}</div>}

      <div className="panel" style={{ marginBottom: 18 }}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void load(1);
          }}
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(160px, 1fr) 2fr 150px 150px auto",
            gap: 10,
            alignItems: "end",
          }}
        >
          <div>
            <div className="card-label">Typ</div>
            <select value={typ} onChange={(event) => setTyp(event.target.value)} style={inputStyle}>
              <option value="">Alle</option>
              {result?.types?.map((entry) => (
                <option key={entry.typ} value={entry.typ}>
                  {entry.typ} ({entry.count})
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="card-label">Text enthält</div>
            <input
              value={text}
              placeholder="Name, SteamID, Befehl …"
              onChange={(event) => setText(event.target.value)}
              style={inputStyle}
            />
          </div>
          <div>
            <div className="card-label">Von</div>
            <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} style={inputStyle} />
          </div>
          <div>
            <div className="card-label">Bis</div>
            <input type="date" value={to} onChange={(event) => setTo(event.target.value)} style={inputStyle} />
          </div>
          <button type="submit" className="primary" disabled={loading}>
            {loading ? "…" : "Suchen"}
          </button>
        </form>
      </div>

      <div className="panel">
        <p className="subtitle" style={{ marginTop: 0 }}>
          {total} Einträge{total > 0 && `, Seite ${page} von ${pages}`}. Neue Einträge
          erscheinen mit bis zu 30 Sekunden Verzögerung.
        </p>

        {result?.entries && result.entries.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th style={{ width: 150 }}>Zeit</th>
                <th style={{ width: 160 }}>Typ</th>
                <th>Eintrag</th>
              </tr>
            </thead>
            <tbody>
              {result.entries.map((entry) => (
                <tr key={entry.id}>
                  <td style={{ whiteSpace: "nowrap", fontSize: 13 }}>{dateFormat(entry.time)}</td>
                  <td>
                    <span style={{ color: rgb(entry.color), fontWeight: 600, fontSize: 13 }}>
                      {entry.typ}
                    </span>
                  </td>
                  <td style={{ color: "var(--text)", fontSize: 13, wordBreak: "break-word" }}>
                    {entry.text}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          !loading && <p className="subtitle">Keine Einträge gefunden.</p>
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
    </>
  );
}
