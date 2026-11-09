/**
 * Page API: `new Marginline(config)`, export, document modes, viewing options, events, file
 * replacement and a subset of the Document API (query → target → mutation → receipt). An instance
 * drives one editor: the one it was created for, the one `selector` points at, or the page's.
 */
import { TextSelection } from 'prosemirror-state';
import {
  applyLink,
  insertTable,
  setAlignment,
  setFontFamily,
  setFontSize,
  setHighlight,
  setTextColor,
  toggleList,
} from '../editor/commands';
import type { DocxEditor, EditMode, TrackedChangesView } from '../editor/DocxEditor';
import { findMatches } from '../editor/plugins/search';
import type { TrackedChange } from '../editor/plugins/trackChanges';
import type { CustomButton, FileActions, UIControls, UserInfo } from '../ui/types';
import { type DocumentInput, type DocumentSource, documentOf, DOCX_MIME, downloadBlob, toBytes } from './source';

export interface MarginlineConfig {
  /**
   * The editor to drive when the page has several: an element (or a selector for one) that
   * contains it or is inside it. By default the page's editor, or the one mounted last.
   */
  selector?: string | HTMLElement;
  document?: DocumentInput;
  documentMode?: EditMode;
  user?: { name: string; email?: string };
  viewing?: { trackedChanges?: TrackedChangesView; comments?: boolean };
  title?: string;
  onReady?: (e: { marginline: Marginline }) => void;
  onEditorCreate?: (e: { editor: ActiveEditor }) => void;
  onContentError?: (e: { error: Error; documentId?: string }) => void;
  onException?: (e: { error: Error }) => void;
  onCommentsUpdate?: (e: { type: string; comments: CommentInfo[] }) => void;
  onTrackedChangesBulkDecision?: (e: { decision: 'accept' | 'reject'; count: number }) => void;
  onEditorUpdate?: (e: { editor: ActiveEditor }) => void;
  diagnostics?: { history?: { enabled?: boolean; maxEvents?: number } };
}

export interface ExportOptions {
  exportType?: ('docx' | 'pdf')[];
  exportedName?: string;
  /** Download the file (default) or only return the Blob(s). */
  triggerDownload?: boolean;
  /** 'clean' leaves comments out of the file. */
  commentsType?: 'external' | 'clean';
}

export interface Target {
  kind: 'range';
  from: number;
  to: number;
  /** Document revision the target belongs to; mutations reject stale targets. */
  revision: number;
}

export interface Receipt {
  status: 'applied' | 'failed';
  operation: string;
  detail?: string;
  revision: number;
  target?: Target;
}

export interface CommentInfo {
  id: string;
  author: string;
  date?: string;
  text: string;
  resolved: boolean;
  quote: string;
  replies: { id: string; author: string; date?: string; text: string }[];
}

export interface ChangeInfo {
  id: string;
  type: TrackedChange['type'];
  author: string;
  date: string;
  text: string;
  target: Target;
}

type Listener = (payload: unknown) => void;

/** What an instance drives: the editor and the interface around it. */
export interface MarginlineHost {
  editor: DocxEditor;
  controls: UIControls;
  files: FileActions;
}

/** Per-editor state shared by the instances created for it. */
interface Runtime {
  host: MarginlineHost;
  /** The instance receiving events; a newer one for the same editor replaces it. */
  current: Marginline | null;
  lastDoc: unknown;
  rev: number;
  doc: DocumentApi;
}

const runtimes = new WeakMap<DocxEditor, Runtime>();
/** Editors mounted on the page, by their root element (for `selector`). */
const mounted = new Map<HTMLElement, MarginlineHost>();
/** The editor `new Marginline()` drives by default (see installPageApi). */
let pageHost: MarginlineHost | null = null;

function runtimeOf(host: MarginlineHost): Runtime {
  let r = runtimes.get(host.editor);
  if (r) {
    r.host = host;
    return r;
  }
  r = { host, current: null, lastDoc: null, rev: 0, doc: null as unknown as DocumentApi };
  r.doc = createDocumentApi(r);
  runtimes.set(host.editor, r);
  return r;
}

function hostFor(selector: string | HTMLElement | undefined): MarginlineHost | null {
  const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
  if (el) for (const [root, host] of mounted) if (el === root || el.contains(root) || root.contains(el)) return host;
  return pageHost ?? [...mounted.values()].pop() ?? null;
}

