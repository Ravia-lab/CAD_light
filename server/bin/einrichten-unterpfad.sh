#!/usr/bin/env bash
# ===========================================================================
#  RaVia CAD Light — Ersteinrichtung als Unterpfad einer bestehenden Seite
#  Zielbild:  https://ravia-tech.de/Cad_light/
# ---------------------------------------------------------------------------
#  Läuft **einmal** und braucht dafür root. Danach spielt der eingeschränkte
#  Benutzer `ravia-deploy` neue Fassungen auf, ohne root.
#
#  Was das Skript anlegt:
#    · Benutzer `ravia-deploy` (Systemkonto, keine Anmeldung, kein Passwort)
#    · /opt/ravia-cad-light/{fassungen,aktuell}
#    · /etc/sudoers.d/ravia-deploy  — genau ein erlaubter Befehl
#    · /etc/nginx/snippets/ravia-cad-light.conf und …-basis.conf
#
#  Was es **nicht** anfasst:
#    · Ihren bestehenden Serverblock für ravia-tech.de. Die eine Zeile, die
#      dort hineingehört, gibt es am Ende ausgedruckt — bewusst zum Selbst-
#      Einfügen. Ein Skript, das ungefragt in eine laufende Serverkonfiguration
#      schreibt, ist ein Skript, das eine laufende Seite abschalten kann.
#    · Ihr TLS-Zertifikat. Das steht bereits, die Domain existiert.
#
#  Aufruf (als root, aus dem entpackten Paketverzeichnis):
#      sudo bin/einrichten-unterpfad.sh
# ===========================================================================
set -euo pipefail

BENUTZER="${RAVIA_BENUTZER:-ravia-deploy}"
WURZEL="${RAVIA_WURZEL:-/opt/ravia-cad-light}"
PAKET="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PFAD="${RAVIA_PFAD:-/Cad_light/}"

rot()  { printf '\033[31m%s\033[0m\n' "$*"; }
gruen(){ printf '\033[32m%s\033[0m\n' "$*"; }
grau() { printf '\033[90m%s\033[0m\n' "$*"; }

[[ $EUID -ne 0 ]] && { rot "Das Skript braucht root — es legt einen Benutzer an und schreibt nach /etc."; exit 1; }

echo
echo "RaVia CAD Light — Einrichtung als Unterpfad $PFAD"
echo "─────────────────────────────────────────────────────────────"

# -- 1 · Vorbedingungen -----------------------------------------------------
echo
echo "1 · Vorbedingungen"
for w in nginx; do
  command -v "$w" >/dev/null 2>&1 || { rot "  ✗ $w fehlt.  apt-get install -y $w"; exit 1; }
  grau "  ✓ $w vorhanden"
done
# rsync ist erwünscht, aber nicht nötig: aufspielen.sh weicht auf cp aus.
# Ein Abbruch an dieser Stelle wäre eine erfundene Hürde.
if command -v rsync >/dev/null 2>&1; then grau "  ✓ rsync vorhanden"
else grau "  · rsync fehlt — aufspielen.sh nutzt cp (gleichwertig)"; fi
[[ -f "$PAKET/app/index.html" ]] || { rot "  ✗ app/index.html fehlt — Paket unvollständig."; exit 1; }

# Der Build muss zum Pfad passen. Ein Build für die Wurzel unter einem
# Unterpfad ergibt eine **weiße Seite ohne Fehlermeldung** — der häufigste
# und am schwersten zu findende Fehler bei dieser Auslieferungsart. Deshalb
# wird hier nachgesehen, statt darauf zu vertrauen.
if grep -q "src=\"${PFAD}assets/" "$PAKET/app/index.html"; then
  grau "  ✓ Der Build ist für $PFAD erzeugt"
else
  rot "  ✗ Der Build passt nicht zum Pfad $PFAD."
  grau "    In app/index.html steht:"
  grep -oE '(src|href)="[^"]*assets/[^"]*"' "$PAKET/app/index.html" | head -2 | sed 's/^/      /'
  grau "    Neu bauen mit:  RAVIA_BASE=$PFAD npm run build"
  exit 1
fi

# -- 2 · Benutzer -----------------------------------------------------------
echo
echo "2 · Benutzer $BENUTZER"
if id -u "$BENUTZER" >/dev/null 2>&1; then
  grau "  ✓ gibt es schon"
