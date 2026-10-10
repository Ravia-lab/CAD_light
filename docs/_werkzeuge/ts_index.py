import os, re, collections, json
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')); OUT = ROOT + '/docs/codebase'
HEAD = 'Stand: 09.10.2026 · Quelle: CAD_light@55f5460 (Version 1.77.0) · automatisch aus den Quelltexten erzeugt (Regex über `export`/`import`), danach geprüft'
files = {}
for base in ('src', 'scripts', 'server'):
    for dp, dns, fns in os.walk(os.path.join(ROOT, base)):
        dns[:] = [d for d in dns if d not in ('node_modules', 'assets')]
        for f in fns:
            if re.search(r'\.(ts|tsx|mjs|js)$', f):
                p = os.path.join(dp, f); rel = os.path.relpath(p, ROOT)
                files[rel] = open(p, encoding='utf-8', errors='replace').read()
def resolve(src_rel, spec):
    if not spec.startswith('.'): return None
    base = os.path.normpath(os.path.join(os.path.dirname(src_rel), spec))
    for ext in ('', '.ts', '.tsx', '.js', '.mjs', '/index.ts', '/index.tsx'):
        if base + ext in files: return base + ext
    return None
imports = collections.defaultdict(set); importer_names = collections.defaultdict(set)
for rel, t in files.items():
    for m in re.finditer(r'import\s+(?:type\s+)?([\s\S]*?)\s+from\s+[\'"]([^\'"]+)[\'"]', t):
        tgt = resolve(rel, m.group(2))
        if tgt:
            imports[tgt].add(rel)
            for n in re.findall(r'([^\W\d]\w*)', m.group(1).replace(' as ', ' ')):
                importer_names[(tgt, n)].add(rel)
    for m in re.finditer(r'import\(\s*[\'"]([^\'"]+)[\'"]\s*\)', t):
        tgt = resolve(rel, m.group(1))
        if tgt: imports[tgt].add(rel)
def doc_of(t):
    m = re.match(r'\s*/\*\*([\s\S]*?)\*/', t)
    if m:
        lines = [re.sub(r'^\s*\*\s?', '', x).strip() for x in m.group(1).split('\n')]
        lines = [x for x in lines if x and not set(x) <= set('-=*')]
        return ' '.join(lines[:2])[:220]
    m = re.match(r'\s*((?://[^\n]*\n)+)', t)
    if m:
        return ' '.join(x.strip('/ ').strip() for x in m.group(1).split('\n') if x.strip('/ ').strip())[:220]
    return ''
os.makedirs(OUT, exist_ok=True)
def lk(rel, line=None): return f'[`{rel}{":"+str(line) if line else ""}`](../../{rel}{"#L"+str(line) if line else ""})'
def esc(s): return (s or '').replace('|', '\\|')
# directory tree
dirs = collections.defaultdict(lambda: [0, 0])
for rel, t in files.items():
    dirs[os.path.dirname(rel)][0] += 1; dirs[os.path.dirname(rel)][1] += t.count('\n') + 1
P = {'src': 'Einstieg (`main.tsx`, `App.tsx`), Einzeldatei-Start', 'src/lib': 'Rechen- und Fachkern: Geometrie, Raumerkennung, Heizlast-Überschlag, Hydraulik, Rohrnetz, Exporte, Importe, Embed-API', 'src/components': 'React-Oberfläche: 2D-Editor, 3D-Ansicht, Panels, Dialoge', 'src/store': 'Zustand-Store (Dokument, Historie, UI)', 'src/types': 'Datenmodell `bim.ts` (BimDocument)', 'src/services': 'Dienste (u. a. `aiVisionService.ts`)', 'src/lib/sprachen': 'Sprachdateien', 'scripts': 'Prüf-, Rauch- und Freigabeskripte (Node)', 'scripts/pruefungen': 'Prüfläufe des Rechenkerns (`npm run verify`)', 'scripts/referenz': 'Referenzdaten für Prüfläufe', 'scripts/werkstatt': 'Werkbank-Hilfen', 'scripts/vertrag': 'Prüfungen gegen den gemeinsamen Vertrag `ravia-vertrag/`', 'scripts/fixtures': 'Testdaten', 'server': 'Auslieferungspaket für den Webserver', 'server/app': 'statische App-Dateien (Einbettungsbeispiel, Handbuch)', 'server/bin': 'Einrichtungs- und Aufspielskripte', 'server/einbettung': 'Einbettungsbeispiel/Doku für Wirte', 'server/nginx': 'nginx-Konfiguration'}
L = ['# Verzeichnisbaum CAD Light', '', HEAD, '', '| Verzeichnis | Code-Dateien | Zeilen | Zweck |', '|---|---:|---:|---|']
for d_ in sorted(dirs):
    L.append(f'| `{d_}/` | {dirs[d_][0]} | ' + f'{dirs[d_][1]:,}'.replace(',', '.') + f' | {P.get(d_, "")} |')
