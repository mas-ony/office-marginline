import type { Node as PMNode } from 'prosemirror-model';
import type { DocxDocument } from '../core/document';
import { formatPageNumber } from './layout/geometry';

export type NoteKind = 'footnote' | 'endnote';

/** Height of the separator line above the notes of a page (one line of 12pt text). */
export const NOTE_SEP_H = 18;

/** A footnote or endnote reference in the body with the mark Word displays for it. */
export interface NoteRef {
  pos: number;
  kind: NoteKind;
  /** Key into `DocxDocument.notes`, e.g. "footnote:3". */
  key: string;
  /** "1", "2"... for footnotes and "i", "ii"... for endnotes; empty for custom marks. */
  label: string;
}

const refCache = new WeakMap<PMNode, NoteRef[]>();

/** Footnote and endnote references in document order, numbered the way Word does by default. */
export function noteRefs(doc: PMNode): NoteRef[] {
  const cached = refCache.get(doc);
  if (cached) return cached;
  const out: NoteRef[] = [];
  const counters = { footnote: 0, endnote: 0 };
  doc.descendants((node, pos) => {
    if (node.type.name !== 'footnote_ref') return true;
    const kind: NoteKind = node.attrs.kind === 'endnote' ? 'endnote' : 'footnote';
    let label = '';
    // References with a custom mark (w:customMarkFollows) do not take part in the numbering.
    if (!node.attrs.raw) label = kind === 'endnote' ? formatPageNumber(++counters.endnote, 'lowerRoman') : String(++counters.footnote);
    out.push({ pos, kind, key: `${kind}:${node.attrs.id}`, label });
    return false;
  });
  refCache.set(doc, out);
  return out;
}

/** Plain text of a note (for tooltips). */
export function noteText(docx: DocxDocument, key: string, max = 300): string {
  const doc = docx.notes.get(key);
  if (!doc) return '';
  const text = doc.textBetween(0, doc.content.size, ' ', ' ').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
