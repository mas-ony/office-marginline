import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseFont, unwrapWoff } from '../../src/pdf/sfnt';
import { fontCovers, winAnsi, writePdf } from '../../src/pdf/writer';

const woff = (file: string) => new Uint8Array(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../node_modules/@fontsource', file)));

function hasPoppler(): boolean {
  try {
    execFileSync('pdftotext', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function pdfText(bytes: Uint8Array): string {
  const dir = mkdtempSync(join(tmpdir(), 'docx-pdf-'));
  const file = join(dir, 'x.pdf');
  writeFileSync(file, bytes);
  return execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' });
}

describe('TrueType fonts from WOFF', () => {
  const font = parseFont(woff('carlito/files/carlito-latin-400-normal.woff'));

  it('unwraps WOFF into a TrueType file with its tables', () => {
    const ttf = unwrapWoff(woff('carlito/files/carlito-latin-400-normal.woff'));
    const tag = String.fromCharCode(...ttf.subarray(0, 4));
    expect(['\u0000\u0001\u0000\u0000', 'true']).toContain(tag);
    expect(font.bytes.length).toBeGreaterThan(10_000);
  });

  it('reads metrics, glyph ids and advances', () => {
    expect(font.postscriptName).toBe('Carlito-Regular');
    expect(font.unitsPerEm).toBeGreaterThan(0);
    expect(font.ascender).toBeGreaterThan(0);
    expect(font.descender).toBeLessThan(0);
    const a = font.glyphId('A'.codePointAt(0)!);
    expect(a).toBeGreaterThan(0);
    expect(font.advance(a)).toBeGreaterThan(0);
    expect(fontCovers(font, 'Hello, world')).toBe(true);
    // The latin subset has no Greek letters.
    expect(fontCovers(font, 'Ω')).toBe(false);
  });
});

describe('PDF writer', () => {
  const font = parseFont(woff('carlito/files/carlito-latin-400-normal.woff'));
  const bytes = writePdf([
    {
      width: 816,
      height: 1056,
      ops: [
        { kind: 'rect', x: 96, y: 96, w: 200, h: 30, fill: [255, 242, 204] },
        { kind: 'line', x1: 96, y1: 140, x2: 720, y2: 140, width: 1, color: [0, 0, 0] },
        { kind: 'text', x: 100, baseline: 118, size: 16, font: { kind: 'embedded', key: 'carlito', font }, text: 'Embedded Carlito text', color: [20, 20, 20] },
        { kind: 'text', x: 100, baseline: 180, size: 12, font: { kind: 'standard', name: 'Helvetica-Bold' }, text: 'Standard font text', color: [200, 0, 0], width: 120 },
        { kind: 'image', x: 100, y: 200, w: 40, h: 40, image: { key: 'px', width: 2, height: 2, rgb: new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]), alpha: new Uint8Array([255, 255, 255, 0]) } },
        { kind: 'link', x: 100, y: 300, w: 80, h: 14, uri: 'https://example.com/' },
        { kind: 'link', x: 100, y: 320, w: 80, h: 14, dest: { page: 1, y: 50 } },
      ],
    },
    { width: 1056, height: 816, ops: [{ kind: 'text', x: 96, baseline: 120, size: 20, font: { kind: 'embedded', key: 'carlito', font }, text: 'Landscape page', color: [0, 0, 0] }] },
  ], { title: 'Writer test', author: 'Tester' });
  const text = new TextDecoder('latin1').decode(bytes);

  it('writes a well-formed file with a correct cross-reference table', () => {
    expect(text.startsWith('%PDF-1.7')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    const start = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(start, start + 4)).toBe('xref');
    const offsets = text.slice(start).split('\n').slice(3).filter((l) => / 00000 n $/.test(l)).map((l) => Number(l.slice(0, 10)));
    offsets.forEach((o, i) => expect(text.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
    expect(text.match(/\/Type \/Page /g)).toHaveLength(2);
    expect(text).toContain('/MediaBox [0 0 792 612]');
  });

  it('embeds the TrueType font with widths and a ToUnicode map', () => {
    expect(text).toContain('/Subtype /CIDFontType2');
    expect(text).toContain('/Encoding /Identity-H');
    expect(text).toContain('/FontFile2');
    expect(text).toContain('/ToUnicode');
    expect(text).toMatch(/\/BaseFont \/[A-Z]{6}\+Carlito-Regular/);
    expect(text).toContain('/BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding');
    expect(text).toContain('/SMask');
    expect(text).toContain('/URI (https://example.com/)');
  });

  it.runIf(hasPoppler())('produces text that PDF readers extract', () => {
    const out = pdfText(bytes);
    expect(out).toContain('Embedded Carlito text');
    expect(out).toContain('Standard font text');
    expect(out).toContain('Landscape page');
  });

  it('encodes Windows-1252 text and rejects other characters', () => {
    expect(winAnsi('Café “quotes” – €')).toEqual([67, 97, 102, 233, 32, 0x93, 113, 117, 111, 116, 101, 115, 0x94, 32, 0x96, 32, 0x80]);
    expect(winAnsi('日本')).toBeNull();
  });
});
