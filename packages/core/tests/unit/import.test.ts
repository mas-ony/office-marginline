import { describe, expect, it } from 'vitest';
import { importDocx } from '../../src/core/import/importer';
import type { SectionProps } from '../../src/core/model/types';
import { findText, fixture, markOf, nodesOfType } from './helpers';

describe('importDocx (kitchen sink)', () => {
  const doc = importDocx(fixture('kitchen-sink.docx'), { fileName: 'kitchen-sink.docx' });
  const body = doc.body;

  it('produces a valid document', () => {
    expect(() => body.check()).not.toThrow();
    expect(body.firstChild?.attrs.styleId).toBe('Title');
    expect(body.firstChild?.textContent).toBe('Kitchen Sink Document');
  });

  it('maps run formatting to marks', () => {
    expect(markOf(findText(body, 'bold'), 'bold')?.attrs.value).toBe(true);
    expect(markOf(findText(body, 'italic'), 'italic')?.attrs.value).toBe(true);
    expect(markOf(findText(body, 'double underline'), 'underline')?.attrs.type).toBe('double');
    expect(markOf(findText(body, 'strike'), 'strike')?.attrs.value).toBe(true);
    expect(markOf(findText(body, 'red'), 'color')?.attrs.color).toBe('FF0000');
    expect(markOf(findText(body, 'highlighted'), 'highlight')?.attrs.color).toBe('yellow');
    expect(markOf(findText(body, 'shaded'), 'shading')?.attrs.fill).toBe('DDEEFF');
    const courier = findText(body, 'Courier 14');
    expect(markOf(courier, 'font')?.attrs.ascii).toBe('Courier New');
    expect(markOf(courier, 'fontSize')?.attrs.size).toBe(28);
    expect(markOf(findText(body, '2'), 'vertAlign')?.attrs.value).toBe('superscript');
    expect(markOf(findText(body, 'strong style'), 'charStyle')?.attrs.styleId).toBe('Strong');
    expect(markOf(findText(body, 'kerned'), 'runExtra')?.attrs.xml).toContain('w:kern');
  });

  it('imports hyperlinks and bookmarks', () => {
    expect(markOf(findText(body, 'External link'), 'link')?.attrs.href).toBe('https://example.com/');
    expect(markOf(findText(body, 'internal link'), 'link')?.attrs.anchor).toBe('target');
    expect(nodesOfType(body, 'bookmark_start').map((b) => b.attrs.name)).toContain('target');
  });

  it('imports tabs, tab stops and line breaks', () => {
    const para = body.child(3);
    expect(para.attrs.tabs).toHaveLength(2);
    expect(para.attrs.tabs[1]).toMatchObject({ val: 'right', leader: 'dot', pos: 9360 });
    expect(nodesOfType(para, 'tab')).toHaveLength(2);
    expect(nodesOfType(para, 'hard_break')).toHaveLength(1);
  });

  it('imports list numbering', () => {
    const items = nodesOfType(body, 'paragraph').filter((p) => p.attrs.numPr);
    expect(items.map((p) => [p.attrs.numPr.numId, p.attrs.numPr.ilvl])).toEqual([
      ['1', 0], ['1', 1], ['1', 0], ['2', 0], ['2', 1], ['2', 0],
    ]);
    expect(doc.numbering.kind('1')).toBe('bullet');
    expect(doc.numbering.kind('2')).toBe('ordered');
  });

  it('imports tables with spans and merges', () => {
    const [table] = nodesOfType(body, 'table');
    expect(table.attrs.styleId).toBe('GridAccent');
    expect(table.attrs.width).toEqual({ type: 'pct', value: 100 });
    expect(table.childCount).toBe(3);
    expect(table.child(0).attrs.header).toBe(true);
    const row2 = table.child(1);
    expect(row2.child(0).attrs.colspan).toBe(2);
    expect(row2.child(1).attrs.rowspan).toBe(2);
    expect(row2.child(1).attrs.shading).toBe('FFF2CC');
    expect(table.child(2).childCount).toBe(2);
    expect(table.child(0).child(0).attrs.colwidth).toEqual([208]);
  });

  it('imports images with media', () => {
    const [img] = nodesOfType(body, 'image');
    expect(img.attrs.mediaPath).toBe('word/media/image1.png');
    expect(img.attrs.width).toBe(1143000);
    expect(img.attrs.alt).toBe('Gradient test image');
    expect(doc.media.get('word/media/image1.png')?.bytes.length).toBeGreaterThan(100);
  });

  it('imports comments with replies', () => {
    expect(markOf(findText(body, 'Comment target'), 'comment')?.attrs.id).toBe('0');
    const thread = doc.comments.get('0');
    expect(thread?.author).toBe('Alice');
    expect(thread?.text).toBe('Please review this.');
    expect(thread?.replies.map((r) => r.text)).toEqual(['Reply from Bob.']);
  });

  it('imports tracked changes', () => {
    expect(markOf(findText(body, 'inserted'), 'insertion')?.attrs.author).toBe('Alice');
    expect(markOf(findText(body, 'deleted'), 'deletion')?.attrs.author).toBe('Bob');
  });

  it('imports fields, footnotes, math and content controls', () => {
    expect(nodesOfType(body, 'footnote_ref')[0].attrs.id).toBe('1');
    const chars = nodesOfType(body, 'field_char').map((f) => f.attrs.type);
    expect(chars).toEqual(['begin', 'separate', 'end']);
    expect(nodesOfType(body, 'instr_text')[0].attrs.text).toContain('DATE');
    const math = nodesOfType(body, 'opaque_inline').find((n) => n.attrs.label === 'Equation');
    expect(math?.attrs.text).toBe('a+b');
    expect(findText(body, 'Inside a content control')).toBeTruthy();
    expect(nodesOfType(body, 'page_break')).toHaveLength(1);
  });

  it('imports sections, headers and footers', () => {
    const [brk] = nodesOfType(body, 'section_break');
    const s1 = brk.attrs.section as SectionProps;
    expect(s1.titlePg).toBe(true);
    expect(s1.headers.default).toBe('word/header1.xml');
    expect(s1.headers.first).toBe('word/header2.xml');
    expect(s1.raw).toContain('w:docGrid');
    const fin = body.attrs.finalSection as SectionProps;
    expect(fin.orient).toBe('landscape');
    expect(fin.pageWidth).toBe(15840);
    expect(fin.pgNumStart).toBe(5);
    expect(fin.cols.num).toBe(2);
    expect(fin.type).toBe('nextPage');
    expect([...doc.headerFooters.keys()].sort()).toEqual(['word/footer1.xml', 'word/header1.xml', 'word/header2.xml']);
    const footer = doc.headerFooters.get('word/footer1.xml')!.doc;
    expect(nodesOfType(footer, 'page_field').map((f) => f.attrs.kind)).toEqual(['PAGE', 'NUMPAGES']);
    expect(footer.textContent).toBe('Page # of #');
  });

  it('reads styles and theme fonts', () => {
    expect(doc.styles.get('Heading1')?.rPr.size).toBe(32);
    expect(doc.theme.minor).toBe('Calibri');
    expect(doc.theme.major).toBe('Calibri Light');
    const eff = doc.styles.effectiveRun('Heading1', 'Strong', {});
    expect(eff.bold).toBe(true);
    expect(eff.size).toBe(32);
  });
});

describe('importDocx (pandoc sample)', () => {
  it('imports a document produced by another application', () => {
    const doc = importDocx(fixture('pandoc-sample.docx'));
    expect(() => doc.body.check()).not.toThrow();
    expect(doc.body.textContent).toContain('Quarterly Report');
    expect(nodesOfType(doc.body, 'table')).toHaveLength(1);
    expect(nodesOfType(doc.body, 'paragraph').some((p) => p.attrs.numPr)).toBe(true);
  });
});
