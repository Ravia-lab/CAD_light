/**
 * Schema des Exportvertrags aus den Typen erzeugen (Festlegung F6).
 * ---------------------------------------------------------------------------
 * Der Vertrag mit RaVia ist `RaviaExport` in `src/types/bim.ts`. Dieses
 * Skript macht daraus ein JSON-Schema (Draft 2020-12) unter
 * `ravia-vertrag/schema/ravia.bim.light-<Fassung>.schema.json`:
 *
 *  - jedes Feld mit Typ, Pflicht oder optional, und der ersten Absatz seines
 *    Kommentars als `description`;
 *  - `additionalProperties: false` an jedem Objekt ohne Schlüsselmuster —
 *    ein Feld, das nicht im Schema steht, gibt es nicht;
 *  - benannte Typen einmal unter `$defs`.
 *
 * Aufruf: `npm run vertrag:schema`. Die Prüfläufe (`npm run verify`)
 * prüfen jeden Export, den sie bauen, gegen die erzeugte Datei; eine
 * Typänderung ohne neues Schema fällt dort auf.
 */

import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const QUELLE = join(WURZEL, 'src', 'types', 'bim.ts');

const programm = ts.createProgram([QUELLE], {
  strict: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  skipLibCheck: true,
  noEmit: true,
});
const checker = programm.getTypeChecker();
const datei = programm.getSourceFile(QUELLE);

let wurzelTyp;
let fassung;
ts.forEachChild(datei, (knoten) => {
  if (ts.isInterfaceDeclaration(knoten) && knoten.name.text === 'RaviaExport') {
    wurzelTyp = checker.getTypeAtLocation(knoten.name);
    const v = knoten.members.find((m) => m.name && m.name.getText() === 'version');
    fassung = v.type.literal.text;
  }
});
if (!wurzelTyp) throw new Error('RaviaExport nicht gefunden');

const defs = {};
const inArbeit = new Set();

/** Erster Absatz des Kommentars, ohne Markdown-Sterne, höchstens 400 Zeichen. */
function beschreibung(symbol) {
  if (!symbol) return undefined;
  const text = ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim();
  if (!text) return undefined;
  const absatz = text.split(/\n\s*\n/)[0].replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
  return absatz.length > 400 ? `${absatz.slice(0, 397)}…` : absatz;
}

/** Name, unter dem ein Typ in `$defs` steht — nur für benannte Schnittstellen und Aliase. */
function defName(typ) {
  const alias = typ.aliasSymbol;
  if (alias && !typ.aliasTypeArguments?.length) return alias.getName();
  const sym = typ.getSymbol();
  if (sym && (sym.flags & ts.SymbolFlags.Interface) && !(typ.typeArguments?.length)) return sym.getName();
  return undefined;
}

