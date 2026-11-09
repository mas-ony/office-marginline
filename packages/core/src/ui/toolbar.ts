/** Toolbar layout and the labels of its controls, shared by the React and Vue interfaces. */
import type { EditMode, TrackedChangesView } from '../editor/DocxEditor';
import type { ViewMode } from '../editor/layout/layout';
import type { CustomButton } from './types';

export interface ToolbarItem {
  id: string;
  group: string;
  /** Width in the toolbar, used to decide what moves into the overflow menu. */
  width: number;
  /** Items with lower priority move into the overflow menu first. */
  priority: number;
  /** For buttons added through the page API. */
  custom?: CustomButton;
}

const ITEMS: ToolbarItem[] = [
  { id: 'undo', group: 'history', width: 34, priority: 100 },
  { id: 'redo', group: 'history', width: 34, priority: 99 },
  { id: 'zoom', group: 'zoom', width: 70, priority: 60 },
  { id: 'font', group: 'font', width: 136, priority: 90 },
  { id: 'size', group: 'font', width: 62, priority: 89 },
  { id: 'bold', group: 'marks', width: 34, priority: 98 },
  { id: 'italic', group: 'marks', width: 34, priority: 97 },
  { id: 'underline', group: 'marks', width: 34, priority: 96 },
  { id: 'strike', group: 'marks', width: 34, priority: 70 },
  { id: 'color', group: 'marks', width: 34, priority: 86 },
  { id: 'highlight', group: 'marks', width: 34, priority: 85 },
  { id: 'link', group: 'insert', width: 34, priority: 80 },
  { id: 'image', group: 'insert', width: 34, priority: 76 },
  { id: 'table', group: 'insert', width: 34, priority: 75 },
  { id: 'table-actions', group: 'insert', width: 34, priority: 74 },
  { id: 'align', group: 'para', width: 50, priority: 82 },
  { id: 'bullets', group: 'para', width: 50, priority: 66 },
  { id: 'numbers', group: 'para', width: 50, priority: 65 },
  { id: 'outdent', group: 'para', width: 34, priority: 42 },
  { id: 'indent', group: 'para', width: 34, priority: 43 },
  { id: 'line-height', group: 'para', width: 34, priority: 41 },
  { id: 'styles', group: 'format', width: 34, priority: 50 },
  { id: 'copy-format', group: 'format', width: 34, priority: 40 },
  { id: 'clear', group: 'format', width: 34, priority: 39 },
  { id: 'ruler', group: 'view', width: 34, priority: 55 },
];

/** The toolbar's items in order, ending with the buttons added through the page API. */
export function toolbarItems(customButtons: CustomButton[]): ToolbarItem[] {
  return [...ITEMS, ...customButtons.map((b, i) => ({ id: `custom-${b.id}`, group: 'custom', width: 34, priority: 30 - i, custom: b }))];
}

const SEP = 9;
const MORE = 36;

/** Choose the items that fit in `width`, keeping the highest priorities. */
export function fitToolbar(items: ToolbarItem[], width: number): Set<string> {
  const total = (chosen: ToolbarItem[]) => chosen.reduce((w, it) => w + it.width, 0) + SEP * Math.max(0, new Set(chosen.map((i) => i.group)).size - 1);
  if (total(items) <= width) return new Set(items.map((i) => i.id));
  const chosen: ToolbarItem[] = [];
  for (const it of [...items].sort((a, b) => b.priority - a.priority)) {
    if (total([...chosen, it]) + MORE <= width) chosen.push(it);
  }
  return new Set(chosen.map((i) => i.id));
}

/** Phones: formatting first; zoom and the ruler only make sense with pages. */
const PHONE_ORDER = ['undo', 'redo', 'bold', 'italic', 'underline', 'strike', 'color', 'highlight', 'bullets', 'numbers', 'align', 'outdent', 'indent', 'link', 'image', 'table', 'table-actions', 'styles', 'size', 'font', 'line-height', 'copy-format', 'clear', 'zoom'];

/** The items of the phone toolbar row, in its order. */
export function phoneToolbar(items: ToolbarItem[], viewMode: ViewMode): ToolbarItem[] {
  const rank = (id: string) => {
    const i = PHONE_ORDER.indexOf(id);
    return i < 0 ? PHONE_ORDER.length : i;
  };
  return items.filter((it) => it.id !== 'ruler' && (it.id !== 'zoom' || viewMode === 'print')).sort((a, b) => rank(a.id) - rank(b.id));
}

/** Items with the separator that goes before each (between groups). */
export function withSeparators(items: ToolbarItem[]): { item: ToolbarItem; separator: boolean }[] {
  return items.map((item, i) => ({ item, separator: i > 0 && items[i - 1].group !== item.group }));
}

export const MARKS = {
  bold: { label: 'Bold', key: 'Ctrl+B' },
  italic: { label: 'Italic', key: 'Ctrl+I' },
  underline: { label: 'Underline', key: 'Ctrl+U' },
  strike: { label: 'Strikethrough', key: 'Ctrl+Shift+X' },
} as const;

export type MarkKind = keyof typeof MARKS;

export const ALIGNS = [
  { value: 'left', action: 'alignLeft', label: 'Align left' },
  { value: 'center', action: 'alignCenter', label: 'Align center' },
  { value: 'right', action: 'alignRight', label: 'Align right' },
  { value: 'both', action: 'alignJustify', label: 'Justify' },
] as const;

export const MODES: { mode: EditMode; label: string; description: string }[] = [
  { mode: 'editing', label: 'Editing', description: 'Edit document directly' },
  { mode: 'suggesting', label: 'Suggesting', description: 'Edits become suggestions' },
  { mode: 'viewing', label: 'Viewing', description: 'View clean version of document only' },
];

export const TRACKED_VIEWS: { value: TrackedChangesView; label: string }[] = [
  { value: 'original', label: 'Original' },
  { value: 'markup', label: 'Markup' },
  { value: 'final', label: 'Final' },
];

export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/bmp';

/** A typed font size in points, rounded to halves; null when it is not a size Word accepts. */
export function parseFontSize(text: string): number | null {
  const n = Math.round(Number(text.replace(',', '.')) * 2) / 2;
  return n >= 1 && n <= 1638 ? n : null;
}

/** A typed link as a URL: `example.com` becomes https://, an email address mailto:. */
export function normalizeLink(href: string): string {
  const url = href.trim();
  if (!url || /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('#')) return url;
  return /^[^\s@]+@[^\s@]+$/.test(url) ? `mailto:${url}` : `https://${url}`;
}

/** The colour of the colour button's bar (text colour, or highlight). */
export function colorBar(color: string | null | undefined): string {
  return color && color !== 'auto' ? `#${color.replace('#', '')}` : 'currentColor';
}

export function highlightBar(hl: string | null | undefined): string {
  return hl ? (hl.startsWith('#') ? hl : `var(--hl-${hl}, ${hl})`) : 'transparent';
}

/** Value shown in the custom colour input. */
export function colorInputValue(value: string | null): string {
  const current = value?.replace('#', '').toUpperCase() ?? null;
  return `#${current && /^[0-9A-F]{6}$/.test(current) ? current : '000000'}`;
}