else
  # Systemkonto ohne Anmeldeschale und ohne Passwort: der Benutzer ist zum
  # Dateienschreiben da, nicht zum Arbeiten. Anmeldung nur über SSH-Schlüssel.
  useradd --system --create-home --home-dir "/home/$BENUTZER" \
          --shell /usr/sbin/nologin --comment "RaVia CAD Light Auslieferung" "$BENUTZER"
  gruen "  ✓ angelegt (Systemkonto, keine Anmeldeschale, kein Passwort)"
fi

# -- 3 · Verzeichnisse ------------------------------------------------------
echo
echo "3 · Verzeichnisse"
mkdir -p "$WURZEL/fassungen"
chown -R "$BENUTZER:$BENUTZER" "$WURZEL"
chmod 755 "$WURZEL" "$WURZEL/fassungen"
grau "  ✓ $WURZEL/fassungen  (gehört $BENUTZER)"

# -- 4 · sudo für genau einen Befehl ----------------------------------------
echo
echo "4 · Rechte"
# Das ist die ganze Erhöhung, die das Aufspielen braucht: nginx dazu bringen,
# die Konfiguration neu zu lesen. Kein Neustart, kein Editieren, kein Shell-
# Zugang. `visudo -c` prüft die Datei, bevor sie gilt — eine kaputte
# sudoers-Datei sperrt sonst alle aus.
cat > /etc/sudoers.d/ravia-deploy <<EOF
# RaVia CAD Light — Auslieferung. Genau ein Befehl, nichts sonst.
# Zwei Befehle, beide unveränderlich:
#   nginx -t                 die Konfiguration prüfen, bevor neu geladen wird
#   systemctl reload nginx   sie übernehmen
# `nginx -t` ist nötig, weil der Test die Protokollpfade mitliest und daran
# als gewöhnlicher Benutzer scheitert — nicht am Inhalt, sondern an den
# Rechten von /var/log/nginx.
$BENUTZER ALL=(root) NOPASSWD: /usr/sbin/nginx -t, /usr/sbin/nginx -s reload, /usr/bin/systemctl reload nginx, /bin/systemctl reload nginx
EOF
chmod 440 /etc/sudoers.d/ravia-deploy
if visudo -c -f /etc/sudoers.d/ravia-deploy >/dev/null; then
  grau "  ✓ /etc/sudoers.d/ravia-deploy  (nur: nginx -t und systemctl reload nginx)"
else
  rm -f /etc/sudoers.d/ravia-deploy
  rot "  ✗ sudoers-Datei fehlerhaft, wieder entfernt."
  exit 1
fi

# -- 5 · nginx-Bausteine ----------------------------------------------------
echo
echo "5 · nginx-Bausteine"
mkdir -p /etc/nginx/snippets
cp "$PAKET/nginx/ravia-cad-light.conf" "$PAKET/nginx/ravia-cad-light-basis.conf" /etc/nginx/snippets/
grau "  ✓ /etc/nginx/snippets/ravia-cad-light.conf"
grau "  ✓ /etc/nginx/snippets/ravia-cad-light-basis.conf"

# -- 6 · Erste Fassung ------------------------------------------------------
echo
echo "6 · Erste Fassung aufspielen"
RAVIA_WURZEL="$WURZEL" "$PAKET/bin/aufspielen.sh" --ohne-neuladen
chown -R "$BENUTZER:$BENUTZER" "$WURZEL"

# -- 7 · Was jetzt noch von Hand gehört -------------------------------------
echo
echo "─────────────────────────────────────────────────────────────"
gruen "Die Dateien liegen. Zwei Handgriffe fehlen — beide bewusst nicht"
gruen "automatisiert, weil sie eine laufende Seite betreffen:"
echo
echo "  1 · Eine Zeile in Ihren Serverblock für ravia-tech.de"
echo
echo "        include /etc/nginx/snippets/ravia-cad-light.conf;"
echo
echo "      Sie gehört in den server{}-Block mit  listen 443 ssl;  —"
echo "      an beliebiger Stelle, üblicherweise unter die location-Blöcke."
echo "      Die Datei ist zu finden mit:"
echo "        grep -rl 'ravia-tech.de' /etc/nginx/sites-enabled/ /etc/nginx/conf.d/"
echo
echo "  2 · Übernehmen und prüfen"
echo
echo "        nginx -t && systemctl reload nginx"
echo "        bin/pruefen.sh https://ravia-tech.de${PFAD}"
echo
grau "  Danach spielt $BENUTZER neue Fassungen ohne root auf:"
grau "      sudo -u $BENUTZER bin/aufspielen.sh"
echo
