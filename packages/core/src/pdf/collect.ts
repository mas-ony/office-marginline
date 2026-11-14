/**
 * Reads a laid-out copy of the pages (DocxEditor.renderForExport) and turns it into PDF drawing
 * operations: backgrounds and borders of elements, pictures, links and the text, word by word at
 * the positions the browser measured. Text is drawn with the bundled fonts embedded (or a
 * standard font); words the fonts cannot show correctly (right-to-left and complex scripts, CJK)
 * are drawn as images rendered by the browser.
 */
import type { PageInfo } from '../editor/layout/geometry';
import { parseFont, type SfntFont } from './sfnt';
import { fontCovers, type FontRef, type ImageRef, type PathSeg, type PdfOp, type PdfPage, type RGB, type StandardFont, winAnsi } from './writer';

// -----------------------------------------------------------------------------------------------
// Fonts

interface FaceSource {
  family: string;
  weight: number;
  italic: boolean;
  ranges: [number, number][];
  url: string;
}

const BUNDLED = new Set(['carlito', 'caladea', 'arimo', 'tinos', 'cousine']);
const SUBSTITUTES: Record<string, string> = {
  calibri: 'carlito',
  'calibri light': 'carlito',
  aptos: 'carlito',
  cambria: 'caladea',
  'cambria math': 'caladea',
  arial: 'arimo',
  helvetica: 'arimo',
  'liberation sans': 'arimo',
  'times new roman': 'tinos',
  times: 'tinos',
  'liberation serif': 'tinos',
  'courier new': 'cousine',
  courier: 'cousine',
  'liberation mono': 'cousine',
};

function parseRanges(value: string): [number, number][] {
  if (!value.trim()) return [[0, 0x10ffff]];
  return value.split(',').map((part) => {
    const m = /U\+([0-9A-F?]+)(?:-([0-9A-F]+))?/i.exec(part.trim());
    if (!m) return [0, -1] as [number, number];
    if (m[1].includes('?')) return [parseInt(m[1].replace(/\?/g, '0'), 16), parseInt(m[1].replace(/\?/g, 'F'), 16)] as [number, number];
    const a = parseInt(m[1], 16);
    return [a, m[2] ? parseInt(m[2], 16) : a] as [number, number];
  });
}

