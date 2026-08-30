import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { checkRateLimit, rateLimitKey } from "@/lib/rateLimit";
import { reloadServer } from "@/lib/pterodactyl";
import {
  countAffectedCharacters,
  deleteJob,
  deleteSubunit,
  deleteUnit,
  loadTree,
  nextKey,
  saveJob,
  saveSubunit,
  saveUnit,
} from "@/lib/jobsDb";

export const dynamic = "force-dynamic";

const colorSchema = z.object({
  r: z.number().int().min(0).max(255),
  g: z.number().int().min(0).max(255),
  b: z.number().int().min(0).max(255),
  a: z.number().int().min(0).max(255),
});

const classList = z.array(z.string().min(1).max(190)).max(128);

const unitInput = z.object({
  name: z.string().min(1).max(128),
  isDefault: z.boolean(),
  equip: classList,
  color: colorSchema,
});

const subunitInput = unitInput.extend({
  maxMembers: z.number().int().min(0).max(9999),
  isMedic: z.boolean(),
  isLeo: z.boolean(),
  isEngineer: z.boolean(),
});

const jobInput = unitInput.extend({
  salary: z.number().int().min(0).max(1_000_000),
  speed: z.number().int().min(0).max(1000),
  position: z.number().int().min(0).max(9999),
  showId: z.boolean(),
  model: classList,
});

const key = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/, "Ungültiger Schlüssel");

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("saveUnit"), unitKey: key.optional(), input: unitInput }),
  z.object({
    action: z.literal("saveSubunit"),
    unitKey: key,
    subunitKey: key.optional(),
    input: subunitInput,
  }),
  z.object({
    action: z.literal("saveJob"),
    unitKey: key,
    subunitKey: key,
    jobKey: key.optional(),
    input: jobInput,
  }),
  z.object({ action: z.literal("deleteUnit"), unitKey: key }),
  z.object({ action: z.literal("deleteSubunit"), unitKey: key, subunitKey: key }),
  z.object({
    action: z.literal("deleteJob"),
    unitKey: key,
    subunitKey: key,
    jobKey: key,
  }),
]);

function authFailed(error: unknown) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  console.error("[jobs] unerwarteter Fehler:", error);

  return NextResponse.json(
    { error: "Datenbank nicht erreichbar", detail: (error as Error).message },
    { status: 503 },
  );
}

export async function GET() {
  try {
    await requireUser("viewer");

    return NextResponse.json({ units: await loadTree() });
  } catch (error) {
    return authFailed(error);
  }
}

export async function POST(request: Request) {
  let user;

  try {
    user = await requireUser("editor");
  } catch (error) {
    return authFailed(error);
  }

  if (!checkRateLimit(rateLimitKey(request, "jobs-write"), 60, 60_000)) {
    return NextResponse.json({ error: "Zu viele Änderungen" }, { status: 429 });
  }

  let raw: unknown;

  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }

  const parsed = body.safeParse(raw);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Ungültige Eingabe", detail: parsed.error.issues },
      { status: 400 },
    );
  }

  const data = parsed.data;

  try {
    // Zustand vorher festhalten, damit das Protokoll ein Vorher/Nachher hat.
    const before = await loadTree();

    let targetKey = "";

    switch (data.action) {
      case "saveUnit": {
        const unitKey = data.unitKey ?? (await nextKey());
        await saveUnit(unitKey, data.input, !data.unitKey);
        targetKey = unitKey;
        break;
      }

      case "saveSubunit": {
        const subunitKey = data.subunitKey ?? (await nextKey());
        await saveSubunit(data.unitKey, subunitKey, data.input, !data.subunitKey);
        targetKey = `${data.unitKey}/${subunitKey}`;
        break;
      }

      case "saveJob": {
        const jobKey = data.jobKey ?? (await nextKey());
        await saveJob(data.unitKey, data.subunitKey, jobKey, data.input, !data.jobKey);
        targetKey = `${data.unitKey}/${data.subunitKey}/${jobKey}`;
        break;
      }

      case "deleteUnit":
        await deleteUnit(data.unitKey);
        targetKey = data.unitKey;
        break;

      case "deleteSubunit":
        await deleteSubunit(data.unitKey, data.subunitKey);
        targetKey = `${data.unitKey}/${data.subunitKey}`;
        break;

      case "deleteJob":
        await deleteJob(data.unitKey, data.subunitKey, data.jobKey);
        targetKey = `${data.unitKey}/${data.subunitKey}/${data.jobKey}`;
        break;
    }

    const after = await loadTree();

    await writeAudit({
      user,
      action: `jobs.${data.action}`,
      targetType: "jobs",
      targetKey,
      before,
      after,
    });

    // Änderung ist gespeichert. Ob der Server sie übernimmt, ist ein zweiter,
    // eigenständiger Schritt - er darf das Speichern nicht rückgängig machen.
    const reload = await reloadServer("jobs");

    return NextResponse.json({
      ok: true,
      units: after,
      reload: { ok: reload.ok, message: reload.message },
    });
  } catch (error) {
    console.error("[jobs] Schreiben fehlgeschlagen:", error);

    return NextResponse.json(
      { error: "Änderung fehlgeschlagen", detail: (error as Error).message },
      { status: 500 },
    );
  }
}

/** Anzahl betroffener Charaktere, für die Rückfrage vor dem Löschen. */
export async function PUT(request: Request) {
  try {
    await requireUser("editor");
  } catch (error) {
    return authFailed(error);
  }

  const schema = z.object({
    unitKey: key,
    subunitKey: key.optional(),
    jobKey: key.optional(),
  });

  let raw: unknown;

  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }

  const parsed = schema.safeParse(raw);

  if (!parsed.success) {
    return NextResponse.json({ error: "Ungültige Eingabe" }, { status: 400 });
  }

  try {
    const count = await countAffectedCharacters(
      parsed.data.unitKey,
      parsed.data.subunitKey,
      parsed.data.jobKey,
    );

    return NextResponse.json({ affected: count });
  } catch (error) {
    return authFailed(error);
  }
}