/**
 * Make an editor findable by `new Marginline({ selector })` (the interface does this while it is
 * mounted). Returns the function that removes it again.
 */
export function registerHost(root: HTMLElement, host: MarginlineHost): () => void {
  mounted.set(root, host);
  return () => {
    if (mounted.get(root) === host) mounted.delete(root);
    if (pageHost === host) pageHost = null;
    runtimes.get(host.editor)?.current?.detach();
  };
}

/** Revision of the current document state: it changes with every edit. */
function revisionOf(r: Runtime): number {
  const doc = r.host.editor.view.state.doc;
  if (doc !== r.lastDoc) {
    r.lastDoc = doc;
    r.rev++;
  }
  return r.rev;
}

function commentInfos(editor: DocxEditor): CommentInfo[] {
  return editor.comments().map((c) => ({
    id: c.id,
    author: c.author,
    date: c.date,
    text: c.text,
    resolved: !!c.done,
    quote: c.quote,
    replies: c.replies.map((r) => ({ id: r.id, author: r.author, date: r.date, text: r.text })),
  }));
}

// -----------------------------------------------------------------------------------------------
// Document API

function createDocumentApi(r: Runtime) {
  const rt = () => r.host;
  const revision = () => revisionOf(r);

  function makeTarget(from: number, to: number): Target {
    return { kind: 'range', from, to, revision: revision() };
  }

  function stale(t: Target | undefined): string | null {
    if (!t) return 'A target is required.';
    if (t.revision !== revision()) return 'The target belongs to an older revision of the document; query again.';
    const size = rt().editor.view.state.doc.content.size;
    if (t.from < 0 || t.to > size || t.from > t.to) return 'The target is outside the document.';
    return null;
  }

  function failed(operation: string, detail: string): Receipt {
    return { status: 'failed', operation, detail, revision: revision() };
  }

  /** Run an edit in the requested change mode (tracked = as a suggestion). */
  function withMode<T>(mode: 'direct' | 'tracked' | undefined, fn: () => T): T {
    const ed = rt().editor;
    const before = ed.editMode;
    const want: EditMode = mode === 'tracked' ? 'suggesting' : mode === 'direct' ? 'editing' : before === 'viewing' ? 'editing' : before;
    if (want !== before) ed.setEditMode(want);
    try {
      return fn();
    } finally {
      if (want !== before) ed.setEditMode(before);
    }
  }

  function replaceRange(from: number, to: number, text: string): Target {
    const view = rt().editor.view;
    const { state } = view;
    const marks = state.doc.resolve(from).marksAcross(state.doc.resolve(to)) ?? state.doc.resolve(from).marks();
    const tr = state.tr;
    if (text) tr.replaceWith(from, to, state.schema.text(text, marks));
    else tr.delete(from, to);
    view.dispatch(tr);
    const end = tr.mapping.map(to);
    return makeTarget(from, Math.max(from, end));
  }

  const documentApi = {
    /** Plain text of the body, paragraphs separated by new lines. */
    getText(): string {
      const doc = rt().editor.view.state.doc;
      return doc.textBetween(0, doc.content.size, '\n', ' ');
    },
    query: {
      /** Find text: `{ select: { type: 'text', pattern, caseSensitive?, regex? }, require?: 'first' | 'all' }`. */
      async match(q: { select: { type: 'text'; pattern: string; caseSensitive?: boolean; regex?: boolean; wholeWord?: boolean }; require?: 'first' | 'all' | 'any' }) {
        const doc = rt().editor.view.state.doc;
        if (q?.select?.type !== 'text') throw new Error('Only text queries are supported ({ select: { type: "text", pattern } }).');
        const matches = findMatches(doc, { query: q.select.pattern, caseSensitive: !!q.select.caseSensitive, regex: !!q.select.regex, wholeWord: !!q.select.wholeWord });
        const items = matches.map((m) => ({
          matchKind: 'text' as const,
          text: doc.textBetween(m.from, m.to, '', ''),
          context: m.context,
          target: makeTarget(m.from, m.to),
        }));
        return { items: q.require === 'first' ? items.slice(0, 1) : items, total: items.length };
      },
    },
    /** Replace the target's text. `{ changeMode: 'tracked' }` records it as a suggestion. */
    async replace(input: { target: Target; text: string }, opts: { changeMode?: 'direct' | 'tracked' } = {}): Promise<Receipt> {
      const why = stale(input?.target);
      if (why) return failed('replace', why);
      const target = withMode(opts.changeMode, () => replaceRange(input.target.from, input.target.to, input.text ?? ''));
      return { status: 'applied', operation: 'replace', detail: opts.changeMode === 'tracked' ? 'replacement recorded in tracked mode' : 'text replaced', revision: revision(), target: { ...target, revision: revision() } };
    },
    async delete(input: { target: Target }, opts: { changeMode?: 'direct' | 'tracked' } = {}): Promise<Receipt> {
      const why = stale(input?.target);
      if (why) return failed('delete', why);
      withMode(opts.changeMode, () => replaceRange(input.target.from, input.target.to, ''));
      return { status: 'applied', operation: 'delete', detail: opts.changeMode === 'tracked' ? 'deletion recorded in tracked mode' : 'text deleted', revision: revision() };
    },
    text: {
      /** Insert text at a target, at 'start'/'end' of the document, or at the selection (default). */
      async insert(input: { text: string; target?: Target; at?: 'selection' | 'start' | 'end' }, opts: { changeMode?: 'direct' | 'tracked' } = {}): Promise<Receipt> {
        const ed = rt().editor;
        const doc = ed.view.state.doc;
        let pos: number;
        if (input.target) {
          const why = stale(input.target);
          if (why) return failed('text.insert', why);
          pos = input.target.to;
        } else if (input.at === 'start') pos = TextSelection.atStart(doc).from;
        else if (input.at === 'end') pos = TextSelection.atEnd(doc).from;
        else pos = ed.view.state.selection.from;
        const target = withMode(opts.changeMode, () => replaceRange(pos, pos, input.text ?? ''));
        return { status: 'applied', operation: 'text.insert', revision: revision(), target: { ...target, revision: revision() } };
      },
    },
    comments: {
      async list(opts: { includeResolved?: boolean } = {}): Promise<CommentInfo[]> {
        return commentInfos(rt().editor).filter((c) => opts.includeResolved !== false || !c.resolved);
      },
      async create(input: { target: Target; text: string }): Promise<Receipt & { commentId?: string }> {
        const why = stale(input?.target);
        if (why) return failed('comments.create', why);
        const id = rt().editor.addCommentAt(input.target, input.text);
        if (!id) return failed('comments.create', 'The comment could not be added (read-only document or empty target).');
        return { status: 'applied', operation: 'comments.create', revision: revision(), commentId: id };
      },
      async reply(input: { commentId: string; text: string }): Promise<Receipt & { commentId?: string }> {
        const id = rt().editor.replyToComment(input.commentId, input.text);
        return id ? { status: 'applied', operation: 'comments.reply', revision: revision(), commentId: id } : failed('comments.reply', `No comment ${input.commentId}.`);
      },
      async resolve(input: { commentId: string }): Promise<Receipt> {
        rt().editor.resolveComment(input.commentId, true);
        return { status: 'applied', operation: 'comments.resolve', revision: revision() };
      },
      async reopen(input: { commentId: string }): Promise<Receipt> {
        rt().editor.resolveComment(input.commentId, false);
        return { status: 'applied', operation: 'comments.reopen', revision: revision() };
      },
      async delete(input: { commentId: string }): Promise<Receipt> {
        rt().editor.deleteComment(input.commentId);
        return { status: 'applied', operation: 'comments.delete', revision: revision() };
      },
    },
    trackChanges: {
      async list(): Promise<ChangeInfo[]> {
        return rt().editor.trackedChanges().map((c) => ({ id: c.id, type: c.type, author: c.author, date: c.date, text: c.text, target: makeTarget(c.ranges[0].from, c.ranges[c.ranges.length - 1].to) }));
      },
      async get(input: { id: string }): Promise<ChangeInfo | null> {
        return (await documentApi.trackChanges.list()).find((c) => c.id === input.id) ?? null;
      },
      /** Accept or reject one change (`target: { id }`) or every change (`target: 'all'`). */
      async decide(input: { decision: 'accept' | 'reject'; target: { id: string } | 'all' }): Promise<Receipt> {
        const ed = rt().editor;
        const all = ed.trackedChanges();
        const list = input.target === 'all' ? all : all.filter((c) => c.id === (input.target as { id: string }).id);
        if (!list.length) return failed('trackChanges.decide', 'No matching tracked change.');
        ed.decideChanges(list, input.decision === 'accept');
        if (input.target === 'all') r.current?.config.onTrackedChangesBulkDecision?.({ decision: input.decision, count: list.length });
        return { status: 'applied', operation: 'trackChanges.decide', detail: `${list.length} change(s) ${input.decision}ed`, revision: revision() };
      },
    },
    fields: {
      async list() {
        return rt().editor.fields().map((f) => ({ name: f.name, tag: f.tag, alias: f.alias, value: f.value, occurrences: f.ranges.length }));
      },
      async set(input: { name: string; value: string }): Promise<Receipt> {
        const ok = rt().editor.setFieldValue(input.name, input.value);
        if (!ok) return failed('fields.set', `No field named ${input.name}.`);
        return { status: 'applied', operation: 'fields.set', revision: revision() };
      },
      async insert(input: { name?: string; value?: string; target?: Target } = {}): Promise<Receipt & { name?: string }> {
        if (input.target) {
          const why = stale(input.target);
          if (why) return failed('fields.insert', why);
        }
        const name = rt().editor.insertField({ name: input.name, value: input.value, at: input.target?.from });
        if (!name) return failed('fields.insert', 'A field cannot be inserted here.');
        return { status: 'applied', operation: 'fields.insert', revision: revision(), name };
      },
    },
  };
  return documentApi;
}

