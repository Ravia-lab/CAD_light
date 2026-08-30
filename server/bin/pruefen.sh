#!/usr/bin/env bash
# ===========================================================================
#  RaVia CAD Light — Abnahme des laufenden Servers
# ---------------------------------------------------------------------------
#  Aufspielen ist kein Nachweis. Dieses Skript ruft den Server von außen auf
#  und prüft die Dinge, die sich still verschlucken lassen: ein falscher
#  MIME-Typ, eine fehlende Kopfzeile, eine index.html im Zwischenspeicher.
#  Jede dieser Abweichungen sieht auf dem Bildschirm zunächst nach einer
#  laufenden Anwendung aus.
#
#  Aufruf (von irgendeinem Rechner mit curl, nicht zwingend vom Server):
#      bin/pruefen.sh https://cad.ravia.de
# ===========================================================================
set -uo pipefail

ADRESSE="${1:-}"
[[ -z "$ADRESSE" ]] && { echo "Aufruf:  bin/pruefen.sh https://cad.ravia.de"; exit 1; }
ADRESSE="${ADRESSE%/}"

FEHLER=0
WARNUNG=0

ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
weg()  { printf '  \033[31m✗\033[0m %s\n' "$*"; FEHLER=$((FEHLER+1)); }
hm()   { printf '  \033[33m!\033[0m %s\n' "$*"; WARNUNG=$((WARNUNG+1)); }
grau() { printf '    \033[90m%s\033[0m\n' "$*"; }

kopf() { curl -sS -m 20 -D - -o /dev/null "$1" 2>/dev/null; }
wert() { grep -i "^$2:" <<<"$1" | head -1 | cut -d: -f2- | tr -d '\r' | sed 's/^ *//'; }

echo
echo "Abnahme  $ADRESSE"
echo "═════════════════════════════════════════════════════════════"

# -- 1 · Erreichbarkeit -----------------------------------------------------
echo
echo "1 · Erreichbarkeit"
H="$(kopf "$ADRESSE/")"
CODE="$(head -1 <<<"$H" | awk '{print $2}')"
if [[ "$CODE" == "200" ]]; then ok "Die Startseite antwortet mit 200"
else weg "Die Startseite antwortet mit ${CODE:-keiner Antwort}"; grau "Ohne das ist alles Weitere gegenstandslos."; echo; exit 1; fi

if [[ "$ADRESSE" == https://* ]]; then
  UMLEITUNG="$(curl -sS -m 20 -o /dev/null -w '%{http_code} %{redirect_url}' "${ADRESSE/https:/http:}/" 2>/dev/null)"
  case "$UMLEITUNG" in
    30[18]*https://*) ok "http wird auf https umgeleitet" ;;
    *) hm "http leitet nicht auf https um (Antwort: $UMLEITUNG)" ;;
  esac
else
  hm "Aufruf ohne TLS geprüft — für den Betrieb gehört https davor"
fi

# -- 2 · Die Dateien, ohne die nichts läuft ---------------------------------
echo
echo "2 · Die Anwendungsdateien"
SEITE="$(curl -sS -m 20 "$ADRESSE/" 2>/dev/null)"
SKRIPT="$(grep -o 'src="/assets/[^"]*\.js"' <<<"$SEITE" | head -1 | sed 's/src="//;s/"//')"
STIL="$(grep -o 'href="/assets/[^"]*\.css"' <<<"$SEITE" | head -1 | sed 's/href="//;s/"//')"

if [[ -n "$SKRIPT" ]]; then ok "Die Startseite nennt eine Skriptdatei"; grau "$SKRIPT"
else weg "In der Startseite steht keine Skriptdatei — falsche index.html?"; fi

if [[ -n "$SKRIPT" ]]; then
  HS="$(kopf "$ADRESSE$SKRIPT")"
  TYP="$(wert "$HS" 'content-type')"
  case "$TYP" in
    *javascript*) ok "Das Skript wird als JavaScript ausgeliefert" ;;
    *) weg "Das Skript kommt als „$TYP“ — der Browser führt es nicht aus" ;;
  esac
fi
if [[ -n "$STIL" ]]; then
  HC="$(kopf "$ADRESSE$STIL")"
  case "$(wert "$HC" 'content-type')" in
    *text/css*) ok "Das Stilblatt wird als CSS ausgeliefert" ;;
    *) weg "Das Stilblatt kommt als „$(wert "$HC" 'content-type')“ — die Seite bliebe unformatiert" ;;
  esac
