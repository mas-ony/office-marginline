import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { DocxDocument } from '../../core/document';
import { fontStack, hexColor, indentCss } from '../../core/model/css';
import { renderLevelText, type LevelDef } from '../../core/model/numbering';
import type { Indent, NumPr } from '../../core/model/types';
import { needsRefresh, type DocxGetter } from '../meta';

export const numberingKey = new PluginKey<DecorationSet>('ml-dx-numbering');

/** Effective numbering of a paragraph (direct numPr, else from its style). */
export function effectiveNumPr(docx: DocxDocument, node: PMNode): NumPr | null {
  const direct = node.attrs.numPr as NumPr | null;
  const fromStyle = docx.styles.resolveParagraphStyle(node.attrs.styleId).pPr.numPr;
  if (direct) {
    if (direct.numId) return direct;
    if (fromStyle?.numId) return { numId: fromStyle.numId, ilvl: direct.ilvl };
    return null;
  }
  return fromStyle?.numId ? fromStyle : null;
}

function labelCss(level: LevelDef, node: PMNode): string[] {
  const css: string[] = [];
  const mark = node.attrs.markProps ?? {};
  const font = level.rPr.fonts?.ascii ?? level.rPr.fonts?.hAnsi;
  if (font && level.numFmt !== 'bullet') css.push(`--ml-dx-lf: ${fontStack(font)}`);
  const size = level.rPr.size ?? mark.size;
  if (size) css.push(`--ml-dx-ls: ${size / 2}pt`);
  const bold = level.rPr.bold ?? mark.bold;
  if (bold !== undefined) css.push(`--ml-dx-lw: ${bold ? 'bold' : 'normal'}`);
  const color = hexColor(level.rPr.color?.val ?? mark.color?.val);
  if (color) css.push(`--ml-dx-lc: ${color}`);
  return css;
}

export function computeNumbering(doc: PMNode, docx: DocxDocument): DecorationSet {
  const decos: Decoration[] = [];
  const counters = new Map<string, (number | undefined)[]>();
  const seenNums = new Set<string>();
  const numbering = docx.numbering;
  doc.descendants((node, pos) => {
    if (node.type.name !== 'paragraph') return true;
    const numPr = effectiveNumPr(docx, node);
    if (!numPr || numPr.numId === '0') return false;
    const level = numbering.level(numPr.numId, numPr.ilvl);
    if (!level) return false;
    const levels = numbering.levels(numPr.numId);
    const absId = numbering.abstractFor(numPr.numId)?.id ?? `n${numPr.numId}`;
    let c = counters.get(absId);
    if (!c) {
      c = [];
      counters.set(absId, c);
    }
    if (!seenNums.has(numPr.numId)) {
      seenNums.add(numPr.numId);
      const num = numbering.nums.get(numPr.numId);
      if (num && [...num.overrides.values()].some((o) => o.start !== undefined)) c.length = 0;
    }
    const ilvl = Math.min(Math.max(numPr.ilvl, 0), 8);
    if (c[ilvl] === undefined) c[ilvl] = numbering.startOverride(numPr.numId, ilvl) ?? level.start;
    else c[ilvl]! += 1;
    for (let l = ilvl + 1; l < 9; l++) {
      // lvlRestart is the 1-based level after which level l restarts; 0 means never.
      const restart = levels[l]?.lvlRestart;
      const resets = restart === undefined ? true : restart !== 0 && ilvl <= restart - 1;
      if (resets) c[l] = undefined;
    }
    const display = levels.map((lv, i) => (i <= ilvl ? c![i] ?? lv?.start ?? 1 : 0));
    const label = renderLevelText(level, display, levels);
    const direct = node.attrs.indent as Indent | null;
    const levelInd = level.pPr.indent;
    const css = labelCss(level, node);
    if (levelInd) {
      const merged: Indent = { ...levelInd, ...(direct ?? {}) };
      if (direct?.firstLine !== undefined && direct.hanging === undefined) delete merged.hanging;
      if (direct?.hanging !== undefined && direct.firstLine === undefined) delete merged.firstLine;
      css.push(...indentCss(merged));
    }
    const cls = ['ml-dx-list', `ml-dx-suff-${level.suff}`];
    if (level.lvlJc === 'right' || level.lvlJc === 'end') cls.push('ml-dx-list-right');
    if (level.lvlJc === 'center') cls.push('ml-dx-list-center');
    decos.push(Decoration.node(pos, pos + node.nodeSize, {
      class: cls.join(' '),
      'data-label': label || '​',
      style: css.join('; '),
    }));
    return false;
  });
  return DecorationSet.create(doc, decos);
}

export function numberingPlugin(getDocx: DocxGetter): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: numberingKey,
    state: {
      init: (_, state) => computeNumbering(state.doc, getDocx()),
      apply: (tr, old, _o, state) => (needsRefresh(tr) ? computeNumbering(state.doc, getDocx()) : old),
    },
    props: {
      decorations: (state) => numberingKey.getState(state),
    },
  });
}
