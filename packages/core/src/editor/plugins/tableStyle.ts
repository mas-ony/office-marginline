import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey } from 'prosemirror-state';
import { TableMap } from 'prosemirror-tables';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { DocxDocument } from '../../core/document';
import { borderCss, runPropsCss, spacingCss } from '../../core/model/css';
import { mergeParaProps, mergeRunProps } from '../../core/model/props';
import type { CellMargins, TableStyleBlock } from '../../core/model/styles';
import type { BorderSpec, BoxBorders, ParaProps, RunProps } from '../../core/model/types';
import { twipsToPt } from '../../core/ooxml/units';
import { needsRefresh, type DocxGetter } from '../meta';

export const tableStyleKey = new PluginKey<DecorationSet>('ml-dx-table-style');

const DEFAULT_MARGINS: CellMargins = { top: 0, bottom: 0, left: 108, right: 108 };

/** Order in which conditional formats apply (later wins). */
const COND_ORDER = ['band1Vert', 'band2Vert', 'band1Horz', 'band2Horz', 'firstCol', 'lastCol', 'firstRow', 'lastRow', 'neCell', 'nwCell', 'seCell', 'swCell'];

interface Look {
  firstRow: boolean;
  lastRow: boolean;
  firstColumn: boolean;
  lastColumn: boolean;
  noHBand: boolean;
  noVBand: boolean;
}

const DEFAULT_LOOK: Look = { firstRow: true, lastRow: false, firstColumn: true, lastColumn: false, noHBand: false, noVBand: true };

