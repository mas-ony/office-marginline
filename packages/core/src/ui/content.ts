/** Texts and small behaviours of the dialogs and menus, shared by the React and Vue interfaces. */
import qrcode from 'qrcode-generator';
import { TextSelection } from 'prosemirror-state';
import { isInTable } from 'prosemirror-tables';
import type { EditorView } from 'prosemirror-view';
import { FORMAT_MARKS, schema } from '../core/model/schema';
import type { CollabStatus } from '../collab/session';
import { linkRange } from '../editor/commands';
import type { DocxEditor } from '../editor/DocxEditor';
import type { ChangeSummary } from './review';
import type { ColorScheme, ThemeName } from './types';

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** The modifier key as shown in menus. */
export const modKey = isMac ? '⌘' : 'Ctrl';

export const THEMES: { id: ThemeName; label: string; description: string }[] = [
  { id: 'modern', label: 'Modern', description: 'Rounded, light chrome' },
  { id: 'docs', label: 'Docs', description: 'Soft blue-gray surfaces' },
  { id: 'word', label: 'Word', description: 'Classic desktop look' },
  { id: 'blueprint', label: 'Blueprint', description: 'Blue accents' },
];

export const SCHEMES: { id: ColorScheme; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

/** Demo button for "Customize the toolbar": inserts today's date, through the page API. */
export const DATE_BUTTON_SNIPPET = `marginline.toolbar.addButton({
  id: 'today',
  label: 'Insert today\\'s date',
  text: '📅',
  onClick: () => marginline.doc.text.insert({
    text: new Date().toLocaleDateString(),
  }),
});`;

export const SHORTCUTS: [string, string][] = [
  ['Ctrl+B / I / U', 'Bold, italic, underline'],
  ['Ctrl+Shift+X', 'Strikethrough'],
  ['Ctrl+Z / Ctrl+Y', 'Undo, redo'],
  ['Ctrl+F', 'Find'],
  ['Ctrl+H', 'Find and replace'],
  ['Ctrl+K', 'Insert link'],
  ['Ctrl+Alt+M', 'New comment'],
  ['Ctrl+Shift+E', 'Switch suggesting on or off'],
  ['Ctrl+Alt+1…5', 'Heading 1–5'],
  ['Ctrl+Alt+0', 'Normal text'],
  ['Ctrl+L / E / R / J', 'Align left, center, right, justify'],
  ['Ctrl+Shift+8 / 7', 'Bullet list, numbered list'],
  ['Tab / Shift+Tab', 'Indent, outdent (in lists and tables)'],
  ['Ctrl+Enter', 'Page break'],
  ['Ctrl+S', 'Download DOCX'],
  ['Ctrl+P', 'Print'],
];

/** A shortcut as shown on this platform. */
export function shortcutLabel(keys: string): string {
  return navigator.platform.includes('Mac') ? keys.replace(/Ctrl/g, '⌘').replace(/Alt/g, '⌥') : keys;
}

/** A bookmark name made from the selected text. */
export function suggestedBookmarkName(editor: DocxEditor): string {
  const sel = editor.view.state.selection;
  return editor.view.state.doc.textBetween(sel.from, sel.to, ' ').replace(/[^\p{L}\p{N}_]+/gu, '_').replace(/^[^\p{L}]+/u, '').slice(0, 40);
}

/** Paste HTML and drop its character formatting so it takes the destination's formatting. */
export async function pasteMatching(view: EditorView): Promise<boolean> {
  try {
    if (!navigator.clipboard?.read) return false;
    const items = await navigator.clipboard.read();
    const item = items.find((i) => i.types.includes('text/html'));
    if (!item) {
      view.pasteText(await navigator.clipboard.readText());
      return true;
    }
    const html = await (await item.getType('text/html')).text();
    const from = view.state.selection.from;
    view.pasteHTML(html);
    const to = view.state.selection.to;
    const tr = view.state.tr;
    for (const name of FORMAT_MARKS) tr.removeMark(from, to, schema.marks[name]);
    for (const m of view.state.storedMarks ?? view.state.doc.resolve(from).marks()) if (FORMAT_MARKS.includes(m.type.name as never)) tr.addMark(from, to, m);
    view.dispatch(tr);
    return true;
  } catch {
    return false;
  }
}

/**
 * A right click for the document context menu. Returns false where the browser's own menu stays
 * (outside the document, or a touch on a phone, which has its own selection menu); otherwise the
 * caret moves to the click unless it is inside the selection.
 */
export function contextMenuAt(editor: DocxEditor, e: MouseEvent, mobile: boolean): boolean {
  const target = e.target as HTMLElement;
  if (!editor.root.contains(target) || !target.closest('.ml-dx-doc')) return false;
  if (mobile && (e as PointerEvent).pointerType !== 'mouse') return false;
  e.preventDefault();
  const view = editor.activeView;
  const hit = view.posAtCoords({ left: e.clientX, top: e.clientY });
  const { from, to } = view.state.selection;
  if (hit && (hit.pos < from || hit.pos > to)) {
    view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(hit.pos))));
  }
  view.focus();
  return true;
}

