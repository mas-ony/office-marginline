import { sortChildren } from '../ooxml/order';
import { parseIntSafe } from '../ooxml/units';
import { WORD_IGNORABLE, WORD_ROOT_PREFIXES, NS } from '../xml/namespaces';
import { attr, child, childrenNamed, el, parseXml, serializeXml, type XmlElement } from '../xml/xml';
import { parseParaProps, parseRunProps } from './props';
import type { StyleSheet } from './styles';
import type { ParaProps, RunProps } from './types';

export interface LevelDef {
  ilvl: number;
  start: number;
  numFmt: string;
  lvlText: string;
  lvlJc: string;
  suff: 'tab' | 'space' | 'nothing';
  lvlRestart?: number;
  isLgl: boolean;
  pStyle?: string;
  pPr: ParaProps;
  rPr: RunProps;
}

export interface AbstractNumDef {
  id: string;
  levels: LevelDef[];
  styleLink?: string;
  numStyleLink?: string;
  xml: XmlElement;
}

export interface NumDef {
  id: string;
  abstractId: string;
  overrides: Map<number, { start?: number; level?: LevelDef }>;
  xml: XmlElement;
}

export type ListKind = 'bullet' | 'ordered';

function parseLevel(e: XmlElement): LevelDef {
  const suff = attr(child(e, 'w:suff'), 'w:val');
  return {
    ilvl: parseIntSafe(attr(e, 'w:ilvl')) ?? 0,
    start: parseIntSafe(attr(child(e, 'w:start'), 'w:val')) ?? 1,
    numFmt: attr(child(e, 'w:numFmt'), 'w:val') ?? 'decimal',
    lvlText: attr(child(e, 'w:lvlText'), 'w:val') ?? '',
    lvlJc: attr(child(e, 'w:lvlJc'), 'w:val') ?? 'left',
    suff: suff === 'space' || suff === 'nothing' ? suff : 'tab',
    lvlRestart: parseIntSafe(attr(child(e, 'w:lvlRestart'), 'w:val')),
    isLgl: !!child(e, 'w:isLgl'),
    pStyle: attr(child(e, 'w:pStyle'), 'w:val'),
    pPr: parseParaProps(child(e, 'w:pPr')).props,
    rPr: parseRunProps(child(e, 'w:rPr')).props,
  };
}

// ---------------------------------------------------------------------------------------------
// Presets (independent designs following Word's bullet and numbering libraries)

interface PresetLevel {
  fmt: string;
  text: string;
  font?: string;
}

export type ListPreset =
  | 'bullet'
  | 'bulletSquare'
  | 'squareBullet'
  | 'diamond'
  | 'check'
  | 'arrow'
  | 'hollowBullet'
  | 'numberLatinRoman1'
  | 'numberDecimal'
  | 'numberLatinRoman2'
  | 'latinRoman'
  | 'romanLatinNumber'
  | 'lowerLatin'
  | 'lowerLatinParen'
  | 'upperLatinParen'
  | 'lowerRomanList';

const DOT = '';
const HOLLOW = 'o';
const SQUARE = '';
const BIG_SQUARE = '';
const DIAMOND = '';
const CHECK = '';
const ARROW = '';

const bulletCycle = (a: PresetLevel, b: PresetLevel, c: PresetLevel): PresetLevel[] =>
  Array.from({ length: 9 }, (_, i) => [a, b, c][i % 3]);

const sym = (text: string): PresetLevel => ({ fmt: 'bullet', text, font: 'Symbol' });
const wing = (text: string): PresetLevel => ({ fmt: 'bullet', text, font: 'Wingdings' });
const courier = (text: string): PresetLevel => ({ fmt: 'bullet', text, font: 'Courier New' });

const numCycle = (fmts: [string, string][]): PresetLevel[] =>
  Array.from({ length: 9 }, (_, i) => {
    const [fmt, pattern] = fmts[i % fmts.length];
    return { fmt, text: pattern.replace('#', `%${i + 1}`) };
  });