function tableDecorations(table: PMNode, pos: number, docx: DocxDocument, decos: Decoration[]) {
  const ta = table.attrs;
  const style = docx.styles.resolveTableStyle(ta.styleId);
  const look: Look = { ...DEFAULT_LOOK, ...(ta.look ?? {}) };
  const borders: BoxBorders = { ...(style.borders ?? {}), ...(ta.borders ?? {}) };
  const margins: CellMargins = { ...DEFAULT_MARGINS, ...(style.cellMargins ?? {}), ...(ta.cellMargins ?? {}) };
  const map = TableMap.get(table);
  const rowBand = style.rowBandSize || 1;
  const colBand = style.colBandSize || 1;
  const headerRows = look.firstRow ? 1 : 0;

  // Table-level styling.
  const tcss: string[] = [];
  if (ta.width?.type === 'pct') tcss.push(`width: ${Math.min(ta.width.value, 100)}%`);
  else if (ta.width?.type === 'dxa' && ta.width.value) tcss.push(`width: ${twipsToPt(ta.width.value)}pt`);
  if (ta.align === 'center') tcss.push('margin-left: auto', 'margin-right: auto');
  else if (ta.align === 'right' || ta.align === 'end') tcss.push('margin-left: auto');
  else if (ta.indent) tcss.push(`margin-left: ${twipsToPt(ta.indent)}pt`);
  const tableRun = runPropsCss(style.rPr);
  decos.push(Decoration.node(pos, pos + table.nodeSize, { style: [...tcss, ...tableRun].join('; ') }));

  const seen = new Set<number>();
  for (let i = 0; i < map.map.length; i++) {
    const cellOffset = map.map[i];
    if (seen.has(cellOffset)) continue;
    seen.add(cellOffset);
    const cell = table.nodeAt(cellOffset);
    if (!cell) continue;
    const rect = map.findCell(cellOffset);
    const firstRow = rect.top === 0;
    const lastRow = rect.bottom === map.height;
    const firstCol = rect.left === 0;
    const lastCol = rect.right === map.width;

    const conds: string[] = [];
    if (!look.noVBand) {
      const idx = Math.floor((rect.left - (look.firstColumn ? 1 : 0)) / colBand);
      if (!(look.firstColumn && firstCol) && !(look.lastColumn && lastCol)) conds.push(idx % 2 === 0 ? 'band1Vert' : 'band2Vert');
    }
    if (!look.noHBand) {
      const idx = Math.floor((rect.top - headerRows) / rowBand);
      if (!(look.firstRow && firstRow) && !(look.lastRow && lastRow)) conds.push(idx % 2 === 0 ? 'band1Horz' : 'band2Horz');
    }
    if (look.firstColumn && firstCol) conds.push('firstCol');
    if (look.lastColumn && lastCol) conds.push('lastCol');
    if (look.firstRow && firstRow) conds.push('firstRow');
    if (look.lastRow && lastRow) conds.push('lastRow');
    if (look.firstRow && look.lastColumn && firstRow && lastCol) conds.push('neCell');
    if (look.firstRow && look.firstColumn && firstRow && firstCol) conds.push('nwCell');
    if (look.lastRow && look.lastColumn && lastRow && lastCol) conds.push('seCell');
    if (look.lastRow && look.firstColumn && lastRow && firstCol) conds.push('swCell');
    conds.sort((a, b) => COND_ORDER.indexOf(a) - COND_ORDER.indexOf(b));

    let shading = style.shading;
    let rPr: RunProps = {};
    let pPr: ParaProps = {};
    const edge: Record<'top' | 'bottom' | 'left' | 'right', BorderSpec | undefined> = {
      top: firstRow ? borders.top : borders.insideH,
      bottom: lastRow ? borders.bottom : borders.insideH,
      left: firstCol ? borders.left : borders.insideV,
      right: lastCol ? borders.right : borders.insideV,
    };
    for (const c of conds) {
      const block: TableStyleBlock | undefined = style.cond[c];
      if (!block) continue;
      if (block.shading) shading = block.shading;
      rPr = mergeRunProps(rPr, block.rPr);
      pPr = mergeParaProps(pPr, block.pPr);
      const b = block.borders ?? {};
      if (b.top) edge.top = b.top;
      if (b.bottom) edge.bottom = b.bottom;
      if (b.left) edge.left = b.left;
      if (b.right) edge.right = b.right;
      if (b.insideH && !firstRow) edge.top = b.insideH;
      if (b.insideH && !lastRow) edge.bottom = b.insideH;
      if (b.insideV && !firstCol) edge.left = b.insideV;
      if (b.insideV && !lastCol) edge.right = b.insideV;
    }
    const ca = cell.attrs;
    const cb = (ca.borders ?? {}) as BoxBorders;
    for (const side of ['top', 'bottom', 'left', 'right'] as const) if (cb[side]) edge[side] = cb[side];
    const cm: CellMargins = { ...margins, ...(ca.margins ?? {}) };

    const css: string[] = [];
    let anyBorder = false;
    for (const side of ['top', 'bottom', 'left', 'right'] as const) {
      const v = borderCss(edge[side]);
      if (v && v !== 'none') anyBorder = true;
      css.push(`border-${side}: ${v ?? 'none'}`);
    }
    css.push(
      `padding: ${twipsToPt(cm.top ?? 0)}pt ${twipsToPt(cm.right ?? 108)}pt ${twipsToPt(cm.bottom ?? 0)}pt ${twipsToPt(cm.left ?? 108)}pt`,
    );
    const bg = ca.shading ?? shading;
    if (bg) css.push(`background-color: #${bg}`);
    css.push(...runPropsCss(rPr));
    const cellPos = pos + 1 + cellOffset;
    decos.push(Decoration.node(cellPos, cellPos + cell.nodeSize, {
      style: css.join('; '),
      class: anyBorder ? 'ml-dx-cell-bordered' : 'ml-dx-cell-borderless',
    }));

    // Paragraph spacing defined by the table style applies where the paragraph's own style
    // and direct formatting leave it unspecified.
    const tablePPr = mergeParaProps(style.pPr, pPr);
    if (tablePPr.spacing) {
      cell.forEach((para, off) => {
        if (para.type.name !== 'paragraph') return;
        const own = mergeParaProps(docx.styles.resolveParagraphStyle(para.attrs.styleId).pPr, para.attrs.spacing ? { spacing: para.attrs.spacing } : {});
        const sp = { ...tablePPr.spacing };
        for (const k of Object.keys(own.spacing ?? {}) as (keyof typeof sp)[]) delete sp[k];
        if (sp.line !== undefined && own.spacing?.lineRule !== undefined) delete sp.line;
        const decl = spacingCss(sp);
        if (!decl.length) return;
        const p = cellPos + 1 + off;
        decos.push(Decoration.node(p, p + para.nodeSize, { style: decl.join('; ') }));
      });
    }
  }
}

export function computeTableStyles(doc: PMNode, docx: DocxDocument): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'table') tableDecorations(node, pos, docx, decos);
    return node.type.name !== 'paragraph';
  });
  return DecorationSet.create(doc, decos);
}

export function tableStylePlugin(getDocx: DocxGetter): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: tableStyleKey,
    state: {
      init: (_, state) => computeTableStyles(state.doc, getDocx()),
      apply: (tr, old, _o, state) => (needsRefresh(tr) ? computeTableStyles(state.doc, getDocx()) : old),
    },
    props: { decorations: (state) => tableStyleKey.getState(state) },
  });
}
