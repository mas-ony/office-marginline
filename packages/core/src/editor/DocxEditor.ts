import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { history, isHistoryTransaction, redo, redoDepth, undo, undoDepth } from 'prosemirror-history';
import type { Node as PMNode } from 'prosemirror-model';
import { EditorState, TextSelection, type Plugin, type Transaction } from 'prosemirror-state';
import { columnResizing, fixTables, tableEditing } from 'prosemirror-tables';
import { EditorView, type NodeViewConstructor } from 'prosemirror-view';
import { collab, getVersion, receiveTransaction, sendableSteps } from 'prosemirror-collab';
import { Step } from 'prosemirror-transform';
import { NumberingModel } from '../core/model/numbering';
import { StyleSheet } from '../core/model/styles';
import { createBlankDocx, localePageSize, type BlankOptions } from '../core/blank';
import type { DocxDocument } from '../core/document';
import { exportDocx } from '../core/export/exporter';
import { importDocx } from '../core/import/importer';
import { runFontName } from '../core/model/css';
import { schema } from '../core/model/schema';
import type { CommentThread, HeaderFooterType, SectionProps } from '../core/model/types';
import { twipsToPx } from '../core/ooxml/units';
import { clipboardPlugin } from './clipboard';
import {
  addComment,
  allSections,
  changeIndent,
  clearFormatting,
  insertImage,
  insertPageBreak,
  nextCommentId,
  removeCommentMarks,
  setAlignment,
  setFontSize,
  setParagraphStyle,
  setSectionProps,
  setVertAlign,
  toggleList,
  toggleStyle,
} from './commands';
import { computeCursorProps, type CursorProps } from './cursorProps';
import { HeaderFooterManager, hfLabel, PagesRenderer, type HFKind } from './headerFooter';
import { noteRefs } from './noteRefs';
import { NotesManager } from './notes';
import { buildKeymap, type KeyAction } from './keymap';
import { CANVAS_PAD_X, CANVAS_PAD_Y, PAGE_GAP, type PageInfo } from './layout/geometry';
import { LayoutEngine, layoutKey, layoutPlugin, setViewMode as setLayoutMode, type LayoutResult, type ViewMode } from './layout/layout';
import { NO_TRACK, REFRESH, REMOTE } from './meta';
import { ImageView, PageFieldView, TabView, TableView } from './nodeviews';
import { commentRanges, commentsKey, commentsPlugin } from './plugins/comments';
import { decorPlugin } from './plugins/decor';
import { presenceKey, presencePlugin, type RemoteCursor } from './plugins/presence';
import { numberingPlugin } from './plugins/numbering';
import { gotoMatch, replaceAll, replaceCurrent, searchKey, searchPlugin, setSearch, type SearchOptions } from './plugins/search';
import { tableStylePlugin } from './plugins/tableStyle';
import { applyDecision, listChanges, trackTransaction, type TrackedChange } from './plugins/trackChanges';
import { buildDocumentCss } from './styleCss';
import { createBookmark, insertCrossReference, listBookmarks, listHeadings, type BookmarkInfo, type HeadingInfo } from './bookmarks';
import { fieldsKey, fieldsPlugin, focusField, insertField, listFields, removeField, renameField, setFieldValue, type FieldInfo } from './fields';
import { applyFormat, copyFormat, type CopiedFormat } from './formatPainter';
import { insertNote, noteText, setNoteText, type NoteKind } from './noteEdit';
import { canRunTableAction, runTableAction, setCellBackground, type TableAction } from './tableActions';

export type EditMode = 'editing' | 'suggesting' | 'viewing';
/** How tracked changes look while viewing: before the changes, marked up, or after them. */
export type TrackedChangesView = 'original' | 'markup' | 'final';
export interface ViewingOptions {
  trackedChanges: TrackedChangesView;
  comments: boolean;
}
export type Stream = 'body' | 'header' | 'footer';

export interface EditorEventMap {
  load: { fileName: string; warnings: string[] };
  change: { dirty: boolean };
  /** The file name changed (not by opening a document, which is `load`). */
  rename: { fileName: string };
  selection: CursorProps;
  layout: { pages: PageInfo[] };
  page: { index: number; count: number; label: string };
  zoom: { zoom: number };
  editMode: { mode: EditMode };
  viewing: ViewingOptions;
  viewMode: { mode: ViewMode };
  stream: { stream: Stream; label?: string; pageIndex?: number };
  comments: Record<string, never>;
  trackedChanges: Record<string, never>;
  search: { query: string; count: number; index: number };
  /** `rect`: where the button that asked is on screen (the header bar's Options), to place its menu. */
  request: { action: KeyAction | 'headerFooterOptions' | 'editNote'; pageIndex?: number; key?: string; rect?: { left: number; top: number; right: number; bottom: number } };
  fields: Record<string, never>;
  formatPainter: { active: boolean };
  error: { message: string };
}

type Listener<K extends keyof EditorEventMap> = (e: EditorEventMap[K]) => void;

export interface DocxEditorOptions {
  author?: string;
  viewMode?: ViewMode;
  editMode?: EditMode;
  zoom?: number;
}

export interface AnchoredComment extends CommentThread {
  from: number;
  quote: string;
}

const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 30, 36, 48, 60, 72];
let instances = 0;

function isoNow(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, 'Z');
}

function toBytes(src: ArrayBuffer | Uint8Array): Uint8Array {
  return src instanceof Uint8Array ? src : new Uint8Array(src);
}

/**
 * A DOCX editor bound to a container element. Framework independent; the React UI and the
 * public OfficeEditor-style API are layered on top of it.
 */
export class DocxEditor {
  readonly root: HTMLElement;
  readonly scrollEl: HTMLElement;
  private sizer: HTMLElement;
  private canvas: HTMLElement;
  private pagesLayer: HTMLElement;
  private bodyHost: HTMLElement;
  private styleEl: HTMLStyleElement;
  private scope: string;
  docx!: DocxDocument;
  view!: EditorView;
  author: string;
  dirty = false;
  private engine: LayoutEngine;
  private hf: HeaderFooterManager;
  private notes: NotesManager;
  private webNotes: HTMLElement | null = null;
  private pages: PagesRenderer;
  private listeners = new Map<keyof EditorEventMap, Set<Listener<never>>>();
  private _zoom: number;
  private _editMode: EditMode;
  private _viewing: ViewingOptions = { trackedChanges: 'final', comments: true };
  private _viewMode: ViewMode;
  private _showMarks = false;
  private layoutPending = false;
  private selectionPending = false;
  private changeTimer: ReturnType<typeof setTimeout> | null = null;
  private stylesVersion = -1;
  private printing = false;
  private destroyed = false;
  private resizeObserver: ResizeObserver | null = null;
  private fitMode: 'width' | 'page' | null = null;
  result: LayoutResult | null = null;
  currentPage = 0;

