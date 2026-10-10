/**
 * Galaktischer Feldzug - gemeinsame Typen und Startwerte.
 *
 * Zwei Seiten (Republik / KUS), je ein ernannter Kommandeur. Die Spielleitung
 * (Panel-Admin) legt den Feldzug an und beendet die Züge. Alle Regeln und
 * Werte stehen hier bzw. in den Feldzug-Einstellungen (settings_json).
 */

export type Side = "republik" | "kus";
export const SIDES: Side[] = ["republik", "kus"];
export const SIDE_NAME: Record<Side, string> = { republik: "Galaktische Republik", kus: "Konföderation (KUS)" };

export type CampaignStatus = "setup" | "running" | "ended";

export type UnitCategory = "infantry" | "heavy" | "armor" | "artillery" | "ship";
export const CATEGORY_NAME: Record<UnitCategory, string> = {
  infantry: "Infanterie",
  heavy: "Schwere Infanterie",
  armor: "Panzer",
  artillery: "Artillerie",
  ship: "Schiff",
};

export interface UnitType {
  key: string;
  side: Side;
  category: UnitCategory;
  name: string;
  /** Mannstärke (Boden) bzw. 1 (Schiff) */
  men: number;
  cost: number;
  buildTurns: number;
  attack: number;
  defense: number;
  /** Bewegung: effektive Parsec je Zug (Schiffe); Bodentruppen brauchen Transport */
  speed: number;
  /** Laderaum für Bodentruppen (Kompanien) - nur Schiffe */
  capacity: number;
  /** Naval-Klasse (nur Schiffe) */
  navalClass: string;
  /** Wo gebaut: "hq" | "shipyard" | "any" */
  buildAt: string;
  position: number;
}

export interface Settings {
  startPoints: number;
  actionsPerTurn: number;
  /** Systeme besetzen: Kosten je Stufe des Systems */
  occupyCostPerTier: number;
  /** Einkommen je Stufe und Zug */
  incomePerTier: number;
  /** Nachschub: zusammenhängend über Sprünge bis zu dieser Weite (effektive Parsec) */
  supplyHop: number;
  /** Standard-Garnison je besetztem System */
  garrisonType: Record<Side, string>;
  /** Gefechte standardmäßig simulieren (ki) oder durch Spieler (spieler) */
  defaultBattleMode: "ki" | "spieler";
  /** Routenfaktoren wie im Naval-System */
  routeMajor: number;
  routeMinor: number;
  junctionDist: number;
}

export const DEFAULT_SETTINGS: Settings = {
  startPoints: 10000,
  actionsPerTurn: 3,
  occupyCostPerTier: 250,
  incomePerTier: 60,
  supplyHop: 600,
  garrisonType: { republik: "rep_infantry", kus: "kus_b1" },
  defaultBattleMode: "ki",
  routeMajor: 0.5,
  routeMinor: 0.7,
  junctionDist: 25,
};

