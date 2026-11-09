import type { Node as PMNode } from 'prosemirror-model';
import { EditorState, type Plugin, type Transaction } from 'prosemirror-state';
import { EditorView, type NodeViewConstructor } from 'prosemirror-view';
import type { DocxDocument, HeaderFooterPart } from '../core/document';
import { schema } from '../core/model/schema';
import type { HeaderFooterType } from '../core/model/types';
import { layoutTabs } from './layout/layout';
import type { PageInfo, SectionGeom } from './layout/geometry';
import type { ColumnRule } from './layout/layout';
import type { NotesManager } from './notes';
import { numberingPlugin } from './plugins/numbering';
import { decorPlugin } from './plugins/decor';
import { tableStylePlugin } from './plugins/tableStyle';

export type HFKind = 'header' | 'footer';

export interface HFHost {
  docx(): DocxDocument;
  zoom(): number;
  nodeViews(getDocx: () => DocxDocument): Record<string, NodeViewConstructor>;
  editingPlugins(): Plugin[];
  onHeaderFooterChanged(path: string): void;
  onActiveChanged(): void;
  onActiveTransaction(view: EditorView, tr: Transaction): void;
}

export interface ActiveHF {
  path: string;
  kind: HFKind;
  pageIndex: number;
  view: EditorView;
  area: HTMLElement;
}

interface Proto {
  view: EditorView;
  host: HTMLElement;
  version: number;
  width: number;
  height: number;
  tabCache: WeakMap<PMNode, string>;
}

export function hfLabel(kind: HFKind, type: HeaderFooterType, evenAndOdd: boolean, section: number, sectionCount: number): string {
  const base = kind === 'header' ? 'Header' : 'Footer';
  let label = type === 'first' ? `First Page ${base}` : type === 'even' ? `Even Page ${base}` : evenAndOdd ? `Odd Page ${base}` : base;
  if (sectionCount > 1) label += ` - Section ${section + 1}`;
  return label;
}

/** Renders header/footer parts on every page and hosts the in-place editor for one of them. */
export class HeaderFooterManager {
  private protos = new Map<string, Proto>();
  private versions = new Map<string, number>();
  active: ActiveHF | null = null;

  constructor(private host: HFHost, private measureHost: HTMLElement) {}

  version(path: string): number {
    return this.versions.get(path) ?? 0;
  }

  bump(path: string) {
    this.versions.set(path, this.version(path) + 1);
  }

  /** Re-measure every part (e.g. after web fonts finished loading). */
  invalidate() {
    for (const path of this.protos.keys()) this.bump(path);
  }

  reset() {
    this.deactivate(false);
    for (const p of this.protos.values()) {
      p.view.destroy();
      p.host.remove();
    }
    this.protos.clear();
    this.versions.clear();
  }

  part(path: string): HeaderFooterPart | undefined {
    return this.host.docx().headerFooters.get(path);
  }

  private stateFor(doc: PMNode): EditorState {
    const get = () => this.host.docx();
    return EditorState.create({ doc, plugins: [numberingPlugin(get), decorPlugin(get), tableStylePlugin(get)] });
  }

  private proto(path: string, width: number): Proto | null {
    const part = this.part(path);
    if (!part) return null;
    const version = this.version(path);
    let p = this.protos.get(path);
    if (p && p.version === version && Math.abs(p.width - width) < 0.5) return p;
    if (!p) {
      const host = document.createElement('div');
      host.className = 'ml-dx-hf-proto';
      this.measureHost.appendChild(host);
      const view = new EditorView(host, {
        state: this.stateFor(part.doc),
        editable: () => false,
        nodeViews: this.host.nodeViews(() => this.host.docx()),
        attributes: { class: 'ml-dx-doc ml-dx-hf-doc' },
      });
      p = { view, host, version: -1, width: 0, height: 0, tabCache: new WeakMap() };
      this.protos.set(path, p);
    } else if (p.version !== version) {
      p.view.updateState(this.stateFor(part.doc));
    }
    p.host.style.width = `${width}px`;
    layoutTabs(p.view, this.host.docx(), this.host.zoom() || 1, p.tabCache);
    p.height = (p.view.dom as HTMLElement).offsetHeight;
    p.version = version;
    p.width = width;
    return p;
  }