fi

# Der Arbeitsprozess von pdf.js. **Der stille Ausfall Nummer eins.**
#
# Der Dateiname steht nicht im Hauptbündel, sondern im pdf-Teilbündel: der
# 3D-Betrachter und der PDF-Leser werden erst bei Bedarf nachgeladen. Es wird
# deshalb in zwei Stufen gesucht — erst das pdf-Teilbündel im Hauptbündel,
# dann darin der Arbeitsprozess.
HAUPT="$(curl -sS -m 30 "$ADRESSE$SKRIPT" 2>/dev/null)"
WORKER="$(grep -oE 'assets/pdf\.worker[A-Za-z0-9._-]*\.mjs' <<<"$HAUPT" | head -1)"
if [[ -z "$WORKER" ]]; then
  TEIL="$(grep -oE 'assets/pdf-[A-Za-z0-9_-]*\.js' <<<"$HAUPT" | head -1)"
  if [[ -n "$TEIL" ]]; then
    WORKER="$(curl -sS -m 30 "$ADRESSE/$TEIL" 2>/dev/null | grep -oE 'assets/pdf\.worker[A-Za-z0-9._-]*\.mjs' | head -1)"
  fi
fi
if [[ -n "$WORKER" ]]; then
  HW="$(kopf "$ADRESSE/$WORKER")"
  CW="$(head -1 <<<"$HW" | awk '{print $2}')"
  TW="$(wert "$HW" 'content-type')"
  if [[ "$CW" != "200" ]]; then
    weg "Der PDF-Arbeitsprozess ist nicht erreichbar ($CW)"
  elif [[ "$TW" == *javascript* ]]; then
    ok "Der PDF-Arbeitsprozess (.mjs) hat den richtigen MIME-Typ"
  else
    weg "Der PDF-Arbeitsprozess kommt als „$TW“ statt als JavaScript"
    grau "Folge: die Anwendung startet, aber ein hochgeladenes PDF bleibt"
    grau "ohne Wirkung. Abhilfe: der types-Block in ravia-cad.conf."
  fi
else
  weg "Der PDF-Arbeitsprozess ließ sich nicht finden"
  grau "Weder im Hauptbündel noch im pdf-Teilbündel steht ein Dateiname"
  grau "„assets/pdf.worker….mjs“. Entweder ist die Anwendung unvollständig"
  grau "aufgespielt, oder die ausgelieferte Fassung ist eine andere als die"
  grau "erwartete. Von Hand nachsehen: Entwicklerwerkzeuge → Netzwerk →"
  grau "ein PDF als Vorlage laden."
fi

# -- 3 · Zwischenspeicher ---------------------------------------------------
echo
echo "3 · Zwischenspeicher"
CC_INDEX="$(wert "$H" 'cache-control')"
case "$CC_INDEX" in
  *no-cache*|*no-store*|*max-age=0*) ok "Die Startseite wird nicht zwischengespeichert" ;;
  '') weg "Die Startseite hat keine Cache-Control-Angabe" ; grau "Folge: Anwender sehen nach einer Aktualisierung tagelang die alte Fassung." ;;
  *) weg "Die Startseite trägt „$CC_INDEX“ — sie darf nicht zwischengespeichert werden" ;;
