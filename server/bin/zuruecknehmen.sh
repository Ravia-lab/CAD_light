#!/usr/bin/env bash
# ===========================================================================
#  RaVia CAD Light — auf die vorige Fassung zurückschalten
# ---------------------------------------------------------------------------
#  Es wird nichts gelöscht und nichts kopiert: die Verknüpfung `aktuell`
#  zeigt danach wieder auf die vorige Fassung. Das dauert einen Wimpernschlag
#  und lässt sich ebenso zurücknehmen.
#
#  Aufruf:
#      sudo bin/zuruecknehmen.sh            auf die vorige Fassung
#      sudo bin/zuruecknehmen.sh --liste    zeigt, was zur Wahl steht
#      sudo bin/zuruecknehmen.sh 20260830-041500-1.14.0
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
WURZEL="/var/www/ravia-cad"
rot()  { printf '\033[31m%s\033[0m\n' "$*"; }
gruen(){ printf '\033[32m%s\033[0m\n' "$*"; }
grau() { printf '\033[90m%s\033[0m\n' "$*"; }

[[ $EUID -ne 0 ]] && { rot "Das Skript braucht root."; exit 1; }
JETZT="$(readlink -f "$WURZEL/aktuell" 2>/dev/null || echo '')"

mapfile -t fassungen < <(ls -1dt "$WURZEL"/fassungen/*/ 2>/dev/null)
if [[ ${#fassungen[@]} -eq 0 ]]; then
  rot "Es liegt keine Fassung unter $WURZEL/fassungen — nichts zurückzunehmen."
  exit 1
fi

if [[ "${1:-}" == "--liste" ]]; then
  echo "Vorhandene Fassungen, neueste zuerst:"
  for f in "${fassungen[@]}"; do
    marke="  "
    [[ "$(readlink -f "$f")" == "$JETZT" ]] && marke="→ "
    printf '%s%s   %s\n' "$marke" "$(basename "$f")" "$(du -sh "$f" | cut -f1)"
  done
  echo
  echo "→ ist die laufende Fassung."
  exit 0
fi

if [[ -n "${1:-}" ]]; then
  ZIEL="$WURZEL/fassungen/$1"
  [[ -d "$ZIEL" ]] || { rot "Es gibt keine Fassung „$1“."; echo "Übersicht:  bin/zuruecknehmen.sh --liste"; exit 1; }
else
  # Die erste Fassung in der Liste, die nicht die laufende ist.
  ZIEL=""
  for f in "${fassungen[@]}"; do
    [[ "$(readlink -f "$f")" == "$JETZT" ]] && continue
    ZIEL="${f%/}"
    break
  done
  [[ -z "$ZIEL" ]] && { rot "Es gibt nur die laufende Fassung — nichts zurückzunehmen."; exit 1; }
fi

[[ -f "$ZIEL/index.html" ]] || { rot "In $ZIEL fehlt die index.html. Nicht umgeschaltet."; exit 1; }

ln -sfn "$ZIEL" "$WURZEL/aktuell.neu"
mv -Tf "$WURZEL/aktuell.neu" "$WURZEL/aktuell"
nginx -t >/dev/null 2>&1 && nginx_neu_laden

gruen "Zurückgenommen."
grau  "  vorher:  $JETZT"
grau  "  jetzt:   $ZIEL"
echo
echo "Abnahme fahren:  bin/pruefen.sh https://IHRE-ADRESSE"
