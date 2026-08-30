#!/usr/bin/env bash
# ===========================================================================
#  RaVia CAD Light — Ersteinrichtung auf einem Linux-Server mit nginx
# ---------------------------------------------------------------------------
#  Legt die Verzeichnisse an, kopiert die Konfiguration, spielt die erste
#  Fassung auf und sagt am Ende, was noch von Hand zu tun ist.
#
#  Aufruf (als root, aus dem entpackten Paketverzeichnis):
#      sudo bin/einrichten.sh cad.ravia.de
#
#  Das Skript ist **wiederholbar**: ein zweiter Lauf ändert nichts, was schon
#  richtig ist. Es fasst kein Zertifikat an — das macht certbot, und zwar
#  erst, wenn die Adresse tatsächlich auf diesen Server zeigt.
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
    systemctl reload nginx
  else
    nginx -s reload 2>/dev/null || nginx
  fi
}

ADRESSE="${1:-}"
WURZEL="/var/www/ravia-cad"
PAKET="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

rot()  { printf '\033[31m%s\033[0m\n' "$*"; }
gruen(){ printf '\033[32m%s\033[0m\n' "$*"; }
grau() { printf '\033[90m%s\033[0m\n' "$*"; }

if [[ -z "$ADRESSE" ]]; then
  rot "Es fehlt die Adresse."
  echo "Aufruf:  sudo bin/einrichten.sh cad.ravia.de"
  exit 1
fi
if [[ $EUID -ne 0 ]]; then
  rot "Das Skript braucht root — es schreibt nach /etc/nginx und /var/www."
  echo "Aufruf:  sudo bin/einrichten.sh $ADRESSE"
  exit 1
fi

echo
echo "RaVia CAD Light — Ersteinrichtung für $ADRESSE"
echo "─────────────────────────────────────────────────────────────"

# -- 1 · Vorbedingungen -----------------------------------------------------
echo
echo "1 · Vorbedingungen"
for werkzeug in nginx rsync curl; do
  if ! command -v "$werkzeug" >/dev/null 2>&1; then
    rot "  ✗ $werkzeug fehlt."
    echo "    Nachinstallieren:  apt-get install -y nginx rsync curl"
    exit 1
  fi
  grau "  ✓ $werkzeug vorhanden"
done

if [[ ! -d "$PAKET/app" ]] || [[ ! -f "$PAKET/app/index.html" ]]; then
  rot "  ✗ Im Paket fehlt das Verzeichnis app/ mit der index.html."
  echo "    Wurde das Archiv vollständig entpackt?"
  exit 1
fi
grau "  ✓ Anwendungsdateien im Paket gefunden"

# -- 2 · Verzeichnisse ------------------------------------------------------
echo
echo "2 · Verzeichnisse"
# Getrennte Fassungsverzeichnisse und eine Verknüpfung darauf. Damit lässt
# sich in einem Zug umschalten und in einem Zug zurücknehmen — und es gibt
# keinen Augenblick, in dem der Server halb alte und halb neue Dateien
# ausliefert.
mkdir -p "$WURZEL/fassungen" /var/www/certbot
grau "  ✓ $WURZEL/fassungen"
grau "  ✓ /var/www/certbot  (für die Zertifikatsprüfung von Let's Encrypt)"

# -- 3 · Konfiguration ------------------------------------------------------
echo
echo "3 · nginx-Konfiguration"
mkdir -p /etc/nginx/snippets

sed "s/cad\.ravia\.de/$ADRESSE/g" "$PAKET/nginx/ravia-cad.conf" \
  > /etc/nginx/sites-available/ravia-cad.conf
grau "  ✓ /etc/nginx/sites-available/ravia-cad.conf  (Adresse eingesetzt)"

# HTTP/2 in der Schreibweise, die diese nginx-Fassung versteht.
#
# `http2 on;` als eigene Anweisung gibt es erst ab 1.25.1. Auf älteren
# Fassungen bricht `nginx -t` mit „unknown directive" ab — und ein Server,
# der nach dem Aufspielen nicht mehr hochkommt, ist der schlechteste
# Fehlerfall, den ein Einrichtungsskript hinterlassen kann. Deshalb wird die
# Fassung gelesen und die passende Form gesetzt, statt sie vom Anwender zu
# verlangen.
NGINX_FASSUNG="$(nginx -v 2>&1 | sed 's|.*/||')"
NGINX_HAUPT="$(cut -d. -f1 <<<"$NGINX_FASSUNG")"
NGINX_NEBEN="$(cut -d. -f2 <<<"$NGINX_FASSUNG")"
NGINX_KLEIN="$(cut -d. -f3 <<<"$NGINX_FASSUNG" | tr -cd '0-9')"
KANN_HTTP2_ANWEISUNG=0
if [[ "$NGINX_HAUPT" -gt 1 ]] \
  || { [[ "$NGINX_HAUPT" -eq 1 ]] && [[ "$NGINX_NEBEN" -gt 25 ]]; } \
  || { [[ "$NGINX_HAUPT" -eq 1 ]] && [[ "$NGINX_NEBEN" -eq 25 ]] && [[ "${NGINX_KLEIN:-0}" -ge 1 ]]; }; then
  KANN_HTTP2_ANWEISUNG=1