/** Startkatalog (im Panel änderbar). Werte je Kompanie bzw. Schiff. */
export const DEFAULT_UNIT_TYPES: UnitType[] = [
  // Republik - Boden
  { key: "rep_infantry", side: "republik", category: "infantry", name: "Klon-Infanteriekompanie", men: 144, cost: 300, buildTurns: 1, attack: 10, defense: 10, speed: 0, capacity: 0, navalClass: "", buildAt: "hq", position: 1 },
  { key: "rep_heavy", side: "republik", category: "heavy", name: "Schwere Klonkompanie (ARC/Heavy)", men: 120, cost: 550, buildTurns: 2, attack: 16, defense: 13, speed: 0, capacity: 0, navalClass: "", buildAt: "hq", position: 2 },
  { key: "rep_armor", side: "republik", category: "armor", name: "AT-TE-Zug", men: 40, cost: 900, buildTurns: 2, attack: 24, defense: 22, speed: 0, capacity: 0, navalClass: "", buildAt: "hq", position: 3 },
  { key: "rep_artillery", side: "republik", category: "artillery", name: "SPHA-T-Batterie", men: 30, cost: 800, buildTurns: 2, attack: 30, defense: 6, speed: 0, capacity: 0, navalClass: "", buildAt: "hq", position: 4 },
  // Republik - Schiffe (Naval-Klassen)
  { key: "rep_venator", side: "republik", category: "ship", name: "Venator-Sternzerstörer", men: 1, cost: 3000, buildTurns: 4, attack: 60, defense: 60, speed: 600, capacity: 8, navalClass: "venator", buildAt: "shipyard", position: 10 },
  { key: "rep_acclamator", side: "republik", category: "ship", name: "Acclamator-Angriffsschiff", men: 1, cost: 1600, buildTurns: 3, attack: 30, defense: 32, speed: 600, capacity: 12, navalClass: "acclamator", buildAt: "shipyard", position: 11 },
  { key: "rep_arquitens", side: "republik", category: "ship", name: "Arquitens-Kreuzer", men: 1, cost: 900, buildTurns: 2, attack: 22, defense: 16, speed: 700, capacity: 1, navalClass: "arquitens", buildAt: "shipyard", position: 12 },
  { key: "rep_pelta", side: "republik", category: "ship", name: "Pelta-Fregatte", men: 1, cost: 700, buildTurns: 2, attack: 12, defense: 18, speed: 650, capacity: 2, navalClass: "pelta", buildAt: "shipyard", position: 13 },
  // KUS - Boden
  { key: "kus_b1", side: "kus", category: "infantry", name: "B1-Droidenkompanie", men: 144, cost: 220, buildTurns: 1, attack: 8, defense: 8, speed: 0, capacity: 0, navalClass: "", buildAt: "hq", position: 1 },
  { key: "kus_b2", side: "kus", category: "heavy", name: "B2-Superkampfdroiden", men: 100, cost: 520, buildTurns: 2, attack: 15, defense: 15, speed: 0, capacity: 0, navalClass: "", buildAt: "hq", position: 2 },
  { key: "kus_droideka", side: "kus", category: "heavy", name: "Droideka-Schwadron", men: 40, cost: 650, buildTurns: 2, attack: 18, defense: 20, speed: 0, capacity: 0, navalClass: "", buildAt: "hq", position: 3 },
  { key: "kus_aat", side: "kus", category: "armor", name: "AAT-Kompanie", men: 36, cost: 850, buildTurns: 2, attack: 22, defense: 20, speed: 0, capacity: 0, navalClass: "", buildAt: "hq", position: 4 },
  { key: "kus_artillery", side: "kus", category: "artillery", name: "Droiden-Artilleriebatterie", men: 30, cost: 750, buildTurns: 2, attack: 28, defense: 6, speed: 0, capacity: 0, navalClass: "", buildAt: "hq", position: 5 },
  // KUS - Schiffe
  { key: "kus_providence", side: "kus", category: "ship", name: "Providence-Träger/Zerstörer", men: 1, cost: 3200, buildTurns: 4, attack: 62, defense: 58, speed: 600, capacity: 10, navalClass: "providence", buildAt: "shipyard", position: 10 },
  { key: "kus_recusant", side: "kus", category: "ship", name: "Recusant-Zerstörer", men: 1, cost: 1400, buildTurns: 3, attack: 34, defense: 24, speed: 650, capacity: 4, navalClass: "recusant", buildAt: "shipyard", position: 11 },
  { key: "kus_munificent", side: "kus", category: "ship", name: "Munificent-Fregatte", men: 1, cost: 1000, buildTurns: 2, attack: 26, defense: 20, speed: 650, capacity: 3, navalClass: "munificent", buildAt: "shipyard", position: 12 },
  { key: "kus_lucrehulk", side: "kus", category: "ship", name: "Lucrehulk-Schlachtschiff", men: 1, cost: 5200, buildTurns: 6, attack: 70, defense: 90, speed: 500, capacity: 30, navalClass: "lucrehulk", buildAt: "shipyard", position: 13 },
];

/** Bekannte Welten mit Besonderheiten (Name klein) */
export const KNOWN_TRAITS: Record<string, string[]> = {
  kuat: ["shipyard"], fondor: ["shipyard"], corellia: ["shipyard"], rendili: ["shipyard"], "sluis van": ["shipyard"],
  "mon cala": ["shipyard"], dac: ["shipyard"], foerost: ["shipyard", "foundry"], bilbringi: ["shipyard"], anaxes: ["shipyard"],
  coruscant: ["capital"], kamino: ["clones"], geonosis: ["foundry"], hypori: ["foundry"], mustafar: ["foundry"],
  "skako minor": ["foundry"], felucia: ["foundry"], "colla iv": ["foundry"], raxus: ["capital"], serenno: ["capital"],
  "neimoidia": ["shipyard", "foundry"], "cato neimoidia": ["shipyard", "foundry"], ryloth: [], christophsis: [],
};

export interface CampaignSystem {
  id: string;
  name: string;
  x: number;
  y: number;
  owner: Side | null;
  tier: number;
  traits: string[];
  fort: number;
  contested: boolean;
}

export interface Unit {
  id: number;
  side: Side;
  type: string;
  systemId: string;
  strength: number;
  xp: number;
  status: "ready" | "training" | "moving" | "battle";
  readyTurn: number;
  fleetId: number | null;
  navalShipId: number | null;
}

/** Sprungnetz: Nachbarn mit effektiven Parsec (nur bis zur größten Sprungweite) */
export type HopGraph = Record<string, Array<[string, number]>>;
