/**
 * DOM behaviour shared by the React and Vue interfaces: popover stacking and dismissal, the dialog focus trap,
 * menu keyboard navigation and the placement of floating panels.
 */
import type { DocxEditor } from '../editor/DocxEditor';

export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}

/** Keep the editor's selection (and the mobile keyboard) when pressing toolbar controls. */
export const keepFocus = (e: { preventDefault(): void }) => e.preventDefault();

export const MOBILE_QUERY = '(max-width: 767px), (max-height: 500px) and (pointer: coarse)';

export function matchesMedia(query: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false;
}

/** Calls `fn` with the query's result whenever it changes; returns the unsubscribe function. */
export function watchMedia(query: string, fn: (matches: boolean) => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
  const mq = window.matchMedia(query);
  const on = () => fn(mq.matches);
  mq.addEventListener('change', on);
  return () => mq.removeEventListener('change', on);
}

// -----------------------------------------------------------------------------------------------
// Popovers

/** Open popovers, oldest first. Only the topmost one reacts to outside clicks and Escape. */
const popoverStack: HTMLElement[] = [];

function isAbove(el: HTMLElement, target: Node): boolean {
  const idx = popoverStack.indexOf(el);
  return popoverStack.slice(idx + 1).some((p) => p.contains(target));
}

/**
 * Closes an open popover on a pointer press outside it and its anchor (unless inside a popover opened
 * above it), or on Escape when it is the topmost one. Returns the function that stops tracking.
 */
export function trackPopover(self: HTMLElement | null, anchor: () => HTMLElement | null, onClose: () => void): () => void {
  if (self) popoverStack.push(self);
  const down = (e: PointerEvent) => {
    const t = e.target as Node;
    if (!self || self.contains(t) || anchor()?.contains(t) || isAbove(self, t)) return;
    onClose();
  };
  const key = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !self || popoverStack[popoverStack.length - 1] !== self) return;
    e.stopPropagation();
    onClose();
    anchor()?.focus();
  };
  document.addEventListener('pointerdown', down, true);
  document.addEventListener('keydown', key, true);
  return () => {
    document.removeEventListener('pointerdown', down, true);
    document.removeEventListener('keydown', key, true);
    const i = self ? popoverStack.indexOf(self) : -1;
    if (i >= 0) popoverStack.splice(i, 1);
  };
}

/** Position of a popover below its anchor (above when there is no room), kept inside the window. */
export function placePopover(anchor: HTMLElement, el: HTMLElement, align: 'start' | 'end' = 'start'): { left: number; top: number; maxHeight: number } {
  const a = anchor.getBoundingClientRect();
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = align === 'end' ? a.right - w : a.left;
  left = Math.max(8, Math.min(left, vw - w - 8));
  let top = a.bottom + 4;
  if (top + h > vh - 8 && a.top - h - 4 > 8) top = a.top - h - 4;
  top = Math.max(8, Math.min(top, vh - h - 8));
  return { left, top, maxHeight: vh - 16 };
}

/** Closes a floating panel on a pointer press outside it or on Escape. */
export function dismissOnOutside(el: () => HTMLElement | null, onClose: () => void): () => void {
  const down = (e: PointerEvent) => {
    if (!el()?.contains(e.target as Node)) onClose();
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  };
  document.addEventListener('pointerdown', down, true);
  document.addEventListener('keydown', key, true);
  return () => {
    document.removeEventListener('pointerdown', down, true);
    document.removeEventListener('keydown', key, true);
  };
}

/** Fixed position of a panel at the caret (Ctrl+K), kept inside the window. */
export function caretPanelPosition(editor: DocxEditor, el: HTMLElement | null): { left: number; top: number } {
  const v = editor.activeView;
  let c = { left: 200, bottom: 200 };
  try {
    c = v.coordsAtPos(v.state.selection.from);
  } catch {
    // Use the default position.
  }
  const w = el?.offsetWidth ?? 320;
  const h = el?.offsetHeight ?? 160;
  return { left: Math.max(8, Math.min(c.left, window.innerWidth - w - 8)), top: Math.max(8, Math.min(c.bottom + 6, window.innerHeight - h - 8)) };
}

/** A menu's top-left corner at a point, kept inside the window. */
export function clampToWindow(x: number, y: number, el: HTMLElement): { left: number; top: number } {
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  return { left: Math.max(8, Math.min(x, window.innerWidth - w - 8)), top: Math.max(8, Math.min(y, window.innerHeight - h - 8)) };
}

/** Where the "add comment" bubble goes beside the page, next to the selection; null when out of view. */
export function commentBubblePosition(editor: DocxEditor, mobile: boolean): { top: number; left: number } | null {
  const v = editor.view;
  try {
    const c = v.coordsAtPos(v.state.selection.from);
    const area = editor.scrollEl.getBoundingClientRect();
    const r = editor.result;
    const canvas = editor.scrollEl.querySelector<HTMLElement>('.ml-dx-canvas');
    const page = r && r.mode === 'print' ? r.pages[editor.pageOfPos(v.state.selection.from)] : null;
    const pageRight = page && canvas ? canvas.getBoundingClientRect().left + (page.left + page.width) * editor.zoom : (v.dom as HTMLElement).getBoundingClientRect().right;
    const top = c.top - area.top;
    let left = Math.min(pageRight + 10, area.right - 46) - area.left;
    if (top < 0 || top > area.height - 30) return null;
    if (mobile) left = area.width - 52;
    return { top, left };
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------------------------
// Menus and dialogs

const MENU_ITEMS = '[role="menuitem"]:not([disabled]), [role="menuitemradio"]:not([disabled])';

export function focusFirstMenuItem(menu: HTMLElement | null) {
  menu?.querySelector<HTMLElement>(MENU_ITEMS)?.focus({ preventScroll: true });
}

/** Arrow keys move between a menu's items. */
export function menuKeyDown(menu: HTMLElement | null, e: KeyboardEvent) {
  const items = Array.from(menu?.querySelectorAll<HTMLElement>(MENU_ITEMS) ?? []);
  const idx = items.indexOf(document.activeElement as HTMLElement);
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    items[(idx + 1) % items.length]?.focus();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    items[(idx - 1 + items.length) % items.length]?.focus();
  }
}

/**
 * Dialog behaviour: focus the first control, close on Escape, keep Tab inside, and give focus back when
 * the dialog closes. `onClose` is read when needed, so it may change while the dialog is open.
 */
export function trapFocus(dialog: HTMLElement | null, onClose: () => void): () => void {
  const prev = document.activeElement as HTMLElement | null;
  const first = dialog?.querySelector<HTMLElement>('input, select, textarea, button:not(.ml-ui-modal-close)');
  first?.focus();
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    }
    if (e.key === 'Tab' && dialog) {
      const f = Array.from(dialog.querySelectorAll<HTMLElement>('input, select, textarea, button, [tabindex]:not([tabindex="-1"])')).filter((x) => !x.hasAttribute('disabled'));
      if (!f.length) return;
      const i = f.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && i <= 0) {
        e.preventDefault();
        f[f.length - 1].focus();
      } else if (!e.shiftKey && i === f.length - 1) {
        e.preventDefault();
        f[0].focus();
      }
    }
  };
  document.addEventListener('keydown', key, true);
  return () => {
    document.removeEventListener('keydown', key, true);
    prev?.focus?.();
  };
}

/** Grow a text box with its content, up to `max` pixels. */
export function autosizeTextarea(el: HTMLTextAreaElement | null, max = 160) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(max, el.scrollHeight)}px`;
}
