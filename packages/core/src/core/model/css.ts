import { twipsToPt } from '../ooxml/units';
import type { BorderSpec, BoxBorders, Indent, RunProps, Spacing } from './types';
import { HIGHLIGHT_COLORS } from './types';

/** Metric-compatible open fonts bundled with the app, used when Office fonts are not installed. */
const FONT_FALLBACKS: Record<string, string[]> = {
  calibri: ['Carlito'],
  'calibri light': ['Carlito'],
  cambria: ['Caladea'],
  'cambria math': ['Caladea'],
  'times new roman': ['Tinos', 'Liberation Serif', 'Times'],
  times: ['Tinos'],
  arial: ['Arimo', 'Liberation Sans', 'Helvetica'],
  helvetica: ['Arimo', 'Arial'],
  'courier new': ['Cousine', 'Liberation Mono', 'Courier'],
  courier: ['Cousine'],
  aptos: ['Carlito'],
  'aptos display': ['Carlito'],
  'aptos narrow': ['Arimo'],
  'segoe ui': ['system-ui'],
  verdana: ['DejaVu Sans'],
  georgia: ['Tinos'],
  garamond: ['Tinos'],
  'book antiqua': ['Tinos'],
  tahoma: ['DejaVu Sans', 'Arimo'],
  'trebuchet ms': ['Arimo'],
  consolas: ['Cousine'],
  'lucida console': ['Cousine'],
};

const SERIF_HINT = /serif|roman|times|georgia|garamond|cambria|caladea|book|minion|palatino|baskerville|century|bookman|tinos/i;
const MONO_HINT = /mono|courier|consolas|console|code|cousine/i;

function quoteFont(name: string): string {
  return /^[a-zA-Z-]+$/.test(name) && !['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui'].includes(name)
    ? name
    : name === 'serif' || name === 'sans-serif' || name === 'monospace' || name === 'system-ui'
      ? name
      : `"${name.replace(/"/g, '')}"`;
}

/** A CSS font-family stack for a Word font name. */
export function fontStack(name: string | undefined): string {
  if (!name) return 'inherit';
  const fallbacks = FONT_FALLBACKS[name.toLowerCase()] ?? [];
  const generic = MONO_HINT.test(name) ? 'monospace' : SERIF_HINT.test(name) ? 'serif' : 'sans-serif';
  return [name, ...fallbacks, generic].map(quoteFont).join(', ');
}

/** Approximate "single" line height of a font as a multiple of the font size (ascent+descent+gap). */
export function lineHeightFactor(font: string | undefined): number {
  const f = (font ?? '').toLowerCase();
  if (f.startsWith('calibri') || f.startsWith('carlito')) return 1.22;
  if (f.startsWith('aptos')) return 1.2;
  if (f.startsWith('cambria') || f.startsWith('caladea')) return 1.172;
  if (f.includes('times') || f.startsWith('tinos')) return 1.15;
  if (f.startsWith('arial') || f.startsWith('arimo') || f.startsWith('helvetica')) return 1.15;
  if (f.includes('courier') || f.startsWith('cousine')) return 1.133;
  if (f.startsWith('georgia')) return 1.136;
  if (f.startsWith('verdana')) return 1.215;
  if (f.startsWith('segoe')) return 1.33;
  return 1.17;
}

export function hexColor(val: string | undefined): string | undefined {
  if (!val || val === 'auto') return undefined;
  if (/^[0-9a-fA-F]{6}$/.test(val)) return `#${val.toUpperCase()}`;
  return undefined;
}

export function highlightCss(name: string | undefined): string | undefined {
  if (!name || name === 'none') return undefined;
  const hex = HIGHLIGHT_COLORS[name];
  return hex ? `#${hex}` : undefined;
}

const BORDER_STYLES: Record<string, string> = {
  single: 'solid',
  thick: 'solid',
  double: 'double',
  dotted: 'dotted',
  dashed: 'dashed',
  dotDash: 'dashed',
  dotDotDash: 'dashed',
  triple: 'double',
  thinThickSmallGap: 'double',
  thickThinSmallGap: 'double',
  wave: 'solid',
  doubleWave: 'double',
  dashSmallGap: 'dashed',
  outset: 'outset',
  inset: 'inset',
  threeDEmboss: 'ridge',
  threeDEngrave: 'groove',
};

