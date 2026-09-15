/**
 * Auslieferungspaket bauen — alles, was aus einer Fassung herausgeht.
 *
 * **Warum als Skript und nicht von Hand.** Ein Paket besteht aus vier Teilen,
 * die zueinander passen müssen: die Serverfassung, die Einzeldatei, der
 * Quellcode und das Setup für Windows. Bisher wurden sie von Hand
 * zusammengelegt — und von Hand heißt: irgendwann liegt eine Fassungsnummer
 * an einer Stelle falsch, die Prüfsummen stammen aus dem vorigen Lauf, oder
 * der Serverstand enthält einen Build für den falschen Grundpfad. Der letzte
 * Fall hat die Anwendung schon einmal weiß aufgehen lassen.
 *
 * Aufruf:
 *     RAVIA_BASE=/Cad_light/ npm run paket
 *
 * Der Grundpfad muss angegeben werden — genau derselbe, unter dem der Server
 * ausliefert. Er wird ins Paket geschrieben, und `aufspielen.sh` vergleicht
 * ihn beim Aufspielen mit dem laufenden Stand.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = JSON.parse(readFileSync(join(WURZEL, 'package.json'), 'utf8')).version;
const BASIS = process.env.RAVIA_BASE ?? '/';
const ZIEL = process.env.RAVIA_PAKET ?? '/home/claude/auslieferung';

const lauf = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: WURZEL, stdio: 'inherit', env: { ...process.env }, ...opts });

console.log(`\n▸ Paket ${VERSION} · Grundpfad ${BASIS}\n`);
mkdirSync(ZIEL, { recursive: true });

// --- 1 · Der Build für den Server ------------------------------------------
console.log('· Build (Server)');
lauf('npm', ['run', 'build'], { env: { ...process.env, RAVIA_BASE: BASIS } });

// Der frische Build ersetzt den Stand unter server/app — aber nur die
// Anwendung. Handbuch und Einbettungsbeispiel liegen dort ebenfalls und
// werden nicht vom Build erzeugt; sie bleiben stehen.
const appDir = join(WURZEL, 'server', 'app');
rmSync(join(appDir, 'assets'), { recursive: true, force: true });
cpSync(join(WURZEL, 'dist'), appDir, { recursive: true });
writeFileSync(join(WURZEL, 'server', 'VERSION'), `${VERSION}\n`);

// --- 2 · Prüfsummen ---------------------------------------------------------
// Sie sind kein Beiwerk: `aufspielen.sh` prüft sie, bevor es umhängt.
console.log('· Prüfsummen');
const serverDir = join(WURZEL, 'server');
const dateien = [];
const sammle = (d) => {
  for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = join(d, e.name);
    if (e.isDirectory()) sammle(p);
    else if (e.name !== 'pruefsummen.sha256') dateien.push(p);
  }
};
sammle(serverDir);
const zeilen = dateien.map((p) => {
  const h = createHash('sha256').update(readFileSync(p)).digest('hex');
  return `${h}  ./${relative(serverDir, p).split('\\').join('/')}`;
});
writeFileSync(join(serverDir, 'pruefsummen.sha256'), zeilen.join('\n') + '\n');

// --- 3 · Serverpaket --------------------------------------------------------
console.log('· Serverpaket (tar.gz)');
const tarName = `RaVia-CAD-Light-Server-${VERSION}.tar.gz`;
lauf('bash', ['-c',
  `rm -rf /tmp/paket && mkdir -p /tmp/paket/ravia-cad-light-server && ` +
  `cp -r "${serverDir}/." /tmp/paket/ravia-cad-light-server/ && ` +
  `tar czf "${join(ZIEL, tarName)}" -C /tmp/paket ravia-cad-light-server && rm -rf /tmp/paket`]);

// --- 4 · Einzeldatei --------------------------------------------------------
// Eine Datei, die im Browser läuft — ohne Server, ohne Installation. Sie wird
// **ohne** Grundpfad gebaut: sie trägt alles in sich.
console.log('· Einzeldatei');
lauf('npm', ['run', 'build:einzeldatei'], { env: { ...process.env, RAVIA_BASE: '/' } });
const einzel = join(WURZEL, 'dist-einzeldatei', 'RaVia-CAD-Light.html');
if (!existsSync(einzel)) throw new Error('Die Einzeldatei wurde nicht erzeugt.');
cpSync(einzel, join(ZIEL, `RaVia-CAD-Light-${VERSION}.html`));

// --- 5 · Quellcode ----------------------------------------------------------
// Ohne node_modules, dist und Bildschirmfotos: das Archiv soll den Quellcode
// enthalten und nicht das, was daraus entsteht.
console.log('· Quellcode (zip)');
const zipName = `RaVia-CAD-Light-${VERSION}-Quellcode.zip`;
lauf('bash', ['-c',
  `cd "${WURZEL}" && rm -f "${join(ZIEL, zipName)}" && ` +
  `zip -qr "${join(ZIEL, zipName)}" . ` +
  `-x 'node_modules/*' -x 'dist/*' -x 'dist-einzeldatei/*' -x 'screenshots/*' ` +
  `-x '.git/*' -x 'server/app/assets/*' -x '*.tmp.*'`]);

const groesse = (p) => `${(statSync(p).size / 1048576).toFixed(2)} MB`;
console.log('\n✓ Paket fertig');
for (const n of [tarName, `RaVia-CAD-Light-${VERSION}.html`, zipName]) {
  console.log(`  ${n.padEnd(46)} ${groesse(join(ZIEL, n))}`);
}
console.log(`\n  Grundpfad im Paket: ${BASIS}\n`);
