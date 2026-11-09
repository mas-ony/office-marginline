/**
 * Just enough of the TrueType format to embed a font in a PDF: WOFF 1.0 unwrapping, the tables
 * that give glyph ids and widths (cmap, hmtx), and the metrics a font descriptor needs.
 */
import { unzlibSync } from 'fflate';

export interface SfntFont {
  /** The TrueType (sfnt) file. */
  bytes: Uint8Array;
  unitsPerEm: number;
  ascender: number;
  descender: number;
  capHeight: number;
  bbox: [number, number, number, number];
  italicAngle: number;
  numGlyphs: number;
  postscriptName: string;
  glyphId(codePoint: number): number;
  /** Advance width of a glyph in font units. */
  advance(gid: number): number;
}

const tag = (d: DataView, o: number) => String.fromCharCode(d.getUint8(o), d.getUint8(o + 1), d.getUint8(o + 2), d.getUint8(o + 3));

/** Convert a WOFF 1.0 file into the TrueType file it wraps (TrueType input is returned as is). */
export function unwrapWoff(input: Uint8Array): Uint8Array {
  const d = new DataView(input.buffer, input.byteOffset, input.byteLength);
  if (tag(d, 0) !== 'wOFF') return input;
  const flavor = d.getUint32(4);
  const numTables = d.getUint16(12);
  const tables: { tag: string; data: Uint8Array; checksum: number }[] = [];
  for (let i = 0; i < numTables; i++) {
    const e = 44 + i * 20;
    const t = tag(d, e);
    const offset = d.getUint32(e + 4);
    const compLength = d.getUint32(e + 8);
    const origLength = d.getUint32(e + 12);
    const checksum = d.getUint32(e + 16);
    const raw = input.subarray(offset, offset + compLength);
    const data = compLength < origLength ? unzlibSync(raw) : raw.slice();
    tables.push({ tag: t, data, checksum });
  }
  tables.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  const headerSize = 12 + 16 * numTables;
  let size = headerSize;
  for (const t of tables) size += (t.data.length + 3) & ~3;
  const out = new Uint8Array(size);
  const o = new DataView(out.buffer);
  o.setUint32(0, flavor);
  o.setUint16(4, numTables);
  let pow = 1;
  let log = 0;
  while (pow * 2 <= numTables) {
    pow *= 2;
    log++;
  }
  o.setUint16(6, pow * 16);
  o.setUint16(8, log);
  o.setUint16(10, numTables * 16 - pow * 16);
  let at = headerSize;
  tables.forEach((t, i) => {
    const e = 12 + i * 16;
    for (let k = 0; k < 4; k++) o.setUint8(e + k, t.tag.charCodeAt(k));
    o.setUint32(e + 4, t.checksum);
    o.setUint32(e + 8, at);
    o.setUint32(e + 12, t.data.length);
    out.set(t.data, at);
    at += (t.data.length + 3) & ~3;
  });
  return out;
}

function tableDir(d: DataView): Map<string, { offset: number; length: number }> {
  const n = d.getUint16(4);
  const out = new Map<string, { offset: number; length: number }>();
  for (let i = 0; i < n; i++) {
    const e = 12 + i * 16;
    out.set(tag(d, e), { offset: d.getUint32(e + 8), length: d.getUint32(e + 12) });
  }
  return out;
}

