import type { Node as PMNode } from 'prosemirror-model';
import type { Command, EditorState } from 'prosemirror-state';
import {
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  CellSelection,
  deleteColumn,
  deleteRow,
  deleteTable,
  fixTables,
  isInTable,
  mergeCells,
  selectedRect,
  splitCell,
} from 'prosemirror-tables';
import type { EditorView } from 'prosemirror-view';
import { schema } from '../core/model/schema';
import type { BoxBorders } from '../core/model/types';
import { REFRESH } from './meta';

export type TableAction =
  | 'addRowBefore'
  | 'addRowAfter'
  | 'addColumnBefore'
  | 'addColumnAfter'
  | 'deleteRow'
  | 'deleteColumn'
  | 'deleteTable'
  | 'removeBorders'
  | 'mergeCells'
  | 'splitCell'
  | 'fixTables';

/** Labels and order of the Table actions menu. */
export const TABLE_ACTIONS: { action: TableAction; label: string }[] = [
  { action: 'addRowBefore', label: 'Insert row above' },
  { action: 'addRowAfter', label: 'Insert row below' },
  { action: 'addColumnBefore', label: 'Insert column left' },
  { action: 'addColumnAfter', label: 'Insert column right' },
  { action: 'deleteRow', label: 'Delete row' },
  { action: 'deleteColumn', label: 'Delete column' },
  { action: 'deleteTable', label: 'Delete table' },
  { action: 'removeBorders', label: 'Remove borders' },
  { action: 'mergeCells', label: 'Merge cells' },
  { action: 'splitCell', label: 'Split cell' },
  { action: 'fixTables', label: 'Fix tables' },
];

const NONE = { val: 'nil' };
const NO_BORDERS: BoxBorders = { top: NONE, left: NONE, bottom: NONE, right: NONE, insideH: NONE, insideV: NONE };

/** The table around the selection and its position. */
export function tableAt(state: EditorState): { node: PMNode; pos: number } | null {
  const $f = state.selection.$from;
  for (let d = $f.depth; d > 0; d--) {
    if ($f.node(d).type === schema.nodes.table) return { node: $f.node(d), pos: $f.before(d) };
  }
  return null;
}

const removeBorders: Command = (state, dispatch) => {
  const t = tableAt(state);
  if (!t) return false;
  if (dispatch) {
    const tr = state.tr.setNodeMarkup(t.pos, undefined, { ...t.node.attrs, borders: NO_BORDERS, styleId: t.node.attrs.styleId });
    t.node.descendants((n, p) => {
      if (n.type === schema.nodes.table_cell) tr.setNodeMarkup(t.pos + 1 + p, undefined, { ...n.attrs, borders: { top: NONE, left: NONE, bottom: NONE, right: NONE } });
      return n.type !== schema.nodes.table_cell;
    });
    dispatch(tr.setMeta(REFRESH, true));
  }
  return true;
};

const fixTable: Command = (state, dispatch) => {
  if (!isInTable(state)) return false;
  const tr = fixTables(state);
  if (dispatch) dispatch((tr ?? state.tr).setMeta(REFRESH, true));
  return true;
};

const COMMANDS: Record<TableAction, Command> = {
  addRowBefore,
  addRowAfter,
  addColumnBefore,
  addColumnAfter,
  deleteRow,
  deleteColumn,
  deleteTable,
  removeBorders,
  mergeCells,
  splitCell,
  fixTables: fixTable,
};

export function canRunTableAction(state: EditorState, action: TableAction): boolean {
  if (!isInTable(state)) return false;
  return COMMANDS[action](state);
}

export function runTableAction(view: EditorView, action: TableAction): boolean {
  if (!isInTable(view.state)) return false;
  return COMMANDS[action](view.state, (tr) => view.dispatch(tr.setMeta(REFRESH, true)), view);
}

/** Background colour (hex without #, or null) of the selected cells. */
export function setCellBackground(view: EditorView, hex: string | null): boolean {
  const { state } = view;
  if (!isInTable(state)) return false;
  const tr = state.tr;
  const sel = state.selection;
  if (sel instanceof CellSelection) {
    sel.forEachCell((cell, pos) => tr.setNodeMarkup(pos, undefined, { ...cell.attrs, shading: hex }));
  } else {
    const rect = selectedRect(state);
    const pos = rect.tableStart + rect.map.map[rect.top * rect.map.width + rect.left];
    const cell = state.doc.nodeAt(pos);
    if (cell) tr.setNodeMarkup(pos, undefined, { ...cell.attrs, shading: hex });
  }
  view.dispatch(tr.setMeta(REFRESH, true));
  return true;
}
