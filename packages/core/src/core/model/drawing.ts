/**
 * Drawings other than plain pictures: shapes (wps), groups of shapes and pictures (wpg) and
 * drawing canvases (wpc). The importer reads one into a DrawingModel: its parts in drawing
 * order with their boxes in px, outlines (preset or custom geometry), fills and outlines with
 * the theme colours resolved, pictures, and the paragraphs of text boxes as editor content.
 * The editor draws the model and does not change it; export writes the original XML back.
 */
import { DOMSerializer, Fragment, type Schema } from 'prosemirror-model';
import { attr, child, elements, findFirst, type XmlElement } from '../xml/xml';
import type { AnchorInfo } from './types';

const EMU_PER_PX = 9525;

/** A colour (#RRGGBB) with an opacity from 0 to 1. */
export interface Paint {
  color: string;
  opacity: number;
}

export interface GradientStop {
  offset: number;
  color: string;
  opacity: number;
}

export type DrawingFill =
  | { kind: 'solid'; paint: Paint }
  | { kind: 'linear'; stops: GradientStop[]; angle: number }
  | { kind: 'radial'; stops: GradientStop[] }
  | { kind: 'picture'; src: string; mediaPath: string | null };

export interface LineEnd {
  /** triangle, stealth, diamond, oval or arrow. */
  type: string;
  /** Width and length: sm, med or lg. */
  w: string;
  len: string;
}

export interface DrawingLine {
  paint: Paint;
  /** Width in px. */
  width: number;
  /** Dash and gap lengths in px; none for a solid line. */
  dash?: number[];
  cap: 'butt' | 'round' | 'square';
  join: 'miter' | 'round' | 'bevel';
  head?: LineEnd;
  tail?: LineEnd;
}

export interface DrawingText {
  /** The paragraphs, as editor content (JSON of block nodes). */
  content: unknown[];
  /** Space between the shape and its text in px: left, top, right, bottom. */
  insets: [number, number, number, number];
  anchor: 'top' | 'middle' | 'bottom';
  vertical: 'horz' | 'vert' | 'vert270';
  wrap: boolean;
  /** Text colour given by the shape's style, used where the text sets none. */
  color?: string;
}

/** A part's box in px, in the coordinates of the group (or drawing) that holds it. */
export interface PartBox {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Clockwise rotation in degrees. */
  rot: number;
  flipH: boolean;
  flipV: boolean;
}

/** Outline of a shape: a preset with its adjust values, or custom paths. */
export type Geometry = { preset: string; adjust: Record<string, number> } | { paths: CustomPath[] };

/** One path of a custom outline, in its own coordinate space (w × h) scaled to the shape box. */
export interface CustomPath {
  w: number;
  h: number;
  fill: boolean;
  stroke: boolean;
  /** M/L x y, C x1 y1 x2 y2 x y, Q x1 y1 x y, A wR hR startAngle swingAngle (degrees), Z. */
  commands: (string | number)[][];
}

export interface ShapePart extends PartBox {
  kind: 'shape';
  geometry: Geometry;
  fill: DrawingFill | null;
  line: DrawingLine | null;
  text?: DrawingText;
}

export interface PicturePart extends PartBox {
  kind: 'picture';
  src: string;
  mediaPath: string | null;
  /** Fractions cut from the left, top, right and bottom of the picture. */
  crop?: [number, number, number, number];
  opacity: number;
  line: DrawingLine | null;
}

export interface GroupPart extends PartBox {
  kind: 'group';
  parts: DrawingPart[];
}

export type DrawingPart = ShapePart | PicturePart | GroupPart;

export interface DrawingModel {
  /** Size in px. */
  width: number;
  height: number;
  parts: DrawingPart[];
  /** Floating placement, or null when the drawing sits in the line. */
  anchor: AnchorInfo | null;
}

// ------------------------------------------------------------------------------------------------
// Colours

/** Colours and line widths of the document theme that drawings refer to. */
export interface DrawingTheme {
  /** Scheme colours (dk1, lt1, accent1…, plus tx1, bg1, tx2 and bg2 as the document maps them). */
  colors: Record<string, string>;
  /** Widths of the theme's line styles in EMU (a:lnStyleLst), for shape style references. */
  lineWidths: number[];
}

const DEFAULT_COLORS: Record<string, string> = {
  dk1: '000000', lt1: 'FFFFFF', dk2: '44546A', lt2: 'E7E6E6', accent1: '4472C4', accent2: 'ED7D31',
  accent3: 'A5A5A5', accent4: 'FFC000', accent5: '5B9BD5', accent6: '70AD47', hlink: '0563C1', folHlink: '954F72',
};

const PRESET_COLORS: Record<string, string> = {
  black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00',
  cyan: '00FFFF', aqua: '00FFFF', magenta: 'FF00FF', fuchsia: 'FF00FF', gray: '808080', grey: '808080',
  silver: 'C0C0C0', maroon: '800000', olive: '808000', lime: '00FF00', teal: '008080', navy: '000080',
  purple: '800080', orange: 'FFA500', brown: 'A52A2A', pink: 'FFC0CB', gold: 'FFD700', darkGray: 'A9A9A9',
  darkGrey: 'A9A9A9', dkGray: 'A9A9A9', lightGray: 'D3D3D3', lightGrey: 'D3D3D3', ltGray: 'D3D3D3',
  darkRed: '8B0000', dkRed: '8B0000', darkBlue: '00008B', dkBlue: '00008B', darkGreen: '006400', dkGreen: '006400',
  lightBlue: 'ADD8E6', ltBlue: 'ADD8E6', lightGreen: '90EE90', ltGreen: '90EE90', lightYellow: 'FFFFE0',
  ltYellow: 'FFFFE0', darkOrange: 'FF8C00', dkOrange: 'FF8C00', violet: 'EE82EE', indigo: '4B0082',
};

const SYSTEM_COLORS: Record<string, string> = { windowText: '000000', window: 'FFFFFF', btnFace: 'F0F0F0', btnText: '000000', highlight: '0078D7', highlightText: 'FFFFFF', grayText: '6D6D6D' };

const MAPPED_NAMES: Record<string, string> = { light1: 'lt1', dark1: 'dk1', light2: 'lt2', dark2: 'dk2', hyperlink: 'hlink', followedHyperlink: 'folHlink' };

/** Theme colours for drawings, with the document's colour mapping (w:clrSchemeMapping) applied. */
export function drawingTheme(colors: Record<string, string>, lineWidths: number[] = [], mapping?: XmlElement): DrawingTheme {
  const out: Record<string, string> = { ...DEFAULT_COLORS, ...colors };
  const pick = (key: string, fallback: string) => {
    const v = attr(mapping, `w:${key}`);
    return out[(v && (MAPPED_NAMES[v] ?? v)) || fallback] ?? out[fallback];
  };
  const mapped = { bg1: pick('bg1', 'lt1'), tx1: pick('t1', 'dk1'), bg2: pick('bg2', 'lt2'), tx2: pick('t2', 'dk2') };
  return { colors: { ...out, ...mapped }, lineWidths };
}

