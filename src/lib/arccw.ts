/**
 * Der Katalog dessen, was sich an den ArcCW-Waffen einstellen lässt.
 *
 * Muss zu PD.ACW.Fields, PD.ACW.Zones und PD.ACW.AttFields in
 * gamemode/modules/arccw/sh_arccw.lua passen. Die Werte selbst reist der Server
 * als JSON an, die Beschriftung und Reihenfolge steuert diese Datei — kommt
 * dort ein Feld dazu, braucht es hier eine Zeile.
 */

export interface FieldSpec {
  key: string;
  label: string;
  group: string;
  unit?: string;
  hint?: string;
}

export const WEAPON_FIELDS: FieldSpec[] = [
  { key: "damage", label: "Schaden nah", group: "Schaden" },
  { key: "damage_min", label: "Schaden fern", group: "Schaden" },
  { key: "range_min", label: "Voller Schaden bis", group: "Schaden", unit: "m" },
  { key: "range", label: "Mindestschaden ab", group: "Schaden", unit: "m" },
  { key: "penetration", label: "Durchschlag", group: "Schaden" },
  { key: "num", label: "Projektile", group: "Schaden", hint: "je Schuss" },

  { key: "rpm", label: "Schuss/Minute", group: "Feuer" },
  { key: "muzzle_velocity", label: "Projektiltempo", group: "Feuer" },

  { key: "recoil", label: "Rückstoß", group: "Handhabung" },
  { key: "recoil_side", label: "Rückstoß seitlich", group: "Handhabung" },
  { key: "recoil_rise", label: "Rückstoß Anstieg", group: "Handhabung" },
  { key: "accuracy_moa", label: "Streuung", group: "Handhabung", unit: "MOA" },
  { key: "hip_dispersion", label: "Streuung Hüfte", group: "Handhabung" },
  { key: "move_dispersion", label: "Streuung Bewegung", group: "Handhabung" },
  { key: "sight_time", label: "Zielzeit", group: "Handhabung", unit: "s" },
  { key: "speed_mult", label: "Tempo mit Waffe", group: "Handhabung" },
  { key: "sighted_speed", label: "Tempo im Visier", group: "Handhabung" },
];

export const ZONE_FIELDS: FieldSpec[] = [
  { key: "head", label: "Kopf", group: "Trefferzone" },
  { key: "chest", label: "Brust", group: "Trefferzone" },
  { key: "stomach", label: "Bauch", group: "Trefferzone" },
  { key: "leftarm", label: "Linker Arm", group: "Trefferzone" },
  { key: "rightarm", label: "Rechter Arm", group: "Trefferzone" },
  { key: "leftleg", label: "Linkes Bein", group: "Trefferzone" },
  { key: "rightleg", label: "Rechtes Bein", group: "Trefferzone" },
  { key: "gear", label: "Ausrüstung", group: "Trefferzone" },
];

export const ATTACHMENT_FIELDS: FieldSpec[] = [
  { key: "mult_damage", label: "Schaden", group: "Faktor" },
  { key: "mult_rpm", label: "Feuerrate", group: "Faktor" },
  { key: "mult_range", label: "Reichweite", group: "Faktor" },
  { key: "mult_penetration", label: "Durchschlag", group: "Faktor" },
  { key: "mult_recoil", label: "Rückstoß", group: "Faktor" },
  { key: "mult_recoil_side", label: "Rückstoß seitlich", group: "Faktor" },
  { key: "mult_accuracy_moa", label: "Streuung", group: "Faktor" },
  { key: "mult_move_dispersion", label: "Streuung Bewegung", group: "Faktor" },
  { key: "mult_sight_time", label: "Zielzeit", group: "Faktor" },
  { key: "mult_speed", label: "Tempo", group: "Faktor" },
  { key: "clip_size", label: "Magazin", group: "Fest", hint: "0 = unverändert" },
];

export const WEAPON_KEYS = WEAPON_FIELDS.map((field) => field.key);
export const ZONE_KEYS = ZONE_FIELDS.map((field) => field.key);
export const ATTACHMENT_KEYS = ATTACHMENT_FIELDS.map((field) => field.key);

export type Values = Record<string, number>;

/** JSON aus der Datenbank in ein sauberes Zahlenobjekt verwandeln. */
export function readValues(raw: unknown, keys: string[]): Values {
  const out: Values = {};

  if (typeof raw !== "string" || raw === "") return out;

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    for (const key of keys) {
      const value = Number(parsed?.[key]);
      if (Number.isFinite(value)) out[key] = value;
    }
  } catch {
    // Kaputtes JSON zählt als "nichts gesetzt".
  }

  return out;
}

export function readList(raw: unknown): string[] {
  if (typeof raw !== "string" || raw === "") return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