  constructor(container: HTMLElement, opts: DocxEditorOptions = {}) {
    this.scope = `ml-dx-scope-${++instances}`;
    this.author = opts.author ?? 'Guest';
    this._zoom = opts.zoom ?? 1;
    this._editMode = opts.editMode ?? 'editing';
    this._viewMode = opts.viewMode ?? 'print';
    this.root = document.createElement('div');
    this.root.className = `ml-dx-root ${this.scope}`;
    this.styleEl = document.createElement('style');
    this.root.appendChild(this.styleEl);
    this.scrollEl = this.root.appendChild(document.createElement('div'));
    this.scrollEl.className = 'ml-dx-scroll';
    this.sizer = this.scrollEl.appendChild(document.createElement('div'));
    this.sizer.className = 'ml-dx-sizer';
    this.canvas = this.sizer.appendChild(document.createElement('div'));
    this.canvas.className = 'ml-dx-canvas';
    this.pagesLayer = this.canvas.appendChild(document.createElement('div'));
    this.pagesLayer.className = 'ml-dx-pages';
    this.bodyHost = this.canvas.appendChild(document.createElement('div'));
    this.bodyHost.className = 'ml-dx-body-host';
    const measure = this.canvas.appendChild(document.createElement('div'));
    measure.className = 'ml-dx-hf-measure';
    container.appendChild(this.root);

    this.hf = new HeaderFooterManager({
      docx: () => this.docx,
      zoom: () => (this._viewMode === 'print' ? this._zoom : 1),
      nodeViews: (get) => this.nodeViews(get),
      editingPlugins: () => this.editingPlugins(false),
      onHeaderFooterChanged: () => {
        this.markDirty();
        this.scheduleLayout();
      },
      onActiveChanged: () => this.scheduleSelection(),
      onActiveTransaction: (view, tr) => this.dispatchHeaderFooter(view, tr),
    }, measure);
    this.notes = new NotesManager({
      docx: () => this.docx,
      zoom: () => (this._viewMode === 'print' ? this._zoom : 1),
      nodeViews: (get) => this.nodeViews(get),
    }, measure);
    this.pages = new PagesRenderer(this.pagesLayer, this.hf, this.notes);
    const editor = this;
    this.engine = new LayoutEngine({
      get view() { return editor.view; },
      get docx() { return editor.docx; },
      get zoom() { return editor._viewMode === 'print' ? editor._zoom : 1; },
      hfHeight: (path, width) => this.hf.height(path, width),
      noteHeight: (key, label, width) => this.notes.height(key, label, width),
      spacing: () => (this.printing ? { gap: 0, padX: 0, padY: 0 } : { gap: PAGE_GAP, padX: CANVAS_PAD_X, padY: CANVAS_PAD_Y }),
    });

    this.scrollEl.addEventListener('scroll', () => this.onScroll(), { passive: true });
    this.scrollEl.addEventListener('dblclick', (e) => this.onDoubleClick(e));
    this.canvas.addEventListener('mousedown', (e) => this.onCanvasMouseDown(e));
    this.root.addEventListener('click', (e) => this.onLinkClick(e));
    if (typeof document !== 'undefined' && document.fonts) {
      document.fonts.addEventListener('loadingdone', () => {
        this.engine.resetCaches();
        this.hf.invalidate();
        this.notes.invalidate();
        this.scheduleLayout();
      });
    }
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.fitMode) this.applyFit(this.fitMode);
        if (this._viewMode === 'web') this.scheduleLayout();
      });
      this.resizeObserver.observe(this.scrollEl);
    }
    this.applyModeClasses();
    this.newDocument();
  }

  // -------------------------------------------------------------------------------------------
  // Events

  on<K extends keyof EditorEventMap>(event: K, fn: Listener<K>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn as Listener<never>);
    return () => set!.delete(fn as Listener<never>);
  }

  private emit<K extends keyof EditorEventMap>(event: K, payload: EditorEventMap[K]) {
    for (const fn of this.listeners.get(event) ?? []) {
      try {
        (fn as Listener<K>)(payload);
      } catch (e) {
        console.error(e);
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // Documents

  get fileName(): string {
    return this.docx?.fileName ?? 'Document.docx';
  }

  set fileName(name: string) {
    const next = name.endsWith('.docx') ? name : `${name}.docx`;
    if (!this.docx || this.docx.fileName === next) return;
    this.docx.fileName = next;
    this.emit('rename', { fileName: next });
  }

  /** Open a .docx from bytes. Throws a readable error for unsupported files. */
  load(source: ArrayBuffer | Uint8Array, fileName = 'Document.docx'): void {
    const docx = importDocx(toBytes(source), {
      fileName,
      urlFactory: (item) => (typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(new Blob([item.bytes as BlobPart], { type: item.contentType })) : ''),
    });
    this.setDocument(docx);
  }

  async loadFile(file: Blob & { name?: string }): Promise<void> {
    this.load(new Uint8Array(await file.arrayBuffer()), file.name ?? 'Document.docx');
  }

  newDocument(opts: BlankOptions = {}): void {
    this.load(createBlankDocx({ pageSize: opts.pageSize ?? localePageSize(), author: this.author, ...opts }), 'Untitled.docx');
  }

  private setDocument(docx: DocxDocument) {
    const old = this.docx;
    this.hf.reset();
    this.notes.reset();
    this.pages.clear();
    this.docx = docx;
    docx.numbering.setStyles(docx.styles);
    this.stylesVersion = -1;
    this.updateStyles();
    let state = EditorState.create({ doc: docx.body, plugins: this.editingPlugins(true) });
    const fix = fixTables(state);
    if (fix) state = state.apply(fix.setMeta('addToHistory', false));
    if (!this.view) {
      this.view = new EditorView(this.bodyHost, {
        state,
        nodeViews: this.nodeViews(() => this.docx),
        dispatchTransaction: (tr) => this.dispatchBody(tr),
        editable: () => !this.readOnly,
        attributes: { class: 'ml-dx-doc', spellcheck: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Document body' },
        handleDOMEvents: {
          focus: () => {
            if (this.hf.active) this.exitHeaderFooter(false);
            return false;
          },
        },
      });
    } else {
      this.view.updateState(state);
    }
    if (old && old !== docx) old.dispose();
    this.dirty = false;
    if (docx.settings.trackRevisions && this._editMode === 'editing') this.setEditMode('suggesting');
    this.scrollEl.scrollTop = 0;
    this.currentPage = 0;
    this.emit('load', { fileName: docx.fileName, warnings: docx.warnings });
    this.emit('change', { dirty: false });
    this.emit('comments', {});
    this.emit('trackedChanges', {});
    this.scheduleLayout();
    this.scheduleSelection();
  }

  /** Serialize the current document; `comments: 'none'` leaves the comments out. */
  exportDocx(opts: { comments?: 'all' | 'none' } = {}): Uint8Array {
    return exportDocx(this.docx, this.view.state.doc, {
      headerFooters: this.hf.docs(),
      trackRevisions: this._editMode === 'suggesting',
      author: this.author,
      comments: opts.comments === 'none' ? new Map() : undefined,
    });
  }

  exportBlob(): Blob {
    return new Blob([this.exportDocx() as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }

  /** Flag the document as having unsaved changes (e.g. after reloading it for sharing). */
  markChanged() {
    this.markDirty();
  }

  markSaved() {
    this.dirty = false;
    this.emit('change', { dirty: false });
  }

  private markDirty() {
    if (!this.dirty) {
      this.dirty = true;
      this.emit('change', { dirty: true });
    }
    if (this.changeTimer) clearTimeout(this.changeTimer);
    this.changeTimer = setTimeout(() => {
      this.changeTimer = null;
      this.emit('change', { dirty: this.dirty });
      this.emit('comments', {});
      this.emit('trackedChanges', {});
      this.emit('fields', {});
    }, 250);
  }

  // -------------------------------------------------------------------------------------------
  // View setup

  nodeViews(getDocx: () => DocxDocument): Record<string, NodeViewConstructor> {
    return {
      image: (node, view, getPos) => new ImageView(node, view, getPos, getDocx),
      tab: () => new TabView(),
      page_field: (node, view, getPos) => new PageFieldView(node, view, getPos, (pos, kind) => (view === this.view ? this.pageFieldText(pos, kind) : undefined)),
      table: (node) => new TableView(node, 24),
    };
  }

  private editingPlugins(body: boolean): Plugin[] {
    const get = () => this.docx;
    const plugins: Plugin[] = [];
    if (body) plugins.push(layoutPlugin(this._viewMode));
    plugins.push(numberingPlugin(get), decorPlugin(get), tableStylePlugin(get));
    if (body) plugins.push(searchPlugin(), commentsPlugin(), fieldsPlugin());
    plugins.push(
      history(),
      ...buildKeymap({ docx: get, run: (a) => this.runAction(a) }),
      clipboardPlugin({ docx: get, insertImages: (files, pos) => void this.insertImages(files, pos) }),
    );
    if (body) plugins.push(columnResizing({ cellMinWidth: 24, View: null }));
    plugins.push(tableEditing(), dropCursor({ color: '#2563eb', width: 2 }), gapCursor());
    return plugins;
  }

  get readOnly(): boolean {
    return this._editMode === 'viewing';
  }

  /** The view receiving edits: the header/footer being edited, or the body. */
  get activeView(): EditorView {
    return this.hf.active?.view ?? this.view;
  }

  get activeStream(): Stream {
    return this.hf.active?.kind ?? 'body';
  }

  private updateStyles() {
    const v = this.docx.styles.version;
    if (v === this.stylesVersion) return;
    this.stylesVersion = v;
    this.styleEl.textContent = buildDocumentCss(this.docx, `.${this.scope}`);
  }

  private dispatchBody(tr: Transaction) {
    if (this.destroyed) return;
    const remote = !!tr.getMeta(REMOTE);
    if (this.readOnly && tr.docChanged && !tr.getMeta(NO_TRACK) && !remote) return;
    let t = tr;
    if (this._editMode === 'suggesting' && tr.docChanged && !tr.getMeta(NO_TRACK) && !remote && !isHistoryTransaction(tr)) {
      t = trackTransaction(tr, this.view.state, { author: this.author, date: isoNow() });
    }
    this.view.updateState(this.view.state.apply(t));
    if (t.docChanged || t.getMeta(REFRESH)) this.updateStyles();
    if (t.docChanged) this.markDirty();
    if (t.docChanged && !remote) this.collabLocal?.();
    const layoutOnly = t.getMeta(layoutKey) && !t.docChanged && !t.getMeta(REFRESH);
    if (!layoutOnly) this.scheduleLayout();
    if (t.getMeta(searchKey) || (t.docChanged && searchKey.getState(this.view.state)?.query)) this.emitSearch();
    this.scheduleSelection();
  }

  private dispatchHeaderFooter(view: EditorView, tr: Transaction) {
    let t = tr;
    if (this.readOnly && tr.docChanged) return;
    if (this._editMode === 'suggesting' && tr.docChanged && !tr.getMeta(NO_TRACK) && !isHistoryTransaction(tr)) {
      t = trackTransaction(tr, view.state, { author: this.author, date: isoNow() });
    }
    this.hf.applyActive(t);
    if (t.docChanged || t.getMeta(REFRESH)) this.updateStyles();
    this.scheduleSelection();
  }

  /** Recompute layout from scratch (fonts loaded, styles changed...). */
  relayout() {
    if (!this.view) return;
    this.view.dispatch(this.view.state.tr.setMeta(REFRESH, true).setMeta('addToHistory', false));
  }

  private scheduleLayout() {
    if (this.layoutPending || this.destroyed) return;
    this.layoutPending = true;
    const run = () => {
      this.layoutPending = false;
      this.runLayout();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 0);
  }

  runLayout() {
    if (!this.view || this.destroyed) return;
    if (this.view.composing) {
      this.scheduleLayout();
      return;
    }
    const r = this.engine.run();
    if (!r) return;
    this.result = r;
    this.applyLayout(r);
    this.refreshBodyPageFields();
    this.emit('layout', { pages: r.pages });
    this.updateCurrentPage(true);
  }

  private applyLayout(r: LayoutResult) {
    if (r.mode === 'print') {
      const z = this.printing ? 1 : this._zoom;
      this.canvas.style.width = `${r.canvasW}px`;
      this.canvas.style.height = `${r.canvasH}px`;
      this.canvas.style.transform = z === 1 ? '' : `scale(${z})`;
      this.sizer.style.width = `${r.canvasW * z}px`;
      this.sizer.style.height = `${r.canvasH * z}px`;
      this.bodyHost.style.left = `${r.rootLeft}px`;
      this.pages.render(r.pages, r.sections, r.rules);
      this.decorateActiveHeaderFooter();
      this.renderWebNotes(false);
    } else {
      this.canvas.style.cssText = '';
      this.sizer.style.cssText = '';
      this.bodyHost.style.left = '';
      this.pages.clear();
      this.renderWebNotes(true);
    }
  }

  /** The web view has no pages, so footnotes and endnotes are listed after the text. */
  private renderWebNotes(show: boolean) {
    const refs = show ? noteRefs(this.view.state.doc).filter((r) => this.docx.notes.has(r.key)) : [];
    if (!refs.length) {
      this.webNotes?.remove();
      this.webNotes = null;
      return;
    }
    if (!this.webNotes) {
      this.webNotes = document.createElement('div');
      this.webNotes.className = 'ml-dx-notes ml-dx-web-notes';
      this.webNotes.innerHTML = '<div class="ml-dx-note-sep" aria-hidden="true"></div><div class="ml-dx-note-list"></div>';
    }
    if (this.webNotes.parentNode !== this.bodyHost) this.bodyHost.appendChild(this.webNotes);
    const ordered = [...refs.filter((r) => r.kind === 'footnote'), ...refs.filter((r) => r.kind === 'endnote')];
    this.notes.render(this.webNotes.lastElementChild as HTMLElement, ordered, 0);
  }

  /** Move the caret to the reference of a footnote or endnote shown on a page. */
  private goToNoteRef(key: string) {
    const ref = noteRefs(this.view.state.doc).find((r) => r.key === key);
    if (!ref) return;
    if (this.hf.active) this.exitHeaderFooter(false);
    const { doc } = this.view.state;
    this.view.dispatch(this.view.state.tr.setSelection(TextSelection.near(doc.resolve(Math.min(ref.pos + 1, doc.content.size)))).scrollIntoView());
    this.view.focus();
  }

  private scheduleSelection() {
    if (this.selectionPending || this.destroyed) return;
    this.selectionPending = true;
    const run = () => {
      this.selectionPending = false;
      if (!this.view || this.destroyed) return;
      const props = computeCursorProps(this.activeView.state, this.docx);
      this.emit('selection', props);
      const ids = props.commentIds;
      const active = commentsKey.getState(this.view.state)?.active ?? null;
      if (this.activeView === this.view && ids.length && !ids.includes(active ?? '')) {
        this.view.dispatch(this.view.state.tr.setMeta(commentsKey, { active: ids[0] }).setMeta('addToHistory', false));
      }
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 0);
  }

  undo(): boolean {
    if (this.readOnly) return false;
    const v = this.activeView;
    return undo(v.state, v.dispatch);
  }

  redo(): boolean {
    if (this.readOnly) return false;
    const v = this.activeView;
    return redo(v.state, v.dispatch);
  }

  get canUndo(): boolean {
    return !this.readOnly && undoDepth(this.activeView.state) > 0;
  }

  get canRedo(): boolean {
    return !this.readOnly && redoDepth(this.activeView.state) > 0;
  }

  cursorProps(): CursorProps {
    return computeCursorProps(this.activeView.state, this.docx);
  }

  focus() {
    this.activeView.focus();
  }

  // -------------------------------------------------------------------------------------------
  // Modes, zoom and pages

  get editMode(): EditMode {
    return this._editMode;
  }

  setEditMode(mode: EditMode) {
    if (mode === this._editMode) return;
    this._editMode = mode;
    if (this.readOnly && this.hf.active) this.exitHeaderFooter(false);
    this.applyModeClasses();
    this.view?.setProps({});
    this.engine.resetCaches();
    this.emit('editMode', { mode });
    this.scheduleLayout();
  }

  get viewingOptions(): ViewingOptions {
    return { ...this._viewing };
  }

  /** How tracked changes and comments appear in viewing mode (read-only, nothing is decided). */
  setViewingOptions(opts: Partial<ViewingOptions>) {
    this._viewing = { ...this._viewing, ...opts };
    this.applyModeClasses();
    this.engine.resetCaches();
    this.emit('viewing', this.viewingOptions);
    this.scheduleLayout();
  }

  get viewMode(): ViewMode {
    return this._viewMode;
  }

  setViewMode(mode: ViewMode) {
    if (mode === this._viewMode) return;
    if (this.hf.active) this.exitHeaderFooter(false);
    this._viewMode = mode;
    this.applyModeClasses();
    setLayoutMode(this.view, mode);
    this.emit('viewMode', { mode });
    this.scheduleLayout();
  }

  get showNonPrinting(): boolean {
    return this._showMarks;
  }

  setShowNonPrinting(on: boolean) {
    this._showMarks = on;
    this.applyModeClasses();
    this.engine.resetCaches();
    this.scheduleLayout();
  }

  private applyModeClasses() {
    const c = this.root.classList;
    for (const m of ['editing', 'suggesting', 'viewing']) c.toggle(`ml-dx-mode-${m}`, this._editMode === m);
    const viewing = this._editMode === 'viewing';
    c.toggle('ml-dx-final', viewing && this._viewing.trackedChanges === 'final');
    c.toggle('ml-dx-original', viewing && this._viewing.trackedChanges === 'original');
    c.toggle('ml-dx-hide-comments', viewing && !this._viewing.comments);
    c.toggle('ml-dx-view-print', this._viewMode === 'print');
    c.toggle('ml-dx-view-web', this._viewMode === 'web');
    c.toggle('ml-dx-show-marks', this._showMarks);
  }

  get zoom(): number {
    return this._zoom;
  }

  setZoom(zoom: number, keepFit = false) {
    if (!keepFit) this.fitMode = null;
    const z = Math.min(4, Math.max(0.25, Math.round(zoom * 100) / 100));
    if (z === this._zoom) return;
    const s = this.scrollEl;
    const cx = (s.scrollLeft + s.clientWidth / 2) / this._zoom;
    const cy = (s.scrollTop + s.clientHeight / 2) / this._zoom;
    this._zoom = z;
    if (this.result) this.applyLayout(this.result);
    s.scrollLeft = cx * z - s.clientWidth / 2;
    s.scrollTop = cy * z - s.clientHeight / 2;
    this.emit('zoom', { zoom: z });
  }

  zoomIn() {
    const steps = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
    this.setZoom(steps.find((s) => s > this._zoom + 0.001) ?? 4);
  }

  zoomOut() {
    const steps = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
    this.setZoom([...steps].reverse().find((s) => s < this._zoom - 0.001) ?? 0.25);
  }

  fitWidth() {
    this.fitMode = 'width';
    this.applyFit('width');
  }

  fitPage() {
    this.fitMode = 'page';
    this.applyFit('page');
  }

  private applyFit(mode: 'width' | 'page') {
    const r = this.result;
    if (!r || r.mode !== 'print') return;
    const w = this.scrollEl.clientWidth;
    const h = this.scrollEl.clientHeight;
    const page = r.pages[this.currentPage] ?? r.pages[0];
    const byWidth = (w - 8) / r.canvasW;
    const z = mode === 'width' ? byWidth : Math.min(byWidth, (h - 16) / (page.height + 2 * CANVAS_PAD_Y));
    this.setZoom(z, true);
  }

  get pageCount(): number {
    return this.result?.pages.length ?? 1;
  }

  goToPage(index: number) {
    const r = this.result;
    if (!r || r.mode !== 'print') return;
    const p = r.pages[Math.max(0, Math.min(r.pages.length - 1, index))];
    this.scrollEl.scrollTo({ top: p.top * this._zoom - 12, behavior: 'smooth' });
    this.currentPage = p.index;
    this.emit('page', { index: p.index, count: r.pages.length, label: p.numberText });
  }

  private onScroll() {
    this.updateCurrentPage(false);
  }

  private updateCurrentPage(force: boolean) {
    const r = this.result;
    if (!r || r.mode !== 'print' || !r.pages.length) return;
    const y = (this.scrollEl.scrollTop + this.scrollEl.clientHeight / 3) / this._zoom;
    let idx = r.pages.findIndex((p) => y < p.top + p.height + PAGE_GAP / 2);
    if (idx < 0) idx = r.pages.length - 1;
    if (idx !== this.currentPage || force) {
      this.currentPage = idx;
      this.emit('page', { index: idx, count: r.pages.length, label: r.pages[idx].numberText });
    }
  }

  /** Page index containing a body position (print layout only). */
  pageOfPos(pos: number): number {
    const r = this.result;
    if (!r || r.mode !== 'print') return 0;
    let idx = 0;
    for (const p of r.pages) if (p.startPos <= pos) idx = p.index;
    return idx;
  }

  /** Text of a PAGE, NUMPAGES or SECTIONPAGES field in the body at `pos`. */
  private pageFieldText(pos: number, kind: string): string | undefined {
    const r = this.result;
    if (!r || r.mode !== 'print' || !r.pages.length) return undefined;
    if (kind === 'NUMPAGES') return String(r.pages.length);
    const page = r.pages[this.pageOfPos(pos)];
    if (kind === 'SECTIONPAGES') return String(r.pages.filter((p) => p.section === page.section).length);
    return page.numberText;
  }

  /** Page fields in the body show the page they landed on after each layout. */
  private refreshBodyPageFields() {
    this.view.dom.querySelectorAll<HTMLElement>('.ml-dx-page-field').forEach((el) => {
      let pos: number;
      try {
        pos = this.view.posAtDOM(el, 0);
      } catch {
        return;
      }
      const text = this.pageFieldText(pos, el.dataset.kind ?? 'PAGE');
      if (text !== undefined && el.textContent !== text) el.textContent = text;
    });
  }

  // -------------------------------------------------------------------------------------------
  // Pointer handling

  private canvasPoint(e: MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / this._zoom, y: (e.clientY - rect.top) / this._zoom };
  }

  private pageAt(x: number, y: number): PageInfo | undefined {
    return this.result?.pages.find((p) => y >= p.top && y < p.top + p.height && x >= p.left && x < p.left + p.width);
  }

  private onDoubleClick(e: MouseEvent) {
    if (this._viewMode !== 'print' || this.readOnly || !this.result) return;
    const { x, y } = this.canvasPoint(e);
    const page = this.pageAt(x, y);
    if (!page) return;
    if (y < page.bodyTop) {
      e.preventDefault();
      this.editHeaderFooter('header', page.index);
    } else if (y > page.bodyBottom) {
      e.preventDefault();
      this.editHeaderFooter('footer', page.index);
    } else if (this.hf.active) {
      this.exitHeaderFooter();
    }
  }

  private onCanvasMouseDown(e: MouseEvent) {
    if (e.button !== 0 || !this.view) return;
    const target = e.target as HTMLElement;
    const note = target.closest<HTMLElement>('.ml-dx-note');
    if (note?.dataset.note) {
      // Notes are edited in a dialog; in viewing mode a click jumps to the reference.
      e.preventDefault();
      if (this.readOnly) this.goToNoteRef(note.dataset.note);
      else this.emit('request', { action: 'editNote', key: note.dataset.note });
      return;
    }
    if (this.view.dom.contains(target) || target.closest('.ml-dx-hf-active') || target.closest('.ml-dx-hf-bar')) return;
    // Clicks in margins or between pages place the caret on the nearest line.
    const rect = this.view.dom.getBoundingClientRect();
    const left = Math.min(Math.max(e.clientX, rect.left + 2), rect.right - 2);
    const hit = this.view.posAtCoords({ left, top: e.clientY });
    if (!hit) return;
    e.preventDefault();
    if (this.hf.active) this.exitHeaderFooter(false);
    this.view.dispatch(this.view.state.tr.setSelection(TextSelection.near(this.view.state.doc.resolve(hit.pos))));
    this.view.focus();
  }

  private onLinkClick(e: MouseEvent) {
    const a = (e.target as HTMLElement).closest?.('a.ml-dx-link') as HTMLAnchorElement | null;
    if (!a) return;
    e.preventDefault();
    if (!(e.ctrlKey || e.metaKey) && !this.readOnly) return;
    const href = a.getAttribute('href') ?? '';
    if (href.startsWith('#bm-')) {
      const target = this.root.querySelector(`[id="${CSS.escape(href.slice(1))}"]`);
      target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } else if (/^(https?:|mailto:)/i.test(href)) {
      window.open(href, '_blank', 'noopener,noreferrer');
    }
  }

  // -------------------------------------------------------------------------------------------
  // Headers and footers

  private sectionPagesCount(section: number): number {
    return this.result?.pages.filter((p) => p.section === section).length ?? 1;
  }

  /** Start editing the header or footer shown on a page (creating one when the page has none). */
  editHeaderFooter(kind: HFKind, pageIndex = this.currentPage) {
    if (this.readOnly) return;
    if (this.collabLocal) {
      this.emit('error', { message: 'Headers and footers cannot be edited while the document is shared.' });
      return;
    }
    if (this._viewMode !== 'print') this.setViewMode('print');
    if (!this.result || this.result.mode !== 'print') this.runLayout();
    const r = this.result;
    if (!r) return;
    let page = r.pages[Math.min(pageIndex, r.pages.length - 1)];
    let path = kind === 'header' ? page.header : page.footer;
    if (!path) {
      path = this.hf.createPart(kind);
      const ref = allSections(this.view.state.doc)[page.section];
      const props: SectionProps = structuredClone(ref.props);
      (kind === 'header' ? props.headers : props.footers)[page.headerType] = path;
      this.view.dispatch(setSectionProps(this.view.state.tr, ref, props).setMeta(REFRESH, true));
      this.runLayout();
      page = this.result!.pages[page.index];
    }
    const area = this.pages.areaFor(page.index, kind);
    if (!area) return;
    const label = hfLabel(kind, page.headerType, !!this.view.state.doc.attrs.evenAndOddHeaders, page.section, r.sections.length);
    this.hf.activate(path, kind, page, area, r.pages.length, this.sectionPagesCount(page.section), label);
    this.root.classList.add('ml-dx-hf-editing');
    this.decorateActiveHeaderFooter();
    this.emit('stream', { stream: kind, label, pageIndex: page.index });
  }

  exitHeaderFooter(focusBody = true) {
    if (!this.hf.active) return;
    this.hf.deactivate();
    this.root.classList.remove('ml-dx-hf-editing');
    this.emit('stream', { stream: 'body' });
    this.scheduleLayout();
    if (focusBody) this.view.focus();
  }

  private decorateActiveHeaderFooter() {
    const a = this.hf.active;
    if (!a) return;
    let bar = a.area.querySelector<HTMLElement>(':scope > .ml-dx-hf-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'ml-dx-hf-bar';
      bar.contentEditable = 'false';
      bar.innerHTML = '<span class="ml-dx-hf-label"></span><button type="button" data-act="options" aria-haspopup="menu" aria-expanded="false">Options</button><button type="button" data-act="remove">Remove</button><button type="button" data-act="close" aria-label="Close header and footer">Close</button>';
      bar.addEventListener('mousedown', (e) => e.preventDefault());
      bar.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest('button');
        const act = btn?.dataset.act;
        const active = this.hf.active;
        if (!btn || !act || !active) return;
        if (act === 'close') this.exitHeaderFooter();
        if (act === 'remove') this.removeHeaderFooter(active.kind, active.pageIndex);
        if (act === 'options') {
          const r = btn.getBoundingClientRect();
          this.emit('request', { action: 'headerFooterOptions', pageIndex: active.pageIndex, rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } });
        }
      });
      a.area.appendChild(bar);
    }
    bar.querySelector('.ml-dx-hf-label')!.textContent = a.area.dataset.label ?? '';
  }

  /** Remove the header/footer used by a page's section for that page type. */
  removeHeaderFooter(kind: HFKind, pageIndex = this.currentPage) {
    const page = this.result?.pages[pageIndex];
    if (!page) return;
    if (this.hf.active) this.exitHeaderFooter(false);
    const sections = allSections(this.view.state.doc);
    const ref = sections[page.section];
    const props: SectionProps = structuredClone(ref.props);
    const refs = kind === 'header' ? props.headers : props.footers;
    // Without its own part a section inherits from earlier sections, so an empty part is
    // needed to blank it when an earlier section defines one of this type.
    const inherited = sections.slice(0, page.section).some((s) => (kind === 'header' ? s.props.headers : s.props.footers)[page.headerType]);
    if (inherited) refs[page.headerType] = this.hf.createPart(kind);
    else delete refs[page.headerType];
    this.view.dispatch(setSectionProps(this.view.state.tr, ref, props).setMeta(REFRESH, true));
  }

  headerFooterOptions(pageIndex = this.currentPage): { headerDistance: number; footerDistance: number; differentFirstPage: boolean; differentOddEven: boolean; maxDistance: number } {
    const page = this.result?.pages[pageIndex];
    const ref = allSections(this.view.state.doc)[page?.section ?? 0];
    return {
      headerDistance: ref.props.margins.header,
      footerDistance: ref.props.margins.footer,
      differentFirstPage: ref.props.titlePg,
      differentOddEven: !!this.view.state.doc.attrs.evenAndOddHeaders,
      maxDistance: Math.round(ref.props.pageHeight / 3),
    };
  }

  setHeaderFooterOptions(pageIndex: number, opts: Partial<{ headerDistance: number; footerDistance: number; differentFirstPage: boolean; differentOddEven: boolean }>) {
    const page = this.result?.pages[pageIndex];
    const ref = allSections(this.view.state.doc)[page?.section ?? 0];
    const props: SectionProps = structuredClone(ref.props);
    const max = Math.round(props.pageHeight / 3);
    if (opts.headerDistance !== undefined) props.margins.header = Math.max(0, Math.min(max, Math.round(opts.headerDistance)));
    if (opts.footerDistance !== undefined) props.margins.footer = Math.max(0, Math.min(max, Math.round(opts.footerDistance)));
    if (opts.differentFirstPage !== undefined) props.titlePg = opts.differentFirstPage;
    const tr = setSectionProps(this.view.state.tr, ref, props);
    if (opts.differentOddEven !== undefined) tr.setDocAttribute('evenAndOddHeaders', opts.differentOddEven);
    if (this.hf.active) this.exitHeaderFooter(false);
    this.view.dispatch(tr.setMeta(REFRESH, true));
  }

  /** Insert PAGE, NUMPAGES or SECTIONPAGES (or "Page X of Y") at the caret of the header or footer being edited. */
  insertPageField(kind: 'PAGE' | 'NUMPAGES' | 'SECTIONPAGES' | 'PAGEXOFY', template = 'Page {page} of {total}'): boolean {
    const a = this.hf.active;
    if (!a || this.readOnly) return false;
    const view = a.view;
    const marks = view.state.storedMarks ?? view.state.selection.$from.marks();
    const field = (k: 'PAGE' | 'NUMPAGES' | 'SECTIONPAGES') => schema.nodes.page_field.create({ kind: k, instr: ` ${k} ` }, null, marks);
    let nodes: PMNode[];
    if (kind === 'PAGEXOFY') {
      nodes = [];
      for (const part of template.split(/(\{page\}|\{total\})/)) {
        if (part === '{page}') nodes.push(field('PAGE'));
        else if (part === '{total}') nodes.push(field('NUMPAGES'));
        else if (part) nodes.push(schema.text(part, marks));
      }
    } else nodes = [field(kind)];
    const tr = view.state.tr.deleteSelection();
    const at = tr.selection.from;
    tr.insert(at, nodes);
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(tr.doc.content.size, at + nodes.reduce((n, x) => n + x.nodeSize, 0)))));
    view.dispatch(tr);
    view.focus();
    return true;
  }

  /** Whether the header/footer of a page's section follows the previous section's (Link to previous); null in the first section. */
  headerFooterLinked(kind: HFKind, pageIndex = this.currentPage): boolean | null {
    const page = this.result?.pages[pageIndex];
    if (!page || page.section === 0) return null;
    const ref = allSections(this.view.state.doc)[page.section];
    return !(kind === 'header' ? ref.props.headers : ref.props.footers)[page.headerType];
  }

  /** Link a section's header/footer to the previous section's, or give it its own copy. */
  setHeaderFooterLinked(kind: HFKind, pageIndex: number, linked: boolean): boolean {
    const page = this.result?.pages[pageIndex];
    if (!page || page.section === 0 || this.readOnly) return false;
    if (this.hf.active) this.exitHeaderFooter(false);
    const sections = allSections(this.view.state.doc);
    const ref = sections[page.section];
    const props: SectionProps = structuredClone(ref.props);
    const refs = kind === 'header' ? props.headers : props.footers;
    if (linked) delete refs[page.headerType];
    else {
      const current = kind === 'header' ? page.header : page.footer;
      const path = this.hf.createPart(kind);
      const src = current ? this.docx.headerFooters.get(current) : undefined;
      const part = this.docx.headerFooters.get(path);
      if (src && part) part.doc = src.doc;
      refs[page.headerType] = path;
    }
    this.view.dispatch(setSectionProps(this.view.state.tr, ref, props).setMeta(REFRESH, true));
    return true;
  }

  headerFooterTypeOfPage(pageIndex: number, kind: HFKind): HeaderFooterType | -1 {
    const page = this.result?.pages[pageIndex];
    if (!page) return -1;
    return (kind === 'header' ? page.header : page.footer) ? page.headerType : -1;
  }

  // -------------------------------------------------------------------------------------------
  // Commands shared by shortcuts and UI

  runAction(a: KeyAction): boolean {
    const v = this.activeView;
    const d = this.docx;
    if (this.readOnly && !['find', 'save', 'print'].includes(a)) return false;
    switch (a) {
      case 'bold': return toggleStyle(v, d, 'bold');
      case 'italic': return toggleStyle(v, d, 'italic');
      case 'underline': return toggleStyle(v, d, 'underline');
      case 'strike': return toggleStyle(v, d, 'strike');
      case 'superscript': return setVertAlign(v, this.cursorProps().superscript ? null : 'superscript');
      case 'subscript': return setVertAlign(v, this.cursorProps().subscript ? null : 'subscript');
      case 'clearFormatting': return clearFormatting(v);
      case 'alignLeft': return setAlignment(v, 'left');
      case 'alignCenter': return setAlignment(v, 'center');
      case 'alignRight': return setAlignment(v, 'right');
      case 'alignJustify': return setAlignment(v, 'both');
      case 'bulletList': return toggleList(v, d, 'bullet');
      case 'numberedList': return toggleList(v, d, 'ordered');
      case 'indent': return changeIndent(v, d, 1);
      case 'outdent': return changeIndent(v, d, -1);
      case 'pageBreak': return insertPageBreak(v);
      case 'fontGrow':
      case 'fontShrink': {
        const cur = this.cursorProps().fontSize ?? 11;
        const next = a === 'fontGrow' ? FONT_SIZES.find((s) => s > cur) ?? cur + 12 : [...FONT_SIZES].reverse().find((s) => s < cur) ?? Math.max(1, cur - 1);
        return setFontSize(v, next);
      }
      default:
        if (a.startsWith('style:')) return setParagraphStyle(v, d, a.slice(6));
        this.emit('request', { action: a });
        return true;
    }
  }

  async insertImages(files: File[], pos?: number): Promise<void> {
    const v = this.activeView;
    if (pos !== undefined) v.dispatch(v.state.tr.setSelection(TextSelection.near(v.state.doc.resolve(pos))));
    for (const f of files) {
      try {
        await insertImage(v, this.docx, f, f.name.replace(/\.[^.]+$/, '') || 'Picture');
      } catch (e) {
        this.emit('error', { message: `Could not insert ${f.name}: ${(e as Error).message}` });
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // Comments

  /** Comment threads anchored in the body, in document order. */
  comments(): AnchoredComment[] {
    const ranges = commentRanges(this.view.state.doc);
    const out: AnchoredComment[] = [];
    for (const [id, rs] of ranges) {
      const t = this.docx.comments.get(id);
      if (!t) continue;
      const quote = rs.map((r) => this.view.state.doc.textBetween(r.from, r.to, ' ', ' ')).join(' ');
      out.push({ ...t, from: rs[0].from, quote });
    }
    return out.sort((a, b) => a.from - b.from);
  }

  addComment(text: string): string | null {
    if (this.readOnly) return null;
    if (this.hf.active) this.exitHeaderFooter(false);
    const id = addComment(this.view, this.docx, text, this.author);
    if (id) {
      this.selectComment(id);
      this.markDirty();
      this.emit('comments', {});
    }
    return id;
  }

  /** Add a comment on a given range (the selection the comment composer was opened for). */
  addCommentAt(range: { from: number; to: number }, text: string): string | null {
    if (this.readOnly) return null;
    if (this.hf.active) this.exitHeaderFooter(false);
    const doc = this.view.state.doc;
    const from = Math.max(0, Math.min(range.from, doc.content.size));
    const to = Math.max(from, Math.min(range.to, doc.content.size));
    try {
      this.view.dispatch(this.view.state.tr.setSelection(TextSelection.create(doc, from, to)).setMeta('addToHistory', false));
    } catch {
      return null;
    }
    return this.addComment(text);
  }

  replyToComment(threadId: string, text: string): string | null {
    const t = this.docx.comments.get(threadId);
    if (!t) return null;
    const id = nextCommentId(this.docx);
    t.replies.push({ id, author: this.author, date: isoNow(), text });
    this.markDirty();
    this.emit('comments', {});
    return id;
  }

  editComment(id: string, text: string) {
    for (const t of this.docx.comments.values()) {
      if (t.id === id) t.text = text;
      for (const r of t.replies) if (r.id === id) r.text = text;
    }
    this.markDirty();
    this.emit('comments', {});
  }

  deleteComment(id: string) {
    const thread = this.docx.comments.get(id);
    if (thread) removeCommentMarks(this.view, id);
    else for (const t of this.docx.comments.values()) t.replies = t.replies.filter((r) => r.id !== id);
    this.markDirty();
    this.emit('comments', {});
  }

  resolveComment(id: string, done: boolean) {
    const t = this.docx.comments.get(id);
    if (!t) return;
    t.done = done;
    this.markDirty();
    this.emit('comments', {});
  }

  selectComment(id: string | null) {
    const tr = this.view.state.tr.setMeta(commentsKey, { active: id }).setMeta('addToHistory', false);
    this.view.dispatch(tr);
    if (!id) return;
    const r = commentRanges(this.view.state.doc).get(id)?.[0];
    if (r) this.scrollToPos(r.from);
  }

  get activeComment(): string | null {
    return commentsKey.getState(this.view.state)?.active ?? null;
  }

  scrollToPos(pos: number) {
    try {
      const coords = this.view.coordsAtPos(pos);
      const s = this.scrollEl.getBoundingClientRect();
      if (coords.top < s.top + 40 || coords.bottom > s.bottom - 40) {
        this.scrollEl.scrollBy({ top: coords.top - s.top - s.height / 3, behavior: 'smooth' });
      }
    } catch {
      // Position not rendered.
    }
  }

  // -------------------------------------------------------------------------------------------
  // Tracked changes

  trackedChanges(): TrackedChange[] {
    return listChanges(this.view.state.doc);
  }

  decideChanges(changes: TrackedChange[] | 'all', accept: boolean) {
    const list = changes === 'all' ? this.trackedChanges() : changes;
    if (!list.length) return;
    this.view.dispatch(applyDecision(this.view.state, list, accept).setMeta(REFRESH, true));
    this.emit('trackedChanges', {});
  }

  selectChange(change: TrackedChange) {
    const r = change.ranges[0];
    const doc = this.view.state.doc;
    const from = Math.min(r.from, doc.content.size);
    const to = Math.min(r.to, doc.content.size);
    try {
      this.view.dispatch(this.view.state.tr.setSelection(TextSelection.create(doc, from, to)).setMeta('addToHistory', false));
    } catch {
      this.view.dispatch(this.view.state.tr.setSelection(TextSelection.near(doc.resolve(from))));
    }
    this.scrollToPos(from);
    this.view.focus();
  }

  // -------------------------------------------------------------------------------------------
  // Search

  search(opts: Partial<SearchOptions & { index: number }>) {
    if (this.hf.active) this.exitHeaderFooter(false);
    this.view.dispatch(setSearch(this.view.state, opts));
    const s = searchKey.getState(this.view.state);
    if (s && s.index >= 0) this.scrollToPos(s.results[s.index].from);
  }

  searchStep(dir: 1 | -1) {
    const tr = gotoMatch(this.view.state, dir);
    if (tr) this.view.dispatch(tr);
  }

  replace(text: string) {
    const tr = replaceCurrent(this.view.state, text);
    if (tr) this.view.dispatch(tr);
  }

  replaceAll(text: string): number {
    const n = searchKey.getState(this.view.state)?.results.length ?? 0;
    const tr = replaceAll(this.view.state, text);
    if (tr) this.view.dispatch(tr);
    return n;
  }

  clearSearch() {
    this.view.dispatch(setSearch(this.view.state, { query: '' }));
  }

  searchResults() {
    return searchKey.getState(this.view.state) ?? null;
  }

  private emitSearch() {
    const s = searchKey.getState(this.view.state);
    this.emit('search', { query: s?.query ?? '', count: s?.results.length ?? 0, index: s?.index ?? -1 });
  }

  // -------------------------------------------------------------------------------------------
  // Fields (content controls)

  fields(): FieldInfo[] {
    return listFields(this.view.state.doc);
  }

  setFieldValue(name: string, value: string): boolean {
    if (this.readOnly) return false;
    const ok = setFieldValue(this.view, name, value);
    if (ok) this.emit('fields', {});
    return ok;
  }

  renameField(name: string, next: string): boolean {
    if (this.readOnly) return false;
    const ok = renameField(this.view, name, next);
    if (ok) this.emit('fields', {});
    return ok;
  }

  insertField(opts: { name?: string; value?: string; at?: number } = {}): string | null {
    if (this.readOnly) return null;
    if (this.hf.active) this.exitHeaderFooter(false);
    const name = insertField(this.view, opts);
    if (name) this.emit('fields', {});
    return name;
  }

  removeField(name: string): boolean {
    if (this.readOnly) return false;
    const ok = removeField(this.view, name);
    if (ok) this.emit('fields', {});
    return ok;
  }

  /** Highlight a field's controls in the document (null clears). */
  focusField(name: string | null) {
    if ((fieldsKey.getState(this.view.state)?.focus ?? null) === name) return;
    this.view.dispatch(focusField(this.view.state, name));
    if (!name) return;
    const f = this.fields().find((x) => x.name === name);
    if (f) this.scrollToPos(f.ranges[0].from);
  }

  // -------------------------------------------------------------------------------------------
  // Copy formatting (format painter)

  private painter: CopiedFormat | null = null;
  private painterOff: (() => void) | null = null;

  get formatPainterActive(): boolean {
    return !!this.painter;
  }

  /** Pick up the formatting at the selection; the next selection made with the pointer receives it. */
  startFormatPainter() {
    if (this.readOnly) return;
    this.painter = copyFormat(this.activeView.state);
    this.root.classList.add('ml-dx-painting');
    const dom = this.view.dom as HTMLElement;
    const up = () => setTimeout(() => {
      if (this.painter && !this.view.state.selection.empty) this.applyFormatPainter();
    }, 0);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') this.stopFormatPainter();
    };
    dom.addEventListener('mouseup', up);
    dom.addEventListener('touchend', up);
    document.addEventListener('keydown', key);
    this.painterOff = () => {
      dom.removeEventListener('mouseup', up);
      dom.removeEventListener('touchend', up);
      document.removeEventListener('keydown', key);
    };
    this.emit('formatPainter', { active: true });
  }

  /** Apply the picked-up formatting to the current selection and end painting. */
  applyFormatPainter(): boolean {
    if (!this.painter) return false;
    const ok = applyFormat(this.view, this.painter);
    this.stopFormatPainter();
    return ok;
  }

  stopFormatPainter() {
    if (!this.painter) return;
    this.painter = null;
    this.painterOff?.();
    this.painterOff = null;
    this.root.classList.remove('ml-dx-painting');
    this.emit('formatPainter', { active: false });
  }

  // -------------------------------------------------------------------------------------------
  // Tables

  canTableAction(action: TableAction): boolean {
    return !this.readOnly && canRunTableAction(this.activeView.state, action);
  }

  tableAction(action: TableAction): boolean {
    if (this.readOnly) return false;
    return runTableAction(this.activeView, action);
  }

  setCellBackground(hex: string | null): boolean {
    if (this.readOnly) return false;
    return setCellBackground(this.activeView, hex);
  }

  // -------------------------------------------------------------------------------------------
  // Bookmarks, cross-references and notes

  bookmarks(): BookmarkInfo[] {
    return listBookmarks(this.view.state.doc);
  }

  headings(): HeadingInfo[] {
    return listHeadings(this.view.state.doc);
  }

  createBookmark(name: string): boolean {
    if (this.readOnly) return false;
    if (this.hf.active) this.exitHeaderFooter(false);
    return createBookmark(this.view, name);
  }

  insertCrossReference(target: { bookmark?: string; headingPos?: number }): boolean {
    if (this.readOnly) return false;
    if (this.hf.active) this.exitHeaderFooter(false);
    return insertCrossReference(this.view, target);
  }

  insertNote(kind: NoteKind, text: string): string | null {
    if (this.readOnly) return null;
    if (this.collabLocal) {
      this.emit('error', { message: 'Footnotes cannot be added while the document is shared.' });
      return null;
    }
    if (this.hf.active) this.exitHeaderFooter(false);
    const key = insertNote(this.view, this.docx, kind, text);
    if (key) {
      this.markDirty();
      this.scheduleLayout();
    }
    return key;
  }

  noteText(key: string): string {
    return noteText(this.docx, key);
  }

  setNoteText(key: string, text: string): boolean {
    if (this.collabLocal) {
      this.emit('error', { message: 'Footnotes cannot be edited while the document is shared.' });
      return false;
    }
    if (this.readOnly || !setNoteText(this.docx, key, text)) return false;
    this.notes.noteChanged(key);
    this.markDirty();
    this.engine.resetCaches();
    this.scheduleLayout();
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // Real-time collaboration (prosemirror-collab; the session in src/collab talks to the relay)

  private collabLocal: (() => void) | null = null;

  get collaborating(): boolean {
    return !!this.collabLocal;
  }

  /** Start sending local steps: `onLocal` is called after every local change. */
  startCollab(version: number, clientID: string, onLocal: () => void) {
    const plugins = this.view.state.plugins.filter((p) => !String((p as unknown as { key: string }).key).startsWith('collab$') && p.spec.key !== presenceKey);
    this.view.updateState(this.view.state.reconfigure({ plugins: [...plugins, collab({ version, clientID }), presencePlugin()] }));
    this.collabLocal = onLocal;
  }

  stopCollab() {
    if (!this.collabLocal) return;
    this.collabLocal = null;
    const plugins = this.view.state.plugins.filter((p) => !String((p as unknown as { key: string }).key).startsWith('collab$') && p.spec.key !== presenceKey);
    this.view.updateState(this.view.state.reconfigure({ plugins }));
  }

  /** Steps not yet confirmed by the relay, as JSON. */
  collabSendable(): { version: number; steps: unknown[]; clientID: string } | null {
    const s = sendableSteps(this.view.state);
    return s ? { version: s.version, steps: s.steps.map((st) => st.toJSON()), clientID: String(s.clientID) } : null;
  }

  get collabVersion(): number {
    return this.collabLocal ? getVersion(this.view.state) : 0;
  }

  /** Apply steps from the relay (including this client's own, which confirms them). */
  receiveCollabSteps(steps: unknown[], clientIDs: (string | number)[]) {
    const parsed = steps.map((j) => Step.fromJSON(schema, j as Record<string, unknown>));
    const tr = receiveTransaction(this.view.state, parsed, clientIDs, { mapSelectionBackward: true });
    this.dispatchBody(tr.setMeta(REMOTE, true).setMeta(REFRESH, true));
  }

  setRemoteCursors(cursors: RemoteCursor[]) {
    if (!this.collabLocal) return;
    this.view.dispatch(this.view.state.tr.setMeta(presenceKey, cursors).setMeta('addToHistory', false));
  }

  /** Replace the comment threads (from a collaborator). */
  setCommentThreads(threads: CommentThread[]) {
    this.docx.comments = new Map(threads.map((t) => [t.id, t]));
    this.emit('comments', {});
  }

  /** Replace styles and list definitions (from a collaborator) and redraw. */
  replaceStylesAndNumbering(stylesXml: string | null, numberingXml: string | null) {
    if (stylesXml) {
      const v = this.docx.styles.version;
      this.docx.styles = StyleSheet.parse(stylesXml);
      this.docx.styles.version = v + 1;
    }
    if (numberingXml || stylesXml) {
      const v = this.docx.numbering.version;
      if (numberingXml) this.docx.numbering = NumberingModel.parse(numberingXml, this.docx.styles);
      this.docx.numbering.setStyles(this.docx.styles);
      this.docx.numbering.version = v + 1;
    }
    this.stylesVersion = -1;
    this.updateStyles();
    this.view.dispatch(this.view.state.tr.setMeta(REFRESH, true).setMeta('addToHistory', false));
  }

  // -------------------------------------------------------------------------------------------
  // Printing

  /**
   * Lay the document out as gap-free pages at 100% and copy them into `host` (appended to the
   * page). Used for printing and PDF export; the live view is restored afterwards.
   */
  private renderPages(hostClass: string): { host: HTMLElement; canvas: HTMLElement; pages: PageInfo[] } {
    if (this.hf.active) this.exitHeaderFooter(false);
    const prevMode = this._viewMode;
    if (prevMode !== 'print') {
      this._viewMode = 'print';
      setLayoutMode(this.view, 'print');
      this.applyModeClasses();
    }
    this.printing = true;
    this.runLayout();
    this.runLayout();
    const pages = this.result?.pages ?? [];
    const host = document.createElement('div');
    const modes = [...this.root.classList].filter((c) => /^ml-dx-(mode-|final$|original$|hide-comments$)/.test(c));
    host.className = `${hostClass} ${this.scope} ml-dx-view-print ${modes.join(' ')}`;
    const style = document.createElement('style');
    const first = pages[0];
    style.textContent = `@page { size: ${(first?.width ?? 816) / 96}in ${(first?.height ?? 1056) / 96}in; margin: 0; }`;
    host.appendChild(style);
    host.appendChild(this.styleEl.cloneNode(true));
    const canvas = this.canvas.cloneNode(true) as HTMLElement;
    canvas.style.transform = '';
    host.appendChild(canvas);
    document.body.appendChild(host);
    this.printing = false;
    if (prevMode !== 'print') {
      this._viewMode = prevMode;
      setLayoutMode(this.view, prevMode);
      this.applyModeClasses();
    }
    this.runLayout();
    return { host, canvas, pages };
  }

  /** Pages laid out for export (PDF); call cleanup() when done reading them. */
  renderForExport(): { host: HTMLElement; canvas: HTMLElement; pages: PageInfo[]; cleanup: () => void } {
    const r = this.renderPages('ml-dx-export-host');
    return { ...r, cleanup: () => r.host.remove() };
  }

  /** Print the paginated document (also "Save as PDF" in the browser's print dialog). */
  print() {
    const { host } = this.renderPages('ml-dx-print-host');
    document.body.classList.add('ml-dx-printing');
    const cleanup = () => {
      host.remove();
      document.body.classList.remove('ml-dx-printing');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    // Give pictures in the clone a moment to decode before opening the dialog.
    setTimeout(() => {
      window.print();
      setTimeout(cleanup, 1000);
    }, 100);
  }

  // -------------------------------------------------------------------------------------------

  /** Positions of all images (for tests and API). */
  /** Font families used in the document: theme fonts, paragraph styles and direct formatting. */
  documentFonts(): string[] {
    const d = this.docx;
    const theme = { major: d.theme.major, minor: d.theme.minor };
    const fonts = new Set<string>();
    for (const f of [theme.major, theme.minor]) if (f) fonts.add(f);
    for (const s of d.styles.paragraphStyleList()) {
      const name = runFontName(d.styles.effectiveRun(s.id, null, {}), theme);
      if (name) fonts.add(name);
    }
    this.view.state.doc.descendants((node) => {
      for (const m of node.marks) {
        const name = m.type === schema.marks.font ? m.attrs.ascii ?? m.attrs.hAnsi ?? m.attrs.eastAsia : null;
        if (name) fonts.add(name);
      }
      return true;
    });
    return [...fonts];
  }

  nodesOfType(type: string): { node: PMNode; pos: number }[] {
    const out: { node: PMNode; pos: number }[] = [];
    this.view.state.doc.descendants((node, pos) => {
      if (node.type === schema.nodes[type]) out.push({ node, pos });
    });
    return out;
  }

  pagePx(twips: number): number {
    return twipsToPx(twips);
  }

  destroy() {
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    this.hf.reset();
    this.view?.destroy();
    this.docx?.dispose();
    this.root.remove();
  }
}
