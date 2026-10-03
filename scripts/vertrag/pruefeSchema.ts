/**
 * JSON-Schema-Prüfung für den Exportvertrag (Festlegung F6).
 * ---------------------------------------------------------------------------
 * Genau der Teil von JSON Schema 2020-12, den `erzeuge-schema.mjs` schreibt:
 * `$ref` (nur `#/$defs/…`), `type`, `const`, `enum`, `properties`,
 * `required`, `additionalProperties`, `items`, `prefixItems`, `anyOf`,
 * `allOf`. Eigene Prüfung statt einer Bibliothek, weil die Prüfläufe ohne
 * zusätzliche Abhängigkeit laufen sollen; kommt im Schema ein anderes
 * Schlüsselwort vor, meldet die Prüfung das, statt es zu übergehen.
 */

export type Schema = Record<string, unknown>;

const BEKANNT = new Set([
  '$schema', '$id', '$ref', '$defs', 'title', 'description', 'type', 'const', 'enum', 'properties',
  'required', 'additionalProperties', 'items', 'prefixItems', 'minItems', 'maxItems', 'anyOf', 'allOf',
]);

function typVon(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

/** Fehler als „Pfad: Meldung"; leer, wenn der Wert gültig ist. */
export function pruefeGegenSchema(wurzel: Schema, wert: unknown, maxFehler = 20): string[] {
  const defs = (wurzel.$defs ?? {}) as Record<string, Schema>;
  const fehler: string[] = [];

  const aufloesen = (s: Schema): Schema => {
    let x = s;
    while (typeof x.$ref === 'string') {
      const name = (x.$ref as string).replace('#/$defs/', '');
      const ziel = defs[name];
      if (!ziel) throw new Error(`$ref ohne Ziel: ${x.$ref as string}`);
      x = ziel;
    }
    return x;
  };

  const gueltig = (s0: Schema, v: unknown, pfad: string, out: string[]): void => {
    if (out.length >= maxFehler) return;
    const s = aufloesen(s0);
    for (const k of Object.keys(s)) if (!BEKANNT.has(k)) out.push(`${pfad}: Schlüsselwort ${k} wird nicht geprüft`);
    if (s.allOf) for (const t of s.allOf as Schema[]) gueltig(t, v, pfad, out);
    if (s.anyOf) {
      const passt = (s.anyOf as Schema[]).some((t) => {
        const probe: string[] = [];
        gueltig(t, v, pfad, probe);
        return probe.length === 0;
      });
      if (!passt) out.push(`${pfad}: passt zu keiner Variante`);
      return;
    }
    if ('const' in s && v !== s.const) {
      out.push(`${pfad}: erwartet ${JSON.stringify(s.const)}, steht ${JSON.stringify(v)}`);
      return;
    }
    if (s.enum && !(s.enum as unknown[]).includes(v)) {
      out.push(`${pfad}: ${JSON.stringify(v)} ist keiner der Werte ${JSON.stringify(s.enum)}`);
      return;
    }
    if (s.type) {
      const t = typVon(v);
      const ok = s.type === 'number' ? t === 'number' && Number.isFinite(v as number) : t === s.type;
      if (!ok) {
        out.push(`${pfad}: erwartet ${s.type as string}, steht ${t === 'number' ? String(v) : t}`);
        return;
      }
    }
    if (typVon(v) === 'object' && (s.properties || s.additionalProperties !== undefined)) {
      const o = v as Record<string, unknown>;
      const props = (s.properties ?? {}) as Record<string, Schema>;
      for (const r of (s.required ?? []) as string[]) if (!(r in o)) out.push(`${pfad}: Pflichtfeld ${r} fehlt`);
      for (const [k, x] of Object.entries(o)) {
        if (props[k]) gueltig(props[k], x, `${pfad}.${k}`, out);
        else if (s.additionalProperties === false) out.push(`${pfad}.${k}: Feld steht nicht im Schema`);
        else if (s.additionalProperties && typeof s.additionalProperties === 'object') {
          gueltig(s.additionalProperties as Schema, x, `${pfad}.${k}`, out);
        }
      }
    }
    if (Array.isArray(v)) {
      const pre = (s.prefixItems ?? []) as Schema[];
      v.forEach((x, i) => {
        if (i < pre.length) gueltig(pre[i], x, `${pfad}[${i}]`, out);
        else if (s.items) gueltig(s.items as Schema, x, `${pfad}[${i}]`, out);
      });
    }
  };

  gueltig(wurzel, wert, '$', fehler);
  return fehler;
}
