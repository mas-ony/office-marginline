import { parseIntSafe, parseMeasure, parseOnOff } from '../ooxml/units';
import { attr, child, childrenNamed, elements, parseFragment, parseXml, serializeXml, type XmlElement } from '../xml/xml';
import { WORD_IGNORABLE, WORD_ROOT_PREFIXES, NS } from '../xml/namespaces';
import { mergeParaProps, mergeRunProps, parseBorders, parseParaProps, parseRunProps, parseShading } from './props';
import type { BoxBorders, ParaProps, RunProps } from './types';

export type StyleType = 'paragraph' | 'character' | 'table' | 'numbering';

export interface CellMargins {
  top?: number;
  left?: number;
  bottom?: number;
  right?: number;
}

export interface TableStyleBlock {
  pPr: ParaProps;
  rPr: RunProps;
  shading?: string;
  borders?: BoxBorders;
  cellMargins?: CellMargins;
}

export interface StyleDef {
  id: string;
  type: StyleType;
  name: string;
  basedOn?: string;
  next?: string;
  link?: string;
  isDefault: boolean;
  hidden: boolean;
  qFormat: boolean;
  uiPriority?: number;
  pPr: ParaProps;
  rPr: RunProps;
  /** Table styles: whole-table properties plus conditional formats keyed by w:tblStylePr type. */
  table?: TableStyleBlock & { cond: Record<string, TableStyleBlock>; rowBandSize?: number; colBandSize?: number };
}

const TOGGLES = ['bold', 'italic', 'caps', 'smallCaps', 'strike', 'dstrike', 'vanish'] as const;

export function parseCellMargins(e: XmlElement | undefined): CellMargins | undefined {
  if (!e) return undefined;
  const m: CellMargins = {};
  for (const c of elements(e)) {
    const side = c.name.slice(2);
    const v = parseMeasure(attr(c, 'w:w'), 'twips');
    if (v === undefined) continue;
    if (side === 'top' || side === 'bottom') m[side] = v;
    else if (side === 'left' || side === 'start') m.left = v;
    else if (side === 'right' || side === 'end') m.right = v;
  }
  return m;
}

function parseTableBlock(e: XmlElement): TableStyleBlock {
  const tblPr = child(e, 'w:tblPr');
  const tcPr = child(e, 'w:tcPr');
  return {
    pPr: parseParaProps(child(e, 'w:pPr')).props,
    rPr: parseRunProps(child(e, 'w:rPr')).props,
    shading: parseShading(child(tcPr, 'w:shd')) ?? parseShading(child(tblPr, 'w:shd')),
    borders: { ...(parseBorders(child(tblPr, 'w:tblBorders')) ?? {}), ...(parseBorders(child(tcPr, 'w:tcBorders')) ?? {}) },
    cellMargins: parseCellMargins(child(tblPr, 'w:tblCellMar')),
  };
}

function parseStyle(e: XmlElement): StyleDef {
  const type = (attr(e, 'w:type') ?? 'paragraph') as StyleType;
  const def: StyleDef = {
    id: attr(e, 'w:styleId') ?? '',
    type,
    name: attr(child(e, 'w:name'), 'w:val') ?? attr(e, 'w:styleId') ?? '',
    basedOn: attr(child(e, 'w:basedOn'), 'w:val'),
    next: attr(child(e, 'w:next'), 'w:val'),
    link: attr(child(e, 'w:link'), 'w:val'),
    isDefault: parseOnOff(attr(e, 'w:default') ?? '0'),
    hidden: !!child(e, 'w:hidden') || !!child(e, 'w:semiHidden'),
    qFormat: !!child(e, 'w:qFormat'),
    uiPriority: parseIntSafe(attr(child(e, 'w:uiPriority'), 'w:val')),
    pPr: parseParaProps(child(e, 'w:pPr')).props,
    rPr: parseRunProps(child(e, 'w:rPr')).props,
  };
  if (type === 'table') {
    const base = parseTableBlock(e);
    const cond: Record<string, TableStyleBlock> = {};
    for (const c of childrenNamed(e, 'w:tblStylePr')) {
      const t = attr(c, 'w:type');
      if (t) cond[t] = parseTableBlock(c);
    }
    const tblPr = child(e, 'w:tblPr');
    def.table = {
      ...base,
      cond,
      rowBandSize: parseIntSafe(attr(child(tblPr, 'w:tblStyleRowBandSize'), 'w:val')),
      colBandSize: parseIntSafe(attr(child(tblPr, 'w:tblStyleColBandSize'), 'w:val')),
    };
  }
  return def;
}