export const LIST_PRESETS: Record<ListPreset, { kind: ListKind; label: string; levels: PresetLevel[] }> = {
  bullet: { kind: 'bullet', label: 'Bullet', levels: bulletCycle(sym(DOT), courier(HOLLOW), wing(SQUARE)) },
  bulletSquare: { kind: 'bullet', label: 'Bullet Square', levels: bulletCycle(sym(DOT), wing(SQUARE), wing(SQUARE)) },
  squareBullet: { kind: 'bullet', label: 'Square Bullet', levels: bulletCycle(wing(BIG_SQUARE), sym(DOT), courier(HOLLOW)) },
  diamond: { kind: 'bullet', label: 'Diamond', levels: bulletCycle(wing(DIAMOND), courier(HOLLOW), wing(SQUARE)) },
  check: { kind: 'bullet', label: 'Check', levels: bulletCycle(wing(CHECK), courier(HOLLOW), wing(SQUARE)) },
  arrow: { kind: 'bullet', label: 'Arrow', levels: bulletCycle(wing(ARROW), courier(HOLLOW), wing(SQUARE)) },
  hollowBullet: { kind: 'bullet', label: 'Outline circle', levels: bulletCycle(courier(HOLLOW), wing(SQUARE), sym(DOT)) },
  numberLatinRoman1: { kind: 'ordered', label: '1. a. i.', levels: numCycle([['decimal', '#.'], ['lowerLetter', '#.'], ['lowerRoman', '#.']]) },
  numberDecimal: {
    kind: 'ordered',
    label: '1. 1.1. 1.1.1.',
    levels: Array.from({ length: 9 }, (_, i) => ({ fmt: 'decimal', text: Array.from({ length: i + 1 }, (_, j) => `%${j + 1}.`).join('') })),
  },
  numberLatinRoman2: { kind: 'ordered', label: '1) a) i)', levels: numCycle([['decimal', '#)'], ['lowerLetter', '#)'], ['lowerRoman', '#)']]) },
  latinRoman: { kind: 'ordered', label: 'A. a. i.', levels: numCycle([['upperLetter', '#.'], ['lowerLetter', '#.'], ['lowerRoman', '#.']]) },
  romanLatinNumber: { kind: 'ordered', label: 'I. A. 1.', levels: numCycle([['upperRoman', '#.'], ['upperLetter', '#.'], ['decimal', '#.']]) },
  lowerLatin: { kind: 'ordered', label: 'a. i. 1.', levels: numCycle([['lowerLetter', '#.'], ['lowerRoman', '#.'], ['decimal', '#.']]) },
  lowerLatinParen: { kind: 'ordered', label: 'a) i) 1)', levels: numCycle([['lowerLetter', '#)'], ['lowerRoman', '#)'], ['decimal', '#)']]) },
  upperLatinParen: { kind: 'ordered', label: 'A) a) i)', levels: numCycle([['upperLetter', '#)'], ['lowerLetter', '#)'], ['lowerRoman', '#)']]) },
  lowerRomanList: { kind: 'ordered', label: 'i. a. 1.', levels: numCycle([['lowerRoman', '#.'], ['lowerLetter', '#.'], ['decimal', '#.']]) },
};

/** Bullet styles offered by the list button menu. */
export const BULLET_STYLES: { preset: ListPreset; label: string; glyph: string }[] = [
  { preset: 'bullet', label: 'Opaque circle', glyph: '●' },
  { preset: 'hollowBullet', label: 'Outline circle', glyph: '○' },
  { preset: 'squareBullet', label: 'Opaque square', glyph: '■' },
];

/** Number styles offered by the numbered list button menu (first level sample). */
export const NUMBER_STYLES: { preset: ListPreset; label: string; sample: string[] }[] = [
  { preset: 'numberLatinRoman1', label: 'Numbers with periods', sample: ['1.', '2.', '3.'] },
  { preset: 'numberLatinRoman2', label: 'Numbers with parentheses', sample: ['1)', '2)', '3)'] },
  { preset: 'romanLatinNumber', label: 'Upper Roman numerals', sample: ['I.', 'II.', 'III.'] },
  { preset: 'lowerRomanList', label: 'Lower Roman numerals', sample: ['i.', 'ii.', 'iii.'] },
  { preset: 'latinRoman', label: 'Upper letters', sample: ['A.', 'B.', 'C.'] },
  { preset: 'upperLatinParen', label: 'Upper letters with parentheses', sample: ['A)', 'B)', 'C)'] },
  { preset: 'lowerLatin', label: 'Lower letters', sample: ['a.', 'b.', 'c.'] },
  { preset: 'lowerLatinParen', label: 'Lower letters with parentheses', sample: ['a)', 'b)', 'c)'] },
];

