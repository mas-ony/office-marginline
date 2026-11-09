import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { exportDocx } from '../../src/core/export/exporter';
import { importDocx } from '../../src/core/import/importer';
import { parseXml } from '../../src/core/xml/xml';
import { example, fixture, nodesOfType, stableJson } from './helpers';

function hasPandoc(): boolean {
  try {
    execFileSync('pandoc', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function pandocText(bytes: Uint8Array): string {
  const dir = mkdtempSync(join(tmpdir(), 'docx-rt-'));
  const file = join(dir, 'x.docx');
  writeFileSync(file, bytes);
  return execFileSync('pandoc', [file, '-t', 'plain', '--wrap=none'], { encoding: 'utf8' });
}

const EXAMPLES = ['agreement.docx', 'template.docx', 'long-report.docx', 'tables-columns.docx', 'international.docx', 'formatting.docx'];

for (const name of ['kitchen-sink.docx', 'pandoc-sample.docx', 'long.docx', 'columns.docx', 'notes.docx', ...EXAMPLES]) {
  const source = () => (EXAMPLES.includes(name) ? example(name) : fixture(name));
  describe(`round trip: ${name}`, () => {
    const original = importDocx(source());
    const bytes = exportDocx(original, original.body, { now: new Date('2025-01-01T00:00:00Z') });
    const reimported = importDocx(bytes);

    it('exports a well-formed package', () => {
      const files = unzipSync(bytes);
      expect(Object.keys(files)[0]).toBe('[Content_Types].xml');
      for (const [path, data] of Object.entries(files)) {
        if (path.endsWith('.xml') || path.endsWith('.rels')) expect(() => parseXml(strFromU8(data)), path).not.toThrow();
      }
    });

    it('preserves the document model', () => {
      expect(stableJson(reimported.body)).toEqual(stableJson(original.body));
      for (const [path, part] of original.headerFooters) {
        expect(stableJson(reimported.headerFooters.get(path)!.doc)).toEqual(stableJson(part.doc));
      }
      const anchored = new Set(nodesOfType(original.body, 'text').flatMap((t) => t.marks.filter((m) => m.type.name === 'comment').map((m) => m.attrs.id)));
      expect([...reimported.comments.values()]).toEqual([...original.comments.values()].filter((c) => anchored.has(c.id)));
    });

    it('is stable across repeated exports', () => {
      const again = exportDocx(reimported, reimported.body, { now: new Date('2025-01-01T00:00:00Z') });
      const a = strFromU8(unzipSync(bytes)['word/document.xml']);
      const b = strFromU8(unzipSync(again)['word/document.xml']);
      expect(b).toBe(a);
    });

    // pandoc takes about two seconds for each copy of the 300-page example.
    it.skipIf(!hasPandoc())('reads the same in another DOCX reader (pandoc)', () => {
      expect(pandocText(bytes)).toBe(pandocText(source()));
    }, 30_000);
  });
}

describe('export details', () => {
  const doc = importDocx(fixture('kitchen-sink.docx'));
  const bytes = exportDocx(doc, doc.body, { now: new Date('2025-01-01T00:00:00Z') });
  const files = unzipSync(bytes);
  const documentXml = strFromU8(files['word/document.xml']);

  it('writes vertical merges back as w:vMerge', () => {
    expect(documentXml).toContain('<w:vMerge w:val="restart"/>');
    expect(documentXml).toMatch(/<w:vMerge\/>/);
    expect(documentXml).toContain('<w:gridSpan w:val="2"/>');
  });

  it('writes the section break into the last paragraph of its section', () => {
    expect(documentXml).toMatch(/End of portrait section<\/w:t><\/w:r><\/w:p>/);
    expect(documentXml).toMatch(/<w:pPr><w:sectPr><w:headerReference w:type="default" r:id="[^"]+"\/>/);
  });

  it('writes comments with replies and updates core properties', () => {
    const comments = strFromU8(files['word/comments.xml']);
    expect(comments).toContain('Please review this.');
    expect(comments).toContain('Reply from Bob.');
    const ex = strFromU8(files['word/commentsExtended.xml']);
    expect(ex).toMatch(/w15:paraIdParent="[0-9A-F]{8}"/);
    expect(documentXml.match(/<w:commentRangeStart/g)?.length).toBe(2);
    expect(strFromU8(files['docProps/core.xml'])).toContain('2025-01-01T00:00:00Z');
  });

  it('keeps images and relationships consistent', () => {
    const rels = strFromU8(files['word/_rels/document.xml.rels']);
    const embed = /r:embed="([^"]+)"/.exec(documentXml)?.[1];
    expect(rels).toContain(`Id="${embed}"`);
    expect(files['word/media/image1.png']).toBeTruthy();
    expect(nodesOfType(doc.body, 'image')).toHaveLength(1);
  });
});
