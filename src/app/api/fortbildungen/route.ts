import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { reloadServer } from "@/lib/pterodactyl";
import { checkRateLimit, rateLimitKey } from "@/lib/rateLimit";
import {
  deleteCourse,
  grantCourse,
  loadCourses,
  loadGrants,
  nextCourseKey,
  revokeGrant,
  saveCourse,
  tablesExist,
} from "@/lib/fortbildungDb";

export const dynamic = "force-dynamic";

const color = z.object({
  r: z.number().int().min(0).max(255),
  g: z.number().int().min(0).max(255),
  b: z.number().int().min(0).max(255),
  a: z.number().int().min(0).max(255),
});

const list = z.array(z.string().min(1).max(190)).max(256);

const courseInput = z.object({
  name: z.string().min(1).max(128),
  description: z.string().max(2000),
  position: z.number().int().min(0).max(9999),
  color,
  equip: list,
  model: list,
  badge: z.object({
    skin: z.number().int().min(0).max(63).nullable(),
    bodygroups: z
      .array(
        z.object({
          model: z.string().max(190),
          index: z.number().int().min(0).max(63),
          value: z.number().int().min(0).max(63),
        }),
      )
      .max(32),
  }),
  access: z.object({ units: list, subunits: list, jobs: list }),
  teach: list,
  requires: list,
  durationDays: z.number().int().min(0).max(3650),
  maxHolders: z.number().int().min(0).max(9999),
});

const key = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), fbKey: key.optional(), input: courseInput }),
  z.object({ action: z.literal("delete"), fbKey: key }),
  z.object({
    action: z.literal("grant"),
    fbKey: key,
    charId: z.string().min(1).max(64),
    steamId: z.string().regex(/^\d{17}$/).or(z.literal("")),
  }),
  z.object({
    action: z.literal("revoke"),
    fbKey: key,
    charId: z.string().min(1).max(64),
  }),
]);

function fail(error: unknown) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  console.error("[fortbildungen] Fehler:", error);
  return NextResponse.json(
    { error: "Datenbank nicht erreichbar", detail: (error as Error).message },
    { status: 503 },
  );
}

export async function GET(request: Request) {
  try {
    await requireUser("viewer");

    if (!(await tablesExist())) {
      return NextResponse.json({
        configured: false,
        hint:
          "Die Tabellen pd_fb_courses und pd_fb_granted fehlen. Sie entstehen beim " +
          "ersten Start des Gamemodes mit dem Modul modules/fortbildung.",
      });
    }

    const fbKey = new URL(request.url).searchParams.get("grants");

    return NextResponse.json({
      configured: true,
      courses: await loadCourses(),
      grants: fbKey ? await loadGrants(fbKey) : [],
    });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  let user;

  try {
    user = await requireUser("editor");
  } catch (error) {
    return fail(error);
  }

  if (!checkRateLimit(rateLimitKey(request, "fb-write"), 60, 60_000)) {
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
    const before = await loadCourses();
    let targetKey = "";

    switch (data.action) {
      case "save": {
        const fbKey = data.fbKey ?? (await nextCourseKey());
        await saveCourse(fbKey, data.input);
        targetKey = fbKey;
        break;
      }

      case "delete":
        await deleteCourse(data.fbKey);
        targetKey = data.fbKey;
        break;

      case "grant": {
        const course = before.find((entry) => entry.fbKey === data.fbKey);

        if (!course) {
          return NextResponse.json({ error: "Unbekannte Fortbildung" }, { status: 400 });
        }

        // Bewusst ohne Zugangsprüfung: das ist der Admin-Weg für Sonderfälle.
        await grantCourse(
          data.charId,
          data.fbKey,
          data.steamId,
          course.durationDays,
          user.steamId,
        );
        targetKey = `${data.fbKey}/${data.charId}`;
        break;
      }

      case "revoke":
        await revokeGrant(data.charId, data.fbKey);
        targetKey = `${data.fbKey}/${data.charId}`;
        break;
    }

    const after = await loadCourses();

    await writeAudit({
      user,
      action: `fb.${data.action === "save" ? "saveCourse" : data.action === "delete" ? "deleteCourse" : data.action}`,
      targetType: "fortbildung",
      targetKey,
      before: data.action === "save" || data.action === "delete" ? before : null,
      after: data.action === "save" || data.action === "delete" ? after : data,
    });

    const reload = await reloadServer("fortbildung");

    return NextResponse.json({
      ok: true,
      courses: after,
      grants: data.action === "grant" || data.action === "revoke"
        ? await loadGrants(data.fbKey)
        : [],
      reload: { ok: reload.ok, message: reload.message },
    });
  } catch (error) {
    console.error("[fortbildungen] Schreiben fehlgeschlagen:", error);

    return NextResponse.json(
      { error: "Änderung fehlgeschlagen", detail: (error as Error).message },
      { status: 500 },
    );
  }
}
