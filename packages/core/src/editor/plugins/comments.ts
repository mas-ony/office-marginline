import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { schema } from '../../core/model/schema';

export interface CommentsState {
  active: string | null;
  decos: DecorationSet;
}

export const commentsKey = new PluginKey<CommentsState>('ml-dx-comments');

/** Ranges covered by each comment, in document order. */
export function commentRanges(doc: PMNode): Map<string, { from: number; to: number }[]> {
  const out = new Map<string, { from: number; to: number }[]>();
  doc.descendants((node, pos) => {
    if (!node.isInline) return true;
    for (const m of node.marks) {
      if (m.type !== schema.marks.comment) continue;
      const id = m.attrs.id as string;
      const list = out.get(id) ?? [];
      const last = list[list.length - 1];
      if (last && last.to === pos) last.to = pos + node.nodeSize;
      else list.push({ from: pos, to: pos + node.nodeSize });
      out.set(id, list);
    }
    return false;
  });
  return out;
}

function decorate(doc: PMNode, active: string | null): DecorationSet {
  if (!active) return DecorationSet.empty;
  const ranges = commentRanges(doc).get(active) ?? [];
  return DecorationSet.create(doc, ranges.map((r) => Decoration.inline(r.from, r.to, { class: 'ml-dx-comment-active' })));
}

export function commentsPlugin(): Plugin<CommentsState> {
  return new Plugin<CommentsState>({
    key: commentsKey,
    state: {
      init: () => ({ active: null, decos: DecorationSet.empty }),
      apply(tr, prev, _o, state) {
        const meta = tr.getMeta(commentsKey) as { active: string | null } | undefined;
        if (meta) return { active: meta.active, decos: decorate(state.doc, meta.active) };
        if (tr.docChanged && prev.active) return { active: prev.active, decos: decorate(state.doc, prev.active) };
        return prev;
      },
    },
    props: { decorations: (state) => commentsKey.getState(state)?.decos },
  });
}
