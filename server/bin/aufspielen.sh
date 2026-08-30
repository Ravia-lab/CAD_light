#!/usr/bin/env bash
# ===========================================================================
#  RaVia CAD Light — eine neue Fassung aufspielen
# ---------------------------------------------------------------------------
#  Der Grundgedanke: **erst danebenlegen, dann umschalten.**
#
#  Die neue Fassung wird in ein eigenes Verzeichnis kopiert, geprüft, und
#  erst danach zeigt die Verknüpfung `aktuell` darauf. Dadurch gibt es keinen
#  Augenblick, in dem der Server halb alte und halb neue Dateien ausliefert —
#  und das ist kein theoretischer Fall: wer mit `rsync --delete` direkt ins
#  laufende Verzeichnis kopiert, liefert genau dazwischen eine index.html
#  aus, die auf Dateien zeigt, die es noch nicht gibt.
#
#  Zurücknehmen geht mit bin/zuruecknehmen.sh in einem Zug.
#
#  Aufruf (als root, aus dem entpackten Paketverzeichnis):
#      sudo bin/aufspielen.sh
# ===========================================================================
set -euo pipefail

# nginx neu laden — auf jedem Wirt, auch ohne systemd.
#
# Die meisten Server fahren systemd; Container und ältere Systeme nicht. Ein
# Aufspielskript, das nur `systemctl` kennt, bricht dort mit einem Fehler ab,
# obwohl alles in Ordnung ist — und wer das einmal erlebt hat, spielt beim
# nächsten Mal von Hand auf und lässt die Prüfungen weg.
nginx_neu_laden() {
  if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet nginx 2>/dev/null; then
    # `ravia-deploy` darf genau diesen einen Befehl über sudo — mehr braucht
    # das Aufspielen nicht, und mehr soll es auch nicht können.
    if [[ $EUID -eq 0 ]]; then systemctl reload nginx; else sudo -n systemctl reload nginx; fi
  else
    # Kein systemd (Container, ältere Systeme): unmittelbar neu laden. Auch
    # hier über sudo, wenn wir nicht root sind — sonst startet nginx als
    # gewöhnlicher Benutzer und scheitert an /var/log/nginx, und die Meldung
    # sieht aus wie ein Konfigurationsfehler, obwohl es ein Rechtefehler ist.
    if [[ $EUID -eq 0 ]]; then
      nginx -s reload 2>/dev/null || nginx
    else
      sudo -n nginx -s reload 2>/dev/null || sudo -n nginx
    fi
  fi
}

# Wo die Fassungen liegen. Änderbar über die Umgebung, damit dasselbe Skript
# für den eigenen Serverblock (/var/www/ravia-cad) und für den Unterpfad in
# einer bestehenden Seite (/opt/ravia-cad-light) taugt.
WURZEL="${RAVIA_WURZEL:-/opt/ravia-cad-light}"
PAKET="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BEHALTEN=5                       # so viele alte Fassungen bleiben stehen
OHNE_NEULADEN=0
[[ "${1:-}" == "--ohne-neuladen" ]] && OHNE_NEULADEN=1

rot()  { printf '\033[31m%s\033[0m\n' "$*"; }
gruen(){ printf '\033[32m%s\033[0m\n' "$*"; }
grau() { printf '\033[90m%s\033[0m\n' "$*"; }

# Root ist **nicht** nötig, wenn das Verzeichnis dem Aufspielbenutzer gehört
# — genau dafür gibt es den Benutzer `ravia-deploy`. Geprüft wird deshalb das
# Schreibrecht und nicht die Benutzerkennung.
if [[ ! -w "$WURZEL" ]] && [[ $EUID -ne 0 ]]; then
  rot "Kein Schreibrecht auf $WURZEL."
  echo "Entweder als der Benutzer aufrufen, dem das Verzeichnis gehört,"
  echo "oder einmalig mit sudo. Eingerichtet wird das von einrichten-unterpfad.sh."
  exit 1
fi
[[ -f "$PAKET/app/index.html" ]] || { rot "app/index.html fehlt — Paket unvollständig."; exit 1; }

FASSUNG="$(cat "$PAKET/VERSION" 2>/dev/null || echo unbekannt)"
STEMPEL="$(date +%Y%m%d-%H%M%S)"
ZIEL="$WURZEL/fassungen/${STEMPEL}-${FASSUNG}"

echo
echo "Aufspielen: Fassung $FASSUNG  →  $ZIEL"
echo "─────────────────────────────────────────────────────────────"

# -- 1 · Prüfsummen des Pakets ----------------------------------------------
#  Vor dem Kopieren, nicht danach: eine Datei, die beim Übertragen des
#  Archivs beschädigt wurde, soll gar nicht erst auf den Server.
if [[ -f "$PAKET/pruefsummen.sha256" ]]; then
  if (cd "$PAKET" && sha256sum -c --quiet pruefsummen.sha256); then
    grau "  ✓ Prüfsummen stimmen"
  else
    rot  "  ✗ Prüfsummen stimmen nicht — das Paket ist beschädigt."
    rot  "    Nicht aufspielen. Archiv neu übertragen."
    exit 1
  fi
else
  grau "  · keine Prüfsummendatei im Paket"
fi

# -- 2 · Danebenlegen -------------------------------------------------------
mkdir -p "$ZIEL"
rsync -a --delete "$PAKET/app/" "$ZIEL/"
chown -R "$(stat -c %U "$WURZEL"):$(stat -c %G "$WURZEL")" "$ZIEL" 2>/dev/null || true
find "$ZIEL" -type d -exec chmod 755 {} +
find "$ZIEL" -type f -exec chmod 644 {} +
grau "  ✓ kopiert ($(du -sh "$ZIEL" | cut -f1))"

