import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { importDocx } from '../../src/core/import/importer';
import { schema } from '../../src/core/model/schema';
import { setListPreset, toggleList } from '../../src/editor/commands';
import { reviewItems } from '../../src/ui/review';
import { caret, findRange, openEditor, selectText } from './editorHelpers';
import { example, fixture } from './helpers';

const part = (bytes: Uint8Array, path: string) => strFromU8(unzipSync(bytes)[path]);

describe('comments', () => {
  it('reads threads with replies and resolved state', () => {
    const ed = openEditor(example('agreement.docx'), 'agreement.docx');
    const threads = ed.comments();
    expect(threads).toHaveLength(3);
    const first = threads[0];
    expect(first.author).toBe('Priya Raman');
    expect(first.replies.map((r) => r.author)).toEqual(['Maya Okafor']);
    expect(threads.find((t) => t.text.startsWith('Legal asked'))?.done).toBe(true);
    expect(first.quote).toBe('two quarters in advance');
    ed.destroy();
  });

  it('adds, replies, edits, resolves and saves comments', () => {
    const ed = openEditor(example('agreement.docx'), 'agreement.docx', 'Dana Cole');
    const r = findRange(ed, 'Monthly accuracy reports');
    const id = ed.addCommentAt(r, 'Who receives these reports?')!;
    expect(id).toBeTruthy();
    const reply = ed.replyToComment(id, '@Maya Okafor can you confirm?')!;
    ed.editComment(reply, '@Maya Okafor please confirm.');
    ed.resolveComment(id, true);
    const again = importDocx(ed.exportDocx());
    const t = [...again.comments.values()].find((c) => c.text === 'Who receives these reports?')!;
    expect(t.author).toBe('Dana Cole');
    expect(t.done).toBe(true);
    expect(t.replies.map((x) => x.text)).toEqual(['@Maya Okafor please confirm.']);
    ed.deleteComment(id);
    expect(ed.comments().some((c) => c.id === id)).toBe(false);
    ed.destroy();
  });
});

describe('suggesting, review and viewing', () => {
  it('lists imported changes, pairing a deletion and insertion as a replacement', () => {
    const ed = openEditor(example('agreement.docx'), 'agreement.docx');
    const items = reviewItems(ed);
    const changes = items.filter((i) => i.kind === 'change');
    expect(changes.map((c) => (c.kind === 'change' ? `${c.summary.verb} ${c.summary.text}${c.summary.with ? ` → ${c.summary.with}` : ''}` : ''))).toEqual([
      'Replaced operate  → support ',
      'Added with role-based access ',
      'Replaced 45 → 30',
    ]);
    // Resolved threads are left out unless asked for.
    expect(items.filter((i) => i.kind === 'comment')).toHaveLength(2);
    expect(reviewItems(ed, { resolved: true }).filter((i) => i.kind === 'comment')).toHaveLength(3);
    ed.destroy();
  });

  it('records typing as suggestions and accepts or rejects them', () => {
    const ed = openEditor(example('agreement.docx'), 'agreement.docx', 'Sam Lee');
    ed.setEditMode('suggesting');
    const r = findRange(ed, 'twelve months');
    ed.view.dispatch(ed.view.state.tr.insertText('eighteen months', r.from, r.to));
    const mine = ed.trackedChanges().filter((c) => c.author === 'Sam Lee');
    expect(mine.map((c) => [c.type, c.text])).toEqual([['deletion', 'twelve months'], ['insertion', 'eighteen months']]);
    ed.decideChanges(mine, true);
    expect(ed.view.state.doc.textContent).toContain('runs for eighteen months');
    expect(ed.view.state.doc.textContent).not.toContain('twelve months');
    ed.decideChanges('all', false);
    expect(ed.trackedChanges()).toHaveLength(0);
    expect(ed.view.state.doc.textContent).toContain('build and operate a shipment');
    ed.destroy();
  });

  it('applies viewing options only in viewing mode', () => {
    const ed = openEditor(example('agreement.docx'), 'agreement.docx');
    ed.setViewingOptions({ trackedChanges: 'original', comments: false });
    expect(ed.root.classList.contains('ml-dx-original')).toBe(false);
    ed.setEditMode('viewing');
    expect(ed.readOnly).toBe(true);
    expect(ed.root.classList.contains('ml-dx-original')).toBe(true);
    expect(ed.root.classList.contains('ml-dx-hide-comments')).toBe(true);
    ed.setViewingOptions({ trackedChanges: 'final', comments: true });
    expect(ed.root.classList.contains('ml-dx-final')).toBe(true);
    expect(ed.root.classList.contains('ml-dx-hide-comments')).toBe(false);
    // Read-only: edits are ignored.
    const before = ed.view.state.doc;
    ed.view.dispatch(ed.view.state.tr.insertText('x', 3));
    expect(ed.view.state.doc).toBe(before);
    ed.destroy();
  });
});

describe('search', () => {
  it('finds with regular expressions and replaces using groups', () => {
    const ed = openEditor(example('agreement.docx'), 'agreement.docx');
    ed.search({ query: '(\\d+)%', regex: true, caseSensitive: false });
    expect(ed.searchResults()?.results).toHaveLength(4);
    expect(ed.replaceAll('$1 percent')).toBe(4);
    expect(ed.view.state.doc.textContent).toContain('15 percent');
    ed.search({ query: 'CLIENT', caseSensitive: true, regex: false });
    expect(ed.searchResults()?.results).toHaveLength(0);
    ed.search({ query: '([unclosed', regex: true });
    expect(ed.searchResults()?.results).toHaveLength(0);
    ed.destroy();
  });
});