/** Built-in styles added on demand when a document does not define them. */
const BUILTIN_STYLES: Record<string, string> = {
  Normal: '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>',
  Title:
    '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="10"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:after="60" w:line="240" w:lineRule="auto"/><w:contextualSpacing/></w:pPr><w:rPr><w:sz w:val="52"/><w:szCs w:val="52"/></w:rPr></w:style>',
  Subtitle:
    '<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="11"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:after="320"/></w:pPr><w:rPr><w:color w:val="666666"/><w:sz w:val="30"/><w:szCs w:val="30"/></w:rPr></w:style>',
  Heading1: heading(1, 400, 120, 40, '000000'),
  Heading2: heading(2, 360, 120, 32, '000000'),
  Heading3: heading(3, 320, 80, 28, '434343'),
  Heading4: heading(4, 280, 80, 24, '666666'),
  Heading5: heading(5, 240, 80, 22, '666666'),
  Heading6: heading(6, 240, 80, 22, '666666', true),
  Quote:
    '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="29"/><w:qFormat/><w:pPr><w:spacing w:before="200" w:after="160"/><w:ind w:left="864" w:right="864"/><w:jc w:val="center"/></w:pPr><w:rPr><w:i/><w:iCs/><w:color w:val="404040"/></w:rPr></w:style>',
  ListParagraph:
    '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="34"/><w:qFormat/><w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>',
  DefaultParagraphFont:
    '<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style>',
  Hyperlink:
    '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr><w:color w:val="0563C1" w:themeColor="hyperlink"/><w:u w:val="single"/></w:rPr></w:style>',
  TableNormal:
    '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>',
  TableGrid:
    '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:uiPriority w:val="39"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr></w:style>',
  NoList:
    '<w:style w:type="numbering" w:default="1" w:styleId="NoList"><w:name w:val="No List"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/></w:style>',
  CommentText:
    '<w:style w:type="paragraph" w:styleId="CommentText"><w:name w:val="annotation text"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:pPr><w:spacing w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>',
  CommentReference:
    '<w:style w:type="character" w:styleId="CommentReference"><w:name w:val="annotation reference"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/><w:rPr><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr></w:style>',
  FootnoteText:
    '<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>',
  FootnoteReference:
    '<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>',
  EndnoteText:
    '<w:style w:type="paragraph" w:styleId="EndnoteText"><w:name w:val="endnote text"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>',
  EndnoteReference:
    '<w:style w:type="character" w:styleId="EndnoteReference"><w:name w:val="endnote reference"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>',
  Header:
    '<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:pPr><w:tabs><w:tab w:val="center" w:pos="4680"/><w:tab w:val="right" w:pos="9360"/></w:tabs><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:style>',
  Footer:
    '<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:pPr><w:tabs><w:tab w:val="center" w:pos="4680"/><w:tab w:val="right" w:pos="9360"/></w:tabs><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:style>',
};

function heading(level: number, before: number, after: number, size: number, color: string, italic = false): string {
  return `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${before}" w:after="${after}"/><w:outlineLvl w:val="${level - 1}"/></w:pPr><w:rPr>${italic ? '<w:i/><w:iCs/>' : ''}<w:color w:val="${color}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`;
}

export const STYLE_PRESETS: { id: string; label: string }[] = [
  { id: 'Normal', label: 'Normal Text' },
  { id: 'Title', label: 'Title' },
  { id: 'Subtitle', label: 'Subtitle' },
  { id: 'Heading1', label: 'Heading 1' },
  { id: 'Heading2', label: 'Heading 2' },
  { id: 'Heading3', label: 'Heading 3' },
  { id: 'Heading4', label: 'Heading 4' },
  { id: 'Heading5', label: 'Heading 5' },
];

export class StyleSheet {
  docDefaults: { rPr: RunProps; pPr: ParaProps } = { rPr: {}, pPr: {} };
  styles = new Map<string, StyleDef>();
  root: XmlElement | null = null;
  extraNamespaces: Record<string, string> = {};
  /** Incremented whenever styles change so dependants (CSS) can refresh. */
  version = 0;
  private byName = new Map<string, string>();

  static parse(xml: string | undefined): StyleSheet {
    const sheet = new StyleSheet();
    if (!xml) return sheet;
    const doc = parseXml(xml);
    sheet.root = doc.root;
    sheet.extraNamespaces = doc.extraNamespaces;
    const defaults = child(doc.root, 'w:docDefaults');
    sheet.docDefaults = {
      rPr: parseRunProps(child(child(defaults, 'w:rPrDefault'), 'w:rPr')).props,
      pPr: parseParaProps(child(child(defaults, 'w:pPrDefault'), 'w:pPr')).props,
    };
    for (const s of childrenNamed(doc.root, 'w:style')) sheet.register(parseStyle(s));
    return sheet;
  }

  private register(def: StyleDef) {
    if (!def.id) return;
    this.styles.set(def.id, def);
    this.byName.set(def.name.toLowerCase(), def.id);
  }

  get(id: string | null | undefined): StyleDef | undefined {
    return id ? this.styles.get(id) : undefined;
  }