  height(path: string, width: number): number {
    return this.proto(path, width)?.height ?? 0;
  }

  /** Fill a page's header/footer area with a static copy of the part. */
  renderStatic(area: HTMLElement, path: string | null, page: PageInfo, width: number, numPages: number, sectionPages: number) {
    if (!path) {
      if (area.dataset.key) area.replaceChildren();
      area.dataset.key = '';
      return;
    }
    const key = `${path}@${this.version(path)}@${width}@${page.numberText}@${numPages}@${sectionPages}`;
    if (area.dataset.key === key) return;
    const proto = this.proto(path, width);
    if (!proto) return;
    const clone = proto.view.dom.cloneNode(true) as HTMLElement;
    clone.removeAttribute('contenteditable');
    clone.classList.add('ml-dx-hf-static');
    clone.querySelectorAll<HTMLElement>('.ml-dx-page-field').forEach((f) => {
      const kind = f.dataset.kind;
      f.textContent = kind === 'NUMPAGES' ? String(numPages) : kind === 'SECTIONPAGES' ? String(sectionPages) : page.numberText;
    });
    area.replaceChildren(clone);
    area.dataset.key = key;
  }

  /** Create an empty header/footer part and return its path (the caller links it to a section). */
  createPart(kind: HFKind): string {
    const docx = this.host.docx();
    const styleId = kind === 'header' ? 'Header' : 'Footer';
    docx.styles.ensureStyle(styleId);
    const path = docx.newHeaderFooterPath(kind);
    docx.headerFooters.set(path, {
      path,
      kind,
      doc: schema.nodes.doc.create(null, [schema.nodes.paragraph.create({ styleId })]),
      rootAttrs: {},
      extraNamespaces: {},
    });
    return path;
  }

  activate(path: string, kind: HFKind, page: PageInfo, area: HTMLElement, numPages: number, sectionPages: number, label: string) {
    this.deactivate(false);
    const part = this.part(path);
    if (!part) return;
    area.replaceChildren();
    area.dataset.key = '';
    const mount = document.createElement('div');
    area.appendChild(mount);
    const view: EditorView = new EditorView(mount, {
      state: EditorState.create({ doc: part.doc, plugins: this.host.editingPlugins() }),
      nodeViews: this.host.nodeViews(() => this.host.docx()),
      attributes: { class: 'ml-dx-doc ml-dx-hf-doc ml-dx-hf-live' },
      dispatchTransaction: (tr) => this.host.onActiveTransaction(view, tr),
    });
    const dom = view.dom as HTMLElement;
    dom.dataset.pageNumber = page.numberText;
    dom.dataset.numPages = String(numPages);
    dom.dataset.sectionPages = String(sectionPages);
    area.classList.add('ml-dx-hf-active');
    area.dataset.label = label;
    this.active = { path, kind, pageIndex: page.index, view, area };
    layoutTabs(view, this.host.docx(), this.host.zoom() || 1, new WeakMap());
    view.focus();
    this.host.onActiveChanged();
  }

  /** Apply a transaction of the active editor and propagate content changes. */
  applyActive(tr: Transaction) {
    const a = this.active;
    if (!a) return;
    a.view.updateState(a.view.state.apply(tr));
    if (tr.docChanged) {
      const part = this.part(a.path);
      if (part) part.doc = a.view.state.doc;
      this.bump(a.path);
      layoutTabs(a.view, this.host.docx(), this.host.zoom() || 1, new WeakMap());
      this.host.onHeaderFooterChanged(a.path);
    }
  }

  deactivate(notify = true) {
    const a = this.active;
    if (!a) return;
    const part = this.part(a.path);
    if (part) part.doc = a.view.state.doc;
    a.view.destroy();
    a.area.classList.remove('ml-dx-hf-active');
    a.area.replaceChildren();
    a.area.dataset.key = '';
    this.active = null;
    this.bump(a.path);
    if (notify) this.host.onActiveChanged();
  }

