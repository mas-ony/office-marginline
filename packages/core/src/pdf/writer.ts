/**
 * PDF writer for laid-out pages: filled rectangles, lines, text in embedded TrueType fonts
 * (Identity-H, with a ToUnicode map so text can be selected and searched) or the standard
 * fonts, images with transparency, and link annotations. Coordinates are CSS pixels from the
 * top-left of each page.
 */
import { zlibSync } from 'fflate';
import type { SfntFont } from './sfnt';

export type RGB = [number, number, number];

export type FontRef =
  | { kind: 'embedded'; key: string; font: SfntFont }
  | { kind: 'standard'; name: StandardFont };

export type StandardFont =
  | 'Helvetica' | 'Helvetica-Bold' | 'Helvetica-Oblique' | 'Helvetica-BoldOblique'
  | 'Times-Roman' | 'Times-Bold' | 'Times-Italic' | 'Times-BoldItalic'
  | 'Courier' | 'Courier-Bold' | 'Courier-Oblique' | 'Courier-BoldOblique';

export interface ImageRef {
  key: string;
  width: number;
  height: number;
  /** RGB pixels (FlateDecode) or JPEG bytes (DCTDecode). */
  rgb?: Uint8Array;
  alpha?: Uint8Array;
  jpeg?: Uint8Array;
  jpegComponents?: number;
}

export type PdfOp =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; fill: RGB }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; width: number; color: RGB; dash?: number[] }
  | { kind: 'text'; x: number; baseline: number; size: number; font: FontRef; text: string; color: RGB; width?: number }
  | { kind: 'image'; x: number; y: number; w: number; h: number; image: ImageRef }
  | { kind: 'link'; x: number; y: number; w: number; h: number; uri?: string; dest?: { page: number; y: number } };

export interface PdfPage {
  width: number;
  height: number;
  ops: PdfOp[];
}

export interface PdfInfo {
  title?: string;
  author?: string;
}

const PT = 0.75;

const num = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

const color = (c: RGB) => c.map((v) => num(v / 255)).join(' ');

const WIN_ANSI: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89,
  'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95,
  '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
};

/** Windows-1252 bytes of a text, or null when a character is not in it. */
export function winAnsi(s: string): number[] | null {
  const out: number[] = [];
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) out.push(code);
    else if (WIN_ANSI[ch] !== undefined) out.push(WIN_ANSI[ch]);
    else if (code === 9 || code === 0x2002 || code === 0x2003) out.push(0x20);
    else return null;
  }
  return out;
}

function literal(bytes: number[]): string {
  let s = '(';
  for (const b of bytes) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) s += `\\${String.fromCharCode(b)}`;
    else if (b < 0x20 || b > 0x7e) s += `\\${b.toString(8).padStart(3, '0')}`;
    else s += String.fromCharCode(b);
  }
  return `${s})`;
}

function textString(s: string): string {
  const bytes = winAnsi(s);
  if (bytes) return literal(bytes);
  let hex = 'FEFF';
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, '0');
  return `<${hex}>`;
}

const STANDARD_WIDTH_GUESS = 0.5;

/** Collects the glyphs used from one embedded font. */
class EmbeddedFont {
  readonly used = new Map<number, string>();
  constructor(readonly font: SfntFont, readonly name: string) {}

  encode(text: string): { hex: string; units: number } {
    let hex = '';
    let units = 0;
    for (const ch of text) {
      const gid = this.font.glyphId(ch.codePointAt(0)!);
      if (!this.used.has(gid)) this.used.set(gid, ch);
      hex += gid.toString(16).padStart(4, '0');
      units += this.font.advance(gid);
    }
    return { hex, units: (units / this.font.unitsPerEm) * 1000 };
  }
}

/** True when every character of `text` has a glyph in the font. */
export function fontCovers(font: SfntFont, text: string): boolean {
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0x20 || cp === 0xa0) continue;
    if (!font.glyphId(cp)) return false;
  }
  return true;
}