type RGB = [number, number, number];

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function hexToRgb(hex: string | undefined): RGB {
  const v = /^[0-9a-f]{6}$/i.test(hex ?? '') ? parseInt(hex!, 16) : 0;
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

function rgbToHex(rgb: RGB): string {
  return `#${rgb.map((c) => Math.round(clamp01(c) * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

function rgbToHsl([r, g, b]: RGB): RGB {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h /= 6;
  return [h, s, l];
}

function hslToRgb([h, s, l]: RGB): RGB {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number) => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (u < 1 / 6) return p + (q - p) * 6 * u;
    if (u < 1 / 2) return q;
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
    return p;
  };
  return [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)];
}

const COLOR_ELEMENTS = new Set(['a:srgbClr', 'a:schemeClr', 'a:prstClr', 'a:sysClr', 'a:scrgbClr', 'a:hslClr']);

/** The colour element inside a fill, a gradient stop or a style reference. */
function colorChild(e: XmlElement | undefined): XmlElement | undefined {
  return elements(e).find((c) => COLOR_ELEMENTS.has(c.name));
}

/**
 * A DrawingML colour with its modifiers applied. Tint and shade work on linear RGB, the
 * luminance and saturation modifiers on HSL, as Office does. `placeholder` stands for phClr.
 */
export function resolveColor(c: XmlElement | undefined, theme: DrawingTheme, placeholder?: Paint | null): Paint | null {
  if (!c) return null;
  let rgb: RGB;
  let opacity = 1;
  const num = (e: XmlElement, name: string) => Number(attr(e, name) ?? 0);
  switch (c.name) {
    case 'a:srgbClr':
      rgb = hexToRgb(attr(c, 'val'));
      break;
    case 'a:schemeClr': {
      const v = attr(c, 'val') ?? '';
      if (v === 'phClr') {
        if (!placeholder) return null;
        rgb = hexToRgb(placeholder.color.slice(1));
        opacity = placeholder.opacity;
      } else rgb = hexToRgb(theme.colors[v] ?? DEFAULT_COLORS[v] ?? '000000');
      break;
    }
    case 'a:prstClr':
      rgb = hexToRgb(PRESET_COLORS[attr(c, 'val') ?? ''] ?? '000000');
      break;
    case 'a:sysClr':
      rgb = hexToRgb(attr(c, 'lastClr') ?? SYSTEM_COLORS[attr(c, 'val') ?? ''] ?? '000000');
      break;
    case 'a:scrgbClr':
      rgb = [num(c, 'r'), num(c, 'g'), num(c, 'b')].map((v) => fromLinear(clamp01(v / 100000))) as RGB;
      break;
    case 'a:hslClr':
      rgb = hslToRgb([num(c, 'hue') / 60000 / 360, num(c, 'sat') / 100000, num(c, 'lum') / 100000]);
      break;
    default:
      return null;
  }
  for (const m of elements(c)) {
    const v = num(m, 'val') / 100000;
    const hsl = () => rgbToHsl(rgb);
    switch (m.name) {
      case 'a:alpha': opacity = clamp01(v); break;
      case 'a:alphaMod': opacity = clamp01(opacity * v); break;
      case 'a:alphaOff': opacity = clamp01(opacity + v); break;
      case 'a:tint': rgb = rgb.map((ch) => fromLinear(1 - (1 - toLinear(ch)) * v)) as RGB; break;
      case 'a:shade': rgb = rgb.map((ch) => fromLinear(toLinear(ch) * v)) as RGB; break;
      case 'a:lumMod': { const [h, s, l] = hsl(); rgb = hslToRgb([h, s, clamp01(l * v)]); break; }
      case 'a:lumOff': { const [h, s, l] = hsl(); rgb = hslToRgb([h, s, clamp01(l + v)]); break; }
      case 'a:lum': { const [h, s] = hsl(); rgb = hslToRgb([h, s, clamp01(v)]); break; }
      case 'a:satMod': { const [h, s, l] = hsl(); rgb = hslToRgb([h, clamp01(s * v), l]); break; }
      case 'a:satOff': { const [h, s, l] = hsl(); rgb = hslToRgb([h, clamp01(s + v), l]); break; }
      case 'a:sat': { const [h, , l] = hsl(); rgb = hslToRgb([h, clamp01(v), l]); break; }
      case 'a:hueMod': { const [h, s, l] = hsl(); rgb = hslToRgb([(((h * v) % 1) + 1) % 1, s, l]); break; }
      case 'a:hueOff': { const [h, s, l] = hsl(); rgb = hslToRgb([(((h + num(m, 'val') / 60000 / 360) % 1) + 1) % 1, s, l]); break; }
      case 'a:hue': { const [, s, l] = hsl(); rgb = hslToRgb([((num(m, 'val') / 60000 / 360) % 1 + 1) % 1, s, l]); break; }
      case 'a:gray': { const g = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]; rgb = [g, g, g]; break; }
      case 'a:inv': rgb = rgb.map((ch) => 1 - ch) as RGB; break;
      case 'a:comp': { const [h, s, l] = hsl(); rgb = hslToRgb([(h + 0.5) % 1, s, l]); break; }
    }
  }
  return { color: rgbToHex(rgb), opacity };
}

// ------------------------------------------------------------------------------------------------
// Reading

/** What reading a drawing needs from the import. */
export interface DrawingSource {
  theme: DrawingTheme;
  /** Package path and display URL of a picture referenced by relationship id. */
  media(rId: string | undefined): { path: string; url: string } | null;
  /** Editor content (block node JSON) for the paragraphs of a text box. */
  text(content: XmlElement): unknown[];
}

const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const WPG = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';
const WPC = 'http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas';

/** Whether a graphic (by its a:graphicData uri) is a shape, group or canvas that can be drawn. */
export function isDrawingUri(uri: string): boolean {
  return uri === WPS || uri === WPG || uri === WPC;
}

interface Xfrm {
  x: number;
  y: number;
  cx: number;
  cy: number;
  chX: number;
  chY: number;
  chCx: number;
  chCy: number;
  rot: number;
  flipH: boolean;
  flipV: boolean;
}

const onOff = (v: string | undefined) => v === '1' || v === 'true' || v === 'on';

function readXfrm(x: XmlElement | undefined): Xfrm {
  const n = (e: XmlElement | undefined, name: string) => Number(attr(e, name) ?? 0) || 0;
  const off = child(x, 'a:off');
  const ext = child(x, 'a:ext');
  const chOff = child(x, 'a:chOff');
  const chExt = child(x, 'a:chExt');
  return {
    x: n(off, 'x'),
    y: n(off, 'y'),
    cx: n(ext, 'cx'),
    cy: n(ext, 'cy'),
    chX: n(chOff, 'x'),
    chY: n(chOff, 'y'),
    chCx: chExt ? n(chExt, 'cx') : n(ext, 'cx'),
    chCy: chExt ? n(chExt, 'cy') : n(ext, 'cy'),
    rot: n(x, 'rot') / 60000,
    flipH: onOff(attr(x, 'flipH')),
    flipV: onOff(attr(x, 'flipV')),
  };
}

/** Maps EMU in a group's child space to px in the group's box. */
interface Space {
  ox: number;
  oy: number;
  sx: number;
  sy: number;
}

function childSpace(x: Xfrm, w: number, h: number): Space {
  return { ox: x.chX, oy: x.chY, sx: x.chCx > 0 ? w / x.chCx : 1 / EMU_PER_PX, sy: x.chCy > 0 ? h / x.chCy : 1 / EMU_PER_PX };
}

function place(x: Xfrm, space: Space): PartBox {
  return {
    x: (x.x - space.ox) * space.sx,
    y: (x.y - space.oy) * space.sy,
    w: x.cx * space.sx,
    h: x.cy * space.sy,
    rot: x.rot,
    flipH: x.flipH,
    flipV: x.flipV,
  };
}

function gradientFill(g: XmlElement, theme: DrawingTheme, ph?: Paint | null): DrawingFill | null {
  const stops: GradientStop[] = [];
  for (const gs of elements(child(g, 'a:gsLst'))) {
    if (gs.name !== 'a:gs') continue;
    const p = resolveColor(colorChild(gs), theme, ph);
    if (p) stops.push({ offset: clamp01(Number(attr(gs, 'pos') ?? 0) / 100000), color: p.color, opacity: p.opacity });
  }
  stops.sort((a, b) => a.offset - b.offset);
  if (!stops.length) return null;
  if (stops.length === 1) return { kind: 'solid', paint: { color: stops[0].color, opacity: stops[0].opacity } };
  if (child(g, 'a:path')) return { kind: 'radial', stops };
  return { kind: 'linear', stops, angle: Number(attr(child(g, 'a:lin'), 'ang') ?? 0) / 60000 };
}

/** The fill a shape's properties set: undefined when they set none (the style decides). */
function fillOf(spPr: XmlElement | undefined, src: DrawingSource, groupFill: DrawingFill | null, ph?: Paint | null): DrawingFill | null | undefined {
  for (const c of elements(spPr)) {
    switch (c.name) {
      case 'a:noFill':
        return null;
      case 'a:solidFill': {
        const p = resolveColor(colorChild(c), src.theme, ph);
        return p ? { kind: 'solid', paint: p } : null;
      }
      case 'a:gradFill':
        return gradientFill(c, src.theme, ph);
      case 'a:pattFill': {
        // Patterns are drawn in their foreground colour.
        const p = resolveColor(colorChild(child(c, 'a:fgClr')), src.theme, ph) ?? resolveColor(colorChild(child(c, 'a:bgClr')), src.theme, ph);
        return p ? { kind: 'solid', paint: p } : null;
      }
      case 'a:blipFill': {
        const m = src.media(attr(child(c, 'a:blip'), 'r:embed'));
        return m ? { kind: 'picture', src: m.url, mediaPath: m.path } : null;
      }
      case 'a:grpFill':
        return groupFill;
    }
  }
  return undefined;
}

function styleFill(style: XmlElement | undefined, theme: DrawingTheme): DrawingFill | null {
  const ref = child(style, 'a:fillRef');
  if (!ref || Number(attr(ref, 'idx') ?? 0) <= 0) return null;
  // The theme's fill styles are drawn in the reference colour (gradient styles included).
  const p = resolveColor(colorChild(ref), theme);
  return p ? { kind: 'solid', paint: p } : null;
}

const DASHES: Record<string, number[]> = {
  dot: [1, 3], dash: [4, 3], lgDash: [8, 3], dashDot: [4, 3, 1, 3], lgDashDot: [8, 3, 1, 3],
  lgDashDotDot: [8, 3, 1, 3, 1, 3], sysDash: [3, 1], sysDot: [1, 1], sysDashDot: [3, 1, 1, 1], sysDashDotDot: [3, 1, 1, 1, 1, 1],
};

function lineOf(spPr: XmlElement | undefined, style: XmlElement | undefined, theme: DrawingTheme): DrawingLine | null {
  const ln = child(spPr, 'a:ln');
  const ref = child(style, 'a:lnRef');
  const idx = Number(attr(ref, 'idx') ?? 0);
  const refPaint = idx > 0 ? resolveColor(colorChild(ref), theme) : null;
  let paint = refPaint;
  let width = idx > 0 ? theme.lineWidths[idx - 1] ?? 9525 : 9525;
  if (ln) {
    if (child(ln, 'a:noFill')) return null;
    const solid = child(ln, 'a:solidFill');
    const grad = child(ln, 'a:gradFill');
    const patt = child(ln, 'a:pattFill');
    if (solid) paint = resolveColor(colorChild(solid), theme, refPaint);
    else if (grad) {
      const g = gradientFill(grad, theme, refPaint);
      paint = g?.kind === 'solid' ? g.paint : g && 'stops' in g ? { color: g.stops[0].color, opacity: g.stops[0].opacity } : paint;
    } else if (patt) paint = resolveColor(colorChild(child(patt, 'a:fgClr')), theme, refPaint) ?? paint;
    if (attr(ln, 'w') !== undefined) width = Number(attr(ln, 'w')) || 0;
  }
  if (!paint) return null;
  // A width of 0 is a hairline.
  const px = width > 0 ? Math.max(width / EMU_PER_PX, 0.5) : 0.75;
  const prst = attr(child(ln, 'a:prstDash'), 'val');
  const cap = attr(ln, 'cap');
  const end = (name: string): LineEnd | undefined => {
    const e = child(ln, name);
    const type = attr(e, 'type');
    return type && type !== 'none' ? { type, w: attr(e, 'w') ?? 'med', len: attr(e, 'len') ?? 'med' } : undefined;
  };
  return {
    paint,
    width: px,
    dash: prst && DASHES[prst] ? DASHES[prst].map((d) => d * px) : undefined,
    cap: cap === 'rnd' ? 'round' : cap === 'sq' ? 'square' : 'butt',
    join: child(ln, 'a:round') ? 'round' : child(ln, 'a:bevel') ? 'bevel' : 'miter',
    head: end('a:headEnd'),
    tail: end('a:tailEnd'),
  };
}

function guideValues(e: XmlElement | undefined, into: Record<string, number> = {}): Record<string, number> {
  for (const gd of elements(e)) {
    const m = /^val\s+(-?\d+(?:\.\d+)?)$/.exec((attr(gd, 'fmla') ?? '').trim());
    const name = attr(gd, 'name');
    if (gd.name === 'a:gd' && name && m) into[name] = Number(m[1]);
  }
  return into;
}

function geometryOf(spPr: XmlElement | undefined): Geometry {
  const prst = child(spPr, 'a:prstGeom');
  if (prst) return { preset: attr(prst, 'prst') ?? 'rect', adjust: guideValues(child(prst, 'a:avLst')) };
  const cust = child(spPr, 'a:custGeom');
  if (!cust) return { preset: 'rect', adjust: {} };
  const guides = guideValues(child(cust, 'a:gdLst'), guideValues(child(cust, 'a:avLst')));
  const v = (s: string | undefined) => {
    if (s === undefined) return 0;
    const n = Number(s);
    return Number.isFinite(n) ? n : guides[s] ?? 0;
  };
  const paths: CustomPath[] = [];
  for (const p of elements(child(cust, 'a:pathLst'))) {
    if (p.name !== 'a:path') continue;
    const commands: (string | number)[][] = [];
    for (const c of elements(p)) {
      const pts = elements(c).filter((e) => e.name === 'a:pt').flatMap((pt) => [v(attr(pt, 'x')), v(attr(pt, 'y'))]);
      switch (c.name) {
        case 'a:moveTo': commands.push(['M', ...pts.slice(0, 2)]); break;
        case 'a:lnTo': commands.push(['L', ...pts.slice(0, 2)]); break;
        case 'a:cubicBezTo': commands.push(['C', ...pts.slice(0, 6)]); break;
        case 'a:quadBezTo': commands.push(['Q', ...pts.slice(0, 4)]); break;
        case 'a:arcTo': commands.push(['A', v(attr(c, 'wR')), v(attr(c, 'hR')), v(attr(c, 'stAng')) / 60000, v(attr(c, 'swAng')) / 60000]); break;
        case 'a:close': commands.push(['Z']); break;
      }
    }
    paths.push({
      w: Number(attr(p, 'w') ?? 0),
      h: Number(attr(p, 'h') ?? 0),
      fill: attr(p, 'fill') !== 'none',
      stroke: !['0', 'false'].includes(attr(p, 'stroke') ?? ''),
      commands,
    });
  }
  return paths.length ? { paths } : { preset: 'rect', adjust: {} };
}

function readText(wsp: XmlElement, src: DrawingSource, style: XmlElement | undefined): DrawingText | undefined {
  const content = child(child(wsp, 'wps:txbx'), 'w:txbxContent');
  if (!content) return undefined;
  const body = child(wsp, 'wps:bodyPr');
  const inset = (name: string, def: number) => {
    const v = attr(body, name);
    return (v === undefined ? def : Number(v) || 0) / EMU_PER_PX;
  };
  const anchor = attr(body, 'anchor');
  const vert = attr(body, 'vert');
  const color = resolveColor(colorChild(child(style, 'a:fontRef')), src.theme);
  return {
    content: src.text(content),
    insets: [inset('lIns', 91440), inset('tIns', 45720), inset('rIns', 91440), inset('bIns', 45720)],
    anchor: anchor === 'ctr' ? 'middle' : anchor === 'b' ? 'bottom' : 'top',
    vertical: vert === 'vert' || vert === 'eaVert' || vert === 'wordArtVertRtl' ? 'vert' : vert === 'vert270' ? 'vert270' : 'horz',
    wrap: attr(body, 'wrap') !== 'none',
    color: color?.color,
  };
}

function readShape(wsp: XmlElement, box: PartBox, src: DrawingSource, groupFill: DrawingFill | null): ShapePart {
  const spPr = child(wsp, 'wps:spPr');
  const style = child(wsp, 'wps:style');
  const own = fillOf(spPr, src, groupFill);
  return {
    kind: 'shape',
    ...box,
    geometry: geometryOf(spPr),
    fill: own === undefined ? styleFill(style, src.theme) : own,
    line: lineOf(spPr, style, src.theme),
    text: readText(wsp, src, style),
  };
}

function readPicture(pic: XmlElement, box: PartBox, src: DrawingSource): PicturePart | null {
  const blipFill = child(pic, 'pic:blipFill');
  const blip = child(blipFill, 'a:blip');
  const media = src.media(attr(blip, 'r:embed'));
  if (!media) return null;
  const rect = child(blipFill, 'a:srcRect');
  const cut = ['l', 't', 'r', 'b'].map((k) => (Number(attr(rect, k) ?? 0) || 0) / 100000) as [number, number, number, number];
  const alpha = child(blip, 'a:alphaModFix');
  return {
    kind: 'picture',
    ...box,
    src: media.url,
    mediaPath: media.path,
    crop: cut.some((c) => c !== 0) ? cut : undefined,
    opacity: alpha ? clamp01(Number(attr(alpha, 'amt') ?? 100000) / 100000) : 1,
    line: child(child(pic, 'pic:spPr'), 'a:ln') ? lineOf(child(pic, 'pic:spPr'), undefined, src.theme) : null,
  };
}

function readPart(e: XmlElement, space: Space, src: DrawingSource, groupFill: DrawingFill | null): DrawingPart | null {
  switch (e.name) {
    case 'wps:wsp':
      return readShape(e, place(readXfrm(child(child(e, 'wps:spPr'), 'a:xfrm')), space), src, groupFill);
    case 'pic:pic':
      return readPicture(e, place(readXfrm(child(child(e, 'pic:spPr'), 'a:xfrm')), space), src);
    case 'wpg:grpSp':
    case 'wpg:wgp': {
      const grpSpPr = child(e, 'wpg:grpSpPr');
      const x = readXfrm(child(grpSpPr, 'a:xfrm'));
      const box = place(x, space);
      const fill = fillOf(grpSpPr, src, groupFill);
      return { kind: 'group', ...box, parts: readParts(e, childSpace(x, box.w, box.h), src, fill === undefined ? groupFill : fill) };
    }
    case 'mc:AlternateContent': {
      const choice = child(e, 'mc:Choice');
      const inner = elements(choice)[0];
      return inner ? readPart(inner, space, src, groupFill) : null;
    }
    default:
      return null;
  }
}

function readParts(parent: XmlElement, space: Space, src: DrawingSource, groupFill: DrawingFill | null): DrawingPart[] {
  const out: DrawingPart[] = [];
  for (const c of elements(parent)) {
    const part = readPart(c, space, src, groupFill);
    if (part) out.push(part);
  }
  return out;
}

/**
 * Reads the shape, group or canvas of a wp:inline / wp:anchor. Returns null for graphics that
 * are not drawings (pictures, charts, diagrams).
 */
export function readDrawing(container: XmlElement, src: DrawingSource, anchor: AnchorInfo | null): DrawingModel | null {
  const extent = child(container, 'wp:extent');
  const width = (Number(attr(extent, 'cx') ?? 0) || 0) / EMU_PER_PX;
  const height = (Number(attr(extent, 'cy') ?? 0) || 0) / EMU_PER_PX;
  const data = findFirst(container, 'a:graphicData');
  const uri = attr(data, 'uri') ?? '';
  let parts: DrawingPart[] = [];
  if (uri === WPS) {
    const wsp = child(data, 'wps:wsp');
    if (!wsp) return null;
    const x = readXfrm(child(child(wsp, 'wps:spPr'), 'a:xfrm'));
    parts = [readShape(wsp, { x: 0, y: 0, w: width, h: height, rot: x.rot, flipH: x.flipH, flipV: x.flipV }, src, null)];
  } else if (uri === WPG) {
    const wgp = child(data, 'wpg:wgp');
    if (!wgp) return null;
    const grpSpPr = child(wgp, 'wpg:grpSpPr');
    const x = readXfrm(child(grpSpPr, 'a:xfrm'));
    const fill = fillOf(grpSpPr, src, null);
    const group: GroupPart = { kind: 'group', x: 0, y: 0, w: width, h: height, rot: x.rot, flipH: x.flipH, flipV: x.flipV, parts: readParts(wgp, childSpace(x, width, height), src, fill ?? null) };
    parts = group.rot || group.flipH || group.flipV ? [group] : group.parts;
  } else if (uri === WPC) {
    const wpc = child(data, 'wpc:wpc');
    if (!wpc) return null;
    const bg = child(wpc, 'wpc:bg');
    const whole = child(wpc, 'wpc:whole');
    const backFill = fillOf(bg, src, null) ?? null;
    const backLine = whole ? lineOf(whole, undefined, src.theme) : null;
    if (backFill || backLine) {
      parts.push({ kind: 'shape', x: 0, y: 0, w: width, h: height, rot: 0, flipH: false, flipV: false, geometry: { preset: 'rect', adjust: {} }, fill: backFill, line: backLine });
    }
    // Canvas children are placed in EMU from the canvas's top left corner.
    parts.push(...readParts(wpc, { ox: 0, oy: 0, sx: 1 / EMU_PER_PX, sy: 1 / EMU_PER_PX }, src, null));
  } else return null;
  return { width, height, parts, anchor };
}

// ------------------------------------------------------------------------------------------------
// Outlines

/**
 * DrawingML gives arc angles on the ellipse (the direction from its centre); the arc drawing
 * needs the ellipse's parameter. Returns the start parameter and the sweep, in degrees.
 */
function parametric(rx: number, ry: number, stAng: number, swAng: number): [number, number] {
  const t = (a: number) => (Math.atan2(rx * Math.sin((a * Math.PI) / 180), ry * Math.cos((a * Math.PI) / 180)) * 180) / Math.PI;
  const t0 = t(stAng);
  if (Math.abs(swAng) >= 360) return [t0, Math.sign(swAng) * 360];
  let sweep = t(stAng + swAng) - t0;
  if (swAng > 0 && sweep < 0) sweep += 360;
  else if (swAng < 0 && sweep > 0) sweep -= 360;
  return [t0, sweep];
}

const r2 = (v: number) => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
};

/** Path data in absolute M, L, C and Z commands only (the PDF export reads it back). */
class PathData {
  private d: string[] = [];
  /** Points in order, for the direction of line ends. */
  readonly points: [number, number][] = [];
  closed = false;
  private x = 0;
  private y = 0;

  move(x: number, y: number): this {
    this.d.push(`M${r2(x)} ${r2(y)}`);
    this.at(x, y);
    return this;
  }

  line(x: number, y: number): this {
    this.d.push(`L${r2(x)} ${r2(y)}`);
    this.at(x, y);
    return this;
  }

  curve(x1: number, y1: number, x2: number, y2: number, x: number, y: number): this {
    this.d.push(`C${r2(x1)} ${r2(y1)} ${r2(x2)} ${r2(y2)} ${r2(x)} ${r2(y)}`);
    this.points.push([x1, y1], [x2, y2]);
    this.at(x, y);
    return this;
  }

  quad(qx: number, qy: number, x: number, y: number): this {
    const x0 = this.x;
    const y0 = this.y;
    return this.curve(x0 + (2 / 3) * (qx - x0), y0 + (2 / 3) * (qy - y0), x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), x, y);
  }

  /**
   * Elliptic arc around (cx, cy) from parametric angle `start` turning by `sweep` (degrees,
   * clockwise on screen). Joins the current point to the arc's start with a line, or moves there.
   */
  arc(cx: number, cy: number, rx: number, ry: number, start: number, sweep: number, move = false): this {
    const steps = Math.max(1, Math.ceil(Math.abs(sweep) / 90 - 1e-9));
    const step = ((sweep / steps) * Math.PI) / 180;
    let t = (start * Math.PI) / 180;
    const sx = cx + rx * Math.cos(t);
    const sy = cy + ry * Math.sin(t);
    if (move || !this.d.length) this.move(sx, sy);
    else if (Math.abs(sx - this.x) > 0.01 || Math.abs(sy - this.y) > 0.01) this.line(sx, sy);
    const k = (4 / 3) * Math.tan(step / 4);
    for (let i = 0; i < steps; i++) {
      const t2 = t + step;
      this.curve(
        cx + rx * (Math.cos(t) - k * Math.sin(t)), cy + ry * (Math.sin(t) + k * Math.cos(t)),
        cx + rx * (Math.cos(t2) + k * Math.sin(t2)), cy + ry * (Math.sin(t2) - k * Math.cos(t2)),
        cx + rx * Math.cos(t2), cy + ry * Math.sin(t2),
      );
      t = t2;
    }
    return this;
  }

  /** DrawingML arcTo: from the current point, which lies on the ellipse at angle stAng. */
  arcTo(wR: number, hR: number, stAng: number, swAng: number): this {
    if (wR <= 0 || hR <= 0) return this;
    const [t0, sweep] = parametric(wR, hR, stAng, swAng);
    const cx = this.x - wR * Math.cos((t0 * Math.PI) / 180);
    const cy = this.y - hR * Math.sin((t0 * Math.PI) / 180);
    return this.arc(cx, cy, wR, hR, t0, sweep);
  }

  close(): this {
    this.d.push('Z');
    this.closed = true;
    return this;
  }

  toString(): string {
    return this.d.join(' ');
  }

  private at(x: number, y: number) {
    this.x = x;
    this.y = y;
    this.points.push([x, y]);
  }
}

interface Outline {
  d: string;
  fill: boolean;
  stroke: boolean;
  evenOdd?: boolean;
  /** For open paths: where they start and end, and the point each end comes from. */
  ends?: { start: [number, number]; startFrom: [number, number]; end: [number, number]; endFrom: [number, number] };
}

function outlineOf(p: PathData, fill = true, stroke = true, evenOdd = false): Outline {
  const out: Outline = { d: p.toString(), fill, stroke, evenOdd };
  const pts = p.points;
  if (!p.closed && pts.length >= 2) {
    const far = (from: [number, number], list: [number, number][]) => list.find((q) => Math.hypot(q[0] - from[0], q[1] - from[1]) > 0.01) ?? list[0];
    const start = pts[0];
    const end = pts[pts.length - 1];
    out.ends = { start, startFrom: far(start, pts.slice(1)), end, endFrom: far(end, pts.slice(0, -1).reverse()) };
  }
  return out;
}

function polygon(points: [number, number][], close = true): PathData {
  const p = new PathData();
  points.forEach(([x, y], i) => (i ? p.line(x, y) : p.move(x, y)));
  return close ? p.close() : p;
}

function roundedRect(x: number, y: number, w: number, h: number, r: number): PathData {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  if (rr <= 0) return polygon([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
  return new PathData()
    .move(x + rr, y)
    .line(x + w - rr, y)
    .arc(x + w - rr, y + rr, rr, rr, -90, 90)
    .line(x + w, y + h - rr)
    .arc(x + w - rr, y + h - rr, rr, rr, 0, 90)
    .line(x + rr, y + h)
    .arc(x + rr, y + h - rr, rr, rr, 90, 90)
    .line(x, y + rr)
    .arc(x + rr, y + rr, rr, rr, 180, 90)
    .close();
}

function ellipse(cx: number, cy: number, rx: number, ry: number): PathData {
  return new PathData().arc(cx, cy, rx, ry, 0, 360, true).close();
}

/** A polygon through n points on the ellipse in the box, fitted to the box (regular shapes). */
function regular(n: number, w: number, h: number): PathData {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    pts.push([Math.cos(a), Math.sin(a)]);
  }
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return polygon(pts.map(([x, y]) => [((x - x0) / (x1 - x0)) * w, ((y - y0) / (y1 - y0)) * h]));
}

function star(n: number, inner: number, w: number, h: number): PathData {
  const pts: [number, number][] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    const r = i % 2 ? inner : 1;
    pts.push([w / 2 + (w / 2) * r * Math.cos(a), h / 2 + (h / 2) * r * Math.sin(a)]);
  }
  return polygon(pts);
}

function callout(body: 'rect' | 'round' | 'ellipse', w: number, h: number, adj: (k: string, d: number) => number): Outline[] {
  const tx = w / 2 + w * adj('adj1', -20833);
  const ty = h / 2 + h * adj('adj2', 62500);
  if (body === 'ellipse') {
    const t = (Math.atan2((ty - h / 2) / h, (tx - w / 2) / w) * 180) / Math.PI;
    const inside = ((tx - w / 2) / (w / 2)) ** 2 + ((ty - h / 2) / (h / 2)) ** 2 <= 1;
    if (inside) return [outlineOf(ellipse(w / 2, h / 2, w / 2, h / 2))];
    return [outlineOf(new PathData().arc(w / 2, h / 2, w / 2, h / 2, t + 12, 336, true).line(tx, ty).close())];
  }
  const r = body === 'round' ? Math.min(w, h) * adj('adj3', 16667) : 0;
  const inside = tx >= 0 && tx <= w && ty >= 0 && ty <= h;
  if (inside) return [outlineOf(roundedRect(0, 0, w, h, r))];
  // The tail leaves the side the tip lies beyond, from a base a sixth of that side wide.
  const side = Math.abs(ty - h / 2) / h > Math.abs(tx - w / 2) / w ? (ty > h / 2 ? 'bottom' : 'top') : tx > w / 2 ? 'right' : 'left';
  const along = side === 'top' || side === 'bottom' ? w : h;
  const at = side === 'top' || side === 'bottom' ? tx : ty;
  const half = along / 12;
  const c = Math.max(r + half, Math.min(along - r - half, at));
  const p = new PathData().move(r, 0);
  if (side === 'top') p.line(c - half, 0).line(tx, ty).line(c + half, 0);
  p.line(w - r, 0);
  if (r) p.arc(w - r, r, r, r, -90, 90);
  if (side === 'right') p.line(w, c - half).line(tx, ty).line(w, c + half);
  p.line(w, h - r);
  if (r) p.arc(w - r, h - r, r, r, 0, 90);
  if (side === 'bottom') p.line(c + half, h).line(tx, ty).line(c - half, h);
  p.line(r, h);
  if (r) p.arc(r, h - r, r, r, 90, 90);
  if (side === 'left') p.line(0, c + half).line(tx, ty).line(0, c - half);
  p.line(0, r);
  if (r) p.arc(r, r, r, r, 180, 90);
  return [outlineOf(p.close())];
}

function presetOutline(name: string, w: number, h: number, adjust: Record<string, number>): Outline[] {
  const ss = Math.min(w, h);
  const adj = (key: string, def: number) => (adjust[key] ?? def) / 100000;
  const open = (p: PathData) => [outlineOf(p, false)];
  const one = (p: PathData) => [outlineOf(p)];
  switch (name) {
    case 'line':
    case 'straightConnector1':
      return open(polygon([[0, 0], [w, h]], false));
    case 'bentConnector2':
      return open(polygon([[0, 0], [w, 0], [w, h]], false));
    case 'bentConnector3': {
      const x1 = w * adj('adj1', 50000);
      return open(polygon([[0, 0], [x1, 0], [x1, h], [w, h]], false));
    }
    case 'bentConnector4': {
      const x1 = w * adj('adj1', 50000);
      const y2 = h * adj('adj2', 50000);
      return open(polygon([[0, 0], [x1, 0], [x1, y2], [w, y2], [w, h]], false));
    }
    case 'bentConnector5': {
      const x1 = w * adj('adj1', 50000);
      const y2 = h * adj('adj2', 50000);
      const x3 = w * adj('adj3', 50000);
      return open(polygon([[0, 0], [x1, 0], [x1, y2], [x3, y2], [x3, h], [w, h]], false));
    }
    case 'curvedConnector2':
      return open(new PathData().move(0, 0).curve(w / 2, 0, w, h / 2, w, h));
    case 'curvedConnector3':
    case 'curvedConnector4':
    case 'curvedConnector5': {
      const x1 = w * adj('adj1', 50000);
      return open(new PathData().move(0, 0).curve(x1 / 2, 0, x1, h / 4, x1, h / 2).curve(x1, (3 * h) / 4, (x1 + w) / 2, h, w, h));
    }
    case 'arc':
    case 'pie':
    case 'chord': {
      // Start and end angles in 60000ths of a degree, clockwise from three o'clock.
      const st = (adjust.adj1 ?? (name === 'arc' ? 16200000 : name === 'pie' ? 0 : 2700000)) / 60000;
      const en = (adjust.adj2 ?? (name === 'arc' ? 0 : 16200000)) / 60000;
      const [t0, sweep] = parametric(w / 2, h / 2, st, ((en - st) % 360 + 360) % 360 || 360);
      const p = new PathData().arc(w / 2, h / 2, w / 2, h / 2, t0, sweep, true);
      if (name === 'arc') return open(p);
      if (name === 'pie') p.line(w / 2, h / 2);
      return one(p.close());
    }
    case 'roundRect':
      return one(roundedRect(0, 0, w, h, ss * adj('adj', 16667)));
    case 'flowChartAlternateProcess':
      return one(roundedRect(0, 0, w, h, ss / 6));
    case 'flowChartTerminator': {
      const rx = (w * 3475) / 21600;
      return one(new PathData().move(rx, 0).line(w - rx, 0).arc(w - rx, h / 2, rx, h / 2, -90, 180).line(rx, h).arc(rx, h / 2, rx, h / 2, 90, 180).close());
    }
    case 'ellipse':
    case 'flowChartConnector':
      return one(ellipse(w / 2, h / 2, w / 2, h / 2));
    case 'flowChartOr':
      return [outlineOf(ellipse(w / 2, h / 2, w / 2, h / 2)), outlineOf(new PathData().move(w / 2, 0).line(w / 2, h).move(0, h / 2).line(w, h / 2), false)];
    case 'flowChartSummingJunction': {
      const dx = (w / 2) * Math.SQRT1_2;
      const dy = (h / 2) * Math.SQRT1_2;
      return [outlineOf(ellipse(w / 2, h / 2, w / 2, h / 2)), outlineOf(new PathData().move(w / 2 - dx, h / 2 - dy).line(w / 2 + dx, h / 2 + dy).move(w / 2 + dx, h / 2 - dy).line(w / 2 - dx, h / 2 + dy), false)];
    }
    case 'triangle':
      return one(polygon([[w * adj('adj', 50000), 0], [w, h], [0, h]]));
    case 'flowChartExtract':
      return one(polygon([[w / 2, 0], [w, h], [0, h]]));
    case 'flowChartMerge':
      return one(polygon([[0, 0], [w, 0], [w / 2, h]]));
    case 'rtTriangle':
      return one(polygon([[0, 0], [w, h], [0, h]]));
    case 'diamond':
    case 'flowChartDecision':
      return one(polygon([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]));
    case 'parallelogram': {
      const o = ss * adj('adj', 25000);
      return one(polygon([[o, 0], [w, 0], [w - o, h], [0, h]]));
    }
    case 'flowChartInputOutput':
      return one(polygon([[w / 5, 0], [w, 0], [(w * 4) / 5, h], [0, h]]));
    case 'trapezoid': {
      const o = ss * adj('adj', 25000);
      return one(polygon([[0, h], [o, 0], [w - o, 0], [w, h]]));
    }
    case 'flowChartManualOperation':
      return one(polygon([[0, 0], [w, 0], [(w * 4) / 5, h], [w / 5, h]]));
    case 'pentagon':
      return one(regular(5, w, h));
    case 'heptagon':
      return one(regular(7, w, h));
    case 'decagon':
      return one(regular(10, w, h));
    case 'dodecagon':
      return one(regular(12, w, h));
    case 'hexagon': {
      const o = ss * adj('adj', 25000);
      return one(polygon([[0, h / 2], [o, 0], [w - o, 0], [w, h / 2], [w - o, h], [o, h]]));
    }
    case 'flowChartPreparation':
      return one(polygon([[0, h / 2], [w / 5, 0], [(w * 4) / 5, 0], [w, h / 2], [(w * 4) / 5, h], [w / 5, h]]));
    case 'octagon': {
      const c = ss * adj('adj', 29289);
      return one(polygon([[c, 0], [w - c, 0], [w, c], [w, h - c], [w - c, h], [c, h], [0, h - c], [0, c]]));
    }
    case 'plus': {
      const o = ss * adj('adj', 25000);
      return one(polygon([[o, 0], [w - o, 0], [w - o, o], [w, o], [w, h - o], [w - o, h - o], [w - o, h], [o, h], [o, h - o], [0, h - o], [0, o], [o, o]]));
    }
    case 'star4': return one(star(4, adj('adj', 12500) * 2, w, h));
    case 'star5': return one(star(5, adj('adj', 19098) * 2, w, h));
    case 'star6': return one(star(6, adj('adj', 28868) * 2, w, h));
    case 'star7': return one(star(7, adj('adj', 34601) * 2, w, h));
    case 'star8': return one(star(8, adj('adj', 38250) * 2, w, h));
    case 'star10': return one(star(10, adj('adj', 42533) * 2, w, h));
    case 'star12':
    case 'star16':
    case 'star24':
    case 'star32':
      return one(star(Number(name.slice(4)), adj('adj', 37500) * 2, w, h));
    case 'heart':
      return one(new PathData()
        .move(w / 2, h * 0.28)
        .curve(w * 0.38, -h * 0.06, -w * 0.05, h * 0.02, w * 0.02, h * 0.34)
        .curve(w * 0.08, h * 0.62, w * 0.38, h * 0.8, w / 2, h)
        .curve(w * 0.62, h * 0.8, w * 0.92, h * 0.62, w * 0.98, h * 0.34)
        .curve(w * 1.05, h * 0.02, w * 0.62, -h * 0.06, w / 2, h * 0.28)
        .close());
    case 'cloud':
    case 'cloudCallout': {
      const p = new PathData();
      const bumps = 9;
      const at = (i: number): [number, number] => {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / bumps;
        return [w / 2 + w * 0.4 * Math.cos(a), h / 2 + h * 0.36 * Math.sin(a)];
      };
      p.move(...at(0));
      for (let i = 0; i < bumps; i++) {
        const mid = -Math.PI / 2 + ((i + 0.5) * 2 * Math.PI) / bumps;
        p.quad(w / 2 + w * 0.62 * Math.cos(mid), h / 2 + h * 0.58 * Math.sin(mid), ...at(i + 1));
      }
      return one(p.close());
    }
    case 'rightArrow': {
      const dy = (h * adj('adj1', 50000)) / 2;
      const dx = Math.min(w, ss * adj('adj2', 50000));
      return one(polygon([[0, h / 2 - dy], [w - dx, h / 2 - dy], [w - dx, 0], [w, h / 2], [w - dx, h], [w - dx, h / 2 + dy], [0, h / 2 + dy]]));
    }
    case 'leftArrow': {
      const dy = (h * adj('adj1', 50000)) / 2;
      const dx = Math.min(w, ss * adj('adj2', 50000));
      return one(polygon([[w, h / 2 - dy], [dx, h / 2 - dy], [dx, 0], [0, h / 2], [dx, h], [dx, h / 2 + dy], [w, h / 2 + dy]]));
    }
    case 'upArrow': {
      const dx = (w * adj('adj1', 50000)) / 2;
      const dy = Math.min(h, ss * adj('adj2', 50000));
      return one(polygon([[w / 2 - dx, h], [w / 2 - dx, dy], [0, dy], [w / 2, 0], [w, dy], [w / 2 + dx, dy], [w / 2 + dx, h]]));
    }
    case 'downArrow': {
      const dx = (w * adj('adj1', 50000)) / 2;
      const dy = Math.min(h, ss * adj('adj2', 50000));
      return one(polygon([[w / 2 - dx, 0], [w / 2 - dx, h - dy], [0, h - dy], [w / 2, h], [w, h - dy], [w / 2 + dx, h - dy], [w / 2 + dx, 0]]));
    }
    case 'leftRightArrow': {
      const dy = (h * adj('adj1', 50000)) / 2;
      const dx = Math.min(w / 2, ss * adj('adj2', 50000));
      return one(polygon([[0, h / 2], [dx, 0], [dx, h / 2 - dy], [w - dx, h / 2 - dy], [w - dx, 0], [w, h / 2], [w - dx, h], [w - dx, h / 2 + dy], [dx, h / 2 + dy], [dx, h]]));
    }
    case 'upDownArrow': {
      const dx = (w * adj('adj1', 50000)) / 2;
      const dy = Math.min(h / 2, ss * adj('adj2', 50000));
      return one(polygon([[w / 2, 0], [w, dy], [w / 2 + dx, dy], [w / 2 + dx, h - dy], [w, h - dy], [w / 2, h], [0, h - dy], [w / 2 - dx, h - dy], [w / 2 - dx, dy], [0, dy]]));
    }
    case 'chevron': {
      const o = Math.min(w, ss * adj('adj', 50000));
      return one(polygon([[0, 0], [w - o, 0], [w, h / 2], [w - o, h], [0, h], [o, h / 2]]));
    }
    case 'homePlate': {
      const o = Math.min(w, ss * adj('adj', 50000));
      return one(polygon([[0, 0], [w - o, 0], [w, h / 2], [w - o, h], [0, h]]));
    }
    case 'flowChartPredefinedProcess':
      return [outlineOf(polygon([[0, 0], [w, 0], [w, h], [0, h]])), outlineOf(new PathData().move(w / 8, 0).line(w / 8, h).move((w * 7) / 8, 0).line((w * 7) / 8, h), false)];
    case 'flowChartInternalStorage':
      return [outlineOf(polygon([[0, 0], [w, 0], [w, h], [0, h]])), outlineOf(new PathData().move(w / 8, 0).line(w / 8, h).move(0, h / 8).line(w, h / 8), false)];
    case 'flowChartDocument':
    case 'flowChartMultidocument': {
      const X = (v: number) => (v / 21600) * w;
      const Y = (v: number) => (v / 21600) * h;
      return one(new PathData().move(0, 0).line(w, 0).line(w, Y(17322)).curve(X(10800), Y(17322), X(10800), Y(23922), 0, Y(20172)).close());
    }
    case 'flowChartManualInput':
      return one(polygon([[0, h / 5], [w, 0], [w, h], [0, h]]));
    case 'flowChartOffpageConnector':
      return one(polygon([[0, 0], [w, 0], [w, (h * 4) / 5], [w / 2, h], [0, (h * 4) / 5]]));
    case 'flowChartPunchedCard':
      return one(polygon([[w / 5, 0], [w, 0], [w, h], [0, h], [0, h / 5]]));
    case 'flowChartDelay':
      return one(new PathData().move(0, 0).line(w / 2, 0).arc(w / 2, h / 2, w / 2, h / 2, -90, 180).line(0, h).close());
    case 'can':
    case 'flowChartMagneticDisk': {
      const ry = name === 'can' ? (ss * adj('adj', 25000)) / 2 : h / 6;
      return [
        outlineOf(new PathData().move(0, ry).line(0, h - ry).arc(w / 2, h - ry, w / 2, ry, 180, -180).line(w, ry).arc(w / 2, ry, w / 2, ry, 0, -180).close()),
        outlineOf(new PathData().arc(w / 2, ry, w / 2, ry, 180, -180, true), false),
      ];
    }
    case 'cube': {
      const o = ss * adj('adj', 25000);
      return [
        outlineOf(polygon([[0, o], [w - o, o], [w - o, h], [0, h]])),
        outlineOf(polygon([[0, o], [o, 0], [w, 0], [w - o, o]])),
        outlineOf(polygon([[w - o, o], [w, 0], [w, h - o], [w - o, h]])),
      ];
    }
    case 'donut': {
      const d = ss * adj('adj', 25000);
      const p = ellipse(w / 2, h / 2, w / 2, h / 2);
      const inner = new PathData().arc(w / 2, h / 2, Math.max(0, w / 2 - d), Math.max(0, h / 2 - d), 0, 360, true).close();
      return [{ ...outlineOf(p), d: `${p.toString()} ${inner.toString()}`, evenOdd: true }];
    }
    case 'frame': {
      const d = ss * adj('adj1', 12500);
      const outer = polygon([[0, 0], [w, 0], [w, h], [0, h]]);
      const inner = polygon([[d, d], [w - d, d], [w - d, h - d], [d, h - d]]);
      return [{ ...outlineOf(outer), d: `${outer.toString()} ${inner.toString()}`, evenOdd: true }];
    }
    case 'snip1Rect': {
      const c = ss * adj('adj', 16667);
      return one(polygon([[0, 0], [w - c, 0], [w, c], [w, h], [0, h]]));
    }
    case 'snip2SameRect': {
      const c = ss * adj('adj1', 16667);
      return one(polygon([[c, 0], [w - c, 0], [w, c], [w, h], [0, h], [0, c]]));
    }
    case 'round1Rect': {
      const r = Math.min(ss / 2, ss * adj('adj', 16667));
      return one(new PathData().move(0, 0).line(w - r, 0).arc(w - r, r, r, r, -90, 90).line(w, h).line(0, h).close());
    }
    case 'round2SameRect': {
      const r = Math.min(ss / 2, ss * adj('adj1', 16667));
      return one(new PathData().move(r, 0).line(w - r, 0).arc(w - r, r, r, r, -90, 90).line(w, h).line(0, h).line(0, r).arc(r, r, r, r, 180, 90).close());
    }
    case 'wedgeRectCallout':
      return callout('rect', w, h, adj);
    case 'wedgeRoundRectCallout':
      return callout('round', w, h, adj);
    case 'wedgeEllipseCallout':
      return callout('ellipse', w, h, adj);
    default:
      return one(polygon([[0, 0], [w, 0], [w, h], [0, h]]));
  }
}

function customOutline(paths: CustomPath[], w: number, h: number): Outline[] {
  return paths.map((path) => {
    const sx = path.w > 0 ? w / path.w : 1 / EMU_PER_PX;
    const sy = path.h > 0 ? h / path.h : 1 / EMU_PER_PX;
    const p = new PathData();
    for (const [cmd, ...a] of path.commands as [string, ...number[]][]) {
      if (cmd === 'M') p.move(a[0] * sx, a[1] * sy);
      else if (cmd === 'L') p.line(a[0] * sx, a[1] * sy);
      else if (cmd === 'C') p.curve(a[0] * sx, a[1] * sy, a[2] * sx, a[3] * sy, a[4] * sx, a[5] * sy);
      else if (cmd === 'Q') p.quad(a[0] * sx, a[1] * sy, a[2] * sx, a[3] * sy);
      else if (cmd === 'A') p.arcTo(a[0] * sx, a[1] * sy, a[2], a[3]);
      else if (cmd === 'Z') p.close();
    }
    return outlineOf(p, path.fill, path.stroke);
  });
}

/** The outline of a shape as SVG paths in its w × h box. */
export function shapeOutline(geometry: Geometry, w: number, h: number): Outline[] {
  return 'paths' in geometry ? customOutline(geometry.paths, w, h) : presetOutline(geometry.preset, w, h, geometry.adjust);
}

/** The part of a shape its text is laid out in. */
function textArea(geometry: Geometry, w: number, h: number): { x: number; y: number; w: number; h: number } {
  const name = 'preset' in geometry ? geometry.preset : '';
  switch (name) {
    case 'ellipse':
    case 'flowChartConnector':
    case 'wedgeEllipseCallout':
      return { x: w * 0.1464, y: h * 0.1464, w: w * 0.7071, h: h * 0.7071 };
    case 'diamond':
    case 'flowChartDecision':
      return { x: w / 4, y: h / 4, w: w / 2, h: h / 2 };
    case 'triangle':
    case 'flowChartExtract':
      return { x: w / 4, y: h / 2, w: w / 2, h: h / 2 };
    default:
      return { x: 0, y: 0, w, h };
  }
}

// ------------------------------------------------------------------------------------------------
// Drawing

const SVG_NS = 'http://www.w3.org/2000/svg';
let gradientSeq = 0;

const px = (v: number) => `${r2(v)}px`;

function svg<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number | undefined> = {}): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) e.setAttribute(k, String(v));
  return e;
}

/**
 * An SVG canvas over a part, in px (no viewBox, so lines keep their width). At least 1px in
 * each direction: a horizontal line has a height of 0, and its stroke draws outside the box.
 */
function svgBox(w: number, h: number): SVGSVGElement {
  return svg('svg', { class: 'ml-dx-drawing-svg', width: r2(Math.max(w, 1)), height: r2(Math.max(h, 1)), 'aria-hidden': 'true' });
}

function frame(part: PartBox, extra = ''): HTMLElement {
  const e = document.createElement('span');
  e.className = `ml-dx-drawing-part${extra ? ` ${extra}` : ''}`;
  e.style.left = px(part.x);
  e.style.top = px(part.y);
  e.style.width = px(part.w);
  e.style.height = px(part.h);
  if (part.rot) e.style.transform = `rotate(${r2(part.rot)}deg)`;
  return e;
}

const flip = (part: PartBox) => (part.flipH || part.flipV ? `scale(${part.flipH ? -1 : 1}, ${part.flipV ? -1 : 1})` : '');

/** Colour of a gradient half way, for the PDF export (which draws gradients in one colour). */
function middleColor(stops: GradientStop[]): string {
  const a = stops[0];
  const b = stops[stops.length - 1];
  const ca = hexToRgb(a.color.slice(1));
  const cb = hexToRgb(b.color.slice(1));
  return rgbToHex(ca.map((v, i) => (v + cb[i]) / 2) as RGB);
}

function gradientDef(fill: Extract<DrawingFill, { stops: GradientStop[] }>, defs: SVGDefsElement): string {
  const id = `ml-dx-gradient-${++gradientSeq}`;
  let g: SVGElement;
  if (fill.kind === 'linear') {
    const a = (fill.angle * Math.PI) / 180;
    const dx = Math.cos(a) / 2;
    const dy = Math.sin(a) / 2;
    g = svg('linearGradient', { id, x1: r2(0.5 - dx), y1: r2(0.5 - dy), x2: r2(0.5 + dx), y2: r2(0.5 + dy) });
  } else g = svg('radialGradient', { id });
  for (const s of fill.stops) g.appendChild(svg('stop', { offset: r2(s.offset), 'stop-color': s.color, 'stop-opacity': s.opacity < 1 ? r2(s.opacity) : undefined }));
  defs.appendChild(g);
  return id;
}

const END_SIZE: Record<string, number> = { sm: 2, med: 3, lg: 5 };

/** An arrowhead (or other line end) at `tip`, pointing away from `from`. */
function lineEnd(end: LineEnd, tip: [number, number], from: [number, number], line: DrawingLine): SVGPathElement {
  const len = Math.max(END_SIZE[end.len] ?? 3, 2) * Math.max(line.width, 1);
  const half = (Math.max(END_SIZE[end.w] ?? 3, 2) * Math.max(line.width, 1)) / 2;
  const a = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  const at = (along: number, across: number): string => {
    const x = tip[0] - along * Math.cos(a) - across * Math.sin(a);
    const y = tip[1] - along * Math.sin(a) + across * Math.cos(a);
    return `${r2(x)} ${r2(y)}`;
  };
  let d: string;
  let filled = true;
  switch (end.type) {
    case 'arrow':
      d = `M${at(len, half)} L${at(0, 0)} L${at(len, -half)}`;
      filled = false;
      break;
    case 'stealth':
      d = `M${at(0, 0)} L${at(len, half)} L${at(len * 0.7, 0)} L${at(len, -half)} Z`;
      break;
    case 'diamond':
      d = `M${at(0, 0)} L${at(len / 2, half)} L${at(len, 0)} L${at(len / 2, -half)} Z`;
      break;
    case 'oval': {
      const p = new PathData().arc(tip[0], tip[1], len / 2, half, 0, 360, true).close();
      d = p.toString();
      break;
    }
    default:
      d = `M${at(0, 0)} L${at(len, half)} L${at(len, -half)} Z`;
  }
  const color = line.paint.color;
  return svg('path', {
    d,
    fill: filled ? color : 'none',
    'fill-opacity': filled && line.paint.opacity < 1 ? r2(line.paint.opacity) : undefined,
    stroke: filled ? 'none' : color,
    'stroke-width': filled ? undefined : r2(line.width),
    'stroke-opacity': !filled && line.paint.opacity < 1 ? r2(line.paint.opacity) : undefined,
  });
}

function strokeAttrs(line: DrawingLine | null): Record<string, string | number | undefined> {
  if (!line) return { stroke: 'none' };
  return {
    stroke: line.paint.color,
    'stroke-width': r2(line.width),
    'stroke-opacity': line.paint.opacity < 1 ? r2(line.paint.opacity) : undefined,
    'stroke-dasharray': line.dash ? line.dash.map(r2).join(' ') : undefined,
    'stroke-linecap': line.cap !== 'butt' ? line.cap : undefined,
    'stroke-linejoin': line.join,
  };
}

function renderText(text: DrawingText, schema: Schema, area: { x: number; y: number; w: number; h: number }): HTMLElement {
  const box = document.createElement('span');
  box.className = `ml-dx-drawing-text${text.wrap ? '' : ' ml-dx-nowrap'}`;
  box.style.left = px(area.x);
  box.style.top = px(area.y);
  box.style.width = px(area.w);
  box.style.height = px(area.h);
  box.style.padding = `${px(text.insets[1])} ${px(text.insets[2])} ${px(text.insets[3])} ${px(text.insets[0])}`;
  if (text.anchor !== 'top') box.style.justifyContent = text.anchor === 'middle' ? 'center' : 'flex-end';
  if (text.color) box.style.color = text.color;
  if (text.vertical !== 'horz') box.style.writingMode = 'vertical-rl';
  if (text.vertical === 'vert270') box.style.transform = 'rotate(180deg)';
  const flow = document.createElement('span');
  flow.className = 'ml-dx-drawing-flow';
  const rendered = DOMSerializer.fromSchema(schema).serializeFragment(Fragment.fromJSON(schema, text.content));
  // Paragraphs become block spans: the drawing sits inside a paragraph, which may not hold <p>.
  for (const p of Array.from((rendered as DocumentFragment).querySelectorAll('p'))) {
    const span = document.createElement('span');
    for (const a of Array.from(p.attributes)) span.setAttribute(a.name, a.value);
    while (p.firstChild) span.appendChild(p.firstChild);
    p.replaceWith(span);
  }
  flow.appendChild(rendered);
  box.appendChild(flow);
  return box;
}

function renderShape(part: ShapePart, schema: Schema): HTMLElement {
  const e = frame(part);
  const w = Math.max(part.w, 0);
  const h = Math.max(part.h, 0);
  const outlines = shapeOutline(part.geometry, w, h);
  if (part.fill?.kind === 'picture') {
    const img = document.createElement('img');
    img.className = 'ml-dx-drawing-fill';
    img.src = part.fill.src;
    img.alt = '';
    img.draggable = false;
    const rect = 'preset' in part.geometry && part.geometry.preset === 'rect';
    if (!rect && outlines[0]) img.style.clipPath = `path('${outlines[0].d}')`;
    if (flip(part)) img.style.transform = flip(part);
    e.appendChild(img);
  }
  const root = svgBox(w, h);
  if (flip(part)) root.style.transform = flip(part);
  let fill = 'none';
  let fallback: string | undefined;
  let fillOpacity: number | undefined;
  if (part.fill?.kind === 'solid') {
    fill = part.fill.paint.color;
    fillOpacity = part.fill.paint.opacity < 1 ? part.fill.paint.opacity : undefined;
  } else if (part.fill && 'stops' in part.fill) {
    const defs = svg('defs');
    root.appendChild(defs);
    fill = `url(#${gradientDef(part.fill, defs)})`;
    fallback = middleColor(part.fill.stops);
  }
  for (const o of outlines) {
    root.appendChild(svg('path', {
      d: o.d,
      fill: o.fill ? fill : 'none',
      'fill-opacity': o.fill && fillOpacity !== undefined ? r2(fillOpacity) : undefined,
      'fill-rule': o.evenOdd ? 'evenodd' : undefined,
      'data-fill': o.fill ? fallback : undefined,
      ...(o.stroke ? strokeAttrs(part.line) : { stroke: 'none' }),
    }));
    if (part.line && o.ends) {
      if (part.line.head) root.appendChild(lineEnd(part.line.head, o.ends.start, o.ends.startFrom, part.line));
      if (part.line.tail) root.appendChild(lineEnd(part.line.tail, o.ends.end, o.ends.endFrom, part.line));
    }
  }
  e.appendChild(root);
  if (part.text) e.appendChild(renderText(part.text, schema, textArea(part.geometry, w, h)));
  return e;
}

function renderPicture(part: PicturePart, mediaUrl?: (path: string) => string): HTMLElement {
  const e = frame(part, 'ml-dx-drawing-pic');
  const img = document.createElement('img');
  img.src = (part.mediaPath && mediaUrl?.(part.mediaPath)) || part.src;
  img.alt = '';
  img.draggable = false;
  if (part.crop) {
    const [l, t, r, b] = part.crop;
    const iw = part.w / Math.max(0.01, 1 - l - r);
    const ih = part.h / Math.max(0.01, 1 - t - b);
    img.style.width = px(iw);
    img.style.height = px(ih);
    img.style.left = px(-l * iw);
    img.style.top = px(-t * ih);
    img.dataset.crop = part.crop.join(' ');
  } else {
    img.style.width = '100%';
    img.style.height = '100%';
  }
  if (part.opacity < 1) img.style.opacity = String(r2(part.opacity));
  if (flip(part)) e.style.transform = [e.style.transform, flip(part)].filter(Boolean).join(' ');
  e.appendChild(img);
  if (part.line) {
    const root = svgBox(part.w, part.h);
    root.appendChild(svg('path', { d: polygon([[0, 0], [part.w, 0], [part.w, part.h], [0, part.h]]).toString(), fill: 'none', ...strokeAttrs(part.line) }));
    e.appendChild(root);
  }
  return e;
}

function renderPart(part: DrawingPart, schema: Schema, mediaUrl?: (path: string) => string): HTMLElement {
  if (part.kind === 'shape') return renderShape(part, schema);
  if (part.kind === 'picture') return renderPicture(part, mediaUrl);
  const e = frame(part, 'ml-dx-drawing-group');
  if (flip(part)) e.style.transform = [e.style.transform, flip(part)].filter(Boolean).join(' ');
  for (const p of part.parts) e.appendChild(renderPart(p, schema, mediaUrl));
  return e;
}

/** Inline CSS for a floating drawing, by its wrapping (as floating pictures are placed). */
function placement(anchor: AnchorInfo, width: number): Record<string, string> {
  const pt = (emu: number) => `${(emu / 12700).toFixed(1)}pt`;
  const s: Record<string, string> = {};
  if (anchor.wrap === 'topAndBottom') {
    s.display = 'block';
    s.margin = `${pt(anchor.distT)} auto ${pt(anchor.distB)}`;
    if (anchor.hAlign === 'left') s.marginLeft = '0';
    else if (anchor.hAlign === 'right') s.marginRight = '0';
    else if (!anchor.hAlign && anchor.hOffset !== undefined) s.marginLeft = px(anchor.hOffset / EMU_PER_PX);
  } else if (anchor.wrap === 'none') {
    s.position = 'absolute';
    if (!anchor.behindDoc) s.zIndex = '2';
    s.left = anchor.hOffset !== undefined ? px(anchor.hOffset / EMU_PER_PX) : anchor.hAlign === 'right' ? 'auto' : '0';
    if (anchor.hAlign === 'right') s.right = '0';
    if (anchor.hAlign === 'center') s.left = `calc(50% - ${px(width / 2)})`;
    s.top = anchor.vOffset !== undefined ? px(anchor.vOffset / EMU_PER_PX) : '0';
  } else {
    const right = anchor.hAlign === 'right' || (anchor.hOffset !== undefined && anchor.hOffset > 2_743_200);
    s.float = right ? 'right' : 'left';
    // Above the paragraphs that wrap around it, so they do not take its clicks.
    s.zIndex = '1';
    s.margin = `${pt(anchor.distT)} ${right ? '0' : pt(anchor.distR ?? 114300)} ${pt(anchor.distB)} ${right ? pt(anchor.distL ?? 114300) : '0'}`;
  }
  return s;
}

/**
 * The drawing as DOM: a box of the drawing's size (in the line, or placed by its anchor) with
 * the parts placed absolutely inside it, in drawing order. `mediaUrl` resolves pictures by
 * package path when given (their import-time URL is used otherwise).
 */
export function renderDrawing(model: DrawingModel, schema: Schema, mediaUrl?: (path: string) => string): HTMLElement {
  const root = document.createElement('span');
  root.className = 'ml-dx-drawing';
  root.contentEditable = 'false';
  root.style.width = px(model.width);
  root.style.height = px(model.height);
  if (model.anchor) {
    root.classList.add('ml-dx-float');
    if (model.anchor.behindDoc && model.anchor.wrap === 'none') root.classList.add('ml-dx-behind');
    Object.assign(root.style, placement(model.anchor, model.width));
  }
  for (const part of model.parts) root.appendChild(renderPart(part, schema, mediaUrl));
  return root;
}
