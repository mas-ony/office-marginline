import type { CursorProps } from '../editor/cursorProps';
import type { DocxEditor, EditMode, Stream, ViewingOptions } from '../editor/DocxEditor';
import type { ViewMode } from '../editor/layout/layout';

export interface EditorSnapshot {
  version: number;
  fileName: string;
  dirty: boolean;
  cursor: CursorProps | null;
  pageIndex: number;
  pageCount: number;
  pageLabel: string;
  zoom: number;
  editMode: EditMode;
  viewing: ViewingOptions;
  viewMode: ViewMode;
  stream: Stream;
  streamLabel: string;
  search: { query: string; count: number; index: number };
  commentsVersion: number;
  changesVersion: number;
  fieldsVersion: number;
  stylesVersion: number;
  layoutVersion: number;
  canUndo: boolean;
  canRedo: boolean;
  painter: boolean;
  activeComment: string | null;
  /** Review items that came with the opened file ("comment:<id>", "change:<type>:<id>"). */
  imported: ReadonlySet<string>;
}

function importedKeys(editor: DocxEditor): Set<string> {
  const keys = new Set<string>();
  for (const c of editor.comments()) keys.add(`comment:${c.id}`);
  for (const c of editor.trackedChanges()) keys.add(`change:${c.type}:${c.id}`);
  return keys;
}

/** DocxEditor events as one immutable snapshot, for the React and Vue interfaces to render from. */
export class EditorStore {
  private snapshot: EditorSnapshot;
  private subs = new Set<() => void>();
  private disposers: (() => void)[] = [];

  constructor(readonly editor: DocxEditor) {
    this.snapshot = {
      version: 0,
      fileName: editor.fileName,
      dirty: editor.dirty,
      cursor: null,
      pageIndex: 0,
      pageCount: 1,
      pageLabel: '1',
      zoom: editor.zoom,
      editMode: editor.editMode,
      viewing: editor.viewingOptions,
      viewMode: editor.viewMode,
      stream: 'body',
      streamLabel: '',
      search: { query: '', count: 0, index: -1 },
      commentsVersion: 0,
      changesVersion: 0,
      fieldsVersion: 0,
      stylesVersion: 0,
      layoutVersion: 0,
      canUndo: false,
      canRedo: false,
      painter: false,
      activeComment: null,
      imported: new Set(),
    };
    const on = editor.on.bind(editor);
    const bump = (key: 'commentsVersion' | 'changesVersion' | 'fieldsVersion') => () => this.set({ [key]: this.snapshot[key] + 1 } as Partial<EditorSnapshot>);
    this.disposers.push(
      on('load', (e) => this.set({
        fileName: e.fileName,
        dirty: false,
        stylesVersion: this.snapshot.stylesVersion + 1,
        commentsVersion: this.snapshot.commentsVersion + 1,
        changesVersion: this.snapshot.changesVersion + 1,
        fieldsVersion: this.snapshot.fieldsVersion + 1,
        editMode: editor.editMode,
        imported: importedKeys(editor),
      })),
      on('change', (e) => this.set({ dirty: e.dirty, fileName: editor.fileName })),
      on('rename', (e) => this.set({ fileName: e.fileName })),
      on('selection', (cursor) => this.set({
        cursor,
        stylesVersion: editor.docx.styles.version,
        canUndo: editor.canUndo,
        canRedo: editor.canRedo,
        activeComment: editor.activeComment,
      })),
      on('page', (e) => this.set({ pageIndex: e.index, pageCount: e.count, pageLabel: e.label })),
      on('layout', (e) => this.set({ pageCount: Math.max(1, e.pages.length), layoutVersion: this.snapshot.layoutVersion + 1 })),
      on('zoom', (e) => this.set({ zoom: e.zoom })),
      on('editMode', (e) => this.set({ editMode: e.mode, canUndo: editor.canUndo, canRedo: editor.canRedo })),
      on('viewing', (v) => this.set({ viewing: v })),
      on('viewMode', (e) => this.set({ viewMode: e.mode })),
      on('stream', (e) => this.set({ stream: e.stream, streamLabel: e.label ?? '' })),
      on('search', (e) => this.set({ search: e })),
      on('comments', bump('commentsVersion')),
      on('trackedChanges', bump('changesVersion')),
      on('fields', bump('fieldsVersion')),
      on('formatPainter', (e) => this.set({ painter: e.active })),
    );
  }

  set(patch: Partial<EditorSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch, version: this.snapshot.version + 1 };
    for (const fn of this.subs) fn();
  }

  subscribe = (fn: () => void) => {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  };

  getSnapshot = () => this.snapshot;

  dispose() {
    for (const d of this.disposers) d();
  }
}