describe('lists, tables, bookmarks and notes', () => {
  it('applies the bullet and number styles of the list menus', () => {
    const ed = openEditor(fixture('kitchen-sink.docx'));
    caret(ed, findRange(ed, 'Heading One').from);
    toggleList(ed.view, ed.docx, 'bullet', 'hollowBullet');
    const xml = ed.docx.numbering.toXml();
    expect(xml).toMatch(/<w:lvlText w:val="o"\/>/);
    caret(ed, findRange(ed, 'Centered justified indent').from);
    toggleList(ed.view, ed.docx, 'ordered', 'lowerRomanList');
    expect(ed.docx.numbering.toXml()).toContain('<w:numFmt w:val="lowerRoman"/>');
    caret(ed, findRange(ed, 'Heading One').from);
    setListPreset(ed.view, ed.docx, 'upperLatinParen');
    expect(ed.docx.numbering.toXml()).toMatch(/<w:numFmt w:val="upperLetter"\/><w:lvlText w:val="%1\)"\/>/);
    ed.destroy();
  });

  it('runs table actions and cell shading', () => {
    const ed = openEditor(example('agreement.docx'), 'agreement.docx');
    caret(ed, findRange(ed, 'Discovery complete').from + 1);
    const table = () => {
      let t = null as null | import('prosemirror-model').Node;
      ed.view.state.doc.descendants((n) => {
        if (!t && n.type === schema.nodes.table) t = n;
        return !t;
      });
      return t!;
    };
    expect(ed.canTableAction('addRowAfter')).toBe(true);
    const rows = table().childCount;
    ed.tableAction('addRowAfter');
    expect(table().childCount).toBe(rows + 1);
    ed.tableAction('deleteRow');
    expect(table().childCount).toBe(rows);
    ed.setCellBackground('FFF2CC');
    let shaded = 0;
    table().descendants((n) => {
      if (n.type === schema.nodes.table_cell && n.attrs.shading === 'FFF2CC') shaded++;
      return true;
    });
    expect(shaded).toBe(1);
    ed.tableAction('removeBorders');
    expect(table().attrs.borders.insideH.val).toBe('nil');
    expect(part(ed.exportDocx(), 'word/document.xml')).toContain('w:fill="FFF2CC"');
    ed.destroy();
  });

  it('creates bookmarks and cross-references', () => {
    const ed = openEditor(example('agreement.docx'), 'agreement.docx');
    selectText(ed, 'sixty days’ written notice');
    expect(ed.createBookmark('Notice_period')).toBe(true);
    expect(ed.bookmarks().map((b) => [b.name, b.text])).toEqual([['Notice_period', 'sixty days’ written notice']]);
    caret(ed, findRange(ed, 'This obligation lasts').from);
    expect(ed.insertCrossReference({ bookmark: 'Notice_period' })).toBe(true);
    const heading = ed.headings().find((h) => h.text === '3. Fees and payment')!;
    caret(ed, findRange(ed, 'Discovery workshops').from);
    expect(ed.insertCrossReference({ headingPos: heading.pos })).toBe(true);
    const xml = part(ed.exportDocx(), 'word/document.xml');
    expect(xml).toContain('w:name="Notice_period"');
    expect(xml).toContain('w:anchor="Notice_period"');
    expect(xml).toMatch(/w:name="_Ref\d+"/);
    expect(ed.createBookmark('1 bad name')).toBe(false);
    ed.destroy();
  });

  it('adds and edits footnotes and writes them to the notes part', () => {
    const ed = openEditor(example('formatting.docx'), 'formatting.docx');
    caret(ed, findRange(ed, 'Before a page break.').to);
    const key = ed.insertNote('footnote', 'A note added in the editor.')!;
    expect(key).toBe('footnote:3');
    expect(ed.setNoteText('footnote:2', 'Edited second note.')).toBe(true);
    expect(ed.noteText('footnote:2')).toBe('Edited second note.');
    const bytes = ed.exportDocx();
    const notes = part(bytes, 'word/footnotes.xml');
    expect(notes).toContain('A note added in the editor.');
    expect(notes).toContain('Edited second note.');
    expect(notes).toContain('A footnote attached to the first sentence.');
    expect(notes.match(/<w:footnoteRef\/>/g)?.length).toBe(3);
    expect(part(bytes, 'word/document.xml')).toContain('<w:footnoteReference w:id="3"/>');
    const again = importDocx(bytes);
    expect(again.notes.get('footnote:3')?.textContent.trim()).toBe('A note added in the editor.');
    ed.destroy();
  });

  it('copies formatting with the format painter', () => {
    const ed = openEditor(example('formatting.docx'), 'formatting.docx');
    selectText(ed, 'bold');
    ed.startFormatPainter();
    expect(ed.formatPainterActive).toBe(true);
    selectText(ed, 'Regular');
    ed.applyFormatPainter();
    expect(ed.formatPainterActive).toBe(false);
    const r = findRange(ed, 'Regular');
    const node = ed.view.state.doc.nodeAt(r.from)!;
    expect(node.marks.some((m) => m.type === schema.marks.bold && m.attrs.value)).toBe(true);
    ed.destroy();
  });
});