export function writePdf(pages: PdfPage[], info: PdfInfo = {}): Uint8Array {
  const objects: (string | Uint8Array | (() => string | Uint8Array))[] = [];
  const enc = new TextEncoder();
  const add = (o: string | Uint8Array | (() => string | Uint8Array)) => {
    objects.push(o);
    return objects.length;
  };
  const stream = (dict: string, data: Uint8Array, compress = true): Uint8Array => {
    const body = compress ? zlibSync(data, { level: 6 }) : data;
    const head = enc.encode(`<< ${dict}${compress ? ' /Filter /FlateDecode' : ''} /Length ${body.length} >>\nstream\n`);
    const tail = enc.encode('\nendstream');
    const out = new Uint8Array(head.length + body.length + tail.length);
    out.set(head, 0);
    out.set(body, head.length);
    out.set(tail, head.length + body.length);
    return out;
  };

  const catalogId = add('');
  const pagesId = add('');
  const fontObj = new Map<string, { id: number; res: string; embedded?: EmbeddedFont }>();
  const imageObj = new Map<string, { id: number; res: string }>();

  const fontFor = (f: FontRef) => {
    const key = f.kind === 'standard' ? `std:${f.name}` : f.key;
    let e = fontObj.get(key);
    if (e) return e;
    const res = `F${fontObj.size + 1}`;
    if (f.kind === 'standard') {
      const id = add(`<< /Type /Font /Subtype /Type1 /BaseFont /${f.name} /Encoding /WinAnsiEncoding >>`);
      e = { id, res };
    } else {
      let n = fontObj.size;
      let tag = '';
      for (let i = 0; i < 6; i++) {
        tag = String.fromCharCode(65 + (n % 26)) + tag;
        n = Math.floor(n / 26);
      }
      const embedded = new EmbeddedFont(f.font, `${tag}+${f.font.postscriptName}`);
      // The dictionaries are written at the end, once the glyphs used are known.
      const id = add('');
      e = { id, res, embedded };
    }
    fontObj.set(key, e);
    return e;
  };

  const imageFor = (img: ImageRef) => {
    let e = imageObj.get(img.key);
    if (e) return e;
    const res = `Im${imageObj.size + 1}`;
    let id: number;
    if (img.jpeg) {
      const cs = img.jpegComponents === 1 ? '/DeviceGray' : img.jpegComponents === 4 ? '/DeviceCMYK /Decode [1 0 1 0 1 0 1 0]' : '/DeviceRGB';
      id = add(stream(`/Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace ${cs} /BitsPerComponent 8 /Filter /DCTDecode`, img.jpeg, false));
    } else {
      let smask = '';
      if (img.alpha) {
        const aid = add(stream(`/Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceGray /BitsPerComponent 8`, img.alpha));
        smask = ` /SMask ${aid} 0 R`;
      }
      id = add(stream(`/Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8${smask}`, img.rgb ?? new Uint8Array(img.width * img.height * 3)));
    }
    e = { id, res };
    imageObj.set(img.key, e);
    return e;
  };

  const pageIds: number[] = [];
  const pageRefs: number[] = [];
  // Reserve page object ids first so internal links can point at any page.
  for (let i = 0; i < pages.length; i++) pageRefs.push(add(''));
  pages.forEach((page, index) => {
    const W = page.width * PT;
    const H = page.height * PT;
    const X = (x: number) => num(x * PT);
    const Y = (y: number) => num(H - y * PT);
    const out: string[] = [];
    const fonts = new Set<string>();
    const images = new Set<string>();
    const annots: string[] = [];
    for (const op of page.ops) {
      switch (op.kind) {
        case 'rect':
          if (op.w <= 0 || op.h <= 0) break;
          out.push(`${color(op.fill)} rg ${X(op.x)} ${Y(op.y + op.h)} ${num(op.w * PT)} ${num(op.h * PT)} re f`);
          break;
        case 'line':
          out.push(`${color(op.color)} RG ${num(Math.max(0.1, op.width * PT))} w ${op.dash ? `[${op.dash.map((d) => num(d * PT)).join(' ')}] 0 d` : '[] 0 d'} ${X(op.x1)} ${Y(op.y1)} m ${X(op.x2)} ${Y(op.y2)} l S`);
          break;
        case 'text': {
          if (!op.text) break;
          const f = fontFor(op.font);
          fonts.add(`/${f.res} ${f.id} 0 R`);
          const size = op.size * PT;
          let show: string;
          let units: number;
          if (f.embedded) {
            const r = f.embedded.encode(op.text);
            show = `<${r.hex}>`;
            units = r.units;
          } else {
            const bytes = winAnsi(op.text) ?? [...op.text].map(() => 0x3f);
            show = literal(bytes);
            units = bytes.length * STANDARD_WIDTH_GUESS * 1000;
          }
          // Stretch or squeeze the run to the width measured in the browser.
          const natural = (units / 1000) * size;
          const tz = op.width && natural > 0 ? Math.max(50, Math.min(200, ((op.width * PT) / natural) * 100)) : 100;
          out.push(`BT /${f.res} ${num(size)} Tf ${num(tz)} Tz ${color(op.color)} rg ${X(op.x)} ${Y(op.baseline)} Td ${show} Tj ET`);
          break;
        }
        case 'image': {
          if (op.w <= 0 || op.h <= 0) break;
          const im = imageFor(op.image);
          images.add(`/${im.res} ${im.id} 0 R`);
          out.push(`q ${num(op.w * PT)} 0 0 ${num(op.h * PT)} ${X(op.x)} ${Y(op.y + op.h)} cm /${im.res} Do Q`);
          break;
        }
        case 'link': {
          const rect = `[${X(op.x)} ${Y(op.y + op.h)} ${X(op.x + op.w)} ${Y(op.y)}]`;
          if (op.uri) annots.push(`<< /Type /Annot /Subtype /Link /Rect ${rect} /Border [0 0 0] /A << /S /URI /URI ${textString(op.uri)} >> >>`);
          else if (op.dest && pageRefs[op.dest.page]) {
            const destH = pages[op.dest.page].height * PT;
            annots.push(`<< /Type /Annot /Subtype /Link /Rect ${rect} /Border [0 0 0] /Dest [${pageRefs[op.dest.page]} 0 R /XYZ 0 ${num(destH - op.dest.y * PT)} 0] >>`);
          }
          break;
        }
      }
    }
    const contentId = add(stream('', enc.encode(out.join('\n'))));
    const annotIds = annots.map((a) => add(a));
    const res = `<< /ProcSet [/PDF /Text /ImageB /ImageC] ${fonts.size ? `/Font << ${[...fonts].join(' ')} >>` : ''} ${images.size ? `/XObject << ${[...images].join(' ')} >>` : ''} >>`;
    objects[pageRefs[index] - 1] = `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${num(W)} ${num(H)}] /Resources ${res} /Contents ${contentId} 0 R${annotIds.length ? ` /Annots [${annotIds.map((a) => `${a} 0 R`).join(' ')}]` : ''} >>`;
    pageIds.push(pageRefs[index]);
  });

  // Embedded fonts: Type0 with a CIDFontType2 descendant, font file and ToUnicode map.
  for (const e of fontObj.values()) {
    if (!e.embedded) continue;
    const { font, used, name } = e.embedded;
    const k = 1000 / font.unitsPerEm;
    const gids = [...used.keys()].sort((a, b) => a - b);
    const widths = gids.map((g) => `${g} [${Math.round(font.advance(g) * k)}]`).join(' ');
    const fileId = add(stream(`/Length1 ${font.bytes.length}`, font.bytes));
    const flags = 32 + (font.italicAngle ? 64 : 0);
    const descId = add(`<< /Type /FontDescriptor /FontName /${name} /Flags ${flags} /FontBBox [${font.bbox.map((v) => Math.round(v * k)).join(' ')}] /ItalicAngle ${num(font.italicAngle)} /Ascent ${Math.round(font.ascender * k)} /Descent ${Math.round(font.descender * k)} /CapHeight ${Math.round(font.capHeight * k)} /StemV 80 /FontFile2 ${fileId} 0 R >>`);
    const cidId = add(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descId} 0 R /DW 1000 /W [${widths}] /CIDToGIDMap /Identity >>`);
    const lines: string[] = [];
    for (const g of gids) {
      const ch = used.get(g)!;
      let hex = '';
      for (let i = 0; i < ch.length; i++) hex += ch.charCodeAt(i).toString(16).padStart(4, '0');
      lines.push(`<${g.toString(16).padStart(4, '0')}> <${hex}>`);
    }
    const chunks: string[] = [];
    for (let i = 0; i < lines.length; i += 100) chunks.push(`${Math.min(100, lines.length - i)} beginbfchar\n${lines.slice(i, i + 100).join('\n')}\nendbfchar`);
    const cmap = `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${chunks.join('\n')}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
    const toUni = add(stream('', enc.encode(cmap)));
    objects[e.id - 1] = `<< /Type /Font /Subtype /Type0 /BaseFont /${name} /Encoding /Identity-H /DescendantFonts [${cidId} 0 R] /ToUnicode ${toUni} 0 R >>`;
  }

  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `D:${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  const infoId = add(`<< /Producer (Marginline) /Creator (Marginline) /CreationDate (${date})${info.title ? ` /Title ${textString(info.title)}` : ''}${info.author ? ` /Author ${textString(info.author)}` : ''} >>`);

  // Serialize.
  const parts: Uint8Array[] = [enc.encode('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n')];
  let offset = parts[0].length;
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    const body = typeof o === 'function' ? o() : o;
    const head = enc.encode(`${i + 1} 0 obj\n`);
    const data = typeof body === 'string' ? enc.encode(body) : body;
    const tail = enc.encode('\nendobj\n');
    offsets.push(offset);
    parts.push(head, data, tail);
    offset += head.length + data.length + tail.length;
  });
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
  parts.push(enc.encode(`${xref}trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${offset}\n%%EOF\n`));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
