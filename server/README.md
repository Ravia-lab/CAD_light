# Serverbetrieb

Hier liegen die Dateien, mit denen RaVia CAD Light auf einem Linux-Server mit
nginx ausgeliefert wird. Das **fertige Paket** entsteht daraus mit
`python3 /home/claude/build_server.py`; es enthält zusätzlich den Build aus
`dist/` und das Anwenderhandbuch.

| Datei | Rolle |
|---|---|
| `nginx/ravia-cad.conf` | Der Serverblock. Drei Stellen anzupassen, alle markiert. |
| `nginx/ravia-cad-kopfzeilen.conf` | Die Sicherheitskopfzeilen. **Hier** steht die RaVia-Adresse für `frame-ancestors` — und nur hier. |
| `bin/einrichten.sh` | Ersteinrichtung. Wiederholbar; setzt auch die zur nginx-Fassung passende HTTP/2-Schreibweise. |
| `bin/aufspielen.sh` | Neue Fassung: danebenlegen, prüfen, umschalten. |
| `bin/zuruecknehmen.sh` | Auf die vorige Fassung zurück. |
| `bin/pruefen.sh` | Abnahme des laufenden Servers von außen. |

## Was am Programm dafür geändert wurde

Zwei Dinge, die ohne Server nie aufgefallen wären und mit Server sofort:

1. **Die Schriften liegen im Paket** (`@fontsource`), statt von Google geladen
   zu werden. Das entfernt den einzigen Aufruf nach außen, macht die
   Anwendung ohne Netz vollständig und löst die Datenschutzfrage, die das
   LG München I am 20.01.2022 entschieden hat.
2. **Kein eingebettetes Skript mehr in den Druckfenstern** (`druckFenster.ts`).
   Ein Druckfenster erbt die Inhaltsrichtlinie des Öffners; mit
   `script-src 'self'` wäre der Druckdialog stillschweigend nicht aufgegangen.
   Derselbe Grund gilt für die Beispielseite zur Einbettung, deren Skript
   jetzt als eigene Datei danebenliegt.

Beides ist auf einem echten nginx nachgewiesen: alle 17 Rauchtests laufen
gegen diese Konfiguration durch.
