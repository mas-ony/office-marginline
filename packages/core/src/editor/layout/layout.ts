import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import type { DocxDocument } from '../../core/document';
import { mergeParaProps } from '../../core/model/props';
import type { TabStop } from '../../core/model/types';
import { twipsToPx } from '../../core/ooxml/units';
import { REFRESH } from '../meta';
import { NOTE_SEP_H, noteRefs, type NoteRef } from '../noteRefs';
import {
  CANVAS_PAD_X,
  CANVAS_PAD_Y,
  columnLayout,
  computeSections,
  formatPageNumber,
  headerTypeFor,
  resolveHeaderFooter,
  type PageInfo,
  type SectionGeom,
} from './geometry';

export type ViewMode = 'print' | 'web';

export interface Gap {
  pos: number;
  height: number;
  kind: 'block' | 'inline' | 'row';
  cols?: number;
}

/** Where a block of a multi-column section is drawn, relative to its position in the flow. */
export interface Placement {
  pos: number;
  dx: number;
  dy: number;
}

export interface LayoutState {
  mode: ViewMode;
  gaps: Gap[];
  placements: Placement[];
  rootPad: number;
  sections: SectionGeom[];
  decos: DecorationSet;
}

interface LayoutMeta {
  gaps?: Gap[];
  placements?: Placement[];
  rootPad?: number;
  mode?: ViewMode;
}

export const layoutKey = new PluginKey<LayoutState>('ml-dx-layout');

export interface CanvasMetrics {
  canvasW: number;
  rootLeft: number;
  rootW: number;
}

export function canvasMetrics(sections: SectionGeom[], padX = CANVAS_PAD_X): CanvasMetrics {
  const maxW = Math.max(...sections.map((s) => s.pageW));
  const canvasW = maxW + padX * 2;
  const s0 = sections[0];
  return { canvasW, rootLeft: (canvasW - s0.pageW) / 2 + s0.contentX, rootW: s0.contentW };
}

function gapWidget(g: Gap): Decoration {
  const h = Math.round(g.height * 100) / 100;
  if (g.kind === 'row') {
    return Decoration.widget(g.pos, () => {
      const tr = document.createElement('tr');
      tr.className = 'ml-dx-gap-row';
      const td = tr.appendChild(document.createElement('td'));
      td.colSpan = g.cols ?? 1;
      td.style.height = `${h}px`;
      return tr;
    }, { side: -1, key: `r${g.pos}:${h}`, ignoreSelection: true });
  }
  return Decoration.widget(g.pos, () => {
    const el = document.createElement(g.kind === 'block' ? 'div' : 'span');
    el.className = g.kind === 'block' ? 'ml-dx-gap' : 'ml-dx-gap ml-dx-gap-inline';
    // After multi-column sections the following content is pulled back up (negative gap).
    if (h < 0) el.style.marginTop = `${h}px`;
    else el.style.height = `${h}px`;
    el.setAttribute('aria-hidden', 'true');
    return el;
  }, { side: -1, key: `${g.kind[0]}${g.pos}:${h}`, ignoreSelection: true, marks: [] });
}

function widthDecorations(doc: PMNode, sections: SectionGeom[]): Decoration[] {
  if (sections.length < 2 && !sections.some((s) => s.props.cols.num > 1)) return [];
  const { canvasW, rootLeft, rootW } = canvasMetrics(sections);
  const out: Decoration[] = [];
  const blocks: { node: PMNode; pos: number }[] = [];
  doc.forEach((node, pos) => blocks.push({ node, pos }));
  for (const s of sections) {
    const left = (canvasW - s.pageW) / 2 + s.contentX;
    const dx = left - rootLeft;
    const width = s.props.cols.num > 1 ? Math.min(...columnLayout(s).w) : s.contentW;
    if (Math.abs(dx) < 0.5 && Math.abs(width - rootW) < 0.5) continue;
    for (let i = s.startBlock; i < s.endBlock && i < blocks.length; i++) {
      const { node, pos } = blocks[i];
      if (node.type.name === 'section_break') continue;
      out.push(Decoration.node(pos, pos + node.nodeSize, { style: `margin-left: ${dx}px; width: ${width}px; box-sizing: border-box` }));
    }
  }
  return out;
}

function placementDecorations(doc: PMNode, placements: Placement[]): Decoration[] {
  const out: Decoration[] = [];
  for (const p of placements) {
    const node = doc.nodeAt(p.pos);
    if (!node || !node.isBlock) continue;
    out.push(Decoration.node(p.pos, p.pos + node.nodeSize, { style: `transform: translate(${p.dx}px, ${p.dy}px)`, class: 'ml-dx-in-column' }));
  }
  return out;
}

function buildDecos(doc: PMNode, mode: ViewMode, gaps: Gap[], placements: Placement[], sections: SectionGeom[]): DecorationSet {
  if (mode !== 'print') return DecorationSet.empty;
  return DecorationSet.create(doc, [...widthDecorations(doc, sections), ...placementDecorations(doc, placements), ...gaps.map(gapWidget)]);
}

function mapPlacements(placements: Placement[], tr: Transaction): Placement[] {
  const out: Placement[] = [];
  for (const p of placements) {
    const r = tr.mapping.mapResult(p.pos, 1);
    if (!r.deleted) out.push({ ...p, pos: r.pos });
  }
  return out;
}