  idForName(name: string): string | undefined {
    return this.byName.get(name.toLowerCase());
  }

  defaultStyleId(type: StyleType): string | undefined {
    for (const s of this.styles.values()) if (s.type === type && s.isDefault) return s.id;
    if (type === 'paragraph' && this.styles.has('Normal')) return 'Normal';
    return undefined;
  }

  /** Style chain from the root ancestor down to `id` (cycle safe). */
  chain(id: string | undefined): StyleDef[] {
    const out: StyleDef[] = [];
    const seen = new Set<string>();
    let cur = id ? this.styles.get(id) : undefined;
    while (cur && !seen.has(cur.id) && out.length < 32) {
      seen.add(cur.id);
      out.unshift(cur);
      cur = cur.basedOn ? this.styles.get(cur.basedOn) : undefined;
    }
    return out;
  }

  /** Paragraph style properties merged along basedOn (docDefaults excluded). */
  resolveParagraphStyle(id: string | null | undefined): { pPr: ParaProps; rPr: RunProps } {
    const sid = id ?? this.defaultStyleId('paragraph');
    let pPr: ParaProps = {};
    let rPr: RunProps = {};
    for (const s of this.chain(sid ?? undefined)) {
      pPr = mergeParaProps(pPr, s.pPr);
      rPr = mergeRunProps(rPr, s.rPr);
    }
    return { pPr, rPr };
  }

  resolveCharacterStyle(id: string | null | undefined): RunProps {
    let rPr: RunProps = {};
    for (const s of this.chain(id ?? undefined)) rPr = mergeRunProps(rPr, s.rPr);
    return rPr;
  }

  resolveTableStyle(id: string | null | undefined): StyleDef['table'] & { pPr: ParaProps; rPr: RunProps } {
    const out: StyleDef['table'] & { pPr: ParaProps; rPr: RunProps } = { pPr: {}, rPr: {}, cond: {} };
    const sid = id ?? this.defaultStyleId('table');
    for (const s of this.chain(sid ?? undefined)) {
      out.pPr = mergeParaProps(out.pPr, s.pPr);
      out.rPr = mergeRunProps(out.rPr, s.rPr);
      if (!s.table) continue;
      if (s.table.shading) out.shading = s.table.shading;
      out.borders = { ...(out.borders ?? {}), ...(s.table.borders ?? {}) };
      out.cellMargins = { ...(out.cellMargins ?? {}), ...(s.table.cellMargins ?? {}) };
      if (s.table.rowBandSize) out.rowBandSize = s.table.rowBandSize;
      if (s.table.colBandSize) out.colBandSize = s.table.colBandSize;
      for (const [k, v] of Object.entries(s.table.cond)) {
        const prev = out.cond[k];
        out.cond[k] = prev
          ? {
              pPr: mergeParaProps(prev.pPr, v.pPr),
              rPr: mergeRunProps(prev.rPr, v.rPr),
              shading: v.shading ?? prev.shading,
              borders: { ...(prev.borders ?? {}), ...(v.borders ?? {}) },
              cellMargins: { ...(prev.cellMargins ?? {}), ...(v.cellMargins ?? {}) },
            }
          : v;
      }
    }
    return out;
  }

  /** Effective paragraph properties: docDefaults, paragraph style chain, then direct formatting. */
  effectiveParagraph(styleId: string | null | undefined, direct?: ParaProps): ParaProps {
    return mergeParaProps(mergeParaProps(this.docDefaults.pPr, this.resolveParagraphStyle(styleId).pPr), direct);
  }

  /**
   * Effective run properties. Toggle properties (bold, italic, ...) combine with XOR across
   * the paragraph and character style levels as the specification requires; direct formatting
   * then sets absolute values.
   */
  effectiveRun(paraStyleId: string | null | undefined, charStyleId: string | null | undefined, direct?: RunProps): RunProps {
    const para = this.resolveParagraphStyle(paraStyleId).rPr;
    const char = this.resolveCharacterStyle(charStyleId);
    let out = mergeRunProps(mergeRunProps(this.docDefaults.rPr, para), char);
    for (const t of TOGGLES) {
      const a = para[t];
      const b = char[t];
      if (a !== undefined && b !== undefined) out = { ...out, [t]: a !== b };
    }
    return mergeRunProps(out, direct);
  }

  /** Add a built-in style definition if the document lacks it. Returns true if the style exists afterwards. */
  ensureStyle(id: string): boolean {
    if (this.styles.has(id)) return true;
    const xml = BUILTIN_STYLES[id];
    if (!xml) return false;
    const e = parseFragment(xml);
    const def = parseStyle(e);
    if (def.basedOn) this.ensureStyle(def.basedOn);
    if (def.isDefault) {
      for (const s of this.styles.values()) if (s.type === def.type && s.isDefault) e.attrs['w:default'] = '0';
      def.isDefault = e.attrs['w:default'] === '1';
    }
    this.register(def);
    if (!this.root) this.root = { type: 'element', name: 'w:styles', attrs: {}, children: [] };
    this.root.children.push(e);
    this.version++;
    return true;
  }

