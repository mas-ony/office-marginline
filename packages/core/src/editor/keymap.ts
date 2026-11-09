import { baseKeymap, chainCommands, deleteSelection, joinBackward, selectAll, selectNodeBackward } from 'prosemirror-commands';
import { redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { NodeSelection, Plugin, TextSelection, type Command } from 'prosemirror-state';
import { addRowAfter, CellSelection, goToNextCell, isInTable } from 'prosemirror-tables';
import type { DocxDocument } from '../core/document';
import { schema } from '../core/model/schema';
import { REFRESH } from './meta';
import { effectiveNumPr } from './plugins/numbering';
import { listKindOf } from './commands';

export interface KeyActions {
  docx(): DocxDocument;
  run(action: KeyAction): boolean;
}

export type KeyAction =
  | 'bold' | 'italic' | 'underline' | 'strike' | 'superscript' | 'subscript' | 'clearFormatting'
  | 'alignLeft' | 'alignCenter' | 'alignRight' | 'alignJustify'
  | 'bulletList' | 'numberedList' | 'indent' | 'outdent'
  | 'pageBreak' | 'link' | 'comment' | 'find' | 'replace' | 'save' | 'print'
  | 'fontGrow' | 'fontShrink'
  | 'style:Normal' | 'style:Heading1' | 'style:Heading2' | 'style:Heading3' | 'style:Heading4' | 'style:Heading5' | 'style:Title';

const REVISION_OR_ANCHOR = new Set(['link', 'comment', 'insertion', 'deletion', 'formatChange']);

/** Enter: Word-like paragraph split (style "next", list continuation, leaving empty list items). */
export function splitParagraph(getDocx: () => DocxDocument): Command {
  return (state, dispatch) => {
    const sel = state.selection;
    if (sel instanceof NodeSelection || sel instanceof CellSelection) return false;
    const para = sel.$from.parent;
    if (para.type !== schema.nodes.paragraph) return false;
    const docx = getDocx();
    if (sel.empty && para.content.size === 0 && listKindOf(docx, para)) {
      if (dispatch) {
        const styleHasList = !!docx.styles.resolveParagraphStyle(para.attrs.styleId).pPr.numPr?.numId;
        dispatch(state.tr.setNodeMarkup(sel.$from.before(), undefined, {
          ...para.attrs,
          numPr: styleHasList ? { numId: '0', ilvl: 0 } : null,
          styleId: para.attrs.styleId === 'ListParagraph' ? null : para.attrs.styleId,
        }).setMeta(REFRESH, true));
      }
      return true;
    }
    if (!dispatch) return true;
    const tr = state.tr;
    if (!sel.empty) tr.deleteSelection();
    const $pos = tr.selection.$from;
    const p = $pos.parent;
    if (p.type !== schema.nodes.paragraph) return false;
    const defaultId = docx.styles.defaultStyleId('paragraph');
    const attrs: Record<string, unknown> = { ...p.attrs, trackIns: null, trackDel: null, pPrChange: null, pageBreakBefore: null };
    if ($pos.parentOffset === p.content.size) {
      const style = docx.styles.get(p.attrs.styleId ?? defaultId);
      if (style?.next && style.next !== style.id) {
        attrs.styleId = style.next === defaultId ? null : style.next;
        attrs.outlineLvl = null;
        attrs.markProps = null;
      }
    }
    const marks = $pos.marks().filter((m) => !REVISION_OR_ANCHOR.has(m.type.name));
    tr.split($pos.pos, 1, [{ type: schema.nodes.paragraph, attrs }]);
    if (attrs.styleId === p.attrs.styleId) tr.setStoredMarks(marks);
    dispatch(tr.setMeta(REFRESH, true).scrollIntoView());
    return true;
  };
}

/** Backspace at the start of a list item removes the list; at the start of an indented paragraph it outdents. */
function backspaceStructure(getDocx: () => DocxDocument): Command {
  return (state, dispatch) => {
    const sel = state.selection;
    if (!sel.empty || sel.$from.parentOffset !== 0) return false;
    const para = sel.$from.parent;
    if (para.type !== schema.nodes.paragraph) return false;
    const docx = getDocx();
    const pos = sel.$from.before();
    if (listKindOf(docx, para)) {
      if (dispatch) {
        const numPr = effectiveNumPr(docx, para)!;
        const lvl = docx.numbering.level(numPr.numId, numPr.ilvl);
        const styleHasList = !!docx.styles.resolveParagraphStyle(para.attrs.styleId).pPr.numPr?.numId;
        dispatch(state.tr.setNodeMarkup(pos, undefined, {
          ...para.attrs,
          numPr: styleHasList ? { numId: '0', ilvl: 0 } : null,
          styleId: para.attrs.styleId === 'ListParagraph' ? null : para.attrs.styleId,
          indent: lvl?.pPr.indent?.left ? { left: lvl.pPr.indent.left } : para.attrs.indent,
        }).setMeta(REFRESH, true));
      }
      return true;
    }
    const ind = para.attrs.indent;
    if (ind && ((ind.left ?? 0) > 0 || (ind.firstLine ?? 0) > 0)) {
      if (dispatch) {
        const next = { ...ind };
        if ((ind.firstLine ?? 0) > 0) delete next.firstLine;
        else next.left = Math.max(0, (ind.left ?? 0) - 720);
        dispatch(state.tr.setNodeMarkup(pos, undefined, { ...para.attrs, indent: Object.keys(next).length ? next : null }));
      }
      return true;
    }
    return false;
  };
}

function insertTab(state: Parameters<Command>[0], dispatch: Parameters<Command>[1]): boolean {
  if (!state.selection.$from.parent.isTextblock) return false;
  if (dispatch) {
    const marks = state.storedMarks ?? state.selection.$from.marks();
    dispatch(state.tr.replaceSelectionWith(schema.nodes.tab.create(null, null, marks), false).scrollIntoView());
  }
  return true;
}

/**
 * Browsers report selection changes asynchronously; a key pressed right after moving the caret
 * (fast typing, automation, remote input) can otherwise run against the previous selection.
 */
function selectionSync(): Plugin {
  return new Plugin({
    props: {
      handleKeyDown(view) {
        const state = view.state;
        if (!(state.selection instanceof TextSelection) || view.composing) return false;
        const root = view.root as Document | ShadowRoot & { getSelection?: () => Selection | null };
        const dom = 'getSelection' in root && root.getSelection ? root.getSelection() : document.getSelection();
        if (!dom || !dom.anchorNode || !dom.focusNode || !view.dom.contains(dom.anchorNode) || !view.dom.contains(dom.focusNode)) return false;
        try {
          const anchor = view.posAtDOM(dom.anchorNode, dom.anchorOffset);
          const head = view.posAtDOM(dom.focusNode, dom.focusOffset);
          if (anchor !== state.selection.anchor || head !== state.selection.head) {
            view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, anchor, head)));
          }
        } catch {
          // Positions inside widgets or atoms cannot be mapped; keep the current selection.
        }
        return false;
      },
    },
  });
}