fi
if [[ $KANN_HTTP2_ANWEISUNG -eq 1 ]]; then
  grau "  ✓ HTTP/2 als eigene Anweisung (nginx $NGINX_FASSUNG)"
else
  sed -i \
    -e 's|^\(\s*\)listen 443 ssl;|\1listen 443 ssl http2;|' \
    -e 's|^\(\s*\)listen \[::\]:443 ssl;|\1listen [::]:443 ssl http2;|' \
    -e 's|^\s*http2 on;|    # http2 steht bei dieser nginx-Fassung an der listen-Zeile|' \
    /etc/nginx/sites-available/ravia-cad.conf
  grau "  ✓ HTTP/2 an der listen-Zeile (nginx $NGINX_FASSUNG kennt die Anweisung noch nicht)"
fi

cp "$PAKET/nginx/ravia-cad-kopfzeilen.conf" /etc/nginx/snippets/
grau "  ✓ /etc/nginx/snippets/ravia-cad-kopfzeilen.conf"

ln -sfn ../sites-available/ravia-cad.conf /etc/nginx/sites-enabled/ravia-cad.conf
grau "  ✓ verknüpft nach sites-enabled"

# Die nginx-Fassung im Antwortkopf sagt einem Angreifer, welche Lücken er
# zuerst probieren kann. Die Einstellung gehört in den http-Abschnitt der
# nginx.conf und nicht in unseren Serverblock — deshalb hier, einmal, und
# nur wenn sie noch nicht steht.
if ! grep -qE '^\s*server_tokens\s+off;' /etc/nginx/nginx.conf; then
  if grep -qE '^\s*#?\s*server_tokens' /etc/nginx/nginx.conf; then
    sed -i 's/^\s*#\?\s*server_tokens.*/\tserver_tokens off;/' /etc/nginx/nginx.conf
  else
    sed -i '0,/^http {/s//http {\n\tserver_tokens off;/' /etc/nginx/nginx.conf
  fi
  grau "  ✓ server_tokens off  (Fassungsnummer nicht mehr im Antwortkopf)"
else
  grau "  ✓ server_tokens off  (stand schon)"
fi

# -- 4 · Erste Fassung aufspielen -------------------------------------------
echo
echo "4 · Erste Fassung aufspielen"
"$PAKET/bin/aufspielen.sh" --ohne-neuladen
gruen "  ✓ aufgespielt"

# -- 5 · nginx prüfen und starten -------------------------------------------
echo
echo "5 · nginx"
# Vor dem ersten Zertifikat kennt nginx die Pfade unter /etc/letsencrypt noch
# nicht und würde beim Prüfen scheitern. Deshalb hier nur melden, nicht
# abbrechen — Schritt 6 löst es auf.
if nginx -t 2>/dev/null; then
  nginx_neu_laden
  gruen "  ✓ Konfiguration in Ordnung, nginx neu geladen"
  ZERTIFIKAT_FEHLT=0
else
  grau "  · nginx meldet noch einen Fehler — das ist beim ersten Lauf normal:"
  grau "    das TLS-Zertifikat gibt es noch nicht. Weiter mit Schritt 6."
  ZERTIFIKAT_FEHLT=1
fi

# -- 6 · Was jetzt noch zu tun ist ------------------------------------------
echo
echo "─────────────────────────────────────────────────────────────"
gruen "Die Dateien liegen. Es fehlen noch zwei Dinge, die von Hand gehören:"
echo
if [[ $ZERTIFIKAT_FEHLT -eq 1 ]]; then
echo "  1 · TLS-Zertifikat holen"
echo "      Voraussetzung: $ADRESSE zeigt im DNS auf diesen Server."
echo "      Prüfen:   dig +short $ADRESSE"
echo
echo "      apt-get install -y certbot python3-certbot-nginx"
echo "      certbot --nginx -d $ADRESSE"
echo
echo "      certbot trägt die Zertifikatspfade selbst ein und lädt nginx neu."
echo "      Die Erneuerung läuft danach als Systemdienst; nachsehen mit:"
echo "      systemctl list-timers | grep certbot"
echo
fi
echo "  2 · Die Adresse von RaVia eintragen"
echo "      Nur wenn RaVia die Anwendung einbetten soll. Genau eine Stelle:"
echo
echo "      /etc/nginx/snippets/ravia-cad-kopfzeilen.conf"
echo "      → in der Zeile Content-Security-Policy bei  frame-ancestors"
echo "      → dort  https://app.ravia.de  durch Ihre RaVia-Adresse ersetzen"
echo
echo "      Danach:   nginx -t && systemctl reload nginx"
echo
echo "  Zum Schluss die Abnahme fahren:"
echo "      bin/pruefen.sh https://$ADRESSE"
echo
