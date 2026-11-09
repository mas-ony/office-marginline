import type { Node as PMNode } from 'prosemirror-model';
import { NodeSelection } from 'prosemirror-state';
import type { EditorView, NodeView, ViewMutationRecord } from 'prosemirror-view';
import type { DocxDocument } from '../core/document';
import { emuToPx, pxToEmu, twipsToPt } from '../core/ooxml/units';

const DEFAULT_TAB_PX = 48;

/** A tab character; its width is set by the layout engine from the paragraph's tab stops. */
export class TabView implements NodeView {
  dom: HTMLElement;
  constructor() {
    this.dom = document.createElement('span');
    this.dom.className = 'ml-dx-tab';
    this.dom.style.width = `${DEFAULT_TAB_PX}px`;
  }
  update(node: PMNode) {
    return node.type.name === 'tab';
  }
  ignoreMutation() {
    return true;
  }
}

/** Text of a page field at a body position, once the pages are laid out. */
export type PageFieldLookup = (pos: number, kind: string) => string | undefined;

/**
 * PAGE / NUMPAGES fields; header editors set data-page-number / data-num-pages on their root,
 * fields in the body ask the layout for the page they are on.
 */
export class PageFieldView implements NodeView {
  dom: HTMLElement;
  constructor(private node: PMNode, private view: EditorView, private getPos?: () => number | undefined, private lookup?: PageFieldLookup) {
    this.dom = document.createElement('span');
    this.dom.className = 'ml-dx-page-field';
    this.dom.contentEditable = 'false';
    this.dom.dataset.kind = node.attrs.kind;
    this.render();
  }
  render() {
    const root = this.view.dom as HTMLElement;
    const kind = this.node.attrs.kind;
    let v = kind === 'NUMPAGES' ? root.dataset.numPages : kind === 'SECTIONPAGES' ? root.dataset.sectionPages : root.dataset.pageNumber;
    if (v === undefined && this.lookup) {
      const pos = this.getPos?.();
      if (pos !== undefined) v = this.lookup(pos, kind);
    }
    this.dom.textContent = v ?? '#';
  }
  update(node: PMNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }
  ignoreMutation() {
    return true;
  }
}

/** Inline picture with resize handles (mouse, pen and touch). */
export class ImageView implements NodeView {
  dom: HTMLElement;
  private img: HTMLImageElement;
  private handles: HTMLElement[] = [];
  private dragging = false;

  constructor(private node: PMNode, private view: EditorView, private getPos: () => number | undefined, private docx: () => DocxDocument) {
    this.dom = document.createElement('span');
    this.dom.className = 'ml-dx-image-wrap';
    this.img = document.createElement('img');
    this.img.className = 'ml-dx-image';
    this.img.draggable = false;
    this.dom.appendChild(this.img);
    for (const corner of ['nw', 'ne', 'sw', 'se']) {
      const h = document.createElement('span');
      h.className = `ml-dx-image-handle ml-dx-handle-${corner}`;
      h.dataset.corner = corner;
      h.addEventListener('pointerdown', (e) => this.startResize(e, corner));
      this.handles.push(h);
      this.dom.appendChild(h);
    }
    this.render();
  }

  private render() {
    const a = this.node.attrs;
    const src = a.src || this.docx().mediaUrl(a.mediaPath);
    if (this.img.getAttribute('src') !== src) this.img.src = src;
    this.img.alt = a.alt || '';
    this.img.title = a.title || '';
    this.img.style.width = `${emuToPx(a.width)}px`;
    this.img.style.height = `${emuToPx(a.height)}px`;
    const anchor = a.anchor as null | { wrap: string; behindDoc: boolean; hAlign?: string; hOffset?: number; hRelative?: string; vOffset?: number; distL: number; distR: number; distT: number; distB: number };
    this.dom.classList.toggle('ml-dx-float', !!anchor);
    this.dom.style.cssText = '';
    if (anchor) {
      const pt = (emu: number) => `${(emu / 12700).toFixed(1)}pt`;
      if (anchor.wrap === 'topAndBottom') {
        this.dom.style.display = 'block';
        this.dom.style.margin = `${pt(anchor.distT)} auto ${pt(anchor.distB)}`;
        if (anchor.hAlign === 'left') this.dom.style.marginLeft = '0';
        if (anchor.hAlign === 'right') this.dom.style.marginRight = '0';
      } else if (anchor.wrap === 'none') {
        this.dom.style.position = 'absolute';
        this.dom.style.zIndex = anchor.behindDoc ? '0' : '2';
        this.dom.style.left = anchor.hOffset !== undefined ? `${emuToPx(anchor.hOffset)}px` : anchor.hAlign === 'right' ? 'auto' : '0';
        if (anchor.hAlign === 'right') this.dom.style.right = '0';
        if (anchor.hAlign === 'center') this.dom.style.left = `calc(50% - ${emuToPx(this.node.attrs.width) / 2}px)`;
        this.dom.style.top = anchor.vOffset !== undefined ? `${emuToPx(anchor.vOffset)}px` : '0';
        if (anchor.behindDoc) this.dom.style.opacity = '0.85';
      } else {
        const right = anchor.hAlign === 'right' || (anchor.hOffset !== undefined && anchor.hOffset > 2_743_200);
        this.dom.style.float = right ? 'right' : 'left';
        // Paragraphs are positioned too, so those after the picture's own would be drawn over it:
        // their boxes reach under it while their text wraps around it, and would take its clicks.
        this.dom.style.zIndex = '1';
        // The picture sits on the margin; its distances only keep the text away.
        const distL = anchor.distL ?? 114300;
        const distR = anchor.distR ?? 114300;
        this.dom.style.margin = `${pt(anchor.distT)} ${right ? '0' : pt(distR)} ${pt(anchor.distB)} ${right ? pt(distL) : '0'}`;
      }
    }
  }