  /** Paragraph styles to offer in the UI: presets plus quick-format styles used by the document. */
  paragraphStyleList(): { id: string; label: string }[] {
    const out = STYLE_PRESETS.map((p) => ({ ...p }));
    const seen = new Set(out.map((p) => p.id));
    for (const s of this.styles.values()) {
      if (s.type !== 'paragraph' || s.hidden || !s.qFormat || seen.has(s.id)) continue;
      out.push({ id: s.id, label: displayStyleName(s.name) });
      seen.add(s.id);
    }
    return out;
  }

  toXml(): string {
    const root = this.root ?? { type: 'element' as const, name: 'w:styles', attrs: {}, children: [] };
    const namespaces: Record<string, string> = {};
    for (const p of WORD_ROOT_PREFIXES) namespaces[p] = NS[p];
    Object.assign(namespaces, this.extraNamespaces);
    if (!root.attrs['mc:Ignorable']) root.attrs['mc:Ignorable'] = WORD_IGNORABLE;
    return serializeXml(root, { namespaces });
  }
}

/** "heading 1" -> "Heading 1" (Word stores some built-in names in lower case). */
export function displayStyleName(name: string): string {
  return name.replace(/^(heading|title|subtitle|quote|caption)\b/i, (m) => m[0].toUpperCase() + m.slice(1).toLowerCase());
}

/** Built-in style ids recognized for preset application. */
export function hasBuiltinStyle(id: string): boolean {
  return id in BUILTIN_STYLES;
}

/** Run properties of a built-in style definition (for previews of styles not yet in a document). */
export function builtinStyleRun(id: string): RunProps | undefined {
  const xml = BUILTIN_STYLES[id];
  return xml ? parseStyle(parseFragment(xml)).rPr : undefined;
}

/** Default styles.xml for new documents. */
export function defaultStylesXml(font = 'Calibri'): string {
  const body = [
    '<w:docDefaults>',
    `<w:rPrDefault><w:rPr><w:rFonts w:ascii="${font}" w:eastAsia="${font}" w:hAnsi="${font}" w:cs="Times New Roman"/><w:kern w:val="2"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US" w:eastAsia="en-US" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>`,
    '<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault>',
    '</w:docDefaults>',
    ...['Normal', 'DefaultParagraphFont', 'TableNormal', 'NoList', 'Title', 'Subtitle', 'Heading1', 'Heading2', 'Heading3', 'Heading4', 'Heading5', 'ListParagraph', 'TableGrid', 'Hyperlink', 'Header', 'Footer'].map((id) => BUILTIN_STYLES[id]),
  ].join('');
  const decls = WORD_ROOT_PREFIXES.map((p) => `xmlns:${p}="${NS[p]}"`).join(' ');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<w:styles ${decls} mc:Ignorable="${WORD_IGNORABLE}">${body}</w:styles>`;
}

// ---------------------------------------------------------------------------------------------
// Theme

export interface ThemeInfo {
  major?: string;
  minor?: string;
  colors: Record<string, string>;
  /** Widths of the line styles in EMU (a:lnStyleLst), which shape styles refer to. */
  lineWidths?: number[];
}

export function parseTheme(xml: string | undefined): ThemeInfo {
  const info: ThemeInfo = { colors: {} };
  if (!xml) return info;
  try {
    const { root } = parseXml(xml);
    const elementsDeep = (e: XmlElement, name: string): XmlElement | undefined => {
      for (const c of elements(e)) {
        if (c.name === name) return c;
        const f = elementsDeep(c, name);
        if (f) return f;
      }
      return undefined;
    };
    const fontScheme = elementsDeep(root, 'a:fontScheme');
    info.major = attr(child(child(fontScheme, 'a:majorFont'), 'a:latin'), 'typeface');
    info.minor = attr(child(child(fontScheme, 'a:minorFont'), 'a:latin'), 'typeface');
    const clr = elementsDeep(root, 'a:clrScheme');
    for (const c of elements(clr)) {
      const name = c.name.slice(2);
      const v = elements(c)[0];
      const hex = attr(v, 'val') ?? attr(v, 'lastClr');
      if (hex) info.colors[name] = hex.toUpperCase();
    }
    const lines = elementsDeep(root, 'a:lnStyleLst');
    if (lines) info.lineWidths = elements(lines).filter((e) => e.name === 'a:ln').map((e) => Number(attr(e, 'w') ?? 0) || 0);
  } catch {
    // A broken theme only affects fonts and the colours of drawings; ignore.
  }
  return info;
}