L += ['', 'Weitere Verzeichnisse: `handbuch/` (Bedienungsanleitung als HTML), `public/` (statische Dateien, Beispiele), `ravia-vertrag/schema/` (JSON-Schemas `ravia.building-1.12.0`, `ravia.bim.light-2.16.0` – der gemeinsame Vertrag mit Scan und RaVia).', '', 'Weiter: [Modulindex](module-index.md) · [Typindex](type-index.md)']
open(OUT + '/directory-tree.md', 'w').write('\n'.join(L) + '\n')
# module index
L = ['# Modulindex CAD Light', '', HEAD, '', 'Je Modul: Verantwortung (Kopfkommentar), exportierte Symbole, Abhängigkeiten (relative Importe) und Aufrufer (Module, die es importieren). Prüf- und Rauchskripte unter `scripts/` zählen als Aufrufer, sind aber getrennt ausgewiesen.', '']
exp_all = {}
for rel in sorted(f for f in files if f.startswith('src/')):
    t = files[rel]
    exps = []
    for m in re.finditer(r'^export\s+(?:default\s+)?(?:async\s+)?(function|class|interface|type|const|let|enum)\s+([^\W\d]\w*)', t, re.M):
        exps.append((m.group(1), m.group(2), t[:m.start()].count('\n') + 1))
    exp_all[rel] = exps
    deps = sorted({resolve(rel, s) for s in re.findall(r'from\s+[\'"](\.[^\'"]+)[\'"]', t)} - {None})
    callers = sorted(imports.get(rel, set()))
    cs = [c for c in callers if c.startswith('src/')]; cx = [c for c in callers if not c.startswith('src/')]
    L.append(f'### {lk(rel)} · {t.count(chr(10))+1} Zeilen')
    L.append('')
    L.append(f'**Verantwortung:** {esc(doc_of(t)) or "_kein Kopfkommentar_"}  ')
    L.append(f'**Abhängigkeiten:** ' + (', '.join(f"`{x.replace("src/","")}`" for x in deps) or '–') + '  ')
    L.append(f'**Aufrufer:** ' + (', '.join(f"`{x.replace("src/","")}`" for x in cs) or '–') + f'  \n**Aufrufer in scripts/:** {len(cx)}')
    funcs = [e for e in exps if e[0] in ('function', 'const', 'let', 'class')]
    if funcs:
        L.append('')
        L.append('Exportierte Funktionen/Konstanten: ' + ', '.join(f"[`{n}`](../../{rel}#L{ln})" + ('' if importer_names.get((rel, n)) else '⁰') for k, n, ln in funcs[:80]) + (f' … (+{len(funcs)-80})' if len(funcs) > 80 else ''))
    L.append('')
L.append('⁰ = kein Modul importiert dieses Symbol namentlich (Kandidat für toten Code; Verwendung im selben Modul ist möglich). Details: Review-Dokumente im RaVia-Repository `ravia_heizlast/docs/review/`.')
open(OUT + '/module-index.md', 'w').write('\n'.join(L) + '\n')
# type index
L = ['# Typindex CAD Light (Interfaces, Typen, Klassen, Enums)', '', HEAD, '', '| Typ | Art | Ort | Importiert von |', '|---|---|---|---|']
n = 0
for rel in sorted(exp_all):
    for k, nm, ln in exp_all[rel]:
        if k in ('interface', 'type', 'class', 'enum'):
            us = sorted(importer_names.get((rel, nm), set())); n += 1
            L.append(f'| `{nm}` | {k} | {lk(rel, ln)} | ' + (', '.join(f"`{u.replace("src/","")}`" for u in us[:5]) + (f' (+{len(us)-5})' if len(us) > 5 else '') if us else '–') + ' |')
L.insert(3, f'**{n} exportierte Typen.** Das fachliche Datenmodell steht fast vollständig in `src/types/bim.ts`; Beschreibung der Modelle: `ravia_heizlast/docs/models/`.\n')
open(OUT + '/type-index.md', 'w').write('\n'.join(L) + '\n')
print(len(files), n)