export type DocumentApi = ReturnType<typeof createDocumentApi>;

/** The editor handle passed to onEditorCreate (also the instance's `activeEditor`). */
export interface ActiveEditor {
  doc: DocumentApi;
  commands: Record<string, (...args: never[]) => boolean>;
  getText(): string;
  focus(): void;
  native: DocxEditor;
}

function activeEditorOf(r: Runtime): ActiveEditor {
  const ed = r.host.editor;
  const v = () => ed.activeView;
  return {
    doc: r.doc,
    native: ed,
    getText: () => r.doc.getText(),
    focus: () => ed.focus(),
    commands: {
      toggleBold: () => ed.runAction('bold'),
      toggleItalic: () => ed.runAction('italic'),
      toggleUnderline: () => ed.runAction('underline'),
      toggleStrike: () => ed.runAction('strike'),
      undo: () => ed.undo(),
      redo: () => ed.redo(),
      setFontFamily: ((name: string) => setFontFamily(v(), name)) as never,
      setFontSize: ((pt: number) => setFontSize(v(), pt)) as never,
      setColor: ((hex: string | null) => setTextColor(v(), hex)) as never,
      setHighlight: ((hex: string | null) => setHighlight(v(), hex ? `#${hex.replace('#', '')}` : null)) as never,
      setTextAlign: ((a: 'left' | 'center' | 'right' | 'justify') => setAlignment(v(), a === 'justify' ? 'both' : a)) as never,
      toggleBulletList: () => toggleList(v(), ed.docx, 'bullet'),
      toggleOrderedList: () => toggleList(v(), ed.docx, 'ordered'),
      insertTable: ((rows = 3, cols = 3) => insertTable(v(), ed.docx, rows, cols)) as never,
      setLink: ((href: string, text?: string) => applyLink(v(), ed.docx, href, text)) as never,
      insertComment: ((text: string) => !!ed.addComment(text)) as never,
    },
  };
}

