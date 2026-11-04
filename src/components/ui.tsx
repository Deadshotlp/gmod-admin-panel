"use client";

import type { CSSProperties, ReactNode } from "react";

/**
 * Kleine gemeinsame Bausteine. Bewusst schlank gehalten - sie sollen die
 * Wiederholung in den Formularen wegnehmen, kein Designsystem werden.
 */

export const inputStyle: CSSProperties = {
  width: "100%",
  padding: "7px 12px",
  background: "var(--input)",
  border: "1px solid var(--border-2)",
  borderRadius: 8,
  color: "var(--text)",
  font: "inherit",
  fontSize: 13.5,
  lineHeight: "20px",
};

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <div className="card-label">{label}</div>
      {children}
      {hint && <div className="field-hint">{hint}</div>}
    </div>
  );
}

export function Check({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={disabled ? "check disabled" : "check"}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
      />
      {label}
    </label>
  );
}

export function Notice({
  ok,
  children,
}: {
  ok: boolean;
  children: ReactNode;
}) {
  return <div className={`notice ${ok ? "ok" : "error"}`}>{children}</div>;
}

/** Wandelt eine Antwort in JSON um und gibt bei HTML einen lesbaren Fehler. */
export async function readJson<T>(
  response: Response,
): Promise<{ data: T | null; error: string | null }> {
  const text = await response.text();

  try {
    const data = JSON.parse(text) as T & { error?: string };

    if (!response.ok || data.error) {
      return { data: null, error: data.error ?? `Serverfehler (HTTP ${response.status})` };
    }

    return { data, error: null };
  } catch {
    return {
      data: null,
      error: `Unerwartete Antwort (HTTP ${response.status}): ${text.slice(0, 160)}`,
    };
  }
}

/** fetch mit Zeitgrenze - ohne sie kann eine Ansicht ewig laden. */
export async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs = 20_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export const dateFormat = (seconds: number): string =>
  seconds > 0
    ? new Date(seconds * 1000).toLocaleString("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "-";