function mapGaps(gaps: Gap[], tr: Transaction): Gap[] {
  const out: Gap[] = [];
  for (const g of gaps) {
    const r = tr.mapping.mapResult(g.pos, -1);
    if (!r.deleted) out.push({ ...g, pos: r.pos });
  }
  return out;
}

export function layoutPlugin(initialMode: ViewMode): Plugin<LayoutState> {
  return new Plugin<LayoutState>({
    key: layoutKey,
    state: {
      init: (_, state) => {
        const sections = computeSections(state.doc);
        return { mode: initialMode, gaps: [], placements: [], rootPad: CANVAS_PAD_Y + sections[0].marginTop, sections, decos: buildDecos(state.doc, initialMode, [], [], sections) };
      },
      apply: (tr, prev, _old, state) => {
        const meta = tr.getMeta(layoutKey) as LayoutMeta | undefined;
        if (!meta && !tr.docChanged && !tr.getMeta(REFRESH)) return prev;
        const mode = meta?.mode ?? prev.mode;
        const sections = tr.docChanged || meta?.mode || tr.getMeta(REFRESH) ? computeSections(state.doc) : prev.sections;
        let gaps = meta?.gaps ?? (tr.docChanged ? mapGaps(prev.gaps, tr) : prev.gaps);
        let placements = meta?.placements ?? (tr.docChanged ? mapPlacements(prev.placements, tr) : prev.placements);
        if (mode !== 'print') {
          gaps = [];
          placements = [];
        }
        const rootPad = meta?.rootPad ?? prev.rootPad;
        return { mode, gaps, placements, rootPad, sections, decos: buildDecos(state.doc, mode, gaps, placements, sections) };
      },
    },
    props: {
      decorations: (state) => layoutKey.getState(state)?.decos,
      attributes: (state): Record<string, string> => {
        const s = layoutKey.getState(state);
        if (!s || s.mode !== 'print') return {};
        const { rootW } = canvasMetrics(s.sections);
        return { style: `padding-top: ${s.rootPad}px; width: ${rootW}px` };
      },
    },
  });
}

export function setViewMode(view: EditorView, mode: ViewMode) {
  view.dispatch(view.state.tr.setMeta(layoutKey, { mode }).setMeta('addToHistory', false));
}

// -----------------------------------------------------------------------------------------------

export interface LayoutHost {
  view: EditorView;
  docx: DocxDocument;
  zoom: number;
  /** Rendered height of a header/footer part at the given content width (px). */
  hfHeight(path: string, width: number): number;
  /** Rendered height of a footnote or endnote (with its number) at the given width (px). */
  noteHeight(key: string, label: string, width: number): number;
  /** Space between pages and around the canvas (zero when printing). */
  spacing(): { gap: number; padX: number; padY: number };
}

/** A vertical separator between columns on one page (x relative to the page). */
export interface ColumnRule {
  page: number;
  top: number;
  bottom: number;
  x: number[];
}

export interface LayoutResult {
  mode: ViewMode;
  pages: PageInfo[];
  sections: SectionGeom[];
  canvasW: number;
  canvasH: number;
  rootLeft: number;
  rootW: number;
  rules: ColumnRule[];
}

interface LineBox {
  top: number;
  bottom: number;
  pos: number;
  forced: boolean;
}

const EPS = 0.5;
const NO_NOTES: NoteRef[] = [];

function placementsEqual(a: Placement[], b: Placement[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].pos !== b[i].pos || Math.abs(a[i].dx - b[i].dx) > 0.5 || Math.abs(a[i].dy - b[i].dy) > 0.5) return false;
  }
  return true;
}

function gapsEqual(a: Gap[], b: Gap[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].pos !== b[i].pos || a[i].kind !== b[i].kind || Math.abs(a[i].height - b[i].height) > 0.5) return false;
  }
  return true;
}

/** Size tab characters to their paragraph's tab stops (print and web view, body and headers). */
export function layoutTabs(view: EditorView, docx: DocxDocument, zoom: number, cache: WeakMap<PMNode, string>): void {
  const defaultStop = twipsToPx(view.state.doc.attrs.defaultTabStop || 720);
  view.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'paragraph') return true;
    let hasTab = false;
    node.forEach((c) => { if (c.type.name === 'tab') hasTab = true; });
    if (!hasTab) return false;
    const el = view.nodeDOM(pos) as HTMLElement | null;
    if (!el) return false;
    const key = `${el.clientWidth}`;
    if (cache.get(node) === key) return false;
    const eff = mergeParaProps(docx.styles.effectiveParagraph(node.attrs.styleId), {
      indent: node.attrs.indent ?? undefined,
      tabs: node.attrs.tabs ?? undefined,
    });
    // In narrow (web/mobile) layouts a stop can lie beyond the text width: right-aligned stops
    // snap to the right edge so headers like "Title<TAB>Page 1" stay on one line; others drop.
    const cs = getComputedStyle(el);
    const maxX = el.clientWidth - parseFloat(cs.paddingRight || '0') - 1;
    const stops = (eff.tabs ?? [])
      .filter((t: TabStop) => t.val !== 'clear' && t.val !== 'bar')
      .map((t) => ({ ...t, x: twipsToPx(t.pos) }))
      .map((t) => (t.x > maxX && (t.val === 'right' || t.val === 'end') ? { ...t, x: maxX } : t))
      .filter((t) => t.x <= maxX);
    const hanging = eff.indent?.hanging !== undefined && eff.indent.left !== undefined ? twipsToPx(eff.indent.left) : undefined;
    const pLeft = el.getBoundingClientRect().left;
    const tabs = Array.from(el.querySelectorAll<HTMLElement>('.ml-dx-tab'));
    for (const tab of tabs) {
      tab.style.width = '0px';
      const x = (tab.getBoundingClientRect().left - pLeft) / zoom;
      const stop = stops.find((s) => s.x > x + 1);
      let target: number;
      if (!stop && hanging !== undefined && hanging > x + 1) target = hanging;
      else if (stop) target = stop.x;
      else target = (Math.floor((x + 1) / defaultStop) + 1) * defaultStop;
      let width = target - x;
      if (stop && (stop.val === 'right' || stop.val === 'end' || stop.val === 'center' || stop.val === 'decimal')) {
        const follow = followingWidth(tab, tabs) / zoom;
        width = stop.val === 'center' ? target - x - follow / 2 : target - x - follow;
      }
      tab.style.width = `${Math.max(0, width)}px`;
      tab.dataset.leader = stop?.leader && stop.leader !== 'none' ? stop.leader : '';
    }
    cache.set(node, key);
    return false;
  });
}