  update(node: PMNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    if (!this.dragging) this.render();
    return true;
  }

  selectNode() {
    this.dom.classList.add('ProseMirror-selectednode');
  }

  deselectNode() {
    this.dom.classList.remove('ProseMirror-selectednode');
  }

  stopEvent(e: Event) {
    return this.handles.includes(e.target as HTMLElement);
  }

  ignoreMutation() {
    return true;
  }

  private zoom(): number {
    const canvas = this.view.dom.closest('.ml-dx-canvas') as HTMLElement | null;
    const m = canvas?.style.transform.match(/scale\(([\d.]+)\)/);
    return m ? parseFloat(m[1]) : 1;
  }

  private startResize(e: PointerEvent, corner: string) {
    if (!this.view.editable) return;
    e.preventDefault();
    e.stopPropagation();
    const pos = this.getPos();
    if (pos === undefined) return;
    this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos)));
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    this.dragging = true;
    const startX = e.clientX;
    const startY = e.clientY;
    const w0 = emuToPx(this.node.attrs.width);
    const h0 = emuToPx(this.node.attrs.height);
    const ratio = h0 / w0;
    const zoom = this.zoom();
    const maxW = (this.view.dom as HTMLElement).clientWidth || 2000;
    let w = w0;
    let h = h0;
    const move = (ev: PointerEvent) => {
      const dx = ((ev.clientX - startX) / zoom) * (corner.includes('w') ? -1 : 1);
      const dy = ((ev.clientY - startY) / zoom) * (corner.includes('n') ? -1 : 1);
      w = Math.max(16, Math.min(maxW, w0 + dx));
      h = ev.shiftKey ? Math.max(16, h0 + dy) : w * ratio;
      this.img.style.width = `${w}px`;
      this.img.style.height = `${h}px`;
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      this.dragging = false;
      const p = this.getPos();
      if (p === undefined) return;
      const tr = this.view.state.tr.setNodeMarkup(p, undefined, { ...this.node.attrs, width: pxToEmu(w), height: pxToEmu(h) });
      this.view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, p)));
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }
}

/** Table rendering with explicit column widths (compatible with prosemirror-tables resizing). */
export class TableView implements NodeView {
  dom: HTMLDivElement;
  table: HTMLTableElement;
  colgroup: HTMLTableColElement;
  contentDOM: HTMLTableSectionElement;

  constructor(public node: PMNode, private cellMinWidth: number) {
    this.dom = document.createElement('div');
    this.dom.className = 'ml-dx-table-wrap';
    this.table = this.dom.appendChild(document.createElement('table'));
    this.colgroup = this.table.appendChild(document.createElement('colgroup'));
    this.contentDOM = this.table.appendChild(document.createElement('tbody'));
    this.updateColumns();
  }

  private updateColumns() {
    const node = this.node;
    this.table.className = `ml-dx-table${node.attrs.styleId ? ` ts-${node.attrs.styleId}` : ''}`;
    const widths: (number | null)[] = [];
    const row = node.firstChild;
    row?.forEach((cell) => {
      const span = cell.attrs.colspan as number;
      const cw = cell.attrs.colwidth as number[] | null;
      for (let i = 0; i < span; i++) widths.push(cw && cw[i] ? cw[i] : null);
    });
    const known = widths.every((w) => w !== null);
    const total = widths.reduce<number>((s, w) => s + (w ?? this.cellMinWidth), 0);
    const pct = node.attrs.width?.type === 'pct';
    while (this.colgroup.children.length > widths.length) this.colgroup.lastChild!.remove();
    widths.forEach((w, i) => {
      let col = this.colgroup.children[i] as HTMLTableColElement | undefined;
      if (!col) col = this.colgroup.appendChild(document.createElement('col'));
      if (w === null) col.style.width = '';
      else col.style.width = pct ? `${((w / total) * 100).toFixed(3)}%` : `${w}px`;
    });
    if (known && !pct) {
      this.table.style.width = `${total}px`;
      this.table.style.tableLayout = 'fixed';
    } else if (pct) {
      this.table.style.width = '100%';
      this.table.style.tableLayout = known ? 'fixed' : 'auto';
    } else {
      this.table.style.width = '';
      this.table.style.tableLayout = 'auto';
    }
    if (node.attrs.indent) this.dom.style.setProperty('--ml-dx-tbl-indent', `${twipsToPt(node.attrs.indent)}pt`);
  }

  update(node: PMNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.updateColumns();
    return true;
  }

  ignoreMutation(record: ViewMutationRecord) {
    return record.type === 'attributes' && (record.target === this.table || this.colgroup.contains(record.target));
  }
}