/** What the context menu offers at the selection. */
export function contextMenuState(editor: DocxEditor) {
  const state = editor.activeView.state;
  return {
    readOnly: editor.readOnly,
    hasText: !state.selection.empty,
    inTable: isInTable(state),
    link: linkRange(state),
    body: editor.activeStream === 'body',
  };
}

/** What the Options menu of the header or footer being edited offers for its page. */
export function headerFooterMenuState(editor: DocxEditor, pageIndex: number) {
  const kind: 'header' | 'footer' = editor.activeStream === 'footer' ? 'footer' : 'header';
  return {
    kind,
    editing: editor.activeStream !== 'body',
    options: editor.headerFooterOptions(pageIndex),
    /** Whether it follows the previous section's; null in the first section. */
    linked: editor.headerFooterLinked(kind, pageIndex),
  };
}

/** The Options button on the bar of the header or footer being edited. */
export function headerFooterOptionsButton(editor: DocxEditor): HTMLElement | null {
  return editor.root.querySelector<HTMLElement>('.ml-dx-hf-active > .ml-dx-hf-bar > [data-act="options"]');
}

const TWIPS_PER_INCH = 1440;
const TWIPS_PER_CM = TWIPS_PER_INCH / 2.54;

/** A header or footer distance (in twips) as its field shows it: centimetres or inches, as on the ruler. */
export function distanceText(twips: number, metric: boolean): string {
  return (twips / (metric ? TWIPS_PER_CM : TWIPS_PER_INCH)).toFixed(2);
}

/** The twips of a distance field's text, at most `max`; null when the text is not a distance. */
export function parseDistance(text: string, max: number, metric: boolean): number | null {
  const s = text.trim().replace(',', '.');
  const n = Number(s);
  if (!s || !Number.isFinite(n) || n < 0) return null;
  return Math.min(max, Math.round(n * (metric ? TWIPS_PER_CM : TWIPS_PER_INCH)));
}

/** The message when the browser refuses to paste from a menu. */
export function pasteRefusedMessage(kind: 'source' | 'match' | 'text'): string {
  return `The browser does not allow pasting from a menu here. Press ${modKey}+V${kind === 'text' ? ` (or ${modKey}+Shift+V for text only)` : ''}.`;
}

/** SVG markup of a QR code for a link (generated locally). */
export function qrSvg(text: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

export function shareStatusText(status: CollabStatus): string {
  return status === 'live' ? 'Live' : status === 'connecting' ? 'Connecting…' : status === 'offline' ? 'Reconnecting…' : 'Ended';
}

/**
 * Copy a link; where the page has no clipboard API (insecure pages) the text in `input` is
 * selected for copying by hand. Returns the message to show.
 */
export async function copyLink(link: string, input: HTMLInputElement | null): Promise<string> {
  try {
    if (!navigator.clipboard) throw new Error('no clipboard');
    await navigator.clipboard.writeText(link);
    return 'Link copied';
  } catch {
    input?.select();
    document.execCommand?.('copy');
    return 'Link selected — copy it with Ctrl+C or the system menu';
  }
}

/** "3 changes · 1 comment" */
export function reviewCountText(changes: number, comments: number): string {
  return `${changes} ${changes === 1 ? 'change' : 'changes'} · ${comments} ${comments === 1 ? 'comment' : 'comments'}`;
}

/** Class of the quoted text on a tracked change card. */
export function changeTextClass(s: ChangeSummary): string {
  return s.verb === 'Deleted' || s.verb === 'Replaced' ? 'ml-del-text' : s.verb === 'Formatted' ? 'ml-fmt-text' : 'ml-ins-text';
}