// -----------------------------------------------------------------------------------------------
// Marginline

const EVENTS = ['ready', 'editorCreate', 'editorUpdate', 'zoomChange', 'documentModeChange', 'commentsUpdate', 'trackedChangesUpdate', 'fieldsUpdate', 'selectionUpdate', 'contentError', 'exception'] as const;
export type MarginlineEvent = (typeof EVENTS)[number];

export class Marginline {
  readonly config: MarginlineConfig;
  readonly doc: DocumentApi;
  /** @internal The editor and interface this instance drives. */
  readonly host: MarginlineHost;
  private readonly rt: Runtime;
  private listeners = new Map<string, Set<Listener>>();
  private history: { type: string; at: string }[] = [];
  private offs: (() => void)[] = [];
  /** Resolves when the configured document has opened. */
  readonly ready: Promise<Marginline>;

  readonly toolbar = {
    addButton: (b: CustomButton) => this.host.controls.addButton(b),
    removeButton: (id: string) => this.host.controls.removeButton(id),
  };

  readonly ui = {
    openPanel: (tab: 'review' | 'fields' = 'review') => {
      this.host.controls.setPanelTab(tab);
      this.host.controls.setPanelOpen(true);
    },
    closePanel: () => this.host.controls.setPanelOpen(false),
    setTheme: (theme: 'modern' | 'docs' | 'word' | 'blueprint') => this.host.controls.setTheme(theme),
    setColorScheme: (scheme: 'system' | 'light' | 'dark') => this.host.controls.setScheme(scheme),
    toast: (message: string) => this.host.controls.toast(message),
    /**
     * Open a document as the Upload button does, with the same messages when it cannot be read; the
     * file picker when no source is given.
     */
    open: async (source?: DocumentSource, name?: string): Promise<void> => {
      const { controls, files } = this.host;
      if (controls.open) await controls.open(source, name);
      else if (source) await this.replaceFile(source, name);
      else files.open();
    },
  };

