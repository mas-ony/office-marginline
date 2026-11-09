import { TextSelection } from 'prosemirror-state';
import { DocxEditor } from '../../src/editor/DocxEditor';

/** A DocxEditor in a jsdom container (layout is a no-op without a real browser). */
export function openEditor(bytes?: Uint8Array, name = 'Test.docx', author = 'Tester'): DocxEditor {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const ed = new DocxEditor(host, { author });
  if (bytes) ed.load(bytes, name);
  return ed;
}

/** Range of the first occurrence of `text` in the body. */
export function findRange(ed: DocxEditor, text: string): { from: number; to: number } {
  let found: { from: number; to: number } | null = null;
  ed.view.state.doc.descendants((node, pos) => {
    if (found) return false;
    if (!node.isText) return true;
    const i = node.text!.indexOf(text);
    if (i >= 0) found = { from: pos + i, to: pos + i + text.length };
    return false;
  });
  if (!found) throw new Error(`Text not found: ${text}`);
  return found;
}

/** Select the first occurrence of `text` in the body. */
export function selectText(ed: DocxEditor, text: string): { from: number; to: number } {
  const r = findRange(ed, text);
  ed.view.dispatch(ed.view.state.tr.setSelection(TextSelection.create(ed.view.state.doc, r.from, r.to)));
  return r;
}

/** Put the caret at a position. */
export function caret(ed: DocxEditor, pos: number) {
  ed.view.dispatch(ed.view.state.tr.setSelection(TextSelection.create(ed.view.state.doc, pos)));
}
