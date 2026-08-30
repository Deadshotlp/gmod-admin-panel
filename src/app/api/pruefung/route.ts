import { NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/auth";
import { findUnknown, loadInventory } from "@/lib/assets";
import { loadTree } from "@/lib/jobsDb";
import { loadCourses } from "@/lib/fortbildungDb";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Prüfbericht: welche Einträge verweisen auf Waffen oder Models, die es auf dem
 * Server gar nicht gibt.
 *
 * Datenquelle ist pd_server_assets, das der Gamemode beim Start schreibt.
 */
export async function GET() {
  try {
    await requireUser("viewer");
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: "Datenbank nicht erreichbar" }, { status: 503 });
  }

  try {
    const inventory = await loadInventory();

    if (!inventory.available) {
      return NextResponse.json({
        available: false,
        hint:
          "Der Server hat noch keinen Bestand gemeldet. Das Modul " +
          "admin/module/remote schreibt ihn etwa 20 Sekunden nach dem Start; " +
          "mit pd_assets_write lässt er sich sofort erneuern.",
      });
    }

    const entries: Array<{ type: "weapon" | "model"; value: string; where: string }> = [];

    // Jobs
    const tree = await loadTree();

    for (const unit of tree) {
      for (const weapon of unit.equip) {
        entries.push({ type: "weapon", value: weapon, where: `Einheit ${unit.name}` });
      }

      for (const subunit of unit.subunits) {
        for (const weapon of subunit.equip) {
          entries.push({
            type: "weapon",
            value: weapon,
            where: `${unit.name} → ${subunit.name}`,
          });
        }

        for (const job of subunit.jobs) {
          for (const weapon of job.equip) {
            entries.push({
              type: "weapon",
              value: weapon,
              where: `${subunit.name} → ${job.name}`,
            });
          }

          for (const model of job.model) {
            entries.push({
              type: "model",
              value: model,
              where: `${subunit.name} → ${job.name}`,
            });
          }
        }
      }
    }

    // Fortbildungen
    try {
      for (const course of await loadCourses()) {
        for (const weapon of course.equip) {
          entries.push({
            type: "weapon",
            value: weapon,
            where: `Fortbildung ${course.name}`,
          });
        }

        for (const model of course.model) {
          entries.push({
            type: "model",
            value: model,
            where: `Fortbildung ${course.name}`,
          });
        }
      }
    } catch {
      // Fortbildungsmodul noch nicht eingerichtet
    }

    // Waffenkiste
    try {
      const weapons = await query<{ class: string; category: string }>(
        "SELECT `class`, `category` FROM `pd_wb_weapons`",
      );

      for (const weapon of weapons) {
        entries.push({
          type: "weapon",
          value: weapon.class,
          where: `Waffenkiste (${weapon.category})`,
        });
      }
    } catch {
      // Waffenkisten-Tabellen noch nicht angelegt
    }

    const unknown = findUnknown(inventory, entries);

    // Gleiche Klasse an mehreren Stellen zusammenfassen
    const grouped = new Map<string, { type: string; value: string; places: string[] }>();

    for (const item of unknown) {
      const key = `${item.type}:${item.value}`;
      const existing = grouped.get(key);

      if (existing) existing.places.push(item.where);
      else grouped.set(key, { type: item.type, value: item.value, places: [item.where] });
    }

    return NextResponse.json({
      available: true,
      updatedAt: inventory.updatedAt,
      checked: entries.length,
      installed: {
        weapons: inventory.weapons.size,
        models: inventory.models.size,
      },
      unknown: Array.from(grouped.values()).sort((a, b) =>
        a.value.localeCompare(b.value),
      ),
    });
  } catch (error) {
    console.error("[pruefung] fehlgeschlagen:", error);

    return NextResponse.json(
      { error: "Prüfung fehlgeschlagen", detail: (error as Error).message },
      { status: 503 },
    );
  }
}