/** Width of content after `tab` up to the next tab on the same line (client px). */
function followingWidth(tab: HTMLElement, tabs: HTMLElement[]): number {
  const next = tabs[tabs.indexOf(tab) + 1];
  const range = document.createRange();
  range.setStartAfter(tab);
  const para = tab.closest('.ml-dx-p');
  if (next) range.setEndBefore(next);
  else if (para) range.setEnd(para, para.childNodes.length);
  const tabRect = tab.getBoundingClientRect();
  let width = 0;
  for (const r of Array.from(range.getClientRects())) {
    if (Math.abs(r.top - tabRect.top) < tabRect.height + 2 && r.width > 0) width += r.width;
  }
  return width;
}

/** Measures the rendered body and computes page breaks for print layout. */
export class LayoutEngine {
  private tabCache = new WeakMap<PMNode, string>();
  /** Natural line boxes per unchanged paragraph node, relative to the paragraph's top and start. */
  private lineCache = new WeakMap<PMNode, { key: string; lines: { top: number; bottom: number; off: number; forced: boolean }[] }>();
  private styleCache = new Map<string, { keepNext: boolean; keepLines: boolean; widow: boolean }>();
  private styleCacheVersion = -1;

  constructor(private host: LayoutHost) {}

  /** Forget measurements that depend on fonts or visibility of non-printing marks. */
  resetCaches() {
    this.tabCache = new WeakMap();
    this.lineCache = new WeakMap();
  }

  /** Everything besides the node itself that can change how a paragraph wraps. */
  private lineKey(el: HTMLElement): string {
    return `${el.clientWidth}|${el.className}|${el.dataset.label ?? ''}|${el.getAttribute('style') ?? ''}`;
  }