esac
if [[ -n "$SKRIPT" ]]; then
  CC_ASSET="$(wert "$(kopf "$ADRESSE$SKRIPT")" 'cache-control')"
  case "$CC_ASSET" in
    *immutable*|*max-age=31536000*) ok "Die Dateien in /assets/ werden lange zwischengespeichert" ;;
    *) hm "Die Dateien in /assets/ tragen „${CC_ASSET:-nichts}“ — sie dürften ein Jahr" ;;
  esac
fi

# -- 4 · Kompression --------------------------------------------------------
echo
echo "4 · Kompression"
if [[ -n "$SKRIPT" ]]; then
  ROH="$(curl -sS -m 30 -o /dev/null -w '%{size_download}' "$ADRESSE$SKRIPT" 2>/dev/null)"
  GEP="$(curl -sS -m 30 -H 'Accept-Encoding: gzip' -o /dev/null -w '%{size_download}' "$ADRESSE$SKRIPT" 2>/dev/null)"
  if [[ -n "$ROH" && -n "$GEP" && "$GEP" -gt 0 && "$GEP" -lt $((ROH * 9 / 10)) ]]; then
    ok "Kompression ist aktiv ($((ROH/1024)) kB → $((GEP/1024)) kB)"
  else
    hm "Kompression scheint nicht zu greifen ($((ROH/1024)) kB → $((GEP/1024)) kB)"
    grau "Ohne sie gehen rund 4 MB statt 1 MB über die Leitung."
  fi
fi

# -- 5 · Sicherheitskopfzeilen ----------------------------------------------
echo
echo "5 · Sicherheitskopfzeilen"
CSP="$(wert "$H" 'content-security-policy')"
if [[ -z "$CSP" ]]; then
  weg "Keine Content-Security-Policy"
else
  ok "Content-Security-Policy vorhanden"
  [[ "$CSP" == *"script-src 'self'"* ]] && ok "  script-src ist auf 'self' begrenzt" || hm "  script-src prüfen: $CSP"
  [[ "$CSP" == *"'unsafe-eval'"* ]] && weg "  'unsafe-eval' ist gesetzt — das gehört hier nicht hin"
  if [[ "$CSP" == *"script-src 'self' 'unsafe-inline'"* ]]; then
    weg "  script-src erlaubt 'unsafe-inline' — seit 1.14.0 nicht mehr nötig"
  fi
  if [[ "$CSP" == *frame-ancestors* ]]; then
    ANC="$(sed 's/.*frame-ancestors //;s/;.*//' <<<"$CSP")"
    ok "  frame-ancestors: $ANC"
    [[ "$ANC" == *"*"* ]] && weg "  frame-ancestors erlaubt jede Seite — Clickjacking möglich"
    # Der ausgelieferte Platzhalter heißt `app.ravia.de`. Nach ihm wird
    # wörtlich gesucht — eine Prüfung auf „ravia" ginge daran vorbei, weil
    # die echte Adresse das Wort natürlich auch enthält.
    if [[ "$ANC" == *"app.ravia.de"* ]]; then
      weg "  Der ausgelieferte Platzhalter app.ravia.de steht noch drin"
      grau "Ist das wirklich Ihre RaVia-Adresse? Wenn nicht, kann RaVia die"
      grau "Anwendung nicht einbetten — der Rahmen bliebe leer."
      grau "Zu ändern in: /etc/nginx/snippets/ravia-cad-kopfzeilen.conf"
    fi
    [[ "$ANC" == *"example"* ]] && weg "  Eine Beispieladresse steht noch drin"
    [[ "$ANC" == "'self'" ]] && hm "  Nur 'self' — RaVia darf die Anwendung nicht einbetten"
  else
    weg "  frame-ancestors fehlt — jede fremde Seite dürfte die Anwendung rahmen"
  fi
