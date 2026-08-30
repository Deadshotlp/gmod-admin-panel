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

// Bewusst nur Node-Bordmittel: diese Datei muss auch dann laufen, wenn
// node_modules noch fehlt - sonst kann sie die Abhaengigkeiten nicht nachziehen.
const {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

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

/**
 * Abhängigkeiten exakt nach Lockfile installieren, wenn sich das Lockfile seit
 * der letzten Installation geändert hat.
 *
 * Das Egg ruft vorher "npm install" auf, das je nach Node-Version und Zeitpunkt
 * einen leicht anderen Abhängigkeitsbaum auflösen darf. "npm ci" erzwingt genau
 * den Baum aus dem Lockfile - denselben, gegen den entwickelt und getestet wurde.
 */
function installIfLockChanged() {
  const lockfile = path.join(process.cwd(), "package-lock.json");
  const installed = path.join(process.cwd(), "node_modules", ".package-lock.json");

  if (!existsSync(lockfile)) return;

  if (!existsSync(installed) || newestMtime(lockfile) > newestMtime(installed)) {
    console.log("[bootstrap] Abhängigkeiten weichen vom Lockfile ab, starte npm ci ...");
    runOrExit("npm", ["ci"]);
  }
}

/**
 * Minimaler .env-Leser für die wenigen Werte, die schon vor dem Start gebraucht
 * werden (PORT, APP_HOSTNAME). Die Anwendung selbst lädt ihre .env später über
 * Next. Bereits gesetzte Umgebungsvariablen haben Vorrang.
 */
function loadDotEnv() {
  const file = path.join(process.cwd(), ".env");
  if (!existsSync(file)) return;

  for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator <= 0) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadDotEnv();

installIfLockChanged();

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
