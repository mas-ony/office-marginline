import { sortChildren } from '../ooxml/order';
import { parseIntSafe, parseMeasure, parseOnOff } from '../ooxml/units';
import { attr, child, el, elements, type XmlElement } from '../xml/xml';
import type {
  BorderSpec,
  BoxBorders,
  ColumnsSpec,
  HeaderFooterType,
  Indent,
  ParaProps,
  RunProps,
  SectionProps,
  SectionType,
  Spacing,
  TabStop,
} from './types';
import { defaultSection } from './types';

const onOff = (e: XmlElement) => parseOnOff(attr(e, 'w:val'));

// ---------------------------------------------------------------------------------------------
// Borders and shading

export function parseBorder(e: XmlElement | undefined): BorderSpec | undefined {
  if (!e) return undefined;
  return {
    val: attr(e, 'w:val') ?? 'single',
    sz: parseIntSafe(attr(e, 'w:sz')),
    space: parseIntSafe(attr(e, 'w:space')),
    color: attr(e, 'w:color'),
  };
}

export function buildBorder(name: string, b: BorderSpec): XmlElement {
  // Optional attributes are written only when known, so imported borders save unchanged.
  return el(name, { 'w:val': b.val, 'w:sz': b.sz, 'w:space': b.space, 'w:color': b.color });
}

export function parseBorders(e: XmlElement | undefined): BoxBorders | undefined {
  if (!e) return undefined;
  const out: BoxBorders = {};
  for (const c of elements(e)) {
    const key = c.name.slice(2);
    const side = key === 'start' ? 'left' : key === 'end' ? 'right' : key;
    if (side === 'top' || side === 'left' || side === 'bottom' || side === 'right' || side === 'between' || side === 'insideH' || side === 'insideV') {
      out[side] = parseBorder(c);
    }
  }
  return out;
}

export function buildBorders(name: string, b: BoxBorders): XmlElement {
  const kids: XmlElement[] = [];
  for (const side of ['top', 'left', 'bottom', 'right', 'between', 'insideH', 'insideV'] as const) {
    const spec = b[side];
    if (spec) kids.push(buildBorder(`w:${side}`, spec));
  }
  return sortChildren(el(name, {}, kids));
}

/** Background colour of a w:shd element (RRGGBB) or undefined. */
export function parseShading(e: XmlElement | undefined): string | undefined {
  if (!e) return undefined;
  const val = attr(e, 'w:val');
  const fill = attr(e, 'w:fill');
  const color = attr(e, 'w:color');
  if (val === 'solid' && color && color !== 'auto') return color.toUpperCase();
  if (fill && fill !== 'auto') return fill.toUpperCase();
  return undefined;
}

export function buildShading(fill: string): XmlElement {
  return el('w:shd', { 'w:val': 'clear', 'w:color': 'auto', 'w:fill': fill });
}

// ---------------------------------------------------------------------------------------------
// Run properties

const RUN_KNOWN = new Set([
  'w:rStyle', 'w:b', 'w:i', 'w:u', 'w:strike', 'w:dstrike', 'w:caps', 'w:smallCaps', 'w:vanish',
  'w:color', 'w:highlight', 'w:shd', 'w:rFonts', 'w:sz', 'w:vertAlign', 'w:spacing', 'w:position',
]);

export interface ParsedRunProps {
  props: RunProps;
  /** Children the editor does not model; written back unchanged. */
  raw: XmlElement[];
  change?: XmlElement;
  ins?: XmlElement;
  del?: XmlElement;
}

