import { Fragment, type Mark, type MarkType, type Node as PMNode, Slice } from 'prosemirror-model';
import { type EditorState, TextSelection, type Transaction } from 'prosemirror-state';
import { AddMarkStep, Mapping, RemoveMarkStep, ReplaceStep, type Step } from 'prosemirror-transform';
import { marksToRunProps, runPropsToMarks } from '../../core/model/marks';
import { isFormatMark, schema } from '../../core/model/schema';
import type { RunProps, TrackInfo } from '../../core/model/types';
import { NO_TRACK } from '../meta';

let counter = 0;
export function newChangeId(): string {
  counter = (counter + 1) % 1e6;
  return `c${Date.now().toString(36)}${counter.toString(36)}`;
}

export interface TrackContext {
  author: string;
  date: string;
}

function markOf(node: PMNode | null | undefined, type: MarkType): Mark | undefined {
  return node?.marks.find((m) => m.type === type);
}

/** ReplaceStep keeps its "structure" flag at runtime but not in the public typings. */
function isStructural(step: Step): boolean {
  return !!(step as unknown as { structure?: boolean }).structure;
}

/** Add insertion marks (and paragraph-mark insertions) to inserted content. */
function markSlice(slice: Slice, ins: Mark, info: TrackInfo): Slice {
  const mapFragment = (frag: Fragment): Fragment => {
    const nodes: PMNode[] = [];
    frag.forEach((n) => {
      if (n.isInline) nodes.push(n.mark(ins.addToSet(n.marks.filter((m) => m.type !== schema.marks.deletion))));
      else if (n.type === schema.nodes.paragraph) nodes.push(n.type.create({ ...n.attrs, trackIns: n.attrs.trackIns ?? info }, mapFragment(n.content), n.marks));
      else nodes.push(n.copy(mapFragment(n.content)));
    });
    return Fragment.fromArray(nodes);
  };
  return new Slice(mapFragment(slice.content), slice.openStart, slice.openEnd);
}

/**
 * Turn a deletion of [from, to) into deletion marks. Content the same author inserted earlier
 * (still tracked) is removed for real, as are that author's own inserted paragraph marks.
 * Returns false when the range holds content that cannot be tracked (tables, section breaks).
 */
function trackDeletion(tr: Transaction, from: number, to: number, ctx: TrackContext): boolean {
  const doc = tr.doc;
  let structural = false;
  doc.nodesBetween(from, to, (node) => {
    if (node.isBlock && node.type !== schema.nodes.paragraph) structural = true;
    return !structural;
  });
  if (structural) return false;

  const toMark: [number, number][] = [];
  const toRemove: [number, number][] = [];
  const paraMarks: number[] = [];
  const ownParaJoins: number[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.isInline) {
      const s = Math.max(from, pos);
      const e = Math.min(to, pos + node.nodeSize);
      if (s >= e) return false;
      const ins = markOf(node, schema.marks.insertion);
      if (ins && ins.attrs.author === ctx.author) toRemove.push([s, e]);
      else if (!markOf(node, schema.marks.deletion)) toMark.push([s, e]);
      return false;
    }
    if (node.type === schema.nodes.paragraph) {
      const end = pos + node.nodeSize - 1;
      if (end >= from && end < to) {
        if (node.attrs.trackIns && node.attrs.trackIns.author === ctx.author) ownParaJoins.push(pos + node.nodeSize);
        else if (!node.attrs.trackDel) paraMarks.push(pos);
      }
    }
    return true;
  });

  // Reuse an adjacent deletion by the same author so consecutive deletes form one change.
  const near = markOf(doc.resolve(to).nodeAfter, schema.marks.deletion) ?? markOf(doc.resolve(from).nodeBefore, schema.marks.deletion);
  const attrs = near && near.attrs.author === ctx.author ? near.attrs : { id: newChangeId(), author: ctx.author, date: ctx.date };
  const del = schema.marks.deletion.create(attrs);
  for (const [s, e] of toMark) tr.addMark(s, e, del);
  for (const pos of paraMarks) {
    const node = tr.doc.nodeAt(pos);
    if (node) tr.setNodeMarkup(pos, undefined, { ...node.attrs, trackDel: { id: attrs.id, author: ctx.author, date: ctx.date } });
  }
  const start = tr.steps.length;
  for (let i = toRemove.length - 1; i >= 0; i--) tr.delete(toRemove[i][0], toRemove[i][1]);
  for (let i = ownParaJoins.length - 1; i >= 0; i--) {
    const at = tr.mapping.slice(start).map(ownParaJoins[i]);
    try {
      tr.join(at);
    } catch {
      // Not joinable; leave the paragraphs separate.
    }
  }
  return true;
}

/**
 * Rewrite a user transaction so that its edits become tracked revisions: deleted content stays
 * in place with a deletion mark and inserted content carries an insertion mark.
 */