# -- 3 · Prüfen, bevor umgeschaltet wird ------------------------------------
#  Die drei Dinge, ohne die die Anwendung nicht startet. Sie zu prüfen kostet
#  nichts; sie **nicht** zu prüfen kostet einen Betriebsausfall, den man erst
#  bemerkt, wenn jemand anruft.
fehler=0
[[ -f "$ZIEL/index.html" ]] || { rot "  ✗ index.html fehlt"; fehler=1; }
[[ -d "$ZIEL/assets"     ]] || { rot "  ✗ assets/ fehlt"; fehler=1; }
if ! ls "$ZIEL"/assets/*.js >/dev/null 2>&1; then rot "  ✗ keine Skriptdatei in assets/"; fehler=1; fi
# Jede in der index.html genannte Datei muss auch daliegen. Genau hier fällt
# ein unvollständig übertragenes Archiv auf.
#
# Der Basispfad muss dabei abgezogen werden: bei einem Build für
# `/Cad_light/` steht in der index.html `/Cad_light/assets/…`, auf der Platte
# liegt die Datei aber unter `assets/…`. Der Basispfad wird aus der Datei
# selbst gelesen statt als Vorgabe geführt — dann stimmt er auch, wenn jemand
# den Pfad ändert und den Build vergisst.
BASIS_IM_HTML="$(grep -oE '(src|href)="[^"]*assets/' "$ZIEL/index.html" | head -1 | sed 's/.*="//;s/assets\/$//')"
while read -r datei; do
  relativ="${datei#"$BASIS_IM_HTML"}"
  relativ="${relativ#/}"
  [[ -f "$ZIEL/$relativ" ]] || { rot "  ✗ index.html verweist auf $datei — nicht vorhanden"; fehler=1; }
done < <(grep -oE '(src|href)="/[^"]*"' "$ZIEL/index.html" | sed 's/.*="//;s/"$//' | grep -v '^/$' || true)
if [[ -n "$BASIS_IM_HTML" && "$BASIS_IM_HTML" != "/" ]]; then
  grau "  · Build für Basispfad $BASIS_IM_HTML"
fi
if [[ $fehler -eq 1 ]]; then
  rot "  ✗ Abbruch. Die laufende Fassung bleibt unverändert."
  rm -rf "$ZIEL"
  exit 1
fi
grau "  ✓ vollständig"

# -- 4 · Umschalten ---------------------------------------------------------
#  `ln -sfn` über eine Zwischenverknüpfung und `mv`: das ist auf einem
#  Dateisystem ein einziger Vorgang. Ein direktes `ln -sfn` auf ein
#  bestehendes Verzeichnis legt die Verknüpfung sonst **hinein** statt
#  darüber.
# `readlink -f` liefert bei einer Verknüpfung, die es noch nicht gibt, den
# angefragten Pfad zurück statt eines Fehlers. Beim ersten Aufspielen stünde
# dort sonst „vorher: …/aktuell" — eine Fassung, die es nie gab.
if [[ -L "$WURZEL/aktuell" ]]; then VORHER="$(readlink -f "$WURZEL/aktuell")"; else VORHER="— (erstes Aufspielen)"; fi
ln -sfn "$ZIEL" "$WURZEL/aktuell.neu"
mv -Tf "$WURZEL/aktuell.neu" "$WURZEL/aktuell"
gruen "  ✓ umgeschaltet"
grau  "    vorher:  $VORHER"
grau  "    jetzt:   $ZIEL"

# -- 5 · nginx ---------------------------------------------------------------
if [[ $OHNE_NEULADEN -eq 0 ]]; then
  # `nginx -t` liest die Protokollpfade mit und scheitert deshalb als
  # gewöhnlicher Benutzer an /var/log/nginx (root:adm 750) — mit „permission
  # denied", nicht mit einem Konfigurationsfehler. Ohne diese Unterscheidung
  # meldete das Skript einen Fehler, den es nicht gibt, **nachdem** es bereits
  # umgeschaltet hat. Deshalb: als root unmittelbar, sonst über dieselbe
  # sudo-Regel, die auch das Neuladen erlaubt.
  if [[ $EUID -eq 0 ]]; then pruefe_nginx() { nginx -t 2>&1; }
  else pruefe_nginx() { sudo -n nginx -t 2>&1; }; fi
  if pruefe_nginx >/dev/null; then
    nginx_neu_laden
    grau "  ✓ nginx neu geladen"
  else
    rot "  ✗ nginx meldet einen Konfigurationsfehler:"
    pruefe_nginx || true
    rot "    Die Dateien sind umgeschaltet, aber nginx läuft mit der alten"
    rot "    Konfiguration weiter. Fehler beheben, dann: systemctl reload nginx"
    exit 1
  fi
fi

# -- 6 · Aufräumen -----------------------------------------------------------
#  Alte Fassungen bleiben stehen, damit man zurückkann. Fünf reichen: das
#  sind bei wöchentlicher Aktualisierung über einen Monat.
mapfile -t alt < <(ls -1dt "$WURZEL"/fassungen/*/ 2>/dev/null | tail -n +$((BEHALTEN + 1)))
for a in "${alt[@]:-}"; do
  [[ -z "$a" ]] && continue
  # Die laufende Fassung wird niemals gelöscht, auch wenn sie alt ist.
  [[ "$(readlink -f "$a")" == "$(readlink -f "$WURZEL/aktuell")" ]] && continue
  rm -rf "$a"
  grau "  · alte Fassung entfernt: $(basename "$a")"
done

echo
gruen "Fertig. Jetzt die Abnahme fahren:"
echo "    bin/pruefen.sh https://IHRE-ADRESSE"
echo
