import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import type { DocxDocument } from '../core/document';
import { schema } from '../core/model/schema';

export type NoteKind = 'footnote' | 'endnote';

const textStyle = (kind: NoteKind) => (kind === 'footnote' ? 'FootnoteText' : 'EndnoteText');
const refStyle = (kind: NoteKind) => (kind === 'footnote' ? 'FootnoteReference' : 'EndnoteReference');

function nextNoteId(docx: DocxDocument, kind: NoteKind): string {
  let max = 0;
  for (const key of docx.notes.keys()) {
    if (key.startsWith(`${kind}:`)) max = Math.max(max, Number(key.slice(kind.length + 1)) || 0);
  }
  return String(max + 1);
}

function noteDoc(kind: NoteKind, text: string, template?: PMNode): PMNode {
  const first = template?.firstChild;
  const attrs = first?.type === schema.nodes.paragraph ? first.attrs : { styleId: textStyle(kind) };
  const marks = first?.firstChild?.isText ? first.firstChild.marks : [];
  const paras = text.split('\n').map((line) => schema.nodes.paragraph.create(attrs, line ? schema.text(line, marks) : null));
  return schema.nodes.doc.create(null, paras);
}

/** Insert a footnote or endnote reference at the selection with the given text. Returns its key. */
export function insertNote(view: EditorView, docx: DocxDocument, kind: NoteKind, text: string): string | null {
  if (!view.state.selection.$from.parent.inlineContent) return null;
  docx.styles.ensureStyle(textStyle(kind));
  docx.styles.ensureStyle(refStyle(kind));
  const id = nextNoteId(docx, kind);
  const key = `${kind}:${id}`;
  docx.notes.set(key, noteDoc(kind, text));
  docx.editedNotes.add(key);
  const ref = schema.nodes.footnote_ref.create({ id, kind }, null, [schema.marks.charStyle.create({ styleId: refStyle(kind) })]);
  const { from, to } = view.state.selection;
  view.dispatch(view.state.tr.replaceWith(to, to, ref).delete(from, to).scrollIntoView());
  return key;
}

export function noteText(docx: DocxDocument, key: string): string {
  const doc = docx.notes.get(key);
  if (!doc) return '';
  const lines: string[] = [];
  doc.forEach((block) => lines.push(block.textContent));
  return lines.join('\n').replace(/^\s+/, '');
}

/** Replace a note's text (keeping its paragraph and run formatting). */
export function setNoteText(docx: DocxDocument, key: string, text: string): boolean {
  const doc = docx.notes.get(key);
  if (!doc) return false;
  const kind = key.startsWith('endnote:') ? 'endnote' : 'footnote';
  docx.notes.set(key, noteDoc(kind, text, doc));
  docx.editedNotes.add(key);
  return true;
}