export function borderCss(b: BorderSpec | undefined): string | undefined {
  if (!b) return undefined;
  if (b.val === 'nil' || b.val === 'none') return 'none';
  const width = Math.max(0.5, (b.sz ?? 4) / 8);
  const style = BORDER_STYLES[b.val] ?? 'solid';
  const color = hexColor(b.color) ?? '#000';
  return `${style === 'double' ? Math.max(width, 2.5) : width}pt ${style} ${color}`;
}

export function underlineCss(val: string | undefined): string | undefined {
  if (!val || val === 'none') return undefined;
  switch (val) {
    case 'double': return 'underline double';
    case 'dotted':
    case 'dottedHeavy': return 'underline dotted';
    case 'dash':
    case 'dashedHeavy':
    case 'dashLong':
    case 'dashLongHeavy':
    case 'dotDash':
    case 'dotDotDash': return 'underline dashed';
    case 'wave':
    case 'wavyHeavy':
    case 'wavyDouble': return 'underline wavy';
    default: return 'underline';
  }
}

/** Resolve a run's display font name (ascii/hAnsi or theme font). */
export function runFontName(props: RunProps, themeFonts?: { major?: string; minor?: string }): string | undefined {
  const f = props.fonts;
  if (!f) return undefined;
  const direct = f.ascii ?? f.hAnsi;
  if (direct) return direct;
  const theme = f.asciiTheme ?? f.hAnsiTheme;
  if (theme && themeFonts) return theme.startsWith('major') ? themeFonts.major : themeFonts.minor;
  return undefined;
}

/** CSS declarations for run properties (used for style classes and direct formatting). */
export function runPropsCss(props: RunProps, themeFonts?: { major?: string; minor?: string }): string[] {
  const css: string[] = [];
  const font = runFontName(props, themeFonts);
  if (font) css.push(`font-family: ${fontStack(font)}`, `--ml-dx-lhf: ${lineHeightFactor(font)}`);
  if (props.size !== undefined) css.push(`font-size: ${props.size / 2}pt`);
  if (props.bold !== undefined) css.push(`font-weight: ${props.bold ? 'bold' : 'normal'}`);
  if (props.italic !== undefined) css.push(`font-style: ${props.italic ? 'italic' : 'normal'}`);
  if (props.color) {
    const c = hexColor(props.color.val);
    css.push(`color: ${c ?? '#000000'}`);
  }
  if (props.caps !== undefined) css.push(`text-transform: ${props.caps ? 'uppercase' : 'none'}`);
  if (props.smallCaps !== undefined) css.push(`font-variant: ${props.smallCaps ? 'small-caps' : 'normal'}`);
  const deco: string[] = [];
  const u = underlineCss(props.underline);
  if (u) deco.push(u);
  if (props.strike || props.dstrike) deco.push(props.dstrike ? 'line-through double' : 'line-through');
  if (deco.length) css.push(`text-decoration: ${deco.join(' ')}`);
  if (props.underlineColor) css.push(`text-decoration-color: ${hexColor(props.underlineColor) ?? 'currentColor'}`);
  const hl = highlightCss(props.highlight) ?? hexColor(props.shading);
  if (hl) css.push(`background-color: ${hl}`);
  if (props.spacing) css.push(`letter-spacing: ${twipsToPt(props.spacing)}pt`);
  if (props.vertAlign === 'superscript') css.push('vertical-align: super', 'font-size: 0.65em');
  if (props.vertAlign === 'subscript') css.push('vertical-align: sub', 'font-size: 0.65em');
  if (props.position) css.push('position: relative', `top: ${-props.position / 2}pt`);
  if (props.vanish) css.push('display: none');
  return css;
}

export function alignCss(align: string | undefined | null): string | undefined {
  switch (align) {
    case 'left':
    case 'start': return 'left';
    case 'right':
    case 'end': return 'right';
    case 'center': return 'center';
    case 'both':
    case 'distribute':
    case 'thaiDistribute':
    case 'lowKashida':
    case 'mediumKashida':
    case 'highKashida': return 'justify';
    default: return undefined;
  }
}

export function indentCss(ind: Indent | undefined | null): string[] {
  if (!ind) return [];
  const css: string[] = [];
  if (ind.left !== undefined) css.push(`padding-left: ${twipsToPt(ind.left)}pt`);
  if (ind.right !== undefined) css.push(`padding-right: ${twipsToPt(ind.right)}pt`);
  if (ind.hanging !== undefined) css.push(`text-indent: ${-twipsToPt(ind.hanging)}pt`, `--ml-dx-hanging: ${twipsToPt(ind.hanging)}pt`);
  else if (ind.firstLine !== undefined) css.push(`text-indent: ${twipsToPt(ind.firstLine)}pt`, '--ml-dx-hanging: 0pt');
  return css;
}

