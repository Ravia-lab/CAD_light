/**
 * Die Wörterbücher — eines je Sprache außer Deutsch.
 * ---------------------------------------------------------------------------
 * **Warum Deutsch hier fehlt.** Der deutsche Text *ist* der Schlüssel. Ein
 * deutscher Katalog wäre eine Tabelle, die jeden Satz auf sich selbst
 * abbildet — Arbeit, die niemand pflegen will, und eine zweite Stelle, an
 * der derselbe Satz anders stehen könnte als im Quelltext.
 *
 * **Warum die Kataloge leer starten.** Eine maschinelle Vorübersetzung
 * einzuchecken wäre schnell und falsch. Was hier steht, liest ein Monteur
 * auf einer Baustelle, und dort entscheidet ein missverstandener Satz über
 * ein Loch in der falschen Wand. Jeder Eintrag gehört erst hinein, wenn ihn
 * jemand gelesen hat, der die Sprache **und** das Gewerk kann.
 *
 * Bis dahin steht überall der deutsche Satz — vollständig und richtig. Das
 * ist der Zustand, den dieses Modul ausdrücklich für gut erklärt: lieber
 * noch nicht übersetzt als falsch übersetzt.
 *
 * **Der Schlüssel mit Zusammenhang** trägt ein `\u0000` zwischen Text und
 * Zusammenhang (siehe `schluessel()`). Das Zeichen kommt in keinem
 * Oberflächentext vor und kann deshalb nichts zerschneiden.
 */

import type { Sprache } from '../sprache';

/** Ein Wörterbuch: deutscher Text → Übersetzung. */
export type Katalog = Record<string, string>;

/*
 * Siebzehn leere Wörterbücher — eines je Sprache außer Deutsch.
 *
 * **Leer ist hier ein Zustand und kein Versäumnis.** Was hier stünde, liest
 * ein Monteur auf einer Baustelle, und dort entscheidet ein
 * missverstandener Satz über ein Loch in der falschen Wand. Jeder Eintrag
 * gehört erst hinein, wenn ihn jemand gelesen hat, der die Sprache **und**
 * das Gewerk kann. Bis dahin steht überall der deutsche Satz — vollständig
 * und richtig, nur eben noch nicht übersetzt.
 */
const tr: Katalog = {};
const pl: Katalog = {};
const ru: Katalog = {};
const uk: Katalog = {};
const ro: Katalog = {};
const bg: Katalog = {};
const hr: Katalog = {};
const sr: Katalog = {};
const sq: Katalog = {};
const el: Katalog = {};
const it: Katalog = {};
const es: Katalog = {};
const pt: Katalog = {};
const fr: Katalog = {};
const nl: Katalog = {};
const en: Katalog = {};
const ar: Katalog = {};

export const KATALOGE: Partial<Record<Sprache, Katalog>> = {
  tr, pl, ru, uk, ro, bg, hr, sr, sq, el, it, es, pt, fr, nl, en, ar,
};
