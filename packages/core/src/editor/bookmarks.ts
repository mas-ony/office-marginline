import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { schema } from '../core/model/schema';

export interface BookmarkInfo {
  id: string;
  name: string;
  /** Position of the bookmark start. */
  pos: number;
  /** Text the bookmark spans (empty for a point bookmark). */
  text: string;
  hidden: boolean;
}

export interface HeadingInfo {
  pos: number;
  level: number;
  text: string;
}

/** Bookmarks in document order. Names starting with "_" are Word's hidden bookmarks. */
export function listBookmarks(doc: PMNode, includeHidden = false): BookmarkInfo[] {
  const starts = new Map<string, { name: string; pos: number }>();
  const out: BookmarkInfo[] = [];
  doc.descendants((node, pos) => {
    if (node.type === schema.nodes.bookmark_start) starts.set(String(node.attrs.id), { name: node.attrs.name, pos });
    else if (node.type === schema.nodes.bookmark_end) {
      const s = starts.get(String(node.attrs.id));
      if (s) {
        const hidden = s.name.startsWith('_');
        if (includeHidden || !hidden) out.push({ id: String(node.attrs.id), name: s.name, pos: s.pos, text: doc.textBetween(s.pos, pos, ' ', ' ').trim(), hidden });
        starts.delete(String(node.attrs.id));
      }
    }
    return true;
  });
  return out.sort((a, b) => a.pos - b.pos);
}

/** Paragraphs with a heading style or outline level. */
export function listHeadings(doc: PMNode): HeadingInfo[] {
  const out: HeadingInfo[] = [];
  doc.descendants((node, pos) => {
    if (node.type !== schema.nodes.paragraph) return node.isBlock;
    const m = /^Heading([1-9])$/i.exec(node.attrs.styleId ?? '');
    const level = m ? Number(m[1]) : node.attrs.outlineLvl !== null && node.attrs.outlineLvl < 9 ? node.attrs.outlineLvl + 1 : 0;
    const text = node.textContent.trim();
    if (level && text) out.push({ pos, level, text });
    return false;
  });
  return out;
}

export function validBookmarkName(name: string): boolean {
  return /^[\p{L}][\p{L}\p{N}_]{0,39}$/u.test(name);
}

function nextBookmarkId(doc: PMNode): string {
  let max = 0;
  doc.descendants((node) => {
    if (node.type === schema.nodes.bookmark_start || node.type === schema.nodes.bookmark_end) max = Math.max(max, Number(node.attrs.id) || 0);
    return true;
  });
  return String(max + 1);
}

/** Wrap the selection (or mark the caret) with a bookmark. Replaces a bookmark of the same name. */
export function createBookmark(view: EditorView, name: string, range?: { from: number; to: number }): boolean {
  if (!validBookmarkName(name) && !name.startsWith('_')) return false;
  const { state } = view;
  const from = range?.from ?? state.selection.from;
  const to = range?.to ?? state.selection.to;
  if (!state.doc.resolve(from).parent.inlineContent || !state.doc.resolve(to).parent.inlineContent) return false;
  const tr = state.tr;
  const existing = listBookmarks(state.doc, true).filter((b) => b.name === name);
  const id = nextBookmarkId(state.doc);
  tr.insert(to, schema.nodes.bookmark_end.create({ id }));
  tr.insert(from, schema.nodes.bookmark_start.create({ id, name }));
  // Remove the old bookmark of that name (start and end nodes).
  const oldIds = new Set(existing.map((b) => b.id));
  const stale: number[] = [];
  tr.doc.descendants((node, pos) => {
    if ((node.type === schema.nodes.bookmark_start || node.type === schema.nodes.bookmark_end) && oldIds.has(String(node.attrs.id))) stale.push(pos);
    return true;
  });
  for (let i = stale.length - 1; i >= 0; i--) tr.delete(stale[i], stale[i] + 1);
  view.dispatch(tr);
  return true;
}

/** Insert linked text pointing at a bookmark (Word's cross-reference to bookmark text). */
export function insertCrossReference(view: EditorView, target: { bookmark?: string; headingPos?: number }): boolean {
  let { state } = view;
  let name = target.bookmark ?? '';
  let text = '';
  if (target.headingPos !== undefined) {
    const heading = state.doc.nodeAt(target.headingPos);
    if (!heading) return false;
    text = heading.textContent.trim();
    // Headings are referenced through a hidden bookmark around their text.
    const inner = listBookmarks(state.doc, true).find((b) => b.hidden && b.pos > target.headingPos! && b.pos < target.headingPos! + heading.nodeSize);
    if (inner) name = inner.name;
    else {
      name = `_Ref${Math.floor(Math.random() * 1e9)}`;
      createBookmark(view, name, { from: target.headingPos + 1, to: target.headingPos + heading.nodeSize - 1 });
      state = view.state;
    }
  } else {
    text = listBookmarks(state.doc, true).find((b) => b.name === name)?.text ?? '';
  }
  if (!name) return false;
  const label = text || name;
  const { from, to } = state.selection;
  const marks = state.selection.$from.marks().filter((m) => m.type !== schema.marks.link);
  const link = schema.marks.link.create({ href: '', anchor: name });
  view.dispatch(state.tr.replaceWith(from, to, schema.text(label, link.addToSet(marks))).scrollIntoView());
  return true;
}