/**
 * Space before and after a paragraph, as custom properties: the `.ml-dx-p` rule turns them into
 * padding (Word adds the two, it does not collapse them), or into margin on a side that has a
 * border or shading, which Word draws inside the spacing.
 */
export function spacingCss(sp: Spacing | undefined | null): string[] {
  if (!sp) return [];
  const css: string[] = [];
  if (sp.beforeAutospacing) css.push('--ml-dx-sb: 14pt');
  else if (sp.before !== undefined) css.push(`--ml-dx-sb: ${twipsToPt(sp.before)}pt`);
  if (sp.afterAutospacing) css.push('--ml-dx-sa: 14pt');
  else if (sp.after !== undefined) css.push(`--ml-dx-sa: ${twipsToPt(sp.after)}pt`);
  if (sp.line !== undefined) {
    const rule = sp.lineRule ?? 'auto';
    if (rule === 'auto') css.push(`--ml-dx-lm: ${Math.round((sp.line / 240) * 1000) / 1000}`, 'line-height: calc(var(--ml-dx-lm) * var(--ml-dx-lhf, 1.17))');
    else if (rule === 'exact') css.push(`line-height: ${twipsToPt(sp.line)}pt`);
    else css.push(`line-height: max(${twipsToPt(sp.line)}pt, calc(var(--ml-dx-lhf, 1.17) * 1em))`);
  }
  return css;
}

export function bordersCss(b: BoxBorders | undefined | null): string[] {
  if (!b) return [];
  const css: string[] = [];
  for (const side of ['top', 'left', 'bottom', 'right'] as const) {
    const v = borderCss(b[side]);
    if (v) {
      css.push(`border-${side}: ${v}`);
      const space = b[side]?.space;
      if (space && (side === 'left' || side === 'right')) css.push(`padding-${side}: ${space}pt`);
      // Top and bottom: the spacing goes outside the border, the border's own space inside.
      if (side === 'top') css.push('--ml-dx-ob: 1', `--ml-dx-bts: ${space ?? 0}pt`);
      if (side === 'bottom') css.push('--ml-dx-oa: 1', `--ml-dx-bbs: ${space ?? 0}pt`);
    }
  }
  return css;
}

/** Paragraph shading: the spacing before and after stays unshaded. */
export function shadingCss(fill: string | null | undefined): string[] {
  return fill ? [`background-color: #${fill}`, '--ml-dx-ob: 1', '--ml-dx-oa: 1'] : [];
}

export function cssIdent(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, (ch) => `_${ch.charCodeAt(0).toString(16)}`);
}

/** Parse a CSS colour (hex, rgb()) to RRGGBB. */
export function cssColorToHex(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  if (v === 'transparent' || v === 'inherit' || v === 'initial' || v === 'currentcolor') return undefined;
  let m = /^#([0-9a-f]{6})$/.exec(v);
  if (m) return m[1].toUpperCase();
  m = /^#([0-9a-f]{3})$/.exec(v);
  if (m) return m[1].split('').map((c) => c + c).join('').toUpperCase();
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(v);
  if (m) {
    if (m[4] !== undefined && parseFloat(m[4]) === 0) return undefined;
    return [m[1], m[2], m[3]].map((n) => Math.min(255, parseInt(n, 10)).toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  const named: Record<string, string> = {
    black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00',
    gray: '808080', grey: '808080', orange: 'FFA500', purple: '800080', navy: '000080', teal: '008080',
  };
  return named[v];
}

/** Parse a CSS length to points. */
export function cssLengthToPt(value: string | null | undefined, basePt = 12): number | undefined {
  if (!value) return undefined;
  const m = /^(-?[\d.]+)(pt|px|em|rem|%|in|cm|mm)?$/.exec(value.trim());
  if (!m) {
    const keywords: Record<string, number> = { 'xx-small': 7, 'x-small': 7.5, small: 10, medium: 12, large: 13.5, 'x-large': 18, 'xx-large': 24 };
    return keywords[value.trim()];
  }
  const n = parseFloat(m[1]);
  switch (m[2]) {
    case 'px': return n * 0.75;
    case 'em':
    case 'rem': return n * basePt;
    case '%': return (n / 100) * basePt;
    case 'in': return n * 72;
    case 'cm': return (n / 2.54) * 72;
    case 'mm': return (n / 25.4) * 72;
    default: return n;
  }
}
