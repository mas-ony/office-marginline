/** The ruler's geometry, marker dragging and ticks, shared by the React and Vue interfaces. */
import { selectedParagraphs, setSectionMargins, updateParagraphs } from '../editor/commands';
import type { DocxEditor } from '../editor/DocxEditor';

const TWIPS_PER_PX = 15;

export type RulerHandle = 'marginLeft' | 'marginRight' | 'firstLine' | 'hanging' | 'indentLeft' | 'indentRight';

export interface RulerGeometry {
  /** Page left edge relative to the ruler, in screen px. */
  x: number;
  zoom: number;
  pageW: number;
  marginLeft: number;
  marginRight: number;
  /** Paragraph indents in page px (left, right, first line offset relative to left). */
  left: number;
  right: number;
  first: number;
  sectionPos: number;
}

/** A marker being dragged and its value so far. */
export interface RulerDrag {
  handle: RulerHandle;
  value: number;
}

export function rulerUsesMetric(): boolean {
  const lang = typeof navigator !== 'undefined' ? navigator.language : 'en-US';
  return !/^en-(US|LR|MM)$/i.test(lang) && !/^en$/i.test(lang);
}

/** Geometry of the page holding the caret, measured against the ruler element. */
export function rulerGeometry(editor: DocxEditor, host: HTMLElement | null): RulerGeometry | null {
  const r = editor.result;
  if (!r || r.mode !== 'print' || !host || !r.pages.length) return null;
  const sel = editor.view.state.selection;
  const page = r.pages[editor.pageOfPos(sel.from)] ?? r.pages[0];
  const sec = r.sections[page.section];
  const canvas = editor.scrollEl.querySelector<HTMLElement>('.ml-dx-canvas');
  if (!sec || !canvas) return null;
  const zoom = editor.zoom;
  const x = canvas.getBoundingClientRect().left + page.left * zoom - host.getBoundingClientRect().left;
  const para = selectedParagraphs(editor.view.state)[0]?.node;
  const ind = para ? editor.docx.styles.effectiveParagraph(para.attrs.styleId, { indent: para.attrs.indent ?? undefined }).indent ?? {} : {};
  const left = (ind.left ?? 0) / TWIPS_PER_PX;
  const right = (ind.right ?? 0) / TWIPS_PER_PX;
  const first = ((ind.firstLine ?? 0) - (ind.hanging ?? 0)) / TWIPS_PER_PX;
  return { x, zoom, pageW: sec.pageW, marginLeft: sec.marginLeft, marginRight: sec.marginRight, left, right, first, sectionPos: page.startPos };
}

/**
 * Drag a marker from a pointer press on it: `onDrag` gets the value while moving and null at the
 * end, when the margin or indent is applied.
 */
