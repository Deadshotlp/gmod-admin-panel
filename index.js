/**
 * Startdatei für Pelican/Pterodactyl.
 *
 * Das Node-Egg startet die in MAIN_FILE hinterlegte Datei - standardmäßig
 * index.js. Fehlt sie, bricht der Start mit MODULE_NOT_FOUND ab, noch bevor die
 * Anwendung überhaupt geladen wird.
 *
 * Diese Datei erledigt drei Dinge:
 *   1. Port und Hostname aus den Panel-Variablen übernehmen
 *   2. bei Bedarf bauen (nach einem git pull ist der alte Build veraltet)
 *   3. den Standalone-Server starten
 */

const { cpSync, existsSync, mkdirSync, readdirSync, statSync } = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { loadEnvConfig } = require("@next/env");

function runOrExit(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  });

  if (result.error) {
    console.error(`[bootstrap] ${command} konnte nicht gestartet werden:`, result.error.message);
    process.exit(1);
  }

  if (typeof result.status === "number" && result.status !== 0) {
    process.exit(result.status);
  }
}

function copyIfPresent(sourceDir, targetDir) {
  if (!existsSync(sourceDir)) return;

  mkdirSync(path.dirname(targetDir), { recursive: true });
  cpSync(sourceDir, targetDir, { recursive: true, force: true });
}

/** Jüngste Änderungszeit in einem Pfad, rekursiv. */
function newestMtime(targetPath) {
  if (!existsSync(targetPath)) return 0;

  const stats = statSync(targetPath);
  if (!stats.isDirectory()) return stats.mtimeMs;

  let newest = stats.mtimeMs;

  for (const entry of readdirSync(targetPath, { withFileTypes: true })) {
    const childMtime = newestMtime(path.join(targetPath, entry.name));
    if (childMtime > newest) newest = childMtime;
  }

  return newest;
}

/**
 * Neu bauen, wenn Quellen jünger sind als der letzte Build. So genügt auf dem
 * Server ein git pull und ein Neustart.
 */
function needsBuild(serverPath) {
  if (!existsSync(serverPath)) return true;

  const buildTime = newestMtime(serverPath);

  const watched = [
    path.join(process.cwd(), "src"),
    path.join(process.cwd(), "public"),
    path.join(process.cwd(), "package.json"),
    path.join(process.cwd(), "package-lock.json"),
    path.join(process.cwd(), "next.config.ts"),
    path.join(process.cwd(), "tsconfig.json"),
  ];

  return watched.some((entry) => newestMtime(entry) > buildTime);
}

loadEnvConfig(process.cwd());

// Pelican/Pterodactyl geben den zugewiesenen Port als SERVER_PORT vor.
if (process.env.SERVER_PORT) {
  process.env.PORT = process.env.SERVER_PORT;
} else if (!process.env.PORT) {
  process.env.PORT = "3000";
}

// Container setzen HOSTNAME oft auf die Container-ID. Hinter einem Reverse Proxy
// muss der Server aber auf allen Schnittstellen lauschen.
process.env.HOSTNAME = process.env.APP_HOSTNAME || "0.0.0.0";

const serverPath = path.join(process.cwd(), ".next", "standalone", "server.js");

if (needsBuild(serverPath)) {
  console.log("[bootstrap] Kein aktueller Build vorhanden, starte npm run build ...");
  runOrExit("npm", ["run", "build"]);
}

if (existsSync(serverPath)) {
  const standaloneDir = path.dirname(serverPath);

  // Der Standalone-Build enthält weder public/ noch die statischen Assets.
  copyIfPresent(path.join(process.cwd(), "public"), path.join(standaloneDir, "public"));
  copyIfPresent(
    path.join(process.cwd(), ".next", "static"),
    path.join(standaloneDir, ".next", "static"),
  );

  console.log(`[bootstrap] Starte Server auf ${process.env.HOSTNAME}:${process.env.PORT}`);
  runOrExit("node", [serverPath]);
} else {
  console.log("[bootstrap] Standalone-Build fehlt, weiche auf npm run start aus ...");
  runOrExit("npm", ["run", "start"]);
}