/** WOFF sources of the bundled faces, read from the @font-face rules on the page. */
function bundledFaces(): FaceSource[] {
  const out: FaceSource[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      const family = rule.style.getPropertyValue('font-family').replace(/["']/g, '').trim().toLowerCase();
      if (!BUNDLED.has(family)) continue;
      const src = rule.style.getPropertyValue('src');
      const woff = /url\(["']?([^"')]+\.woff)["']?\)\s*format\(["']?woff["']?\)/i.exec(src);
      if (!woff) continue;
      const url = new URL(woff[1], sheet.href ?? location.href).href;
      out.push({
        family,
        weight: parseInt(rule.style.getPropertyValue('font-weight'), 10) || 400,
        italic: /italic|oblique/.test(rule.style.getPropertyValue('font-style')),
        ranges: parseRanges(rule.style.getPropertyValue('unicode-range')),
        url,
      });
    }
  }
  return out;
}

const fontCache = new Map<string, Promise<SfntFont | null>>();

function loadFont(url: string): Promise<SfntFont | null> {
  let p = fontCache.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((buf) => parseFont(new Uint8Array(buf)))
      .catch(() => null);
    fontCache.set(url, p);
  }
  return p;
}

const systemCache = new Map<string, boolean>();

/** Whether a family is installed (rendered differently from the fallback). */
function installed(family: string): boolean {
  let v = systemCache.get(family);
  if (v !== undefined) return v;
  const c = document.createElement('canvas').getContext('2d');
  if (!c) return false;
  const sample = 'mmmmmmmmmlli1WQ@#';
  const widths = ['monospace', 'serif'].map((g) => {
    c.font = `40px ${g}`;
    const base = c.measureText(sample).width;
    c.font = `40px "${family}", ${g}`;
    return Math.abs(c.measureText(sample).width - base) > 0.5;
  });
  v = widths[0] || widths[1];
  systemCache.set(family, v);
  return v;
}

type Resolved = { kind: 'bundled'; family: string } | { kind: 'standard'; base: 'Helvetica' | 'Times' | 'Courier' };

function standardFor(family: string): 'Helvetica' | 'Times' | 'Courier' {
  const f = family.toLowerCase();
  if (/mono|courier|consol|menlo|code|typewriter/.test(f)) return 'Courier';
  if (/serif|times|georgia|garamond|cambria|book|palatino|minion|caslon|baskerville|tinos|caladea|^roman/.test(f) && !/sans/.test(f)) return 'Times';
  return 'Helvetica';
}

const resolveCache = new Map<string, Resolved>();

/** The face the browser draws a CSS font-family list with, mapped to something embeddable. */
function resolveFamily(list: string): Resolved {
  let r = resolveCache.get(list);
  if (r) return r;
  const families = list.split(',').map((f) => f.trim().replace(/^["']|["']$/g, ''));
  r = { kind: 'standard', base: 'Helvetica' };
  for (const fam of families) {
    const low = fam.toLowerCase();
    if (BUNDLED.has(low)) {
      r = { kind: 'bundled', family: low };
      break;
    }
    if (SUBSTITUTES[low]) {
      r = { kind: 'bundled', family: SUBSTITUTES[low] };
      break;
    }
    if (low === 'serif') {
      r = { kind: 'bundled', family: 'tinos' };
      break;
    }
    if (low === 'sans-serif' || low === 'system-ui') {
      r = { kind: 'bundled', family: 'arimo' };
      break;
    }
    if (low === 'monospace') {
      r = { kind: 'bundled', family: 'cousine' };
      break;
    }
    if (installed(fam)) {
      r = { kind: 'standard', base: standardFor(fam) };
      break;
    }
  }
  resolveCache.set(list, r);
  return r;
}

function standardName(base: 'Helvetica' | 'Times' | 'Courier', bold: boolean, italic: boolean): StandardFont {
  if (base === 'Times') return (bold ? (italic ? 'Times-BoldItalic' : 'Times-Bold') : italic ? 'Times-Italic' : 'Times-Roman');
  const suffix = bold ? (italic ? '-BoldOblique' : '-Bold') : italic ? '-Oblique' : '';
  return `${base}${suffix}` as StandardFont;
}

// -----------------------------------------------------------------------------------------------
// Colours and geometry

function parseColor(css: string): { rgb: RGB; alpha: number } | null {
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/.exec(css);
  if (!m) return null;
  let a = m[4] === undefined ? 1 : parseFloat(m[4]);
  if (m[4]?.endsWith('%')) a /= 100;
  return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], alpha: a };
}

/**
 * A path of a drawing (the editor writes them with absolute M, L, C and Z only) as a PDF path,
 * through the element's transform to the screen; colours blended over white like the rest.
 */
function pathOp(el: SVGPathElement, s: CSSStyleDeclaration, ctm: DOMMatrix, to: (x: number, y: number) => [number, number]): PdfOp | null {
  const tokens = (el.getAttribute('d') ?? '').match(/[MLCZ]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
  const at = (i: number): [number, number] => {
    const p = new DOMPoint(Number(tokens[i]), Number(tokens[i + 1])).matrixTransform(ctm);
    return to(p.x, p.y);
  };
  const segs: PathSeg[] = [];
  for (let i = 0; i < tokens.length;) {
    const c = tokens[i++].toUpperCase();
    if (c === 'Z') segs.push(['Z']);
    else if (c === 'M' || c === 'L') {
      segs.push([c, ...at(i)]);
      i += 2;
    } else if (c === 'C') {
      segs.push(['C', ...at(i), ...at(i + 2), ...at(i + 4)]);
      i += 6;
    }
  }
  const opacity = parseFloat(s.opacity || '1');
  const paint = (value: string, alpha: number): RGB | undefined => {
    const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
    const c = hex ? { rgb: [0, 2, 4].map((k) => parseInt(hex[1].slice(k, k + 2), 16)) as RGB, alpha: 1 } : parseColor(value);
    if (!c) return undefined;
    const a = c.alpha * alpha;
    return a > 0.02 ? solid({ rgb: c.rgb, alpha: a }) : undefined;
  };
  // Gradients are drawn in their middle colour.
  const fill = paint(s.fill.startsWith('url(') ? el.dataset.fill ?? '' : s.fill, parseFloat(s.fillOpacity || '1') * opacity);
  const stroke = paint(s.stroke, parseFloat(s.strokeOpacity || '1') * opacity);
  if (!segs.length || (!fill && !stroke)) return null;
  const scale = Math.sqrt(Math.abs(ctm.a * ctm.d - ctm.b * ctm.c)) || 1;
  const dash = s.strokeDasharray && s.strokeDasharray !== 'none' ? s.strokeDasharray.split(/[\s,]+/).map((v) => parseFloat(v) * scale).filter((v) => v > 0) : undefined;
  return {
    kind: 'path',
    segs,
    fill,
    evenOdd: s.fillRule === 'evenodd',
    stroke,
    width: (parseFloat(s.strokeWidth) || 1) * scale,
    dash: dash?.length ? dash : undefined,
    cap: s.strokeLinecap === 'round' || s.strokeLinecap === 'square' ? s.strokeLinecap : 'butt',
    join: s.strokeLinejoin === 'round' || s.strokeLinejoin === 'bevel' ? s.strokeLinejoin : 'miter',
  };
}

/** Blend a translucent colour over white (pages are white). */
function solid(c: { rgb: RGB; alpha: number }): RGB {
  const a = Math.max(0, Math.min(1, c.alpha));
  return c.rgb.map((v) => Math.round(v * a + 255 * (1 - a))) as RGB;
}

interface Box {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

const COMPLEX = /[֐-ࣿऀ-෿฀-໿ༀ-႟ក-៿יִ-﷿ﹰ-﻿]/;
const RTL = /[֐-ࣿיִ-﷿ﹰ-﻿]/;

interface TextPiece {
  box: Box;
  text: string;
  el: HTMLElement;
}

export interface Collected {
  pages: PdfPage[];
}

/** Read the export copy and produce PDF pages. */
export async function collect(canvas: HTMLElement, pages: PageInfo[]): Promise<Collected> {
  const origin = canvas.getBoundingClientRect();
  const out: PdfPage[] = pages.map((p) => ({ width: p.width, height: p.height, ops: [] }));
  const ranks = pages.map((p) => ({ top: p.top, bottom: p.top + p.height, left: p.left }));

  const pageAt = (cy: number): number => {
    for (let i = 0; i < ranks.length; i++) if (cy >= ranks[i].top - 0.5 && cy < ranks[i].bottom + 0.5) return i;
    return -1;
  };
  const toBox = (r: DOMRect | { left: number; top: number; width: number; height: number }): Box | null => {
    const x = r.left - origin.left;
    const y = r.top - origin.top;
    const page = pageAt(y + r.height / 2);
    if (page < 0) return null;
    return { page, x: x - ranks[page].left, y: y - ranks[page].top, w: r.width, h: r.height };
  };
  const push = (page: number, op: PdfOp) => out[page].ops.push(op);

  // Labels drawn with ::before/::after become real text so they can be measured.
  for (const el of Array.from(canvas.querySelectorAll<HTMLElement>('.ml-dx-list'))) {
    const before = getComputedStyle(el, '::before');
    const span = document.createElement('span');
    span.className = 'ml-dx-pdf-label';
    span.textContent = (el.dataset.label ?? '').replace(/​/g, '') + (el.classList.contains('ml-dx-suff-space') ? ' ' : '');
    for (const prop of ['display', 'min-width', 'font-family', 'font-size', 'font-weight', 'font-style', 'color', 'padding-right', 'text-align', 'white-space', 'box-sizing', 'text-indent']) {
      span.style.setProperty(prop, before.getPropertyValue(prop));
    }
    el.insertBefore(span, el.firstChild);
  }
  for (const el of Array.from(canvas.querySelectorAll<HTMLElement>('.ml-dx-footnote-ref'))) {
    const span = document.createElement('span');
    span.textContent = el.dataset.num ?? '';
    el.appendChild(span);
  }

  const styleCache = new Map<Element, CSSStyleDeclaration>();
  const style = (el: Element) => {
    let s = styleCache.get(el);
    if (!s) {
      s = getComputedStyle(el);
      styleCache.set(el, s);
    }
    return s;
  };

  // Pass 1: backgrounds, borders, pictures and links, in document order (painting order).
  const images: Promise<void>[] = [];
  const all = Array.from(canvas.querySelectorAll<HTMLElement>('*'));
  for (const el of all) {
    const s = style(el);
    if (s.display === 'none' || s.visibility === 'hidden') continue;
    if (el.closest('.ml-dx-hf-measure, .ml-dx-hf-proto')) continue;
    const isPage = el.classList.contains('ml-dx-page');
    const bg = parseColor(s.backgroundColor);
    if (bg && bg.alpha > 0.02 && !isPage) {
      const inline = s.display === 'inline';
      for (const r of inline ? Array.from(el.getClientRects()) : [el.getBoundingClientRect()]) {
        const b = toBox(r);
        if (b) push(b.page, { kind: 'rect', x: b.x, y: b.y, w: b.w, h: b.h, fill: solid(bg) });
      }
    }
    if (!isPage && s.display !== 'inline') {
      const r = el.getBoundingClientRect();
      const b = toBox(r);
      if (b) {
        const side = (name: 'top' | 'right' | 'bottom' | 'left') => {
          const w = parseFloat(s.getPropertyValue(`border-${name}-width`));
          const st = s.getPropertyValue(`border-${name}-style`);
          if (!w || st === 'none' || st === 'hidden') return;
          const c = parseColor(s.getPropertyValue(`border-${name}-color`));
          if (!c || c.alpha < 0.05) return;
          const half = w / 2;
          const dash = st === 'dashed' ? [w * 3, w * 2] : st === 'dotted' ? [w, w] : undefined;
          const line = (x1: number, y1: number, x2: number, y2: number) => push(b.page, { kind: 'line', x1, y1, x2, y2, width: st === 'double' ? w / 3 : w, color: solid(c), dash });
          if (name === 'top') line(b.x, b.y + half, b.x + b.w, b.y + half);
          if (name === 'bottom') line(b.x, b.y + b.h - half, b.x + b.w, b.y + b.h - half);
          if (name === 'left') line(b.x + half, b.y, b.x + half, b.y + b.h);
          if (name === 'right') line(b.x + b.w - half, b.y, b.x + b.w - half, b.y + b.h);
          if (st === 'double') {
            if (name === 'top') line(b.x, b.y + w - w / 6, b.x + b.w, b.y + w - w / 6);
            if (name === 'bottom') line(b.x, b.y + b.h - w + w / 6, b.x + b.w, b.y + b.h - w + w / 6);
            if (name === 'left') line(b.x + w - w / 6, b.y, b.x + w - w / 6, b.y + b.h);
            if (name === 'right') line(b.x + b.w - w + w / 6, b.y, b.x + b.w - w + w / 6, b.y + b.h);
          }
        };
        side('top');
        side('right');
        side('bottom');
        side('left');
      }
    }
    if (el.classList.contains('ml-dx-note-sep')) {
      const b = toBox(el.getBoundingClientRect());
      if (b) push(b.page, { kind: 'line', x1: b.x, y1: b.y + b.h / 2, x2: b.x + Math.min(192, b.w / 3), y2: b.y + b.h / 2, width: 1, color: [0, 0, 0] });
    }
    if (el instanceof SVGPathElement && el.closest('.ml-dx-drawing-svg')) {
      const r = el.getBoundingClientRect();
      const page = pageAt(r.top - origin.top + r.height / 2);
      const ctm = el.getScreenCTM();
      if (page >= 0 && ctm) {
        const op = pathOp(el, s, ctm, (x, y) => [x - origin.left - ranks[page].left, y - origin.top - ranks[page].top]);
        if (op) push(page, op);
      }
    }
    if (el instanceof HTMLImageElement) {
      // A cropped picture in a drawing is larger than its frame, which shows part of it.
      const crop = el.dataset.crop?.split(' ').map(Number);
      const frame = crop?.length === 4 && el.parentElement ? el.parentElement : el;
      const b = toBox(frame.getBoundingClientRect());
      if (b && b.w > 0 && b.h > 0) {
        const op: PdfOp & { kind: 'image' } = { kind: 'image', x: b.x, y: b.y, w: b.w, h: b.h, image: { key: '', width: 1, height: 1 } };
        push(b.page, op);
        images.push(rasterImage(el, b.w, b.h, frame === el ? undefined : crop).then((img) => {
          if (img) op.image = img;
          else op.w = 0;
        }));
      }
    }
    if (el instanceof HTMLAnchorElement) {
      const href = el.getAttribute('href') ?? '';
      for (const r of Array.from(el.getClientRects())) {
        const b = toBox(r);
        if (!b) continue;
        if (/^(https?:|mailto:)/i.test(href)) push(b.page, { kind: 'link', x: b.x, y: b.y, w: b.w, h: b.h, uri: href });
        else if (href.startsWith('#')) {
          const target = canvas.querySelector(`[id="${CSS.escape(href.slice(1))}"]`);
          const tb = target ? toBox(target.getBoundingClientRect()) : null;
          if (tb) push(b.page, { kind: 'link', x: b.x, y: b.y, w: b.w, h: b.h, dest: { page: tb.page, y: Math.max(0, tb.y - 12) } });
        }
      }
    }
  }
  await Promise.all(images);

  // Pass 2: text, word by word.
  const pieces: TextPiece[] = [];
  const walker = document.createTreeWalker(canvas, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node.textContent ?? '';
    if (!text.trim()) continue;
    const el = node.parentElement;
    if (!el || el.closest('.ml-dx-hf-measure, .ml-dx-hf-proto, .ml-dx-hf-bar, .ml-dx-page-field-proto')) continue;
    const s = style(el);
    if (s.visibility === 'hidden' || s.display === 'none') continue;
    const re = /\S+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const start = m.index;
      const end = start + m[0].length;
      range.setStart(node, start);
      range.setEnd(node, end);
      const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
      if (!rects.length) continue;
      const sameLine = rects.every((r) => Math.abs(r.top - rects[0].top) <= 2);
      if (sameLine) {
        // One line (several rectangles when a word mixes text directions): use their union.
        const left = Math.min(...rects.map((r) => r.left));
        const right = Math.max(...rects.map((r) => r.right));
        const top = Math.min(...rects.map((r) => r.top));
        const bottom = Math.max(...rects.map((r) => r.bottom));
        const b = toBox({ left, top, width: right - left, height: bottom - top });
        if (b) pieces.push({ box: b, text: m[0], el });
        continue;
      }
      // The token wraps over lines (no spaces, e.g. CJK): split it by line.
      let segStart = start;
      let segTop = -1;
      for (let i = start; i <= end; i++) {
        let top = -1;
        if (i < end) {
          range.setStart(node, i);
          range.setEnd(node, i + 1);
          const r = range.getClientRects()[0];
          top = r ? Math.round(r.top) : segTop;
        }
        if (i === end || (segTop >= 0 && Math.abs(top - segTop) > 2)) {
          range.setStart(node, segStart);
          range.setEnd(node, i);
          const r = Array.from(range.getClientRects()).find((x) => x.width > 0);
          const b = r ? toBox(r) : null;
          if (b) pieces.push({ box: b, text: text.slice(segStart, i), el });
          segStart = i;
        }
        if (top >= 0) segTop = top;
      }
    }
  }
  range.detach?.();

  // Load the faces the text needs.
  const faces = bundledFaces();
  const faceFor = (family: string, weight: number, italic: boolean, cp: number): FaceSource | null => {
    const cands = faces.filter((f) => f.family === family && f.ranges.some(([a, b]) => cp >= a && cp <= b));
    if (!cands.length) return null;
    const score = (f: FaceSource) => Math.abs(f.weight - (weight >= 600 ? 700 : 400)) + (f.italic === italic ? 0 : 1000);
    return cands.sort((a, b) => score(a) - score(b))[0];
  };
  const fontsByUrl = new Map<string, SfntFont | null>();
  const wanted = new Set<string>();
  for (const pc of pieces) {
    const s = style(pc.el);
    const r = resolveFamily(s.fontFamily);
    if (r.kind !== 'bundled') continue;
    const weight = parseInt(s.fontWeight, 10) || 400;
    const italic = s.fontStyle !== 'normal';
    for (const ch of pc.text) {
      const f = faceFor(r.family, weight, italic, ch.codePointAt(0)!);
      if (f) wanted.add(f.url);
    }
  }
  await Promise.all([...wanted].map(async (url) => fontsByUrl.set(url, await loadFont(url))));

  const ascentCache = new Map<string, number>();
  const measureCtx = document.createElement('canvas').getContext('2d');
  const ascentOf = (font: string, fallback: number): number => {
    let a = ascentCache.get(font);
    if (a === undefined) {
      if (measureCtx) {
        measureCtx.font = font;
        const tm = measureCtx.measureText('Hg');
        a = tm.fontBoundingBoxAscent || fallback;
      } else a = fallback;
      ascentCache.set(font, a);
    }
    return a;
  };

  const decorations = (el: HTMLElement): { line: string; color: string; style: string }[] => {
    const out2: { line: string; color: string; style: string }[] = [];
    for (let e: HTMLElement | null = el; e && !e.classList.contains('ml-dx-p') && !e.classList.contains('ml-dx-doc'); e = e.parentElement) {
      const s = style(e);
      const line = s.textDecorationLine;
      if (line && line !== 'none') out2.push({ line, color: s.textDecorationColor || s.color, style: s.textDecorationStyle });
    }
    return out2;
  };

  for (const pc of pieces) {
    const s = style(pc.el);
    const size = parseFloat(s.fontSize) || 14;
    const col = parseColor(s.color);
    if (!col || col.alpha < 0.05) continue;
    const color = solid(col);
    const weight = parseInt(s.fontWeight, 10) || 400;
    const italic = s.fontStyle !== 'normal';
    let text = pc.text;
    if (s.textTransform === 'uppercase' || s.fontVariantCaps === 'small-caps' || s.fontVariant.includes('small-caps')) text = text.toUpperCase();
    else if (s.textTransform === 'lowercase') text = text.toLowerCase();
    const fontCss = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
    const ascent = ascentOf(fontCss, size * 0.8);
    const b = pc.box;
    const baseline = b.y + ascent;
    const resolved = resolveFamily(s.fontFamily);
    let drawn = false;
    if (!COMPLEX.test(text)) {
      if (resolved.kind === 'bundled') {
        // Split the word into runs that one face covers (latin, cyrillic... are separate files).
        const runs: { font: SfntFont; key: string; text: string }[] = [];
        let ok = true;
        for (const ch of text) {
          const face = faceFor(resolved.family, weight, italic, ch.codePointAt(0)!);
          const font = face ? fontsByUrl.get(face.url) : null;
          if (!face || !font || !fontCovers(font, ch)) {
            ok = false;
            break;
          }
          const last = runs[runs.length - 1];
          if (last && last.key === face.url) last.text += ch;
          else runs.push({ font, key: face.url, text: ch });
        }
        if (ok && runs.length) {
          if (runs.length === 1) {
            push(b.page, { kind: 'text', x: b.x, baseline, size, font: { kind: 'embedded', key: runs[0].key, font: runs[0].font }, text: runs[0].text, color, width: b.w });
          } else {
            // Place each run by its share of the natural width.
            const widths = runs.map((r) => [...r.text].reduce((w, ch) => w + r.font.advance(r.font.glyphId(ch.codePointAt(0)!)) / r.font.unitsPerEm, 0));
            const total = widths.reduce((a2, c) => a2 + c, 0) || 1;
            let x = b.x;
            runs.forEach((r, i) => {
              const w = (widths[i] / total) * b.w;
              push(b.page, { kind: 'text', x, baseline, size, font: { kind: 'embedded', key: r.key, font: r.font }, text: r.text, color, width: w });
              x += w;
            });
          }
          drawn = true;
        }
      } else if (winAnsi(text)) {
        const font: FontRef = { kind: 'standard', name: standardName(resolved.base, weight >= 600, italic) };
        push(b.page, { kind: 'text', x: b.x, baseline, size, font, text, color, width: b.w });
        drawn = true;
      }
    }
    if (!drawn) {
      const img = rasterText(text, fontCss, color, b.w, b.h, ascent, RTL.test(text));
      if (img) push(b.page, { kind: 'image', x: b.x, y: b.y, w: b.w, h: b.h, image: img });
    }
    for (const d of decorations(pc.el)) {
      const dc = parseColor(d.color);
      const lc = dc ? solid(dc) : color;
      const thick = Math.max(0.75, size / 16);
      const lines: number[] = [];
      if (d.line.includes('underline')) lines.push(baseline + Math.max(1, size * 0.11));
      if (d.line.includes('line-through')) lines.push(baseline - size * 0.28);
      if (d.line.includes('overline')) lines.push(b.y + 0.5);
      for (const y of lines) {
        push(b.page, { kind: 'line', x1: b.x, y1: y, x2: b.x + b.w, y2: y, width: thick, color: lc, dash: d.style === 'dashed' ? [3, 2] : d.style === 'dotted' ? [1, 1.5] : undefined });
        if (d.style === 'double') push(b.page, { kind: 'line', x1: b.x, y1: y + thick * 2, x2: b.x + b.w, y2: y + thick * 2, width: thick, color: lc });
      }
    }
  }
  // Spaces between words are not drawn; underlined spaces are covered by the word lines above.
  return { pages: out };
}

let imageCounter = 0;

/** Pixels of an image element at the size it is shown (2× for sharpness, capped). */
async function rasterImage(img: HTMLImageElement, w: number, h: number, crop?: number[]): Promise<ImageRef | null> {
  try {
    if (!img.complete) await img.decode();
  } catch {
    return null;
  }
  const scale = Math.min(2, 2400 / Math.max(w, h, 1));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  try {
    if (crop) {
      // Fractions cut from the left, top, right and bottom of the picture.
      const [l, t, r, b] = crop;
      const nw = img.naturalWidth;
      const nh = img.naturalHeight;
      ctx.drawImage(img, l * nw, t * nh, Math.max(1, (1 - l - r) * nw), Math.max(1, (1 - t - b) * nh), 0, 0, cw, ch);
    } else ctx.drawImage(img, 0, 0, cw, ch);
    return pixels(ctx.getImageData(0, 0, cw, ch), `img${++imageCounter}`);
  } catch {
    return null;
  }
}

function pixels(data: ImageData, key: string): ImageRef {
  const n = data.width * data.height;
  const rgb = new Uint8Array(n * 3);
  const alpha = new Uint8Array(n);
  let translucent = false;
  for (let i = 0; i < n; i++) {
    rgb[i * 3] = data.data[i * 4];
    rgb[i * 3 + 1] = data.data[i * 4 + 1];
    rgb[i * 3 + 2] = data.data[i * 4 + 2];
    alpha[i] = data.data[i * 4 + 3];
    if (alpha[i] < 255) translucent = true;
  }
  return { key, width: data.width, height: data.height, rgb, alpha: translucent ? alpha : undefined };
}

/** A word drawn by the browser (shaping, right-to-left, fonts without embeddable glyphs). */
function rasterText(text: string, font: string, color: RGB, w: number, h: number, ascent: number, rtl: boolean): ImageRef | null {
  const scale = 3;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w * scale));
  c.height = Math.max(1, Math.ceil(h * scale));
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.scale(scale, scale);
  ctx.font = font;
  ctx.fillStyle = `rgb(${color.join(',')})`;
  ctx.textBaseline = 'alphabetic';
  if (rtl) {
    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    ctx.fillText(text, w, ascent);
  } else {
    ctx.fillText(text, 0, ascent);
  }
  return pixels(ctx.getImageData(0, 0, c.width, c.height), `txt${++imageCounter}`);
}
