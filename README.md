# SWRP Serververwaltung

Web-Panel für den Garry's-Mod-Star-Wars-RP-Server. Schreibt direkt in die
Gamemode-Datenbank und stößt den laufenden Server danach zum Nachladen an.

## Wie es zusammenhängt

```
Browser ──Steam-Login──► Panel ──mysql2──► Gamemode-Datenbank
                           │
                           └─Pterodactyl-API─► Serverkonsole ─► pd_reload
                                                                    │
                                                     GMod lädt aus der DB nach
```

GMod kann keine eingehenden Verbindungen annehmen. Deshalb läuft der Weg von
außen über die Serverkonsole: das Panel schickt über die Pterodactyl-API einen
Befehl, den das Gamemode-Modul `admin/module/remote` entgegennimmt.

## Voraussetzungen

- Node 20 oder neuer
- Netzzugang zur Gamemode-Datenbank. Steht der MySQL-Server im lokalen Netz, ist
  er **von außen nicht erreichbar** — das Panel muss dann im selben Netz laufen
  (etwa als weiterer Container auf demselben Host) oder über einen Tunnel
  angebunden werden.
- Ein Pterodactyl-Client-API-Schlüssel für den Spielserver.

## Einrichten

```bash
npm install
cp .env.example .env
```

Danach die `.env` ausfüllen. Zwingend: `DB_*`, `SESSION_SECRET`,
`PANEL_BOOTSTRAP_STEAM_IDS` (deine eigene SteamID64, sonst kommst du nicht rein).

`SESSION_SECRET` erzeugen:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Starten:

```bash
npm run dev
```

## Deployen auf Pelican / Pterodactyl

Als generischer NodeJS-Server. Wichtig sind zwei Einstellungen:

| Variable | Wert |
|---|---|
| `MAIN_FILE` / Startdatei | `index.js` |
| `AUTO_UPDATE` | `1`, wenn das Egg bei jedem Start `git pull` machen soll |

`index.js` ist die Startdatei, die das Egg aufruft. Sie übernimmt den vom Panel
zugewiesenen Port aus `SERVER_PORT`, setzt `HOSTNAME` auf `0.0.0.0` (sonst
lauscht der Server nur auf der Container-ID und der Reverse Proxy bekommt keine
Verbindung), baut bei Bedarf neu und startet den Standalone-Server.

> Zeigt `MAIN_FILE` auf eine Datei, die es nicht gibt, bricht der Start mit
> `Cannot find module './index.js'` ab — der Fehler kommt dann von `ts-node` aus
> dem Egg, nicht aus dieser Anwendung.

Nach einem `git pull` genügt ein Neustart: die Startdatei vergleicht die
Änderungszeiten von `src/`, `package.json` und den Konfigurationsdateien mit dem
letzten Build und baut nur dann neu.

Die `.env` legst du direkt im Container an (`/home/container/.env`). Sie steht in
`.gitignore` und gehört nicht ins Repository.

`typescript` und die `@types/*` stehen bewusst in `dependencies` statt in
`devDependencies`: der Container baut sich selbst, und bei `NODE_ENV=production`
würde `npm install` die devDependencies überspringen — dann fehlt TypeScript und
`next build` bricht ab.

## Zugang

Anmeldung läuft über Steam. **Wer sich anmeldet, hat noch keinen Zugang** — die
SteamID muss in der Tabelle `pd_panel_users` stehen. Für den Erstzugang trägst du
dich über `PANEL_BOOTSTRAP_STEAM_IDS` ein; diese IDs sind immer Administrator,
auch wenn die Tabelle leer ist.

Rollen:

| Rolle | Darf |
|---|---|
| `viewer` | alles ansehen |
| `editor` | Konfiguration ändern, Daten neu laden lassen |
| `admin` | zusätzlich Eingriffe am laufenden Server und Benutzerverwaltung |

## Gegenstück im Gamemode

Das Panel braucht `gamemode/modules/admin/module/remote/sv_remote.lua`. Das Modul
legt die Tabellen `pd_server_status` und `pd_online_players` an, schreibt alle 15
Sekunden einen Heartbeat und stellt diese Konsolenbefehle bereit:

```
pd_reload <jobs|fortbildung|waffen|fraktionen|armor|spawns|all>
pd_status
pd_assets_write
pd_admin_say <text>
pd_admin_kick <steamid64> [grund]
pd_defcon <0-5> [text]
```

Alle sind ausschließlich aus der Serverkonsole bzw. per RCON ausführbar — ein
verbundener Spieler kann sie nicht auslösen.

Läuft mehr als ein Server auf derselben Datenbank, unterscheidet das ConVar
`pd_server_key` sie. Der Wert muss zu `SERVER_KEY` in der `.env` passen.

## Bereiche

| Bereich | Inhalt |
|---|---|
| Übersicht | Serverstatus, Spielerliste, Nachladen anstoßen |
| Jobs & Einheiten | Baum aus Unit, Untereinheit und Job; Export und Import |
| Fortbildungen | Katalog und Inhaber |
| Waffen & Gewichte | Kategorien, Gewichte, Tragelast, Rechner zum Durchspielen |
| Spieler & Charaktere | Suche und Einsicht (nur lesend, siehe unten) |
| Werkzeuge | Ausrüstungs-Prüfung, Sicherungen, Serverkonsole |
| Änderungsprotokoll | Wer hat wann was geändert, mit Rücknahme |
| Panel-Benutzer | Rollen vergeben |

**Spieler & Charaktere ist bewusst nur lesend.** Die Einheitenzuordnung liegt
gleichzeitig in `pd_characters` und in `data/factions/players.json`, und der
Gamemode schreibt beim Verlassen eines Spielers dessen Zeilen komplett neu — eine
Änderung von hier würde dabei überschrieben.

## Sicherungen

Vor Import, Rücknahme und Zurückspielen legt das Panel automatisch eine Sicherung
des betroffenen Bereichs an. Die Dateien liegen im Ordner `backups/` neben der
Anwendung und sind **nicht** im Repository. Bei einem Neuaufbau des Containers
sind sie weg — wichtige Sicherungen also über die Oberfläche herunterladen.

## Ausrüstungs-Prüfung

Der Gamemode schreibt beim Start alle installierten Waffen und Playermodels nach
`pd_server_assets`. Unter „Werkzeuge" zeigt das Panel damit an, welche Einträge in
Jobs, Fortbildungen oder der Waffenkiste auf etwas verweisen, das es auf dem
Server gar nicht gibt. Mit `pd_assets_write` in der Serverkonsole lässt sich der
Bestand sofort erneuern.

## Mehrere Server

Sind weitere Server über `PANEL_SERVER_2_*` konfiguriert, erscheint in der
Seitenleiste ein Umschalter. Jeder Server hat eine eigene Datenbank und eigene
Pterodactyl-Anbindung. Der Jobbaum lässt sich exportieren und auf einem anderen
Server importieren.
