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
pd_reload <jobs|fortbildung|fraktionen|armor|spawns|all>
pd_status
pd_admin_say <text>
pd_admin_kick <steamid64> [grund]
pd_defcon <0-5> [text]
```

Alle sind ausschließlich aus der Serverkonsole bzw. per RCON ausführbar — ein
verbundener Spieler kann sie nicht auslösen.

Läuft mehr als ein Server auf derselben Datenbank, unterscheidet das ConVar
`pd_server_key` sie. Der Wert muss zu `SERVER_KEY` in der `.env` passen.

## Stand

Fertig: Anmeldung, Rollen, Änderungsprotokoll, Live-Status, Nachladen.

Noch nicht gebaut: Jobs & Einheiten, Fortbildungen, Waffen & Gewichte, Spieler &
Charaktere, Strafakten, Benutzerverwaltung. Diese Punkte stehen ausgegraut in der
Navigation.