  readonly diagnostics = {
    getSnapshot: () => ({ events: [...this.history] }),
    clear: () => {
      this.history = [];
    },
  };

  /**
   * Drive an editor: the one in `host`, else the one `config.selector` points at, else the page's.
   * Creating another instance for the same editor stops this one receiving events.
   */
  constructor(config: MarginlineConfig = {}, host?: MarginlineHost) {
    this.config = { ...config };
    const h = host ?? hostFor(config.selector);
    if (!h) throw new Error('The editor is not ready yet.');
    this.host = h;
    this.rt = runtimeOf(h);
    this.doc = this.rt.doc;
    if (this.rt.current && this.rt.current !== this) this.rt.current.detach();
    this.rt.current = this;
    const ed = h.editor;
    const emit = (type: MarginlineEvent, payload: unknown) => this.emit(type, payload);
    this.offs.push(
      ed.on('zoom', (e) => emit('zoomChange', { zoom: Math.round(e.zoom * 100) })),
      ed.on('editMode', (e) => emit('documentModeChange', { documentMode: e.mode })),
      ed.on('comments', () => {
        const comments = commentInfos(ed);
        emit('commentsUpdate', { type: 'update', comments });
        this.config.onCommentsUpdate?.({ type: 'update', comments });
      }),
      ed.on('trackedChanges', () => emit('trackedChangesUpdate', { changes: ed.trackedChanges().length })),
      ed.on('fields', () => emit('fieldsUpdate', {})),
      ed.on('change', () => {
        const editor = activeEditorOf(this.rt);
        emit('editorUpdate', { editor });
        this.config.onEditorUpdate?.({ editor });
      }),
      ed.on('selection', () => emit('selectionUpdate', {})),
      ed.on('error', (e) => {
        const error = new Error(e.message);
        emit('exception', { error });
        this.config.onException?.({ error });
      }),
    );
    if (config.user?.name) h.controls.setUser({ name: config.user.name, email: config.user.email ?? '' });
    this.ready = this.start();
  }

  private async start(): Promise<Marginline> {
    const ed = this.host.editor;
    if (this.config.document) {
      const { source, name } = documentOf(this.config.document);
      if (source) {
        const result = await this.replaceDocument(source, name);
        if (!result.ok) {
          const error = new Error(result.detail ?? 'Could not open the document.');
          this.emit('contentError', { error });
          this.config.onContentError?.({ error });
        }
      }
    }
    if (this.config.documentMode) ed.setEditMode(this.config.documentMode);
    if (this.config.viewing) ed.setViewingOptions(this.config.viewing);
    if (this.config.title) ed.fileName = this.config.title;
    const editor = activeEditorOf(this.rt);
    this.emit('editorCreate', { editor });
    this.config.onEditorCreate?.({ editor });
    this.emit('ready', { marginline: this });
    this.config.onReady?.({ marginline: this });
    return this;
  }

  get activeEditor(): ActiveEditor {
    return activeEditorOf(this.rt);
  }

  /** The current document mode: editing, suggesting or viewing. */
  get documentMode(): EditMode {
    return this.host.editor.editMode;
  }

  setDocumentMode(mode: EditMode) {
    if (!['editing', 'suggesting', 'viewing'].includes(mode)) throw new Error(`Unknown document mode ${mode}`);
    this.host.editor.setEditMode(mode);
  }

  setViewingOptions(opts: { trackedChanges?: TrackedChangesView; comments?: boolean }) {
    this.host.editor.setViewingOptions(opts);
  }

  /** Zoom in percent (100 = actual size). */
  setZoom(percent: number) {
    this.host.editor.setZoom(percent / 100);
  }

