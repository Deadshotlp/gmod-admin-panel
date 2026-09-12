import { execute, queryOne, transaction } from "./db";
import { loadTree } from "./jobsDb";

/**
 * Schreibzugriff auf Charaktere (`pd_characters`).
 *
 * Die Einheitenzuordnung steht nur noch hier: der Gamemode baut seinen
 * Fraktionsbaum aus den Spalten `faction_*`, die frühere
 * `data/factions/players.json` wird nicht mehr gelesen. Nach jeder Änderung
 * lädt der Server die Charaktere mit `pd_reload chars` neu und setzt
 * verbundene Spieler sofort um.
 *
 * Die Spalten `job_*` spiegeln den Jobbaum (Anzeigename, erstes Model,
 * Schlüssel der Untereinheit) - so, wie `PD.Char:UpdateStoredCharJobData` sie
 * im Spiel schreibt. Sie werden deshalb aus dem Baum abgeleitet und nie frei
 * gesetzt.
 */

export interface CharacterRow {
  steamid64: string;
  slot_index: number;
  char_id: string;
  char_name: string;
  char_rank: string;
  char_money: number;
  char_playtime: number;
  char_cratedate: string;
  char_lastplaytime: string;
  faction_unit: string;
  faction_subunit: string;
  faction_job: string;
  job_id: string;
  job_name: string;
  job_model: string;
  job_unit: string;
}

export interface CharacterInput {
  name: string;
  rank: string;
  money: number;
  unitKey: string;
  subunitKey: string;
  jobKey: string;
}

/** Fehler mit HTTP-Status, den die Route direkt weitergeben kann. */
export class CharacterError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function getCharacter(steamId: string, charId: string): Promise<CharacterRow | null> {
  return queryOne<CharacterRow>(
    "SELECT * FROM `pd_characters` WHERE `steamid64` = ? AND `char_id` = ? LIMIT 1",
    [steamId, charId],
  );
}

export async function saveCharacter(
  steamId: string,
  charId: string,
  input: CharacterInput,
): Promise<CharacterRow> {
  const existing = await getCharacter(steamId, charId);

  if (!existing) {
    throw new CharacterError(404, "Charakter nicht gefunden");
  }

  const tree = await loadTree();
  const unit = tree.find((entry) => entry.unitKey === input.unitKey);
  const subunit = unit?.subunits.find((entry) => entry.subunitKey === input.subunitKey);
  const job = subunit?.jobs.find((entry) => entry.jobKey === input.jobKey);

  if (!unit || !subunit || !job) {
    throw new CharacterError(400, "Einheit, Untereinheit oder Job gibt es im Jobbaum nicht");
  }

  await execute(
    "UPDATE `pd_characters` SET `char_name` = ?, `char_rank` = ?, `char_money` = ?, " +
      "`faction_unit` = ?, `faction_subunit` = ?, `faction_job` = ?, " +
      "`job_id` = ?, `job_name` = ?, `job_model` = ?, `job_unit` = ? " +
      "WHERE `steamid64` = ? AND `char_id` = ?",
    [
      input.name,
      input.rank,
      input.money,
      unit.unitKey,
      subunit.subunitKey,
      job.jobKey,
      job.jobKey,
      job.name.slice(0, 128),
      (job.model[0] ?? "").slice(0, 255),
      subunit.subunitKey,
      steamId,
      charId,
    ],
  );

  const saved = await getCharacter(steamId, charId);

  if (!saved) {
    throw new CharacterError(404, "Charakter nach dem Speichern nicht mehr gefunden");
  }

  return saved;
}

/**
 * Löscht den Charakter und - wie `PD.FB.CleanupChar` beim Löschen im Spiel -
 * seine Fortbildungen, die an der Charakter-ID hängen.
 */
export async function deleteCharacter(steamId: string, charId: string): Promise<void> {
  await transaction(async (conn) => {
    await conn.execute(
      "DELETE FROM `pd_characters` WHERE `steamid64` = ? AND `char_id` = ?",
      [steamId, charId],
    );

    const [tables] = await conn.query("SHOW TABLES LIKE 'pd_fb_granted'");

    if (Array.isArray(tables) && tables.length > 0) {
      await conn.execute("DELETE FROM `pd_fb_granted` WHERE `char_id` = ?", [charId]);
    }
  });
}