export function trackTransaction(tr: Transaction, state: EditorState, ctx: TrackContext): Transaction {
  const out = state.tr;
  let map = new Mapping();
  let cursor: number | null = null;
  const prevSel = state.selection;

  for (let i = 0; i < tr.steps.length; i++) {
    const step = tr.steps[i];
    const mapped = step.map(map);
    const before = out.steps.length;
    if (mapped instanceof ReplaceStep && !isStructural(mapped)) {
      const { from, to, slice } = mapped;
      let insertAt = to;
      let tracked = true;
      if (from < to) {
        tracked = trackDeletion(out, from, to, ctx);
        if (tracked) insertAt = out.mapping.slice(before).map(to, 1);
        else out.step(mapped);
      }
      if (tracked && slice.size) {
        const near = markOf(out.doc.resolve(insertAt).nodeBefore, schema.marks.insertion);
        const insAttrs = near && near.attrs.author === ctx.author ? near.attrs : { id: newChangeId(), author: ctx.author, date: ctx.date };
        const info: TrackInfo = { id: insAttrs.id, author: ctx.author, date: ctx.date };
        const replaceAt = out.steps.length;
        out.replace(insertAt, insertAt, markSlice(slice, schema.marks.insertion.create(insAttrs), info));
        cursor = out.mapping.slice(replaceAt).map(insertAt, 1);
        // The paragraph that was split now ends with a new paragraph mark.
        if (slice.openStart > 0) {
          const $p = out.doc.resolve(insertAt);
          for (let d = $p.depth; d > 0; d--) {
            const n = $p.node(d);
            if (n.type !== schema.nodes.paragraph) continue;
            if (!n.attrs.trackIns) out.setNodeMarkup($p.before(d), undefined, { ...n.attrs, trackIns: info });
            break;
          }
        }
      } else if (tracked && from < to) {
        // Pure deletion: Backspace leaves the cursor before the deleted text, Delete after it.
        const backward = prevSel.empty && prevSel.head === (step as ReplaceStep).to;
        cursor = backward ? out.mapping.slice(before).map(from, -1) : out.mapping.slice(before).map(to, 1);
      }
    } else if ((mapped instanceof AddMarkStep || mapped instanceof RemoveMarkStep) && isFormatMark(mapped.mark)) {
      const { from, to } = mapped;
      const ranges: { from: number; to: number; old: RunProps }[] = [];
      out.doc.nodesBetween(from, to, (node, pos) => {
        if (!node.isInline) return true;
        if (markOf(node, schema.marks.formatChange)) return false;
        const ins = markOf(node, schema.marks.insertion);
        if (ins && ins.attrs.author === ctx.author) return false;
        ranges.push({ from: Math.max(from, pos), to: Math.min(to, pos + node.nodeSize), old: marksToRunProps(node.marks).props });
        return false;
      });
      out.step(mapped);
      const id = newChangeId();
      for (const r of ranges) out.addMark(r.from, r.to, schema.marks.formatChange.create({ id, author: ctx.author, date: ctx.date, oldProps: r.old }));
    } else if (mapped) {
      out.step(mapped);
    }
    const next = new Mapping();
    next.appendMap(step.getMap().invert());
    next.appendMapping(map);
    for (let s = before; s < out.steps.length; s++) next.appendMap(out.steps[s].getMap());
    map = next;
  }

  if (cursor !== null && cursor >= 0 && cursor <= out.doc.content.size) {
    try {
      out.setSelection(TextSelection.create(out.doc, cursor));
    } catch {
      // Fall back to the mapped selection below.
    }
  } else {
    try {
      out.setSelection(TextSelection.create(out.doc, map.map(tr.selection.anchor), map.map(tr.selection.head)));
    } catch {
      // Keep the default mapped selection.
    }
  }
  if (tr.storedMarks) out.setStoredMarks(tr.storedMarks);
  if (tr.scrolledIntoView) out.scrollIntoView();
  out.setMeta(NO_TRACK, true);
  for (const key of ['addToHistory', 'uiEvent', 'paste', 'composition']) {
    const v = tr.getMeta(key);
    if (v !== undefined) out.setMeta(key, v);
  }
  return out;
}

// -----------------------------------------------------------------------------------------------
// Listing, accepting and rejecting

export type ChangeType = 'insertion' | 'deletion' | 'format' | 'paragraph-insertion' | 'paragraph-deletion';

export interface TrackedChange {
  id: string;
  type: ChangeType;
  author: string;
  date: string;
  ranges: { from: number; to: number }[];
  text: string;
}

const MARK_TYPES: Record<string, ChangeType> = { insertion: 'insertion', deletion: 'deletion', formatChange: 'format' };

