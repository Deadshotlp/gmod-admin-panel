import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import {
  BACKUP_SCOPES,
  createBackup,
  listBackups,
  readBackup,
  restoreBackup,
  type BackupScope,
} from "@/lib/backups";

export const dynamic = "force-dynamic";

function fail(error: unknown) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  console.error("[backups] Fehler:", error);
  return NextResponse.json({ error: "Fehlgeschlagen" }, { status: 503 });
}

export async function GET(request: Request) {
  try {
    await requireUser("editor");
  } catch (error) {
    return fail(error);
  }

  const file = new URL(request.url).searchParams.get("datei");

  // Herunterladen einer einzelnen Sicherung
  if (file) {
    const backup = await readBackup(file);

    if (!backup) {
      return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
    }

    return new NextResponse(JSON.stringify(backup, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${file}"`,
      },
    });
  }

  return NextResponse.json({
    backups: await listBackups(),
    scopes: Object.keys(BACKUP_SCOPES),
  });
}

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    scope: z.enum(["jobs", "fortbildung", "waffen", "fahrzeuge", "kisten"]),
    reason: z.string().max(200).optional(),
  }),
  z.object({ action: z.literal("restore"), file: z.string().min(1).max(190) }),
]);

export async function POST(request: Request) {
  let user;

  try {
    // Zurückspielen ersetzt ganze Tabellen - das ist Adminsache.
    user = await requireUser("admin");
  } catch (error) {
    return fail(error);
  }

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

  const data = parsed.data;

  try {
    if (data.action === "create") {
      const info = await createBackup(
        data.scope as BackupScope,
        data.reason ?? `Von Hand angelegt durch ${user.displayName}`,
      );

      if (!info) {
        return NextResponse.json(
          { error: "Sicherung konnte nicht geschrieben werden" },
          { status: 500 },
        );
      }

      await writeAudit({
        user,
        action: "backup.create",
        targetType: "backup",
        targetKey: info.file,
        note: `${info.rows} Zeilen`,
      });

      return NextResponse.json({ ok: true, backups: await listBackups() });
    }

    const result = await restoreBackup(data.file);

    await writeAudit({
      user,
      action: "backup.restore",
      targetType: "backup",
      targetKey: data.file,
      note: result.message,
    });

    return NextResponse.json({
      ok: result.ok,
      message: result.message,
      backups: await listBackups(),
    });
  } catch (error) {
    return fail(error);
  }
}