  private paraFlags(node: PMNode) {
    const docx = this.host.docx;
    if (this.styleCacheVersion !== docx.styles.version) {
      this.styleCache.clear();
      this.styleCacheVersion = docx.styles.version;
    }
    const key = node.attrs.styleId ?? '';
    let s = this.styleCache.get(key);
    if (!s) {
      const eff = docx.styles.effectiveParagraph(node.attrs.styleId);
      s = { keepNext: !!eff.keepNext, keepLines: !!eff.keepLines, widow: eff.widowControl !== false };
      this.styleCache.set(key, s);
    }
    return {
      keepNext: node.attrs.keepNext ?? s.keepNext,
      keepLines: node.attrs.keepLines ?? s.keepLines,
      widow: node.attrs.widowControl ?? s.widow,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Lines

  /** Natural line boxes of a paragraph (top/bottom relative to `nat`), using DOM measurement only. */
  private measureLines(el: HTMLElement, natY: (clientY: number) => number): LineBox[] {
    const { view } = this.host;
    interface Item { top: number; bottom: number; left: number; right: number; pos: number; brk: boolean }
    const items: Item[] = [];
    const range = document.createRange();
    const walk = (parent: Node) => {
      for (let n = parent.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === Node.TEXT_NODE) {
          const text = n as Text;
          if (!text.data.length) continue;
          range.selectNodeContents(text);
          const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 || r.height > 0);
          if (!rects.length) continue;
          rects.forEach((r, i) => {
            let offset = 0;
            if (i > 0) {
              // Binary search the first character rendered on this line fragment.
              let lo = 0;
              let hi = text.data.length - 1;
              while (lo < hi) {
                const mid = (lo + hi) >> 1;
                range.setStart(text, mid);
                range.setEnd(text, mid + 1);
                const cr = range.getBoundingClientRect();
                if (cr.top >= r.top - 1 && !(cr.top >= r.bottom)) hi = mid;
                else if (cr.top < r.top - 1) lo = mid + 1;
                else hi = mid;
              }
              offset = lo;
            }
            let pos: number;
            try {
              pos = view.posAtDOM(text, offset);
            } catch {
              return;
            }
            items.push({ top: r.top, bottom: r.bottom, left: r.left, right: r.right, pos, brk: false });
          });
        } else if (n.nodeType === Node.ELEMENT_NODE) {
          const e = n as HTMLElement;
          if (e.classList.contains('ml-dx-gap')) continue;
          const atom = e.classList.contains('ml-dx-tab') || e.classList.contains('ml-dx-image-wrap') || e.tagName === 'IMG' || e.tagName === 'BR'
            || e.classList.contains('ml-dx-page-break') || e.classList.contains('ml-dx-column-break') || e.classList.contains('ml-dx-opaque')
            || e.classList.contains('ml-dx-page-field') || e.classList.contains('ml-dx-footnote-ref');
          if (atom) {
            if (e.classList.contains('ml-dx-float') || e.style.position === 'absolute') continue;
            const r = e.getBoundingClientRect();
            let pos: number;
            try {
              pos = view.posAtDOM(e, 0, -1);
            } catch {
              continue;
            }
            const brk = e.classList.contains('ml-dx-page-break') || e.classList.contains('ml-dx-column-break');
            if (e.tagName === 'BR' && e.classList.contains('ProseMirror-trailingBreak')) continue;
            items.push({ top: r.top, bottom: r.bottom, left: r.left, right: r.right, pos, brk });
          } else walk(e);
        }
      }
    };
    walk(el);
    // Group into lines: a new line starts when an item lies below the current line or the
    // horizontal position moves back to the left while going down.
    interface RawLine { top: number; bottom: number; pos: number; forced: boolean; lastRight: number; lastTop: number }
    const lines: RawLine[] = [];
    let forceNew = false;
    for (const it of items) {
      const cur = lines[lines.length - 1];
      const newLine = !cur || forceNew || it.top >= cur.bottom - 1 || (it.left < cur.lastRight - 2 && it.top > cur.lastTop + 2);
      if (newLine) lines.push({ top: it.top, bottom: it.bottom, pos: it.pos, forced: false, lastRight: it.right, lastTop: it.top });
      else {
        cur.top = Math.min(cur.top, it.top);
        cur.bottom = Math.max(cur.bottom, it.bottom);
        cur.lastRight = it.right;
        cur.lastTop = it.top;
      }
      forceNew = false;
      if (it.brk) {
        lines[lines.length - 1].forced = true;
        forceNew = true;
      }
    }
    if (!lines.length) return [];
    // Convert content rects to line boxes: split the leading between neighbouring lines and
    // extend the first and last line to the paragraph's content box.
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const zoom = this.host.zoom;
    const padTop = (parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth || '0')) * zoom;
    const padBottom = (parseFloat(cs.paddingBottom) + parseFloat(cs.borderBottomWidth || '0')) * zoom;
    const boxes: LineBox[] = lines.map((l) => ({ top: l.top, bottom: l.bottom, pos: l.pos, forced: l.forced }));
    boxes[0].top = Math.min(boxes[0].top, rect.top + padTop);
    for (let i = 0; i < boxes.length - 1; i++) {
      const mid = (lines[i].bottom + lines[i + 1].top) / 2;
      boxes[i].bottom = Math.max(boxes[i].bottom, mid);
      boxes[i + 1].top = Math.min(boxes[i + 1].top, mid);
    }
    const last = boxes[boxes.length - 1];
    last.bottom = Math.max(last.bottom, rect.bottom - padBottom);
    return boxes.map((b) => ({ ...b, top: natY(b.top), bottom: natY(b.bottom) }));
  }

  // ---------------------------------------------------------------------------------------------

  run(): LayoutResult | null {
    const { view } = this.host;
    let st = layoutKey.getState(view.state);
    if (!st) return null;
    layoutTabs(view, this.host.docx, this.host.zoom || 1, this.tabCache);
    const sections = st.sections;
    const spacing = this.host.spacing();
    const metrics = canvasMetrics(sections, spacing.padX);
    if (st.mode !== 'print') {
      return { mode: st.mode, pages: [], sections, canvasW: metrics.canvasW, canvasH: 0, rootLeft: 0, rootW: 0, rules: [] };
    }

    // Inline gaps change line wrapping, so take them out of paragraphs that must be measured
    // again; unchanged paragraphs reuse their cached line geometry.
    const inlineGaps = st.gaps.filter((g) => g.kind === 'inline');
    if (inlineGaps.length) {
      const keep: Gap[] = [];
      for (const g of inlineGaps) {
        const $g = view.state.doc.resolve(Math.min(g.pos, view.state.doc.content.size));
        const para = $g.depth >= 1 ? $g.node(1) : null;
        const el = para ? (view.nodeDOM($g.before(1)) as HTMLElement | null) : null;
        const cached = para ? this.lineCache.get(para) : undefined;
        if (cached && el && cached.key === this.lineKey(el)) keep.push(g);
      }
      if (keep.length !== inlineGaps.length) {
        view.dispatch(view.state.tr.setMeta(layoutKey, { gaps: [...st.gaps.filter((g) => g.kind !== 'inline'), ...keep] }).setMeta('addToHistory', false));
        st = layoutKey.getState(view.state)!;
      }
    }
    const oldGaps = [...st.gaps].sort((a, b) => a.pos - b.pos);
    const doc = view.state.doc;
    const zoom = this.host.zoom || 1;
    const root = view.dom as HTMLElement;
    const rootRect = root.getBoundingClientRect();
    const contentTopClient = rootRect.top + st.rootPad * zoom;
    const evenAndOdd = !!doc.attrs.evenAndOddHeaders;

    const pages: PageInfo[] = [];
    let pageTop = spacing.padY;
    let pageNumber = 0;
    const openPage = (sectionIdx: number, firstInSection: boolean, startPos: number, blank = false): PageInfo => {
      const sg = sections[sectionIdx];
      if (firstInSection && sg.props.pgNumStart !== null && sg.props.pgNumStart !== undefined) pageNumber = sg.props.pgNumStart;
      else pageNumber++;
      const type = headerTypeFor(sg, firstInSection, pageNumber, evenAndOdd);
      const header = resolveHeaderFooter(sections, sectionIdx, 'header', type);
      const footer = resolveHeaderFooter(sections, sectionIdx, 'footer', type);
      const hH = header ? this.host.hfHeight(header, sg.contentW) : 0;
      const fH = footer ? this.host.hfHeight(footer, sg.contentW) : 0;
      let bodyTopOff = Math.max(sg.marginTop, header ? sg.headerDist + hH : 0);
      let bodyBottomOff = sg.pageH - Math.max(sg.marginBottom, footer ? sg.footerDist + fH : 0);
      if (bodyBottomOff - bodyTopOff < 72) {
        bodyTopOff = Math.min(bodyTopOff, sg.pageH / 2 - 36);
        bodyBottomOff = Math.max(bodyBottomOff, sg.pageH / 2 + 36);
      }
      const page: PageInfo = {
        index: pages.length,
        number: pageNumber,
        numberText: formatPageNumber(pageNumber, sg.props.pgNumFmt),
        section: sectionIdx,
        firstInSection,
        top: pageTop,
        left: (metrics.canvasW - sg.pageW) / 2,
        width: sg.pageW,
        height: sg.pageH,
        bodyTop: pageTop + bodyTopOff,
        bodyBottom: pageTop + bodyBottomOff,
        header,
        footer,
        headerType: type,
        startPos,
        blank,
        notes: [],
        notesH: 0,
        endnotes: [],
        endnotesTop: 0,
      };
      pages.push(page);
      pageTop += sg.pageH + spacing.gap;
      return page;
    };

    let page = openPage(0, true, 0);
    const y0 = page.bodyTop;
    let shift = 0;
    const newGaps: Gap[] = [];
    let pageHasContent = false;
    let sectionIdx = 0;
    let pending: { section: number; parity?: 'even' | 'odd'; newSection: boolean } | null = null;

    /** Start a new page and return the gap needed to move content at visual y `visTop` there. */
    const nextPage = (startPos: number, visTop: number): number => {
      const target = pending ?? { section: page.section, newSection: false };
      let p = openPage(target.section, target.newSection, startPos);
      if (target.parity && (p.number % 2 === 0) !== (target.parity === 'even')) {
        p.blank = true;
        p = openPage(target.section, false, startPos);
      }
      page = p;
      pending = null;
      pageHasContent = false;
      return page.bodyTop - visTop;
    };

    const blocks: { node: PMNode; pos: number }[] = [];
    doc.forEach((node, pos) => blocks.push({ node, pos }));

    // Footnotes take space at the bottom of the page that holds their reference.
    const refs = noteRefs(doc).filter((r) => this.host.docx.notes.has(r.key));
    const footRefs = refs.filter((r) => r.kind === 'footnote');
    const notesIn = (from: number, to: number): NoteRef[] => {
      if (!footRefs.length) return NO_NOTES;
      let lo = 0;
      let hi = footRefs.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (footRefs[mid].pos < from) lo = mid + 1;
        else hi = mid;
      }
      const out: NoteRef[] = [];
      for (let k = lo; k < footRefs.length && footRefs[k].pos < to; k++) out.push(footRefs[k]);
      return out;
    };
    /** Extra height the current page needs for these notes (separator included). */
    const notesH = (list: NoteRef[]): number => {
      if (!list.length) return 0;
      const w = sections[page.section].contentW;
      let h = page.notes.length ? 0 : NOTE_SEP_H;
      for (const r of list) h += this.host.noteHeight(r.key, r.label, w);
      return h;
    };
    const addNotes = (list: NoteRef[]) => {
      if (!list.length) return;
      page.notesH += notesH(list);
      page.notes.push(...list);
    };
    /** Bottom of the space available for body text on the current page. */
    const limit = () => page.bodyBottom - page.notesH;

    // Multi-column sections: blocks are stacked in the flow and drawn in columns via transforms.
    interface ColItem { pos: number; h: number; base: number; page: number; col: number; y: number }
    interface ColState { section: number; x: number[]; top: number; y: number; index: number; page: number; items: ColItem[]; forceNext: boolean }
    const placements: Placement[] = [];
    const rules: ColumnRule[] = [];
    let col: ColState | null = null;

    /** Close the column region; returns the visual y where following content continues. */
    const finishColumns = (balance: boolean): number => {
      const c = col!;
      col = null;
      const sg = sections[c.section];
      const num = c.x.length;
      const last = c.items.filter((it) => it.page === c.page);
      if (balance && last.length > 1 && num > 1) {
        // Smallest column height that fits the last page's blocks in order into `num` columns.
        const fitsIn = (hMax: number) => {
          let k = 0;
          let used = 0;
          for (const it of last) {
            if (used > 0 && used + it.h > hMax + EPS) {
              k++;
              used = 0;
            }
            used += it.h;
            if (k >= num) return false;
          }
          return true;
        };
        let lo = Math.max(...last.map((it) => it.h));
        let hi = last.reduce((a, it) => a + it.h, 0);
        for (let iter = 0; iter < 30 && hi - lo > 0.5; iter++) {
          const mid = (lo + hi) / 2;
          if (fitsIn(mid)) hi = mid;
          else lo = mid;
        }
        let k = 0;
        let used = 0;
        for (const it of last) {
          if (used > 0 && used + it.h > hi + EPS && k < num - 1) {
            k++;
            used = 0;
          }
          it.col = k;
          it.y = c.top + used;
          used += it.h;
        }
      }
      const byPage = new Map<number, { top: number; bottom: number }>();
      for (const it of c.items) {
        const pl = placements.find((p) => p.pos === it.pos);
        if (pl) {
          pl.dx = c.x[it.col];
          pl.dy = it.y - it.base;
        }
        const r = byPage.get(it.page) ?? { top: it.y, bottom: it.y + it.h };
        r.top = Math.min(r.top, it.y);
        r.bottom = Math.max(r.bottom, it.y + it.h);
        byPage.set(it.page, r);
      }
      if (sg.props.cols.sep && num > 1) {
        const layout = columnLayout(sg);
        for (const [pi, r] of byPage) {
          const pg = pages[pi];
          const xs = layout.x.slice(1).map((x, i) => sg.contentX + (layout.x[i] + layout.w[i] + x) / 2);
          rules.push({ page: pi, top: r.top - pg.top, bottom: r.bottom - pg.top, x: xs });
        }
      }
      const end = byPage.get(c.page);
      return end ? end.bottom : c.y;
    };

    interface Snapshot { shift: number; gaps: number; oldIdx: number; oldShift: number; pageIndex: number; pageHasContent: boolean; pageNumber: number; pageTop: number; placements: number; notes: number; notesH: number }
    const snapshots: Snapshot[] = [];
    let oldIdx = 0;
    let oldShift = 0;
    let forceBreakAt = -1;
    let keepNextGuard = -1;
    /** Visual bottom of the last block placed (where endnotes start). */
    let flowBottom = y0;

    const natY = (clientY: number) => (clientY - contentTopClient) / zoom;

    for (let i = 0; i < blocks.length; i++) {
      const { node, pos } = blocks[i];
      while (oldIdx < oldGaps.length && oldGaps[oldIdx].pos <= pos) {
        oldShift += oldGaps[oldIdx].height;
        oldIdx++;
      }
      snapshots[i] = { shift, gaps: newGaps.length, oldIdx, oldShift, pageIndex: page.index, pageHasContent, pageNumber, pageTop, placements: placements.length, notes: page.notes.length, notesH: page.notesH };

      if (node.type.name === 'section_break') {
        sectionIdx = Math.min(sectionIdx + 1, sections.length - 1);
        const type = sections[sectionIdx].props.type ?? 'nextPage';
        if (type !== 'continuous') pending = { section: sectionIdx, newSection: true, parity: type === 'evenPage' ? 'even' : type === 'oddPage' ? 'odd' : undefined };
        continue;
      }
      const el = view.nodeDOM(pos) as HTMLElement | null;
      if (!el || !el.getBoundingClientRect) continue;
      const rect = el.getBoundingClientRect();
      let innerOld = 0;
      const innerOldGaps: Gap[] = [];
      for (let k = oldIdx; k < oldGaps.length && oldGaps[k].pos < pos + node.nodeSize; k++) {
        innerOld += oldGaps[k].height;
        innerOldGaps.push(oldGaps[k]);
      }
      const inColumns = sections[sectionIdx].props.cols.num > 1;
      // Column blocks carry transforms; offsetTop/offsetHeight give their place in the flow.
      const natTop = inColumns ? el.offsetTop - st.rootPad - oldShift : natY(rect.top) - oldShift;
      const natH = inColumns ? el.offsetHeight : rect.height / zoom - innerOld;
      let top = y0 + natTop + shift;

      if (col && (!inColumns || col.section !== sectionIdx)) {
        // Leaving a column region: continue below its tallest column (balanced before a
        // continuous section break).
        const endY = finishColumns(!pending);
        const h = endY - top;
        newGaps.push({ pos, height: h, kind: 'block' });
        shift += h;
        top = y0 + natTop + shift;
      }
      const flags = node.type.name === 'paragraph' ? this.paraFlags(node) : { keepNext: false, keepLines: false, widow: true };
      const blockNotes = notesIn(pos, pos + node.nodeSize);
      let notesPlaced = false;

      const breakHere = (visTop: number) => {
        const h = nextPage(pos, visTop);
        newGaps.push({ pos, height: h, kind: 'block' });
        shift += h;
        top = y0 + natTop + shift;
      };

      if (pending || forceBreakAt === i || (node.attrs.pageBreakBefore && pageHasContent)) {
        if (pending || pageHasContent || forceBreakAt === i) breakHere(top);
        forceBreakAt = -1;
      }

      if (inColumns) {
        const sg: SectionGeom = sections[sectionIdx];
        if (!col) col = { section: sectionIdx, x: columnLayout(sg).x, top, y: top, index: 0, page: page.index, items: [], forceNext: false };
        const c: ColState = col;
        if (c.forceNext || (c.y + natH > limit() - notesH(blockNotes) + EPS && c.y > c.top + EPS)) {
          if (c.index < c.x.length - 1) {
            c.index++;
            c.y = c.top;
          } else {
            page = openPage(page.section, false, pos);
            pageHasContent = false;
            c.index = 0;
            c.top = page.bodyTop;
            c.y = page.bodyTop;
            c.page = page.index;
          }
        }
        c.forceNext = el.querySelector('.ml-dx-column-break, .ml-dx-page-break') !== null;
        placements.push({ pos, dx: c.x[c.index], dy: c.y - top });
        c.items.push({ pos, h: natH, base: top, page: page.index, col: c.index, y: c.y });
        c.y += natH;
        addNotes(blockNotes);
        pageHasContent = true;
        continue;
      }

      let fits = top + natH <= limit() - notesH(blockNotes) + EPS;
      const hasForced = node.type.name === 'paragraph' && el.querySelector('.ml-dx-page-break, .ml-dx-column-break') !== null;

      /**
       * Keep-with-next: when this block has to start on the next page, preceding keepNext
       * paragraphs on the current page move with it. Returns true after rewinding the loop.
       */
      const tryKeepNext = (): boolean => {
        if (!pageHasContent || i === 0 || keepNextGuard === i) return false;
        let j = i - 1;
        let chain = 0;
        while (j >= 0 && chain < 5) {
          const prev = blocks[j];
          if (prev.node.type.name !== 'paragraph' || !this.paraFlags(prev.node).keepNext) break;
          if (snapshots[j].pageIndex !== page.index || !snapshots[j].pageHasContent) break;
          j--;
          chain++;
        }
        const start = j + 1;
        if (chain === 0 || start >= i) return false;
        const snap = snapshots[start];
        shift = snap.shift;
        newGaps.length = snap.gaps;
        placements.length = snap.placements;
        page.notes.length = snap.notes;
        page.notesH = snap.notesH;
        oldIdx = snap.oldIdx;
        oldShift = snap.oldShift;
        pageHasContent = snap.pageHasContent;
        forceBreakAt = start;
        keepNextGuard = i;
        i = start - 1;
        return true;
      };

      let rewind = false;
      if (node.type.name === 'paragraph' && (!fits || hasForced)) {
        const key = this.lineKey(el);
        const cached = this.lineCache.get(node);
        let lines: LineBox[];
        if (cached && cached.key === key) {
          lines = cached.lines.map((l) => ({ top: natTop + l.top, bottom: natTop + l.bottom, pos: pos + l.off, forced: l.forced }));
        } else {
          lines = this.measureLines(el, (cy) => natY(cy) - oldShift);
          this.lineCache.set(node, { key, lines: lines.map((l) => ({ top: l.top - natTop, bottom: l.bottom - natTop, off: l.pos - pos, forced: l.forced })) });
        }
        if (lines.length) {
          if (!fits && pageHasContent && flags.keepLines && natH <= page.bodyBottom - page.bodyTop) {
            if (tryKeepNext()) continue;
            breakHere(top);
            fits = top + natH <= limit() - notesH(blockNotes) + EPS;
          }
          notesPlaced = true;
          let startLine = 0;
          let firstOnPageIsParaStart = !pageHasContent;
          // Notes state of the page before each line's notes were added, to undo moved lines.
          const marks: { n: number; h: number }[] = [];
          const undoNotes = (from: number, upTo: number) => {
            if (from >= upTo || !marks[from]) return;
            page.notes.length = marks[from].n;
            page.notesH = marks[from].h;
          };
          for (let j = 0; j < lines.length; j++) {
            const L = lines[j];
            const vb = y0 + L.bottom + shift;
            const lineNotes = blockNotes.length ? notesIn(j === 0 ? pos : L.pos, j + 1 < lines.length ? lines[j + 1].pos : pos + node.nodeSize) : NO_NOTES;
            if (vb > limit() - notesH(lineNotes) + EPS) {
              if (j === startLine && (startLine > 0 || !pageHasContent)) {
                // A single line taller than the page: let it overflow.
              } else {
                let b = j;
                if (b > 0 && flags.widow && lines.length > 1) {
                  if (lines.length - b === 1 && b - 1 > startLine) b -= 1;
                  if (b - startLine === 1 && startLine === 0 && pageHasContent && !firstOnPageIsParaStart) b = 0;
                }
                if (b === 0) {
                  // Nothing of the paragraph stays on this page.
                  undoNotes(0, j);
                  if (tryKeepNext()) {
                    rewind = true;
                    break;
                  }
                  breakHere(top);
                  startLine = 0;
                  firstOnPageIsParaStart = true;
                  j = -1;
                  continue;
                }
                undoNotes(b, j);
                const visTop = y0 + lines[b].top + shift;
                const h = nextPage(lines[b].pos, visTop);
                newGaps.push({ pos: lines[b].pos, height: h, kind: 'inline' });
                shift += h;
                startLine = b;
                j = b - 1;
                pageHasContent = true;
                continue;
              }
            }
            marks[j] = { n: page.notes.length, h: page.notesH };
            addNotes(lineNotes);
            if (L.forced) {
              if (j < lines.length - 1) {
                const visTop = y0 + lines[j + 1].top + shift;
                const h = nextPage(lines[j + 1].pos, visTop);
                newGaps.push({ pos: lines[j + 1].pos, height: h, kind: 'inline' });
                shift += h;
                startLine = j + 1;
                pageHasContent = true;
              } else {
                pending = { section: page.section, newSection: false };
              }
            }
          }
        } else if (!fits && pageHasContent) {
          if (tryKeepNext()) continue;
          breakHere(top);
        }
      } else if (node.type.name === 'table' && !fits) {
        notesPlaced = true;
        rewind = this.splitTable(node, pos, natY, oldShift, innerOldGaps, {
          y0,
          getShift: () => shift,
          addShift: (h) => { shift += h; },
          limit,
          notesIn,
          notesH,
          addNotes,
          pageHasContent: () => pageHasContent,
          breakBefore: () => {
            if (tryKeepNext()) return true;
            breakHere(top);
            return false;
          },
          nextPage: (startPos, visTop) => nextPage(startPos, visTop),
          push: (g) => newGaps.push(g),
        });
      } else if (!fits && pageHasContent) {
        if (tryKeepNext()) continue;
        breakHere(top);
      }
      if (rewind) continue;
      if (!notesPlaced) addNotes(blockNotes);
      pageHasContent = true;
      flowBottom = y0 + natTop + natH + shift;
    }

    if (col) flowBottom = finishColumns(false);

    // Endnotes follow the end of the text, continuing on new pages when they do not fit.
    let y = flowBottom;
    for (const r of refs) {
      if (r.kind !== 'endnote') continue;
      const h = this.host.noteHeight(r.key, r.label, sections[page.section].contentW);
      const sep = page.endnotes.length ? 0 : NOTE_SEP_H;
      if (y + sep + h > limit() + EPS && (page.endnotes.length > 0 || y > page.bodyTop + EPS)) {
        page = openPage(page.section, false, doc.content.size);
        y = page.bodyTop;
      }
      if (!page.endnotes.length) {
        page.endnotesTop = y - page.top;
        y += NOTE_SEP_H;
      }
      page.endnotes.push(r);
      y += h;
    }

    const last = pages[pages.length - 1];
    const canvasH = last.top + last.height + spacing.padY;
    const rootPad = y0;
    newGaps.sort((a, b) => a.pos - b.pos);
    if (!gapsEqual(newGaps, st.gaps) || !placementsEqual(placements, st.placements) || Math.abs(rootPad - st.rootPad) > 0.25) {
      view.dispatch(view.state.tr.setMeta(layoutKey, { gaps: newGaps, placements, rootPad }).setMeta('addToHistory', false));
    }
    return { mode: 'print', pages, sections, canvasW: metrics.canvasW, canvasH, rootLeft: metrics.rootLeft, rootW: metrics.rootW, rules };
  }

  private splitTable(
    table: PMNode,
    pos: number,
    natY: (cy: number) => number,
    oldShift: number,
    innerOldGaps: Gap[],
    ctx: {
      y0: number;
      getShift: () => number;
      addShift: (h: number) => void;
      /** Bottom of the space for body text on the current page. */
      limit: () => number;
      notesIn: (from: number, to: number) => NoteRef[];
      notesH: (list: NoteRef[]) => number;
      addNotes: (list: NoteRef[]) => void;
      pageHasContent: () => boolean;
      /** Break before the table; true means the caller rewound for keep-with-next. */
      breakBefore: () => boolean;
      nextPage: (startPos: number, visTop: number) => number;
      push: (g: Gap) => void;
    },
  ): boolean {
    const { view } = this.host;
    const rows: { pos: number; end: number; top: number; bottom: number }[] = [];
    let cols = 1;
    table.forEach((row, offset) => {
      const rowPos = pos + 1 + offset;
      const rowEl = view.nodeDOM(rowPos) as HTMLElement | null;
      if (!rowEl) return;
      let span = 0;
      row.forEach((c) => { span += c.attrs.colspan; });
      cols = Math.max(cols, span);
      const r = rowEl.getBoundingClientRect();
      const before = innerOldGaps.filter((g) => g.pos <= rowPos).reduce((s, g) => s + g.height, 0);
      rows.push({ pos: rowPos, end: rowPos + row.nodeSize, top: natY(r.top) - oldShift - before, bottom: natY(r.bottom) - oldShift - before });
    });
    if (!rows.length) return false;
    let firstOnPage = 0;
    for (let j = 0; j < rows.length; j++) {
      const vb = ctx.y0 + rows[j].bottom + ctx.getShift();
      const rowNotes = ctx.notesIn(rows[j].pos, rows[j].end);
      if (vb <= ctx.limit() - ctx.notesH(rowNotes) + EPS) {
        ctx.addNotes(rowNotes);
        continue;
      }
      if (j === firstOnPage) {
        if (j === 0 && ctx.pageHasContent()) {
          if (ctx.breakBefore()) return true;
          j = -1;
          firstOnPage = 0;
          continue;
        }
        ctx.addNotes(rowNotes);
        continue; // A row taller than the page overflows.
      }
      const visTop = ctx.y0 + rows[j].top + ctx.getShift();
      const h = ctx.nextPage(rows[j].pos, visTop);
      ctx.push({ pos: rows[j].pos, height: h, kind: 'row', cols });
      ctx.addShift(h);
      firstOnPage = j;
      j--;
    }
    return false;
  }
}