export function startRulerDrag(
  editor: DocxEditor,
  host: HTMLElement,
  handle: RulerHandle,
  e: { currentTarget: EventTarget | null; pointerId: number; clientX: number; preventDefault(): void; stopPropagation(): void },
  metric: boolean,
  onDrag: (drag: RulerDrag | null) => void,
) {
  const geo = rulerGeometry(editor, host);
  if (!geo || editor.readOnly) return;
  e.preventDefault();
  e.stopPropagation();
  const el = e.currentTarget as HTMLElement;
  el.setPointerCapture(e.pointerId);
  const box = host.getBoundingClientRect();
  const snap = metric ? 2.5 / 2.54 * 96 / 10 * 2 : 96 / 16;
  const pageX = (clientX: number) => {
    const raw = (clientX - box.left - geo.x) / geo.zoom;
    return Math.round(raw / snap) * snap;
  };
  // Margins move by how far the grey margin area is dragged; markers follow the pointer.
  const startX = e.clientX;
  const dragged = (clientX: number) => Math.round((clientX - startX) / geo.zoom / snap) * snap;
  const valueAt = (clientX: number): number => {
    const p = pageX(clientX);
    const contentL = geo.marginLeft;
    const contentR = geo.pageW - geo.marginRight;
    switch (handle) {
      case 'marginLeft': return Math.max(0, Math.min(geo.marginLeft + dragged(clientX), contentR - 96));
      case 'marginRight': return Math.max(0, Math.min(geo.marginRight - dragged(clientX), geo.pageW - contentL - 96));
      case 'indentLeft':
      case 'hanging': return Math.max(-contentL, Math.min(p - contentL, contentR - contentL - geo.right - 24));
      case 'firstLine': return p - contentL - geo.left;
      case 'indentRight': return Math.max(-geo.marginRight, Math.min(contentR - p, contentR - contentL - geo.left - 24));
    }
  };
  const move = (ev: PointerEvent) => onDrag({ handle, value: valueAt(ev.clientX) });
  const up = (ev: PointerEvent) => {
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
    onDrag(null);
    const v = valueAt(ev.clientX);
    const tw = Math.round(v * TWIPS_PER_PX);
    const view = editor.view;
    if (handle === 'marginLeft') setSectionMargins(view, { left: tw }, geo.sectionPos);
    else if (handle === 'marginRight') setSectionMargins(view, { right: tw }, geo.sectionPos);
    else {
      updateParagraphs(view, (a) => {
        const cur = { ...((a.indent as Record<string, number>) ?? {}) };
        if (handle === 'indentLeft' || handle === 'hanging') {
          const firstOffset = geo.first;
          cur.left = tw;
          // The first line keeps its position relative to the page while hanging moves.
          if (handle === 'hanging') {
            const firstAbs = geo.left + firstOffset;
            const off = firstAbs - v;
            delete cur.firstLine;
            delete cur.hanging;
            if (off > 0) cur.firstLine = Math.round(off * TWIPS_PER_PX);
            else if (off < 0) cur.hanging = Math.round(-off * TWIPS_PER_PX);
          }
        } else if (handle === 'firstLine') {
          delete cur.firstLine;
          delete cur.hanging;
          if (tw > 0) cur.firstLine = tw;
          else if (tw < 0) cur.hanging = -tw;
        } else if (handle === 'indentRight') cur.right = tw;
        return { ...a, indent: cur };
      }, true);
    }
    editor.focus();
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  onDrag({ handle, value: valueAt(e.clientX) });
}

export interface RulerTick {
  key: number;
  left: number;
  className: string;
  /** Number shown at whole inches or centimetres. */
  label?: number;
}

export interface RulerSlider {
  handle: RulerHandle;
  className: string;
  label: string;
  value: number;
  title?: string;
  left: number;
  width?: number;
}

export interface RulerLayout {
  page: { left: number; width: number };
  ticks: RulerTick[];
  sliders: RulerSlider[];
}

/** Positions of the page, the ticks and the markers (with the value of a marker being dragged). */
export function rulerLayout(g: RulerGeometry, drag: RulerDrag | null, metric: boolean): RulerLayout {
  let { marginLeft, marginRight, left, right, first } = g;
  if (drag) {
    if (drag.handle === 'marginLeft') marginLeft = drag.value;
    if (drag.handle === 'marginRight') marginRight = drag.value;
    if (drag.handle === 'indentLeft') left = drag.value;
    if (drag.handle === 'hanging') {
      first = g.left + g.first - drag.value;
      left = drag.value;
    }
    if (drag.handle === 'firstLine') first = drag.value;
    if (drag.handle === 'indentRight') right = drag.value;
  }
  const z = g.zoom;
  const px = (v: number) => g.x + v * z;
  const unit = metric ? 96 / 2.54 : 96;
  const steps = metric ? 4 : 8;
  const ticks: RulerTick[] = [];
  const count = Math.floor(g.pageW / (unit / steps));
  for (let i = 0; i <= count; i++) {
    const at = (i * unit) / steps;
    const major = i % steps === 0;
    const half = !major && i % (steps / 2) === 0;
    ticks.push({ key: i, left: px(at), className: major ? 'ml-tick is-major' : half ? 'ml-tick is-half' : 'ml-tick', label: major && i > 0 ? i / steps : undefined });
  }
  const contentL = marginLeft;
  const contentR = g.pageW - marginRight;
  return {
    page: { left: px(0), width: g.pageW * z },
    ticks,
    sliders: [
      { handle: 'marginLeft', className: 'ml-ruler-margin', label: 'Left margin', value: Math.round(marginLeft), title: 'Drag to change the left margin', left: px(0), width: marginLeft * z },
      { handle: 'marginRight', className: 'ml-ruler-margin', label: 'Right margin', value: Math.round(marginRight), title: 'Drag to change the right margin', left: px(contentR), width: marginRight * z },
      { handle: 'firstLine', className: 'ml-indent ml-indent-first', label: 'First line indent', value: Math.round(first), left: px(contentL + left + first) },
      { handle: 'hanging', className: 'ml-indent ml-indent-hanging', label: 'Hanging indent', value: Math.round(left), left: px(contentL + left) },
      { handle: 'indentLeft', className: 'ml-indent ml-indent-left', label: 'Left indent', value: Math.round(left), left: px(contentL + left) },
      { handle: 'indentRight', className: 'ml-indent ml-indent-right', label: 'Right indent', value: Math.round(right), left: px(contentR - right) },
    ],
  };
}