export function parseRunProps(rPr: XmlElement | undefined): ParsedRunProps {
  const props: RunProps = {};
  const raw: XmlElement[] = [];
  const out: ParsedRunProps = { props, raw };
  if (!rPr) return out;
  for (const c of elements(rPr)) {
    switch (c.name) {
      case 'w:rStyle': props.styleId = attr(c, 'w:val'); break;
      case 'w:b': props.bold = onOff(c); break;
      case 'w:i': props.italic = onOff(c); break;
      case 'w:u':
        props.underline = attr(c, 'w:val') ?? 'single';
        if (attr(c, 'w:color') && attr(c, 'w:color') !== 'auto') props.underlineColor = attr(c, 'w:color');
        break;
      case 'w:strike': props.strike = onOff(c); break;
      case 'w:dstrike': props.dstrike = onOff(c); break;
      case 'w:caps': props.caps = onOff(c); break;
      case 'w:smallCaps': props.smallCaps = onOff(c); break;
      case 'w:vanish': props.vanish = onOff(c); break;
      case 'w:color': {
        const val = attr(c, 'w:val');
        if (val) {
          props.color = { val: val === 'auto' ? 'auto' : val.toUpperCase() };
          if (attr(c, 'w:themeColor')) props.color.themeColor = attr(c, 'w:themeColor');
          if (attr(c, 'w:themeShade')) props.color.themeShade = attr(c, 'w:themeShade');
          if (attr(c, 'w:themeTint')) props.color.themeTint = attr(c, 'w:themeTint');
        }
        break;
      }
      case 'w:highlight': props.highlight = attr(c, 'w:val'); break;
      case 'w:shd': {
        const fill = parseShading(c);
        if (fill) props.shading = fill;
        else raw.push(c);
        break;
      }
      case 'w:rFonts': {
        const f: RunProps['fonts'] = {};
        for (const k of ['ascii', 'hAnsi', 'eastAsia', 'cs', 'asciiTheme', 'hAnsiTheme', 'eastAsiaTheme', 'cstheme', 'hint'] as const) {
          const v = attr(c, `w:${k}`);
          if (v) f[k] = v;
        }
        props.fonts = f;
        break;
      }
      case 'w:sz': {
        const v = parseMeasure(attr(c, 'w:val'), 'halfPt');
        if (v !== undefined) props.size = v;
        break;
      }
      case 'w:vertAlign': {
        const v = attr(c, 'w:val');
        if (v === 'superscript' || v === 'subscript' || v === 'baseline') props.vertAlign = v;
        break;
      }
      case 'w:spacing': {
        const v = parseMeasure(attr(c, 'w:val'), 'twips');
        if (v !== undefined) props.spacing = v;
        break;
      }
      case 'w:position': {
        const v = parseMeasure(attr(c, 'w:val'), 'halfPt');
        if (v !== undefined) props.position = v;
        break;
      }
      case 'w:rPrChange': out.change = c; break;
      case 'w:ins':
      case 'w:moveTo': out.ins = c; break;
      case 'w:del':
      case 'w:moveFrom': out.del = c; break;
      default:
        if (!RUN_KNOWN.has(c.name)) raw.push(c);
    }
  }
  return out;
}

const bool = (name: string, v: boolean | undefined) => (v === undefined ? null : v ? el(name) : el(name, { 'w:val': '0' }));

/** Build the children of a w:rPr from props. Returns null when nothing would be written. */
export function buildRunProps(props: RunProps, raw: XmlElement[] = [], extra: XmlElement[] = [], name = 'w:rPr'): XmlElement | null {
  const kids: XmlElement[] = [];
  const push = (e: XmlElement | null) => {
    if (e) kids.push(e);
  };
  if (props.styleId) push(el('w:rStyle', { 'w:val': props.styleId }));
  if (props.fonts && Object.keys(props.fonts).length) {
    const a: Record<string, string> = {};
    for (const [k, v] of Object.entries(props.fonts)) if (v) a[`w:${k}`] = v;
    push(el('w:rFonts', a));
  }
  push(bool('w:b', props.bold));
  push(bool('w:i', props.italic));
  push(bool('w:caps', props.caps));
  push(bool('w:smallCaps', props.smallCaps));
  push(bool('w:strike', props.strike));
  push(bool('w:dstrike', props.dstrike));
  push(bool('w:vanish', props.vanish));
  if (props.color) {
    push(el('w:color', {
      'w:val': props.color.val,
      'w:themeColor': props.color.themeColor,
      'w:themeShade': props.color.themeShade,
      'w:themeTint': props.color.themeTint,
    }));
  }
  if (props.spacing !== undefined) push(el('w:spacing', { 'w:val': props.spacing }));
  if (props.position !== undefined) push(el('w:position', { 'w:val': props.position }));
  if (props.size !== undefined) push(el('w:sz', { 'w:val': props.size }));
  if (props.highlight) push(el('w:highlight', { 'w:val': props.highlight }));
  if (props.underline) push(el('w:u', { 'w:val': props.underline, 'w:color': props.underlineColor }));
  if (props.shading) push(buildShading(props.shading));
  if (props.vertAlign) push(el('w:vertAlign', { 'w:val': props.vertAlign }));
  const all = [...kids, ...raw, ...extra];
  if (!all.length) return null;
  return sortChildren(el(name, {}, all));
}