function schema(typ) {
  const f = typ.flags;
  if (f & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return {};
  if (f & ts.TypeFlags.StringLiteral) return { const: typ.value };
  if (f & ts.TypeFlags.NumberLiteral) return { const: typ.value };
  if (f & ts.TypeFlags.BooleanLiteral) return { const: checker.typeToString(typ) === 'true' };
  if (f & ts.TypeFlags.String) return { type: 'string' };
  if (f & ts.TypeFlags.Number) return { type: 'number' };
  if (f & ts.TypeFlags.Boolean) return { type: 'boolean' };
  if (f & ts.TypeFlags.Null) return { type: 'null' };
  if (f & ts.TypeFlags.Union) return vereinigung(typ);

  if (checker.isArrayType(typ)) return { type: 'array', items: schema(checker.getTypeArguments(typ)[0]) };
  if (checker.isTupleType(typ)) {
    const args = checker.getTypeArguments(typ);
    return { type: 'array', prefixItems: args.map(schema), minItems: args.length, maxItems: args.length };
  }
  if (f & ts.TypeFlags.Object || f & ts.TypeFlags.Intersection) {
    const name = defName(typ);
    if (name) {
      if (!defs[name] && !inArbeit.has(name)) {
        inArbeit.add(name);
        defs[name] = objekt(typ);
        inArbeit.delete(name);
      }
      return { $ref: `#/$defs/${name}` };
    }
    return objekt(typ);
  }
  throw new Error(`Typ nicht abbildbar: ${checker.typeToString(typ)}`);
}

function vereinigung(typ) {
  const teile = typ.types.filter((t) => !(t.flags & ts.TypeFlags.Undefined));
  const bool = teile.filter((t) => t.flags & ts.TypeFlags.BooleanLiteral);
  const rest = teile.filter((t) => !(t.flags & ts.TypeFlags.BooleanLiteral));
  const glieder = [];
  if (bool.length === 2) glieder.push({ type: 'boolean' });
  else for (const b of bool) glieder.push(schema(b));
  const literale = rest.filter((t) => t.flags & (ts.TypeFlags.StringLiteral | ts.TypeFlags.NumberLiteral));
  const sonst = rest.filter((t) => !(t.flags & (ts.TypeFlags.StringLiteral | ts.TypeFlags.NumberLiteral)));
  if (literale.length) glieder.push({ enum: literale.map((t) => t.value) });
  for (const t of sonst) glieder.push(schema(t));
  return glieder.length === 1 ? glieder[0] : { anyOf: glieder };
}

function objekt(typ) {
  const props = {};
  const pflicht = [];
  for (const p of checker.getPropertiesOfType(typ)) {
    const decl = p.valueDeclaration ?? p.declarations?.[0];
    const ptyp = decl ? checker.getTypeOfSymbolAtLocation(p, decl) : checker.getTypeOfSymbol(p);
    // Funktionen sind kein Datenfeld.
    if (ptyp.getCallSignatures().length) continue;
    const s = schema(ptyp);
    const d = beschreibung(p);
    props[p.getName()] = d && !s.$ref ? { description: d, ...s } : d ? { description: d, allOf: [s] } : s;
    const optional = (p.flags & ts.SymbolFlags.Optional) !== 0;
    if (!optional) pflicht.push(p.getName());
  }
  const raus = { type: 'object', properties: props };
  if (pflicht.length) raus.required = pflicht;
  const index = checker.getIndexInfosOfType(typ);
  if (index.length) raus.additionalProperties = schema(index[0].type);
  else raus.additionalProperties = false;
  const d = beschreibung(typ.aliasSymbol ?? typ.getSymbol());
  return d ? { description: d, ...raus } : raus;
}

const wurzel = schema(wurzelTyp);
const ausgabe = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `urn:ravia-vertrag:schema:ravia.bim.light-${fassung}`,
  title: `RaVia CAD Light Export ${fassung} (ravia.bim.light)`,
  description:
    'Erzeugt aus RaviaExport in src/types/bim.ts (npm run vertrag:schema). Festlegung F6: ein Feld, das hier ' +
    'nicht steht, gibt es nicht. Leistungen in W, außer wo der Feldname oder die Beschreibung kW nennt.',
  ...wurzel,
  $defs: Object.fromEntries(Object.entries(defs).sort(([a], [b]) => a.localeCompare(b))),
};
const ziel = join(WURZEL, 'ravia-vertrag', 'schema', `ravia.bim.light-${fassung}.schema.json`);
const text = `${JSON.stringify(ausgabe, null, 2)}\n`;
if (process.argv.includes('--pruefen')) {
  // Für die Prüfläufe: steht im Vertragsverzeichnis, was die Typen sagen?
  let alt = '';
  try {
    alt = readFileSync(ziel, 'utf-8');
  } catch {
    /* fehlt */
  }
  if (alt !== text) {
    console.log(`Schema ${fassung} veraltet oder fehlt — npm run vertrag:schema`);
    process.exit(1);
  }
  console.log(`Schema ${fassung} aktuell`);
} else {
  mkdirSync(dirname(ziel), { recursive: true });
  writeFileSync(ziel, text);
  console.log(`Schema ${fassung}: ${Object.keys(defs).length} Typen → ${ziel}`);
}