/** Character to glyph mapping from a format 4 or 12 cmap subtable (Unicode). */
function readCmap(d: DataView, base: number): (cp: number) => number {
  const count = d.getUint16(base + 2);
  let best = -1;
  let bestFormat = 0;
  for (let i = 0; i < count; i++) {
    const rec = base + 4 + i * 8;
    const platform = d.getUint16(rec);
    const encoding = d.getUint16(rec + 2);
    const offset = base + d.getUint32(rec + 4);
    const format = d.getUint16(offset);
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicode) continue;
    if (format === 12 && bestFormat !== 12) {
      best = offset;
      bestFormat = 12;
    } else if (format === 4 && !bestFormat) {
      best = offset;
      bestFormat = 4;
    }
  }
  if (best < 0) return () => 0;
  if (bestFormat === 12) {
    const groups = d.getUint32(best + 12);
    const starts: number[] = [];
    const ends: number[] = [];
    const glyphs: number[] = [];
    for (let i = 0; i < groups; i++) {
      const g = best + 16 + i * 12;
      starts.push(d.getUint32(g));
      ends.push(d.getUint32(g + 4));
      glyphs.push(d.getUint32(g + 8));
    }
    return (cp) => {
      let lo = 0;
      let hi = groups - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (cp < starts[mid]) hi = mid - 1;
        else if (cp > ends[mid]) lo = mid + 1;
        else return glyphs[mid] + cp - starts[mid];
      }
      return 0;
    };
  }
  const segX2 = d.getUint16(best + 6);
  const segs = segX2 / 2;
  const endsAt = best + 14;
  const startsAt = endsAt + segX2 + 2;
  const deltaAt = startsAt + segX2;
  const rangeAt = deltaAt + segX2;
  return (cp) => {
    if (cp > 0xffff) return 0;
    for (let i = 0; i < segs; i++) {
      const end = d.getUint16(endsAt + i * 2);
      if (cp > end) continue;
      const start = d.getUint16(startsAt + i * 2);
      if (cp < start) return 0;
      const delta = d.getInt16(deltaAt + i * 2);
      const rangeOffset = d.getUint16(rangeAt + i * 2);
      if (!rangeOffset) return (cp + delta) & 0xffff;
      const g = d.getUint16(rangeAt + i * 2 + rangeOffset + (cp - start) * 2);
      return g ? (g + delta) & 0xffff : 0;
    }
    return 0;
  };
}

function readName(d: DataView, base: number, id: number): string {
  const count = d.getUint16(base + 2);
  const strings = base + d.getUint16(base + 4);
  for (let i = 0; i < count; i++) {
    const r = base + 6 + i * 12;
    const platform = d.getUint16(r);
    const nameId = d.getUint16(r + 6);
    if (nameId !== id) continue;
    const length = d.getUint16(r + 8);
    const offset = strings + d.getUint16(r + 10);
    let s = '';
    if (platform === 3 || platform === 0) for (let k = 0; k < length; k += 2) s += String.fromCharCode(d.getUint16(offset + k));
    else for (let k = 0; k < length; k++) s += String.fromCharCode(d.getUint8(offset + k));
    if (s) return s;
  }
  return '';
}

export function parseFont(input: Uint8Array): SfntFont {
  const bytes = unwrapWoff(input);
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dir = tableDir(d);
  const need = (t: string) => {
    const e = dir.get(t);
    if (!e) throw new Error(`Font table ${t} missing`);
    return e.offset;
  };
  const head = need('head');
  const hhea = need('hhea');
  const maxp = need('maxp');
  const hmtx = need('hmtx');
  const cmap = need('cmap');
  const unitsPerEm = d.getUint16(head + 18);
  const bbox: [number, number, number, number] = [d.getInt16(head + 36), d.getInt16(head + 38), d.getInt16(head + 40), d.getInt16(head + 42)];
  const ascender = d.getInt16(hhea + 4);
  const descender = d.getInt16(hhea + 6);
  const numHMetrics = d.getUint16(hhea + 34);
  const numGlyphs = d.getUint16(maxp + 4);
  const os2 = dir.get('OS/2');
  const capHeight = os2 && os2.length >= 90 && d.getUint16(os2.offset) >= 2 ? d.getInt16(os2.offset + 88) : Math.round(ascender * 0.7);
  const post = dir.get('post');
  const italicAngle = post ? d.getInt32(post.offset + 4) / 65536 : 0;
  const name = dir.get('name');
  const postscriptName = (name ? readName(d, name.offset, 6) : '') || 'EmbeddedFont';
  const lookup = readCmap(d, cmap);
  const lastAdvance = d.getUint16(hmtx + (numHMetrics - 1) * 4);
  return {
    bytes,
    unitsPerEm,
    ascender,
    descender,
    capHeight,
    bbox,
    italicAngle,
    numGlyphs,
    postscriptName: postscriptName.replace(/[^A-Za-z0-9+-]/g, ''),
    glyphId: lookup,
    advance: (gid) => (gid < numHMetrics ? d.getUint16(hmtx + gid * 4) : lastAdvance),
  };
}
