import type { Mark } from 'prosemirror-model';
import type { EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { FORMAT_MARKS, isFormatMark, schema } from '../core/model/schema';
import { selectedParagraphs } from './commands';

const PARA_KEYS = ['styleId', 'align', 'indent', 'spacing', 'keepNext', 'keepLines', 'borders', 'shading', 'bidi'] as const;

/** Formatting picked up by "Copy formatting": run formatting and the paragraph's formatting. */
export interface CopiedFormat {
  marks: readonly Mark[];
  para: Record<string, unknown> | null;
}

export function copyFormat(state: EditorState): CopiedFormat {
  const { $from, empty, from } = state.selection;
  const node = empty ? null : state.doc.nodeAt(from);
  const marks = (empty ? state.storedMarks ?? $from.marks() : node?.isInline ? node.marks : $from.marks()).filter(isFormatMark);
  const parent = $from.parent;
  const para = parent.type === schema.nodes.paragraph ? Object.fromEntries(PARA_KEYS.map((k) => [k, parent.attrs[k]])) : null;
  return { marks, para };
}

/**
 * Apply copied formatting to the selection. Run formatting replaces the selection's formatting;
 * paragraph formatting is applied to paragraphs the selection covers completely, or to the
 * caret's paragraph when nothing is selected.
 */
export function applyFormat(view: EditorView, fmt: CopiedFormat): boolean {
  const { state } = view;
  const { from, to, empty } = state.selection;
  const tr = state.tr;
  if (empty) tr.setStoredMarks(fmt.marks);
  else {
    for (const name of FORMAT_MARKS) tr.removeMark(from, to, schema.marks[name]);
    for (const m of fmt.marks) tr.addMark(from, to, m);
  }
  if (fmt.para) {
    for (const p of selectedParagraphs(state)) {
      const whole = empty || (from <= p.pos + 1 && to >= p.pos + p.node.nodeSize - 1);
      if (!whole) continue;
      tr.setNodeMarkup(tr.mapping.map(p.pos), undefined, { ...p.node.attrs, ...fmt.para });
    }
  }
  view.dispatch(tr);
  return true;
}
