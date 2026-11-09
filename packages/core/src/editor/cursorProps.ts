import type { Mark, Node as PMNode } from 'prosemirror-model';
import type { EditorState } from 'prosemirror-state';
import { redoDepth, undoDepth } from 'prosemirror-history';
import { CellSelection, isInTable } from 'prosemirror-tables';
import type { DocxDocument } from '../core/document';
import { runFontName } from '../core/model/css';
import type { ListKind, ListPreset } from '../core/model/numbering';
import { schema } from '../core/model/schema';
import type { RunProps } from '../core/model/types';
import { effectiveRunProps, isImageSelected, linkRange, listKindOf, selectedParagraphs, type Alignment } from './commands';
import { effectiveNumPr } from './plugins/numbering';

export interface CursorProps {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  superscript: boolean;
  subscript: boolean;
  /** null means the selection mixes values. */
  fontFamily: string | null;
  fontSize: number | null;
  color: string | null;
  highlight: string | null;
  styleId: string | null;
  align: Alignment | null;
  lineSpacing: number | null;
  listKind: ListKind | null;
  listPreset: ListPreset | null;
  inTable: boolean;
  imageSelected: boolean;
  textSelected: boolean;
  link: string | null;
  commentIds: string[];
  canUndo: boolean;
  canRedo: boolean;
}

function sameOrNull<T>(values: T[]): T | null {
  if (!values.length) return null;
  return values.every((v) => v === values[0]) ? values[0] : null;
}

function highlightOf(marks: readonly Mark[]): string | null {
  const h = marks.find((m) => m.type === schema.marks.highlight);
  if (h && h.attrs.color !== 'none') return h.attrs.color;
  const s = marks.find((m) => m.type === schema.marks.shading);
  return s ? `#${s.attrs.fill}` : null;
}

function alignOf(value: string | undefined): Alignment {
  switch (value) {
    case 'center': return 'center';
    case 'right':
    case 'end': return 'right';
    case 'both':
    case 'distribute': return 'both';
    default: return 'left';
  }
}

export function computeCursorProps(state: EditorState, docx: DocxDocument): CursorProps {
  const sel = state.selection;
  const themeFonts = { major: docx.theme.major, minor: docx.theme.minor };
  const runs: { props: RunProps; marks: readonly Mark[] }[] = [];
  const paraOf = (pos: number): PMNode | null => {
    const $p = state.doc.resolve(pos);
    for (let d = $p.depth; d >= 0; d--) if ($p.node(d).type === schema.nodes.paragraph) return $p.node(d);
    return null;
  };
  if (sel.empty) {
    const marks = state.storedMarks ?? sel.$from.marks();
    runs.push({ props: effectiveRunProps(docx, paraOf(sel.from), marks), marks });
  } else {
    const visit = (from: number, to: number) => {
      state.doc.nodesBetween(from, to, (node, _pos, parent) => {
        if (!node.isInline) return true;
        if (node.isText && parent) runs.push({ props: effectiveRunProps(docx, parent, node.marks), marks: node.marks });
        return false;
      });
    };
    if (sel instanceof CellSelection) sel.forEachCell((cell, pos) => visit(pos, pos + cell.nodeSize));
    else for (const r of sel.ranges) visit(r.$from.pos, r.$to.pos);
    if (!runs.length) {
      const marks = sel.$from.marks();
      runs.push({ props: effectiveRunProps(docx, paraOf(sel.from), marks), marks });
    }
  }
  const all = (f: (p: RunProps) => boolean) => runs.every((r) => f(r.props));
  const paras = selectedParagraphs(state);
  const first = paras[0]?.node ?? null;
  const effPara = first ? docx.styles.effectiveParagraph(first.attrs.styleId, {
    align: first.attrs.align ?? undefined,
    spacing: first.attrs.spacing ?? undefined,
  }) : null;
  const spacing = effPara?.spacing;
  const lineSpacing = spacing?.line !== undefined && (spacing.lineRule ?? 'auto') === 'auto' ? Math.round((spacing.line / 240) * 100) / 100 : spacing?.line === undefined ? 1 : null;
  const listKinds = paras.map((p) => listKindOf(docx, p.node));
  const listKind = sameOrNull(listKinds);
  const numPr = first ? effectiveNumPr(docx, first) : null;
  const link = sel.empty ? linkRange(state)?.mark.attrs.href ?? null : null;
  const commentIds = new Set<string>();
  for (const m of sel.$from.marks()) if (m.type === schema.marks.comment) commentIds.add(m.attrs.id);
  const defaultStyle = docx.styles.defaultStyleId('paragraph') ?? 'Normal';
  return {
    bold: all((p) => !!p.bold),
    italic: all((p) => !!p.italic),
    underline: all((p) => !!p.underline && p.underline !== 'none'),
    strike: all((p) => !!p.strike || !!p.dstrike),
    superscript: all((p) => p.vertAlign === 'superscript'),
    subscript: all((p) => p.vertAlign === 'subscript'),
    fontFamily: sameOrNull(runs.map((r) => runFontName(r.props, themeFonts) ?? 'Times New Roman')),
    fontSize: sameOrNull(runs.map((r) => (r.props.size ?? 20) / 2)),
    color: sameOrNull(runs.map((r) => r.props.color?.val ?? 'auto')),
    highlight: sameOrNull(runs.map((r) => highlightOf(r.marks))),
    styleId: sameOrNull(paras.map((p) => p.node.attrs.styleId ?? defaultStyle)),
    align: sameOrNull(paras.map((p) => alignOf(docx.styles.effectiveParagraph(p.node.attrs.styleId, { align: p.node.attrs.align ?? undefined }).align))),
    lineSpacing,
    listKind,
    listPreset: numPr && listKind ? docx.numbering.presetOf(numPr.numId) ?? null : null,
    inTable: isInTable(state),
    imageSelected: isImageSelected(state),
    textSelected: !sel.empty,
    link,
    commentIds: [...commentIds],
    canUndo: undoDepth(state) > 0,
    canRedo: redoDepth(state) > 0,
  };
}