  get zoom(): number {
    return Math.round(this.host.editor.zoom * 100);
  }

  /** Whether the document has changes that were not downloaded or shared. */
  get dirty(): boolean {
    return this.host.editor.dirty;
  }

  get user(): UserInfo {
    return { name: this.host.editor.author, email: '' };
  }

  setUser(user: { name: string; email?: string }) {
    this.host.controls.setUser({ name: user.name, email: user.email ?? '' });
  }

  on(event: MarginlineEvent, fn: Listener) {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(fn);
    return this;
  }

  off(event: MarginlineEvent, fn: Listener) {
    this.listeners.get(event)?.delete(fn);
    return this;
  }

  once(event: MarginlineEvent, fn: Listener) {
    const wrap: Listener = (p) => {
      this.off(event, wrap);
      fn(p);
    };
    return this.on(event, wrap);
  }

  private emit(type: MarginlineEvent, payload: unknown) {
    if (this.config.diagnostics?.history?.enabled !== false) {
      this.history.push({ type, at: new Date().toISOString() });
      const max = this.config.diagnostics?.history?.maxEvents ?? 500;
      if (this.history.length > max) this.history.splice(0, this.history.length - max);
    }
    for (const fn of this.listeners.get(type) ?? []) {
      try {
        fn(payload);
      } catch (e) {
        console.error(e);
      }
    }
  }

  /**
   * Export the document. Resolves to the Blob (or an array of Blobs for several types) and
   * downloads it unless `triggerDownload: false`.
   */
  async export(opts: ExportOptions = {}): Promise<Blob | Blob[]> {
    const ed = this.host.editor;
    const types = opts.exportType?.length ? opts.exportType : ['docx'];
    const base = (opts.exportedName ?? ed.fileName).replace(/\.(docx|pdf)$/i, '');
    const blobs: Blob[] = [];
    for (const type of types) {
      let blob: Blob;
      if (type === 'pdf') {
        const { exportPdf } = await import('../pdf/exportPdf');
        blob = new Blob([(await exportPdf(ed)) as BlobPart], { type: 'application/pdf' });
      } else {
        const bytes = opts.commentsType === 'clean' ? ed.exportDocx({ comments: 'none' }) : ed.exportDocx();
        blob = new Blob([bytes as BlobPart], { type: DOCX_MIME });
      }
      if (opts.triggerDownload !== false) downloadBlob(blob, `${base}.${type}`);
      blobs.push(blob);
    }
    if (types.includes('docx') && opts.triggerDownload !== false && opts.commentsType !== 'clean') ed.markSaved();
    return blobs.length === 1 ? blobs[0] : blobs;
  }

  /** Open another DOCX in the editor. */
  async replaceDocument(src: DocumentSource, name?: string): Promise<{ ok: boolean; reason?: string; detail?: string }> {
    try {
      const { bytes, name: srcName } = await toBytes(src);
      this.host.editor.load(bytes, name ?? srcName ?? 'Document.docx');
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: 'open-failed', detail: (e as Error).message };
    }
  }

  /** Same as replaceDocument; throws on failure. */
  async replaceFile(src: DocumentSource, name?: string): Promise<void> {
    const r = await this.replaceDocument(src, name);
    if (!r.ok) throw new Error(r.detail ?? 'Could not open the document.');
  }

  /** Stop delivering events to this instance. */
  detach() {
    for (const off of this.offs) off();
    this.offs = [];
    this.listeners.clear();
    if (this.rt.current === this) this.rt.current = null;
  }

  destroy() {
    this.detach();
  }
}

interface PageGlobals {
  Marginline?: typeof Marginline;
  marginline?: Marginline;
  docxEditor?: DocxEditor;
}

/**
 * Make `ml`'s editor the page's: install window.Marginline (the class, whose instances drive this
 * editor by default), window.marginline (`ml`) and window.docxEditor. Returns the function that
 * removes them again.
 */
export function installPageApi(ml: Marginline): () => void {
  const host = ml.host;
  pageHost = host;
  const w = window as unknown as PageGlobals;
  w.docxEditor = host.editor;
  w.Marginline = Marginline;
  w.marginline = ml;
  return () => {
    if (pageHost === host) pageHost = null;
    if (w.marginline !== ml) return;
    delete w.marginline;
    delete w.docxEditor;
  };
}