export function mergeRunProps(base: RunProps, over: RunProps | undefined): RunProps {
  if (!over) return base;
  const out: RunProps = { ...base };
  for (const [k, v] of Object.entries(over) as [keyof RunProps, unknown][]) {
    if (v === undefined) continue;
    if (k === 'fonts') out.fonts = { ...(base.fonts ?? {}), ...(v as RunProps['fonts']) };
    else (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Paragraph properties

const PARA_KNOWN = new Set([
  'w:pStyle', 'w:keepNext', 'w:keepLines', 'w:pageBreakBefore', 'w:widowControl', 'w:numPr',
  'w:pBdr', 'w:shd', 'w:tabs', 'w:spacing', 'w:ind', 'w:contextualSpacing', 'w:jc', 'w:outlineLvl',
  'w:bidi', 'w:rPr', 'w:sectPr', 'w:pPrChange',
]);

export interface ParsedParaProps {
  props: ParaProps;
  raw: XmlElement[];
  rPr?: XmlElement;
  sectPr?: XmlElement;
  change?: XmlElement;
}

export function parseSpacing(c: XmlElement): Spacing {
  const s: Spacing = {};
  const before = parseMeasure(attr(c, 'w:before'), 'twips');
  const after = parseMeasure(attr(c, 'w:after'), 'twips');
  const line = parseMeasure(attr(c, 'w:line'), 'twips');
  if (before !== undefined) s.before = before;
  if (after !== undefined) s.after = after;
  if (line !== undefined) s.line = line;
  const rule = attr(c, 'w:lineRule');
  if (rule === 'auto' || rule === 'exact' || rule === 'atLeast') s.lineRule = rule;
  if (attr(c, 'w:beforeAutospacing') !== undefined) s.beforeAutospacing = parseOnOff(attr(c, 'w:beforeAutospacing'));
  if (attr(c, 'w:afterAutospacing') !== undefined) s.afterAutospacing = parseOnOff(attr(c, 'w:afterAutospacing'));
  return s;
}

export function parseIndent(c: XmlElement): Indent {
  const ind: Indent = {};
  const left = parseMeasure(attr(c, 'w:left') ?? attr(c, 'w:start'), 'twips');
  const right = parseMeasure(attr(c, 'w:right') ?? attr(c, 'w:end'), 'twips');
  const firstLine = parseMeasure(attr(c, 'w:firstLine'), 'twips');
  const hanging = parseMeasure(attr(c, 'w:hanging'), 'twips');
  if (left !== undefined) ind.left = left;
  if (right !== undefined) ind.right = right;
  if (firstLine !== undefined) ind.firstLine = firstLine;
  if (hanging !== undefined) ind.hanging = hanging;
  return ind;
}

export function parseTabs(c: XmlElement): TabStop[] {
  return elements(c)
    .filter((t) => t.name === 'w:tab')
    .map((t) => ({
      pos: parseMeasure(attr(t, 'w:pos'), 'twips') ?? 0,
      val: attr(t, 'w:val') ?? 'left',
      leader: attr(t, 'w:leader'),
    }));
}

export function parseParaProps(pPr: XmlElement | undefined): ParsedParaProps {
  const props: ParaProps = {};
  const raw: XmlElement[] = [];
  const out: ParsedParaProps = { props, raw };
  if (!pPr) return out;
  for (const c of elements(pPr)) {
    switch (c.name) {
      case 'w:pStyle': props.styleId = attr(c, 'w:val'); break;
      case 'w:keepNext': props.keepNext = onOff(c); break;
      case 'w:keepLines': props.keepLines = onOff(c); break;
      case 'w:pageBreakBefore': props.pageBreakBefore = onOff(c); break;
      case 'w:widowControl': props.widowControl = onOff(c); break;
      case 'w:contextualSpacing': props.contextualSpacing = onOff(c); break;
      case 'w:bidi': props.bidi = onOff(c); break;
      case 'w:numPr': {
        const numId = attr(child(c, 'w:numId'), 'w:val');
        const ilvl = parseIntSafe(attr(child(c, 'w:ilvl'), 'w:val')) ?? 0;
        if (numId !== undefined) props.numPr = { numId, ilvl };
        else if (child(c, 'w:ilvl')) props.numPr = { numId: '', ilvl };
        break;
      }
      case 'w:pBdr': props.borders = parseBorders(c); break;
      case 'w:shd': {
        const fill = parseShading(c);
        if (fill) props.shading = fill;
        break;
      }
      case 'w:tabs': props.tabs = parseTabs(c); break;
      case 'w:spacing': props.spacing = parseSpacing(c); break;
      case 'w:ind': props.indent = parseIndent(c); break;
      case 'w:jc': props.align = attr(c, 'w:val'); break;
      case 'w:outlineLvl': props.outlineLvl = parseIntSafe(attr(c, 'w:val')); break;
      case 'w:rPr': out.rPr = c; break;
      case 'w:sectPr': out.sectPr = c; break;
      case 'w:pPrChange': out.change = c; break;
      default:
        if (!PARA_KNOWN.has(c.name)) raw.push(c);
    }
  }
  return out;
}

export function buildSpacing(s: Spacing): XmlElement {
  return el('w:spacing', {
    'w:before': s.before,
    'w:beforeAutospacing': s.beforeAutospacing === undefined ? undefined : s.beforeAutospacing ? '1' : '0',
    'w:after': s.after,
    'w:afterAutospacing': s.afterAutospacing === undefined ? undefined : s.afterAutospacing ? '1' : '0',
    'w:line': s.line,
    'w:lineRule': s.line !== undefined ? s.lineRule ?? 'auto' : undefined,
  });
}

export function buildIndent(ind: Indent): XmlElement {
  return el('w:ind', {
    'w:left': ind.left,
    'w:right': ind.right,
    'w:firstLine': ind.hanging === undefined ? ind.firstLine : undefined,
    'w:hanging': ind.hanging,
  });
}

export function buildParaProps(props: ParaProps, raw: XmlElement[] = [], extra: XmlElement[] = []): XmlElement | null {
  const kids: XmlElement[] = [];
  if (props.styleId) kids.push(el('w:pStyle', { 'w:val': props.styleId }));
  const flag = (name: string, v: boolean | undefined) => {
    if (v !== undefined) kids.push(v ? el(name) : el(name, { 'w:val': '0' }));
  };
  flag('w:keepNext', props.keepNext);
  flag('w:keepLines', props.keepLines);
  flag('w:pageBreakBefore', props.pageBreakBefore);
  flag('w:widowControl', props.widowControl);
  if (props.numPr) {
    // An empty numId means "level only" (the list itself comes from the paragraph style).
    kids.push(el('w:numPr', {}, [
      el('w:ilvl', { 'w:val': props.numPr.ilvl }),
      props.numPr.numId ? el('w:numId', { 'w:val': props.numPr.numId }) : null,
    ]));
  }
  if (props.borders && Object.keys(props.borders).length) kids.push(buildBorders('w:pBdr', props.borders));
  if (props.shading) kids.push(buildShading(props.shading));
  if (props.tabs && props.tabs.length) {
    kids.push(el('w:tabs', {}, props.tabs.map((t) => el('w:tab', { 'w:val': t.val, 'w:leader': t.leader, 'w:pos': t.pos }))));
  }
  flag('w:bidi', props.bidi);
  if (props.spacing && Object.keys(props.spacing).length) kids.push(buildSpacing(props.spacing));
  if (props.indent && Object.keys(props.indent).length) kids.push(buildIndent(props.indent));
  flag('w:contextualSpacing', props.contextualSpacing);
  if (props.align) kids.push(el('w:jc', { 'w:val': props.align }));
  if (props.outlineLvl !== undefined) kids.push(el('w:outlineLvl', { 'w:val': props.outlineLvl }));
  const all = [...kids, ...raw, ...extra];
  if (!all.length) return null;
  return sortChildren(el('w:pPr', {}, all));
}

export function mergeParaProps(base: ParaProps, over: ParaProps | undefined): ParaProps {
  if (!over) return base;
  const out: ParaProps = { ...base };
  for (const [k, v] of Object.entries(over) as [keyof ParaProps, unknown][]) {
    if (v === undefined) continue;
    if (k === 'spacing') out.spacing = { ...(base.spacing ?? {}), ...(v as Spacing) };
    else if (k === 'indent') {
      const ind = { ...(base.indent ?? {}), ...(v as Indent) };
      // firstLine and hanging are mutually exclusive.
      if ((v as Indent).firstLine !== undefined && (v as Indent).hanging === undefined) delete ind.hanging;
      if ((v as Indent).hanging !== undefined && (v as Indent).firstLine === undefined) delete ind.firstLine;
      out.indent = ind;
    } else if (k === 'borders') out.borders = { ...(base.borders ?? {}), ...(v as BoxBorders) };
    else if (k === 'tabs') out.tabs = mergeTabs(base.tabs, v as TabStop[]);
    else (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

function mergeTabs(base: TabStop[] | undefined, over: TabStop[]): TabStop[] {
  const map = new Map<number, TabStop>();
  for (const t of base ?? []) map.set(t.pos, t);
  for (const t of over) {
    if (t.val === 'clear') map.delete(t.pos);
    else map.set(t.pos, t);
  }
  return [...map.values()].sort((a, b) => a.pos - b.pos);
}

// ---------------------------------------------------------------------------------------------
// Section properties

const SECTION_KNOWN = new Set([
  'w:headerReference', 'w:footerReference', 'w:type', 'w:pgSz', 'w:pgMar', 'w:cols', 'w:titlePg',
  'w:pgNumType', 'w:vAlign',
]);

export function parseSection(sectPr: XmlElement | undefined, resolveRel: (rId: string) => string | undefined, serialize: (e: XmlElement[]) => string): SectionProps {
  const sp = defaultSection();
  if (!sectPr) return sp;
  const raw: XmlElement[] = [];
  const pgNumRaw: Record<string, string> = {};
  for (const c of elements(sectPr)) {
    switch (c.name) {
      case 'w:headerReference':
      case 'w:footerReference': {
        const type = (attr(c, 'w:type') ?? 'default') as HeaderFooterType;
        const path = resolveRel(attr(c, 'r:id') ?? '');
        if (path && (type === 'default' || type === 'first' || type === 'even')) {
          (c.name === 'w:headerReference' ? sp.headers : sp.footers)[type] = path;
        }
        break;
      }
      case 'w:type': sp.type = (attr(c, 'w:val') ?? 'nextPage') as SectionType; break;
      case 'w:pgSz': {
        sp.pageWidth = parseMeasure(attr(c, 'w:w'), 'twips') ?? sp.pageWidth;
        sp.pageHeight = parseMeasure(attr(c, 'w:h'), 'twips') ?? sp.pageHeight;
        const orient = attr(c, 'w:orient');
        sp.orient = orient === 'landscape' || orient === 'portrait' ? orient : null;
        break;
      }
      case 'w:pgMar': {
        const m = sp.margins;
        for (const k of ['top', 'right', 'bottom', 'left', 'header', 'footer', 'gutter'] as const) {
          const v = parseMeasure(attr(c, `w:${k}`) ?? (k === 'left' ? attr(c, 'w:start') : k === 'right' ? attr(c, 'w:end') : undefined), 'twips');
          if (v !== undefined) m[k] = v;
        }
        break;
      }
      case 'w:cols': {
        const cols: ColumnsSpec = {
          num: parseIntSafe(attr(c, 'w:num')) ?? 1,
          space: parseMeasure(attr(c, 'w:space'), 'twips') ?? 720,
          equalWidth: attr(c, 'w:equalWidth') === undefined ? true : parseOnOff(attr(c, 'w:equalWidth')),
          sep: attr(c, 'w:sep') === undefined ? false : parseOnOff(attr(c, 'w:sep')),
          cols: elements(c)
            .filter((x) => x.name === 'w:col')
            .map((x) => ({ w: parseMeasure(attr(x, 'w:w'), 'twips') ?? 0, space: parseMeasure(attr(x, 'w:space'), 'twips') ?? 0 })),
        };
        if (!cols.equalWidth && cols.cols.length) cols.num = cols.cols.length;
        sp.cols = cols;
        break;
      }
      case 'w:titlePg': sp.titlePg = onOff(c); break;
      case 'w:pgNumType': {
        sp.pgNumStart = parseIntSafe(attr(c, 'w:start')) ?? null;
        sp.pgNumFmt = attr(c, 'w:fmt') ?? null;
        for (const [k, v] of Object.entries(c.attrs)) if (k !== 'w:start' && k !== 'w:fmt') pgNumRaw[k] = v;
        break;
      }
      case 'w:vAlign': sp.vAlign = attr(c, 'w:val') ?? null; break;
      default:
        if (!SECTION_KNOWN.has(c.name)) raw.push(c);
    }
  }
  if (Object.keys(pgNumRaw).length) raw.push(el('w:pgNumType', pgNumRaw));
  sp.raw = raw.length ? serialize(raw) : null;
  return sp;
}

export function buildSection(sp: SectionProps, relIdFor: (path: string, kind: 'header' | 'footer') => string, rawChildren: XmlElement[]): XmlElement {
  const kids: XmlElement[] = [];
  for (const type of ['default', 'first', 'even'] as const) {
    const p = sp.headers[type];
    if (p) kids.push(el('w:headerReference', { 'w:type': type, 'r:id': relIdFor(p, 'header') }));
  }
  for (const type of ['default', 'first', 'even'] as const) {
    const p = sp.footers[type];
    if (p) kids.push(el('w:footerReference', { 'w:type': type, 'r:id': relIdFor(p, 'footer') }));
  }
  if (sp.type) kids.push(el('w:type', { 'w:val': sp.type }));
  kids.push(el('w:pgSz', { 'w:w': sp.pageWidth, 'w:h': sp.pageHeight, 'w:orient': sp.orient ?? undefined }));
  const m = sp.margins;
  kids.push(el('w:pgMar', {
    'w:top': m.top, 'w:right': m.right, 'w:bottom': m.bottom, 'w:left': m.left,
    'w:header': m.header, 'w:footer': m.footer, 'w:gutter': m.gutter,
  }));
  const pgNumExtra = rawChildren.find((r) => r.name === 'w:pgNumType');
  if (sp.pgNumStart !== null || sp.pgNumFmt !== null || pgNumExtra) {
    kids.push(el('w:pgNumType', { ...(pgNumExtra?.attrs ?? {}), 'w:fmt': sp.pgNumFmt ?? undefined, 'w:start': sp.pgNumStart ?? undefined }));
  }
  const c = sp.cols;
  if (c.num > 1 || !c.equalWidth) {
    kids.push(el('w:cols', {
      'w:num': c.num,
      'w:space': c.equalWidth ? c.space : undefined,
      'w:sep': c.sep ? '1' : undefined,
      'w:equalWidth': c.equalWidth ? undefined : '0',
    }, c.equalWidth ? [] : c.cols.map((col) => el('w:col', { 'w:w': col.w, 'w:space': col.space || undefined }))));
  } else {
    kids.push(el('w:cols', { 'w:space': c.space }));
  }
  if (sp.vAlign) kids.push(el('w:vAlign', { 'w:val': sp.vAlign }));
  if (sp.titlePg) kids.push(el('w:titlePg'));
  for (const r of rawChildren) if (r.name !== 'w:pgNumType') kids.push(r);
  return sortChildren(el('w:sectPr', {}, kids));
}
