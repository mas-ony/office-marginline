import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { DocxDocument } from '../../core/document';
import type { SectionProps } from '../../core/model/types';
import { needsRefresh, type DocxGetter } from '../meta';
import { noteRefs, noteText } from '../noteRefs';

export const decorKey = new PluginKey<DecorationSet>('ml-dx-decor');

const BREAK_LABELS: Record<string, string> = {
  nextPage: 'Section Break (Next Page)',
  continuous: 'Section Break (Continuous)',
  evenPage: 'Section Break (Even Page)',
  oddPage: 'Section Break (Odd Page)',
  nextColumn: 'Section Break (Next Column)',
};

function contextual(docx: DocxDocument, node: PMNode): boolean {
  if (node.attrs.contextualSpacing !== null && node.attrs.contextualSpacing !== undefined) return node.attrs.contextualSpacing;
  return !!docx.styles.effectiveParagraph(node.attrs.styleId).contextualSpacing;
}

function styleOf(docx: DocxDocument, node: PMNode): string {
  return node.attrs.styleId ?? docx.styles.defaultStyleId('paragraph') ?? '';
}

/**
 * Decorations derived from neighbouring content: contextual spacing between paragraphs of the
 * same style, section break labels and footnote reference numbers.
 */
export function computeDecor(doc: PMNode, docx: DocxDocument): DecorationSet {
  const decos: Decoration[] = [];

  // Section break labels describe how the *next* section starts.
  const breaks: { pos: number; node: PMNode }[] = [];
  doc.forEach((node, offset) => {
    if (node.type.name === 'section_break') breaks.push({ pos: offset, node });
  });
  breaks.forEach((b, i) => {
    const next: SectionProps = i + 1 < breaks.length ? breaks[i + 1].node.attrs.section : doc.attrs.finalSection;
    decos.push(Decoration.node(b.pos, b.pos + b.node.nodeSize, { 'data-label': BREAK_LABELS[next?.type ?? 'nextPage'] ?? BREAK_LABELS.nextPage }));
  });

  // Contextual spacing within every container of blocks (body and table cells).
  const visitContainer = (container: PMNode, start: number) => {
    let prev: { node: PMNode; pos: number } | null = null;
    container.forEach((node, offset) => {
      const pos = start + offset;
      if (node.type.name === 'paragraph') {
        if (prev) {
          const same = styleOf(docx, prev.node) === styleOf(docx, node);
          if (same && contextual(docx, prev.node)) decos.push(Decoration.node(prev.pos, prev.pos + prev.node.nodeSize, { class: 'ml-dx-ctx-bottom' }));
          if (same && contextual(docx, node)) decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'ml-dx-ctx-top' }));
        }
        prev = { node, pos };
      } else {
        prev = null;
        if (node.type.name === 'table') {
          node.forEach((row, rowOffset) => {
            row.forEach((cell, cellOffset) => {
              visitContainer(cell, pos + 1 + rowOffset + 1 + cellOffset + 1);
            });
          });
        }
      }
    });
  };
  visitContainer(doc, 0);

  // Footnote and endnote numbers, with the note text as a tooltip.
  for (const r of noteRefs(doc)) {
    const node = doc.nodeAt(r.pos);
    if (!node) continue;
    const attrs: Record<string, string> = {};
    if (r.label) attrs['data-num'] = r.label;
    const text = noteText(docx, r.key);
    if (text) attrs.title = text;
    decos.push(Decoration.node(r.pos, r.pos + node.nodeSize, attrs));
  }
  return DecorationSet.create(doc, decos);
}

export function decorPlugin(getDocx: DocxGetter): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: decorKey,
    state: {
      init: (_, state) => computeDecor(state.doc, getDocx()),
      apply: (tr, old, _o, state) => (needsRefresh(tr) ? computeDecor(state.doc, getDocx()) : old),
    },
    props: { decorations: (state) => decorKey.getState(state) },
  });
}