export function buildKeymap(actions: KeyActions): Plugin[] {
  const act = (a: KeyAction): Command => () => actions.run(a);
  const tab: Command = (state, dispatch, view) => {
    if (isInTable(state)) {
      if (goToNextCell(1)(state, dispatch)) return true;
      if (dispatch && view) {
        addRowAfter(state, dispatch);
        return goToNextCell(1)(view.state, view.dispatch);
      }
      return true;
    }
    const para = state.selection.$from.parent;
    if (para.type === schema.nodes.paragraph && listKindOf(actions.docx(), para) && state.selection.$from.parentOffset === 0) return actions.run('indent');
    return insertTab(state, dispatch);
  };
  const shiftTab: Command = (state, dispatch) => {
    if (isInTable(state)) return goToNextCell(-1)(state, dispatch);
    const para = state.selection.$from.parent;
    if (para.type === schema.nodes.paragraph && listKindOf(actions.docx(), para)) return actions.run('outdent');
    return false;
  };
  const custom: Record<string, Command> = {
    'Mod-z': undo,
    'Mod-y': redo,
    'Shift-Mod-z': redo,
    'Mod-b': act('bold'),
    'Mod-i': act('italic'),
    'Mod-u': act('underline'),
    'Shift-Mod-x': act('strike'),
    'Alt-Shift-5': act('strike'),
    'Mod-.': act('superscript'),
    'Mod-,': act('subscript'),
    'Mod-\\': act('clearFormatting'),
    'Mod-Space': act('clearFormatting'),
    'Mod-l': act('alignLeft'),
    'Mod-e': act('alignCenter'),
    'Mod-r': act('alignRight'),
    'Mod-j': act('alignJustify'),
    'Shift-Mod-7': act('numberedList'),
    'Shift-Mod-8': act('bulletList'),
    'Mod-m': act('indent'),
    'Shift-Mod-m': act('outdent'),
    'Mod-]': act('fontGrow'),
    'Mod-[': act('fontShrink'),
    'Shift-Mod-.': act('fontGrow'),
    'Shift-Mod-,': act('fontShrink'),
    'Mod-Enter': act('pageBreak'),
    'Mod-k': act('link'),
    'Mod-Alt-m': act('comment'),
    'Mod-f': act('find'),
    'Mod-h': act('replace'),
    'Mod-s': act('save'),
    'Mod-p': act('print'),
    'Mod-Alt-0': act('style:Normal'),
    'Mod-Alt-1': act('style:Heading1'),
    'Mod-Alt-2': act('style:Heading2'),
    'Mod-Alt-3': act('style:Heading3'),
    'Mod-Alt-4': act('style:Heading4'),
    'Mod-Alt-5': act('style:Heading5'),
    'Enter': splitParagraph(actions.docx),
    'Shift-Enter': (state, dispatch) => {
      if (!state.selection.$from.parent.isTextblock) return false;
      if (dispatch) dispatch(state.tr.replaceSelectionWith(schema.nodes.hard_break.create(), true).scrollIntoView());
      return true;
    },
    'Tab': tab,
    'Shift-Tab': shiftTab,
    'Backspace': chainCommands(deleteSelection, backspaceStructure(actions.docx), joinBackward, selectNodeBackward),
    'Mod-a': selectAll,
  };
  return [selectionSync(), keymap(custom), keymap(baseKeymap)];
}

export function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iP(hone|od|ad)/.test(navigator.platform);
}

