import { describe, expect, it } from 'vitest';
import { exportDocx } from '../../src/core/export/exporter';
import { importDocx } from '../../src/core/import/importer';
import { noteRefs } from '../../src/editor/noteRefs';
import { fixture } from './helpers';

describe('footnotes and endnotes', () => {
  const doc = importDocx(fixture('notes.docx'), { fileName: 'notes.docx' });

  it('imports note bodies without the separator notes', () => {
    expect(doc.notes.size).toBe(15);
    expect(doc.notes.has('footnote:-1')).toBe(false);
    expect(doc.notes.has('footnote:0')).toBe(false);
    expect(doc.notes.get('footnote:2')?.textContent).toContain('Long footnote 2.');
    expect(doc.notes.get('footnote:100')?.textContent.trim()).toBe('Footnote in a table cell.');
    expect(doc.notes.get('endnote:1')?.textContent.trim()).toBe('First endnote text.');
    expect(doc.notes.get('endnote:1')?.firstChild?.attrs.styleId).toBe('EndnoteText');
  });

  it('numbers references in document order like Word', () => {
    const refs = noteRefs(doc.body);
    expect(refs.filter((r) => r.kind === 'footnote').map((r) => r.label)).toEqual(Array.from({ length: 13 }, (_, i) => String(i + 1)));
    expect(refs.filter((r) => r.kind === 'endnote').map((r) => r.label)).toEqual(['i', 'ii']);
    expect(refs.every((r) => doc.notes.has(r.key))).toBe(true);
    expect(refs.find((r) => r.label === '13')?.key).toBe('footnote:100');
  });

  it('keeps the notes when the document is saved again', () => {
    const again = importDocx(exportDocx(doc, doc.body));
    expect([...again.notes.keys()]).toEqual([...doc.notes.keys()]);
    expect(noteRefs(again.body).map((r) => r.key)).toEqual(noteRefs(doc.body).map((r) => r.key));
  });
});