// ---------------------------------------------------------------------------------------------
// Number formatting

function toRoman(n: number): string {
  if (n <= 0 || n >= 4000) return String(n);
  const map: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
  return out;
}

function toLetters(n: number): string {
  if (n <= 0) return String(n);
  // Word repeats the letter: 27 -> AA, 28 -> BB.
  const letter = String.fromCharCode(65 + ((n - 1) % 26));
  return letter.repeat(Math.floor((n - 1) / 26) + 1);
}

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function cardinal(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '');
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${cardinal(n % 100)}` : ''}`;
  return String(n);
}

function ordinalSuffix(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

function ordinalText(n: number): string {
  const c = cardinal(n);
  const irregular: Record<string, string> = { one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth' };
  const parts = c.split(/([ -])/);
  const last = parts[parts.length - 1];
  parts[parts.length - 1] = irregular[last] ?? (last.endsWith('y') ? `${last.slice(0, -1)}ieth` : `${last}th`);
  return parts.join('');
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function formatNumber(n: number, fmt: string): string {
  switch (fmt) {
    case 'decimal': return String(n);
    case 'decimalZero': return n < 10 ? `0${n}` : String(n);
    case 'upperRoman': return toRoman(n);
    case 'lowerRoman': return toRoman(n).toLowerCase();
    case 'upperLetter': return toLetters(n);
    case 'lowerLetter': return toLetters(n).toLowerCase();
    case 'ordinal': return ordinalSuffix(n);
    case 'cardinalText': return cap(cardinal(n));
    case 'ordinalText': return cap(ordinalText(n));
    case 'decimalEnclosedCircle':
    case 'decimalEnclosedCircleChinese': return n >= 1 && n <= 20 ? String.fromCodePoint(0x2460 + n - 1) : String(n);
    case 'decimalEnclosedParen': return n >= 1 && n <= 20 ? String.fromCodePoint(0x2474 + n - 1) : `(${n})`;
    case 'decimalEnclosedFullstop': return n >= 1 && n <= 20 ? String.fromCodePoint(0x2488 + n - 1) : `${n}.`;
    case 'chicago': return ['*', '†', '‡', '§'][(n - 1) % 4].repeat(Math.floor((n - 1) / 4) + 1);
    case 'none': return '';
    case 'bullet': return '';
    default: return String(n);
  }
}

const WINGDINGS: Record<number, string> = {
  0x6c: '●', 0x6e: '■', 0x6f: '□', 0x71: '❑', 0x75: '◆', 0x76: '❖', 0x77: '⬥', 0xa7: '▪', 0xa8: '◻',
  0xd8: '➢', 0xe0: '→', 0xe8: '➔', 0xf0: '⇨', 0xfc: '✓', 0xfb: '✗', 0xfe: '☑', 0x9f: '•', 0xa1: '○',
};
const SYMBOL: Record<number, string> = { 0xb7: '•', 0xa8: '♦', 0xd8: '¬', 0x2d: '−', 0xae: '→' };

/** Map Symbol/Wingdings private-use bullet characters to displayable Unicode. */
export function bulletChar(text: string, font: string | undefined): string {
  if (!text) return '';
  const f = (font ?? '').toLowerCase();
  return [...text]
    .map((ch) => {
      const code = ch.codePointAt(0)!;
      const low = code >= 0xf000 && code <= 0xf0ff ? code - 0xf000 : code;
      if (f.startsWith('wingdings')) return WINGDINGS[low] ?? (code >= 0xf000 ? '•' : ch);
      if (f === 'symbol') return SYMBOL[low] ?? (code >= 0xf000 ? '•' : ch);
      if (code >= 0xf000 && code <= 0xf0ff) return WINGDINGS[low] ?? SYMBOL[low] ?? '•';
      if (ch === 'o' && f.startsWith('courier')) return '◦';
      return ch;
    })
    .join('');
}

/** Render a level's label from the current counters (index = level). */
export function renderLevelText(level: LevelDef, counters: number[], levelDefs: (LevelDef | undefined)[]): string {
  if (level.numFmt === 'bullet') return bulletChar(level.lvlText, level.rPr.fonts?.ascii ?? level.rPr.fonts?.hAnsi);
  return level.lvlText.replace(/%(\d)/g, (_m, d: string) => {
    const idx = parseInt(d, 10) - 1;
    const def = levelDefs[idx];
    const n = counters[idx] ?? def?.start ?? 1;
    const fmt = level.isLgl && def?.numFmt !== 'decimalZero' ? 'decimal' : def?.numFmt ?? 'decimal';
    return formatNumber(n, fmt);
  });
}

// ---------------------------------------------------------------------------------------------

export class NumberingModel {
  abstracts = new Map<string, AbstractNumDef>();
  nums = new Map<string, NumDef>();
  root: XmlElement | null = null;
  extraNamespaces: Record<string, string> = {};
  version = 0;

  constructor(private styles?: StyleSheet) {}

  static parse(xml: string | undefined, styles?: StyleSheet): NumberingModel {
    const model = new NumberingModel(styles);
    if (!xml) return model;
    const doc = parseXml(xml);
    model.root = doc.root;
    model.extraNamespaces = doc.extraNamespaces;
    for (const a of childrenNamed(doc.root, 'w:abstractNum')) {
      const id = attr(a, 'w:abstractNumId') ?? '';
      const levels: LevelDef[] = [];
      for (const l of childrenNamed(a, 'w:lvl')) {
        const lvl = parseLevel(l);
        levels[lvl.ilvl] = lvl;
      }
      model.abstracts.set(id, {
        id,
        levels,
        styleLink: attr(child(a, 'w:styleLink'), 'w:val'),
        numStyleLink: attr(child(a, 'w:numStyleLink'), 'w:val'),
        xml: a,
      });
    }
    for (const n of childrenNamed(doc.root, 'w:num')) {
      const id = attr(n, 'w:numId') ?? '';
      const overrides = new Map<number, { start?: number; level?: LevelDef }>();
      for (const o of childrenNamed(n, 'w:lvlOverride')) {
        const ilvl = parseIntSafe(attr(o, 'w:ilvl')) ?? 0;
        const start = parseIntSafe(attr(child(o, 'w:startOverride'), 'w:val'));
        const lvl = child(o, 'w:lvl');
        overrides.set(ilvl, { start, level: lvl ? { ...parseLevel(lvl), ilvl } : undefined });
      }
      model.nums.set(id, { id, abstractId: attr(child(n, 'w:abstractNumId'), 'w:val') ?? '', overrides, xml: n });
    }
    return model;
  }

  setStyles(styles: StyleSheet) {
    this.styles = styles;
  }

  /** Abstract definition of a num, following numStyleLink indirection. */
  abstractFor(numId: string, depth = 0): AbstractNumDef | undefined {
    const num = this.nums.get(numId);
    if (!num) return undefined;
    const abs = this.abstracts.get(num.abstractId);
    if (abs?.numStyleLink && depth < 4 && this.styles) {
      const style = this.styles.get(abs.numStyleLink);
      const linked = style?.pPr.numPr?.numId;
      if (linked && linked !== numId) return this.abstractFor(linked, depth + 1) ?? abs;
    }
    return abs;
  }

  level(numId: string, ilvl: number): LevelDef | undefined {
    const num = this.nums.get(numId);
    if (!num) return undefined;
    const override = num.overrides.get(ilvl);
    if (override?.level) return override.level;
    return this.abstractFor(numId)?.levels[ilvl];
  }

  levels(numId: string): (LevelDef | undefined)[] {
    return Array.from({ length: 9 }, (_, i) => this.level(numId, i));
  }

  startOverride(numId: string, ilvl: number): number | undefined {
    return this.nums.get(numId)?.overrides.get(ilvl)?.start;
  }

  kind(numId: string): ListKind | undefined {
    const lvl = this.level(numId, 0);
    if (!lvl) return undefined;
    return lvl.numFmt === 'bullet' ? 'bullet' : 'ordered';
  }

  /** Detect which preset (if any) a num instance was created from. */
  presetOf(numId: string): ListPreset | undefined {
    const lvl0 = this.level(numId, 0);
    const lvl1 = this.level(numId, 1);
    if (!lvl0) return undefined;
    for (const [key, preset] of Object.entries(LIST_PRESETS) as [ListPreset, (typeof LIST_PRESETS)[ListPreset]][]) {
      const [p0, p1] = preset.levels;
      if (p0.fmt === lvl0.numFmt && p0.text === lvl0.lvlText && (!lvl1 || (p1.fmt === lvl1.numFmt && p1.text === lvl1.lvlText))) return key;
    }
    return undefined;
  }

  private nextId(map: Map<string, unknown>): string {
    let n = 1;
    for (const k of map.keys()) n = Math.max(n, (parseInt(k, 10) || 0) + 1);
    return String(n);
  }

  /** Create a new list from a preset and return its numId. */
  addList(preset: ListPreset): string {
    const def = LIST_PRESETS[preset];
    const abstractId = this.abstracts.size ? this.nextId(this.abstracts) : '0';
    const nsid = Math.floor(Math.random() * 0xffffffff).toString(16).toUpperCase().padStart(8, '0');
    const lvls = def.levels.map((p, i) =>
      sortChildren(el('w:lvl', { 'w:ilvl': i }, [
        el('w:start', { 'w:val': 1 }),
        el('w:numFmt', { 'w:val': p.fmt }),
        el('w:lvlText', { 'w:val': p.text }),
        el('w:lvlJc', { 'w:val': 'left' }),
        el('w:pPr', {}, [el('w:ind', { 'w:left': 720 * (i + 1), 'w:hanging': 360 })]),
        p.font ? el('w:rPr', {}, [el('w:rFonts', { 'w:ascii': p.font, 'w:hAnsi': p.font, 'w:hint': 'default' })]) : null,
      ])),
    );
    const absXml = el('w:abstractNum', { 'w:abstractNumId': abstractId }, [
      el('w:nsid', { 'w:val': nsid }),
      el('w:multiLevelType', { 'w:val': 'hybridMultilevel' }),
      ...lvls,
    ]);
    const levels: LevelDef[] = lvls.map(parseLevel);
    this.abstracts.set(abstractId, { id: abstractId, levels, xml: absXml });
    const numId = this.nextId(this.nums);
    const numXml = el('w:num', { 'w:numId': numId }, [el('w:abstractNumId', { 'w:val': abstractId })]);
    this.nums.set(numId, { id: numId, abstractId, overrides: new Map(), xml: numXml });
    this.ensureRoot();
    this.version++;
    return numId;
  }

  /** New num pointing at the same abstract definition, restarting at `start` on level 0. */
  restartList(numId: string, start = 1): string {
    const num = this.nums.get(numId);
    if (!num) return numId;
    const id = this.nextId(this.nums);
    const xml = el('w:num', { 'w:numId': id }, [
      el('w:abstractNumId', { 'w:val': num.abstractId }),
      el('w:lvlOverride', { 'w:ilvl': 0 }, [el('w:startOverride', { 'w:val': start })]),
    ]);
    this.nums.set(id, { id, abstractId: num.abstractId, overrides: new Map([[0, { start }]]), xml });
    this.version++;
    return id;
  }

  private ensureRoot() {
    if (!this.root) this.root = { type: 'element', name: 'w:numbering', attrs: {}, children: [] };
  }

  get isEmpty(): boolean {
    return this.nums.size === 0 && this.abstracts.size === 0;
  }

  toXml(): string {
    this.ensureRoot();
    const root = this.root!;
    const others = root.children.filter((c) => c.type === 'element' && c.name !== 'w:abstractNum' && c.name !== 'w:num');
    root.children = [
      ...others.filter((c) => c.type === 'element' && c.name === 'w:numPicBullet'),
      ...[...this.abstracts.values()].map((a) => a.xml),
      ...[...this.nums.values()].map((n) => n.xml),
      ...others.filter((c) => c.type === 'element' && c.name !== 'w:numPicBullet'),
    ];
    const namespaces: Record<string, string> = {};
    for (const p of WORD_ROOT_PREFIXES) namespaces[p] = NS[p];
    Object.assign(namespaces, this.extraNamespaces);
    if (!root.attrs['mc:Ignorable']) root.attrs['mc:Ignorable'] = WORD_IGNORABLE;
    return serializeXml(root, { namespaces });
  }
}