fi
[[ -n "$(wert "$H" 'x-content-type-options')" ]] && ok "X-Content-Type-Options" || hm "X-Content-Type-Options fehlt"
[[ -n "$(wert "$H" 'referrer-policy')" ]] && ok "Referrer-Policy" || hm "Referrer-Policy fehlt"
[[ -n "$(wert "$H" 'permissions-policy')" ]] && ok "Permissions-Policy" || hm "Permissions-Policy fehlt"
if [[ -n "$(wert "$H" 'strict-transport-security')" ]]; then
  ok "Strict-Transport-Security ist gesetzt"
else
  grau "Strict-Transport-Security ist nicht gesetzt — das ist Absicht, solange"
  grau "die Zertifikatserneuerung nicht nachweislich läuft (siehe Kopfzeilendatei)."
fi
SRV="$(wert "$H" 'server')"
[[ "$SRV" == *[0-9]* ]] && hm "Die nginx-Fassung steht im Antwortkopf ($SRV) — server_tokens off;" || ok "Keine Fassungsnummer im Antwortkopf"

# -- 6 · Kein Aufruf nach außen ---------------------------------------------
echo
echo "6 · Fremde Adressen"
# Gesucht wird nach **ladenden** Verweisen, nicht nach jeder Zeichenfolge,
# die wie eine Adresse aussieht. Der Unterschied ist nicht spitzfindig: in
# jedem SVG steht `xmlns="http://www.w3.org/2000/svg"`, und das ist eine
# **Namensraumkennung**, die kein Browser je abruft. Wer sie mitzählt, meldet
# einen Fehler, den es nicht gibt — und wer solche Meldungen zweimal bekommt,
# sieht beim dritten Mal nicht mehr hin.
EIGEN="$(sed 's|https\?://||' <<<"$ADRESSE")"
FREMD="$(grep -oE '(src|href)="https?://[^"]+"' <<<"$SEITE" \
  | sed 's/.*="//;s/"$//' \
  | grep -oE 'https?://[a-zA-Z0-9.-]+' \
  | grep -v "^https\?://$EIGEN" \
  | sort -u)"
if [[ -z "$FREMD" ]]; then
  ok "Die Startseite ruft keine fremde Adresse auf"
else
  weg "Die Startseite verweist nach außen:"
  while read -r f; do grau "$f"; done <<<"$FREMD"
  grau "Seit 1.14.0 sollte hier nichts stehen — die Schriften liegen im Paket."
fi

# -- 7 · Die Beispielseite zur Einbettung -----------------------------------
echo
echo "7 · Einbettung"
CB="$(curl -sS -m 20 -o /dev/null -w '%{http_code}' "$ADRESSE/einbettung-beispiel.html" 2>/dev/null)"
[[ "$CB" == "200" ]] && ok "Die Beispielseite zur Einbettung ist erreichbar" || hm "Beispielseite: $CB"

echo
echo "═════════════════════════════════════════════════════════════"
if [[ $FEHLER -eq 0 && $WARNUNG -eq 0 ]]; then
  printf '\033[32m✓ ABNAHME BESTANDEN\033[0m — alles wie vorgesehen.\n\n'
  echo "Was das Skript nicht prüfen kann, weil es keinen Browser hat:"
  echo "  · ob die 3D-Ansicht aufgeht (WebGL)"
  echo "  · ob ein hochgeladener Grundriss durchläuft"
  echo "  · ob der Druckdialog aufgeht"
  echo "Die drei Handgriffe stehen im Handbuch, Abschnitt „Abnahme am Bildschirm“."
  echo
  exit 0
elif [[ $FEHLER -eq 0 ]]; then
  printf '\033[33m! %d Hinweis(e)\033[0m — betriebsfähig, aber sehen Sie es sich an.\n\n' "$WARNUNG"
  exit 0
else
  printf '\033[31m✗ %d Fehler, %d Hinweis(e)\033[0m — noch nicht abgenommen.\n\n' "$FEHLER" "$WARNUNG"
  exit 1
fi