  /** Current documents of all parts (for export). */
  docs(): Map<string, PMNode> {
    const out = new Map<string, PMNode>();
    for (const [path, part] of this.host.docx().headerFooters) out.set(path, part.doc);
    if (this.active) out.set(this.active.path, this.active.view.state.doc);
    return out;
  }
}

/** Page sheets with header and footer areas. */
export class PagesRenderer {
  private els: HTMLElement[] = [];

  constructor(private layer: HTMLElement, private hf: HeaderFooterManager, private notes: NotesManager) {}

  areaFor(index: number, kind: HFKind): HTMLElement | null {
    return this.els[index]?.querySelector<HTMLElement>(kind === 'header' ? '.ml-dx-header' : '.ml-dx-footer') ?? null;
  }

  clear() {
    for (const el of this.els) el.remove();
    this.els = [];
  }

  render(pages: PageInfo[], sections: SectionGeom[], rules: ColumnRule[] = []) {
    const numPages = pages.length;
    const perSection = new Map<number, number>();
    for (const p of pages) perSection.set(p.section, (perSection.get(p.section) ?? 0) + 1);
    pages.forEach((p, i) => {
      let el = this.els[i];
      if (!el) {
        el = document.createElement('div');
        el.className = 'ml-dx-page';
        el.innerHTML = '<div class="ml-dx-hf ml-dx-header"></div><div class="ml-dx-hf ml-dx-footer"></div>';
        this.layer.appendChild(el);
        this.els[i] = el;
      }
      el.style.cssText = `top:${p.top}px;left:${p.left}px;width:${p.width}px;height:${p.height}px`;
      el.dataset.page = p.numberText;
      el.classList.toggle('ml-dx-page-blank', p.blank);
      const sg = sections[p.section];
      const header = el.querySelector<HTMLElement>(':scope > .ml-dx-header')!;
      const footer = el.querySelector<HTMLElement>(':scope > .ml-dx-footer')!;
      header.style.cssText = `top:${sg.headerDist}px;left:${sg.contentX}px;width:${sg.contentW}px`;
      footer.style.cssText = `bottom:${sg.footerDist}px;left:${sg.contentX}px;width:${sg.contentW}px`;
      const active = this.hf.active;
      const sectionPages = perSection.get(p.section) ?? 1;
      if (!(active && active.pageIndex === i && active.kind === 'header')) this.hf.renderStatic(header, p.header, p, sg.contentW, numPages, sectionPages);
      if (!(active && active.pageIndex === i && active.kind === 'footer')) this.hf.renderStatic(footer, p.footer, p, sg.contentW, numPages, sectionPages);
      this.renderNotes(el, 'ml-dx-footnotes', p.notes, p.bodyBottom - p.notesH - p.top, sg);
      this.renderNotes(el, 'ml-dx-endnotes', p.endnotes, p.endnotesTop, sg);
      el.querySelectorAll('.ml-dx-col-rule').forEach((r) => r.remove());
      for (const rule of rules) {
        if (rule.page !== i) continue;
        for (const x of rule.x) {
          const line = document.createElement('div');
          line.className = 'ml-dx-col-rule';
          line.style.cssText = `left:${x}px;top:${rule.top}px;height:${Math.max(0, rule.bottom - rule.top)}px`;
          el.appendChild(line);
        }
      }
    });
    for (let i = pages.length; i < this.els.length; i++) this.els[i].remove();
    this.els.length = Math.min(this.els.length, pages.length);
  }

  /** A page's footnote or endnote area: separator line followed by the notes. */
  private renderNotes(el: HTMLElement, cls: string, refs: PageInfo['notes'], top: number, sg: SectionGeom) {
    let area = el.querySelector<HTMLElement>(`:scope > .${cls}`);
    if (!refs.length) {
      area?.remove();
      return;
    }
    if (!area) {
      area = document.createElement('div');
      area.className = `ml-dx-notes ${cls}`;
      area.innerHTML = '<div class="ml-dx-note-sep" aria-hidden="true"></div><div class="ml-dx-note-list"></div>';
      el.appendChild(area);
    }
    area.style.cssText = `top:${top}px;left:${sg.contentX}px;width:${sg.contentW}px`;
    this.notes.render(area.lastElementChild as HTMLElement, refs, sg.contentW);
  }
}