export function listChanges(doc: PMNode): TrackedChange[] {
  const byKey = new Map<string, TrackedChange>();
  const order: TrackedChange[] = [];
  const add = (type: ChangeType, attrs: Record<string, string>, from: number, to: number, text: string) => {
    const key = `${type}:${attrs.id}:${attrs.author}`;
    let c = byKey.get(key);
    if (!c) {
      c = { id: attrs.id, type, author: attrs.author, date: attrs.date, ranges: [], text: '' };
      byKey.set(key, c);
      order.push(c);
    }
    const last = c.ranges[c.ranges.length - 1];
    if (last && last.to === from) last.to = to;
    else c.ranges.push({ from, to });
    c.text += text;
  };
  doc.descendants((node, pos) => {
    if (node.type === schema.nodes.paragraph) {
      const end = pos + node.nodeSize - 1;
      if (node.attrs.trackIns) add('paragraph-insertion', node.attrs.trackIns, end, end + 1, '¶');
      if (node.attrs.trackDel) add('paragraph-deletion', node.attrs.trackDel, end, end + 1, '¶');
      return true;
    }
    if (!node.isInline) return true;
    for (const m of node.marks) {
      const type = MARK_TYPES[m.type.name];
      if (type) add(type, m.attrs as Record<string, string>, pos, pos + node.nodeSize, node.isText ? node.text ?? '' : node.type.name === 'image' ? '[image]' : '');
    }
    return false;
  });
  order.sort((a, b) => a.ranges[0].from - b.ranges[0].from);
  return order;
}

function removeMarkById(tr: Transaction, type: MarkType, change: TrackedChange) {
  for (const r of change.ranges) {
    const from = tr.mapping.map(r.from);
    const to = tr.mapping.map(r.to);
    tr.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isInline) return true;
      for (const m of node.marks) {
        if (m.type === type && m.attrs.id === change.id) tr.removeMark(Math.max(from, pos), Math.min(to, pos + node.nodeSize), m);
      }
      return false;
    });
  }
}

function deleteRanges(tr: Transaction, change: TrackedChange) {
  for (const r of [...change.ranges].sort((a, b) => b.from - a.from)) tr.delete(tr.mapping.map(r.from), tr.mapping.map(r.to));
}

/** `end` is the last position inside a paragraph; join it with the following paragraph. */
function joinAfterParagraph(tr: Transaction, end: number) {
  const after = tr.mapping.map(end) + 1;
  if (after < tr.doc.content.size && tr.doc.resolve(after).nodeAfter?.type === schema.nodes.paragraph) {
    try {
      tr.join(after);
    } catch {
      // Not joinable; leave as is.
    }
  }
}

function clearParagraphAttr(tr: Transaction, end: number, attr: 'trackIns' | 'trackDel') {
  const $pos = tr.doc.resolve(tr.mapping.map(end));
  for (let d = $pos.depth; d > 0; d--) {
    const n = $pos.node(d);
    if (n.type === schema.nodes.paragraph) {
      tr.setNodeMarkup($pos.before(d), undefined, { ...n.attrs, [attr]: null });
      return;
    }
  }
}

function restoreFormat(tr: Transaction, change: TrackedChange) {
  for (const r of change.ranges) {
    const from = tr.mapping.map(r.from);
    const to = tr.mapping.map(r.to);
    const segments: { from: number; to: number; old: RunProps; mark: Mark }[] = [];
    tr.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isInline) return true;
      const fc = node.marks.find((m) => m.type === schema.marks.formatChange && m.attrs.id === change.id);
      if (fc) segments.push({ from: Math.max(from, pos), to: Math.min(to, pos + node.nodeSize), old: fc.attrs.oldProps ?? {}, mark: fc });
      return false;
    });
    for (const seg of segments) {
      for (const name of ['charStyle', 'font', 'fontSize', 'color', 'highlight', 'shading', 'bold', 'italic', 'underline', 'strike', 'dstrike', 'caps', 'smallCaps', 'hidden', 'vertAlign', 'charSpacing', 'position']) {
        tr.removeMark(seg.from, seg.to, schema.marks[name]);
      }
      for (const m of runPropsToMarks(seg.old)) tr.addMark(seg.from, seg.to, m);
      tr.removeMark(seg.from, seg.to, seg.mark);
    }
  }
}

export function applyDecision(state: EditorState, changes: TrackedChange[], accept: boolean): Transaction {
  const tr = state.tr.setMeta(NO_TRACK, true);
  // Process from the end of the document so earlier positions stay valid.
  const sorted = [...changes].sort((a, b) => b.ranges[0].from - a.ranges[0].from);
  for (const c of sorted) {
    const end = c.ranges[0].from;
    switch (c.type) {
      case 'insertion':
        if (accept) removeMarkById(tr, schema.marks.insertion, c);
        else deleteRanges(tr, c);
        break;
      case 'deletion':
        if (accept) deleteRanges(tr, c);
        else removeMarkById(tr, schema.marks.deletion, c);
        break;
      case 'format':
        if (accept) removeMarkById(tr, schema.marks.formatChange, c);
        else restoreFormat(tr, c);
        break;
      case 'paragraph-insertion':
        clearParagraphAttr(tr, end, 'trackIns');
        if (!accept) joinAfterParagraph(tr, end);
        break;
      case 'paragraph-deletion':
        clearParagraphAttr(tr, end, 'trackDel');
        if (accept) joinAfterParagraph(tr, end);
        break;
    }
  }
  return tr;
}
