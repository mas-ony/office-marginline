/**
 * The interface around a DocxEditor without its views: the state the React and Vue interfaces
 * render, the actions their controls call, and the behaviour that needs no view (editor requests,
 * shortcuts, file actions, autosave, sharing, phone layout). A view creates one, renders from
 * `state`, calls `attach()` once its elements exist and `detach()` when it goes away.
 */
import { Marginline, type MarginlineHost, registerHost } from '../api/marginline';
import { type DocumentInput, type DocumentSource, documentOf, DOCX_MIME, downloadBlob, nameOfUrl } from '../api/source';
import { type CollabOptions, CollabSession } from '../collab/session';
import { wordAt } from '../editor/commands';
import { DocxEditor } from '../editor/DocxEditor';
import { type AutosaveRecord, clearAutosave, loadAutosave, saveAutosave } from './autosave';
import { matchesMedia, MOBILE_QUERY, watchMedia } from './dom';
import { EditorStore } from './store';
import {
  type ColorScheme,
  COLOR_SCHEMES,
  type CustomButton,
  FIELD_DRAG_TYPE,
  type FileActions,
  type MarginlineOptions,
  type ModalName,
  type SidePanelTab,
  THEME_NAMES,
  type ThemeName,
  type UIControls,
  type UIState,
  type UserInfo,
} from './types';

export const DISCARD_PROMPT = 'Discard unsaved changes to the current document?';

const DARK_QUERY = '(prefers-color-scheme: dark)';
const RECOVERY_MS = 1000 * 60 * 60 * 24 * 14;
const AUTOSAVE_DELAY = 2000;
const TOAST_MS = 3500;
const OPEN_ACCEPT = `.docx,.dotx,${DOCX_MIME}`;

interface FilePickerWindow {
  showOpenFilePicker?: (opts: unknown) => Promise<FileSystemFileHandle[]>;
}

const pickerTypes = [{ description: 'Word document', accept: { [DOCX_MIME]: ['.docx', '.dotx'] } }];

function load<T extends string>(key: string | undefined, fallback: T, allowed: readonly T[]): T {
  if (!key) return fallback;
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string | undefined, value: string) {
  if (!key) return;
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage is optional.
  }
}

function loadUser(key: string | undefined): UserInfo | null {
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const u = JSON.parse(raw) as UserInfo;
      if (u?.name) return { name: u.name, email: u.email ?? '' };
    }
  } catch {
    // Fall through to a generated name.
  }
  return null;
}

function describeError(e: unknown, name: string): string {
  const msg = (e as Error)?.message ?? String(e);
  if (/\.doc$/i.test(name)) return `“${name}” is a legacy Word 97-2003 file. Save it as .docx and open it again.`;
  return `Could not open “${name}”: ${msg}`;
}

const isDark = (scheme: ColorScheme) => scheme === 'dark' || (scheme === 'system' && matchesMedia(DARK_QUERY));

function sameDocument(a: DocumentInput | undefined, b: DocumentInput | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const x = documentOf(a);
  const y = documentOf(b);
  return x.source === y.source && x.name === y.name;
}

type Patch = Partial<UIState>;

/** Classes of the interface's root element: the theme, the appearance and the phone layout. */
export function rootClassOf(state: Pick<UIState, 'theme' | 'dark' | 'mobile'>): string {
  return ['ml-app', `theme-${state.theme}`, state.dark && 'is-dark', state.mobile && 'is-mobile'].filter(Boolean).join(' ');
}

export class MarginlineUI implements UIControls {
  options: MarginlineOptions;
  state: UIState;
  /** The editor while attached. */
  editor: DocxEditor | null = null;
  store: EditorStore | null = null;
  /**
   * Container on the page's body for menus, dialogs and messages, so that they overlay everything;
   * it carries the theme classes of the interface. Created by attach().
   */
  layer: HTMLDivElement | null = null;
  /** The page API instance for this editor, from the time the interface is ready. */
  api: Marginline | null = null;
  readonly files: FileActions;
  private listeners = new Set<() => void>();
  private offs: (() => void)[] = [];
  private root: HTMLElement | null = null;
  private input: HTMLInputElement | null = null;
  private hostRef: MarginlineHost | null = null;
  private session: CollabSession | null = null;
  private recovery: AutosaveRecord | null = null;
  private autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private shareSupported: boolean | null = null;

  constructor(options: MarginlineOptions = {}) {
    this.options = { ...options };
    const key = options.storageKey;
    const mobile = matchesMedia(MOBILE_QUERY);
    const scheme = options.colorScheme ?? load(key && `${key}-scheme`, 'system', COLOR_SCHEMES);
    const user = options.user ? { name: options.user.name, email: options.user.email ?? '' } : loadUser(key && `${key}-user`) ?? { name: `Reviewer ${1000 + Math.floor(Math.random() * 9000)}`, email: '' };
    this.state = {
      mobile,
      panelOpen: !mobile && typeof window !== 'undefined' && window.innerWidth >= 1100,
      panelTab: 'review',
      composerRange: null,
      findOpen: false,
      findReplace: false,
      rulerOn: load(key && `${key}-ruler`, 'off', ['on', 'off']) === 'on',
      modal: null,
      modalData: {},
      toast: null,
      notice: null,
      restore: null,
      user,
      theme: options.theme ?? load(key && `${key}-theme`, 'modern', THEME_NAMES),
      scheme,
      dark: isDark(scheme),
      customButtons: [],
      linkAtCaret: false,
      hfMenu: null,
      collab: null,
      ready: false,
    };
    this.files = this.makeFiles();
  }

  // ---------------------------------------------------------------------------------------------
  // State

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getState = (): UIState => this.state;

  set(patch: Patch) {
    const keys = Object.keys(patch) as (keyof UIState)[];
    if (keys.every((k) => Object.is(this.state[k], patch[k]))) return;
    this.state = { ...this.state, ...patch };
    this.updateLayer();
    this.notify();
  }

  private notify() {
    for (const fn of [...this.listeners]) fn();
  }

  private updateLayer() {
    if (this.layer) this.layer.className = rootClassOf(this.state).replace('ml-app', 'ml-layer');
  }

  /** Whether a node belongs to this interface (its root or its layer). */
  contains(node: Node | null): boolean {
    return !!node && (!!this.root?.contains(node) || !!this.layer?.contains(node));
  }

  // ---------------------------------------------------------------------------------------------
  // Actions

  setPanelOpen = (open: boolean) => this.set({ panelOpen: open });

  setPanelTab = (tab: SidePanelTab) => this.set({ panelTab: tab });

  setFindOpen = (open: boolean, replace = false) => this.set({ findOpen: open, findReplace: replace });

  setRulerOn = (on: boolean) => {
    this.set({ rulerOn: on });
    save(this.key('ruler'), on ? 'on' : 'off');
  };

  setLinkAtCaret = (open: boolean) => this.set({ linkAtCaret: open });

  openModal = (modal: ModalName, data: Record<string, unknown> = {}) => this.set({ modal, modalData: data });

  closeModal = () => this.set({ modal: null, modalData: {} });

  toast = (message: string) => {
    this.set({ toast: message });
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.set({ toast: null }), TOAST_MS);
  };

  /** Show a message that stays until dismissed. */
  notice = (message: string | null) => this.set({ notice: message });

  setTheme = (theme: ThemeName) => {
    this.set({ theme });
    save(this.key('theme'), theme);
    this.options.onThemeChange?.(theme);
  };

  setScheme = (scheme: ColorScheme) => {
    this.set({ scheme, dark: isDark(scheme) });
    save(this.key('scheme'), scheme);
    this.options.onColorSchemeChange?.(scheme);
  };

  setUser = (user: UserInfo) => {
    this.applyUser(user);
    this.saveUser();
    this.options.onUserChange?.(user);
  };

  addButton = (b: CustomButton) => this.set({ customButtons: [...this.state.customButtons.filter((x) => x.id !== b.id), b] });

  removeButton = (id: string) => this.set({ customButtons: this.state.customButtons.filter((x) => x.id !== id) });

  /** The new-comment composer for the selection (or the word at the caret). */
  openComposer = () => {
    const ed = this.editor;
    if (!ed || ed.readOnly) return;
    if (ed.activeStream !== 'body') ed.exitHeaderFooter(false);
    const { state } = ed.view;
    const range = state.selection.empty ? wordAt(state, state.selection.from) : { from: state.selection.from, to: state.selection.to };
    if (!range || range.from === range.to) {
      this.toast('Select the text you want to comment on.');
      return;
    }
    this.set({ composerRange: range, panelTab: 'review', ...(this.state.mobile ? {} : { panelOpen: true }) });
  };

  closeComposer = () => this.set({ composerRange: null });

  closeHeaderFooterMenu = () => this.set({ hfMenu: null });

  /** Open the unsaved work autosave found. */
  recover = () => {
    const r = this.recovery;
    if (r) this.openBytes(r.bytes, r.fileName);
  };

  discardRecovery = () => {
    this.recovery = null;
    this.set({ restore: null });
    if (this.options.autosave) void clearAutosave(this.options.autosave);
  };

  /** Ask before replacing a document with unsaved changes. */
  confirmDiscard = (): boolean => !this.editor?.dirty || window.confirm(DISCARD_PROMPT);

  // ---------------------------------------------------------------------------------------------
  // Opening documents

  /** Open a document: a URL, a File or Blob, or the bytes; the file picker when no source is given. */
  open = async (source?: DocumentSource, name?: string): Promise<void> => {
    if (source === undefined) {
      this.files.open();
      return;
    }
    if (typeof source === 'string') {
      await this.openUrl(source, name ?? nameOfUrl(source));
      return;
    }
    let bytes: Uint8Array;
    try {
      bytes = source instanceof Uint8Array ? source : source instanceof ArrayBuffer ? new Uint8Array(source) : new Uint8Array(await source.arrayBuffer());
    } catch (e) {
      this.notice(`Could not open the file: ${(e as Error).message}`);
      return;
    }
    this.openBytes(bytes, name ?? (source as File).name ?? 'Document.docx');
  };

  openBytes(bytes: Uint8Array, name: string): boolean {
    const ed = this.editor;
    if (!ed) return false;
    try {
      ed.load(bytes, name);
      this.recovery = null;
      this.set({ restore: null });
      if (this.options.autosave) void clearAutosave(this.options.autosave);
      return true;
    } catch (e) {
      this.notice(describeError(e, name));
      return false;
    }
  }

  async openUrl(url: string, name: string): Promise<void> {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      this.openBytes(new Uint8Array(await r.arrayBuffer()), name);
    } catch (e) {
      this.notice(`Could not load ${name}: ${(e as Error).message}`);
    }
  }

  private async openDocument(input: DocumentInput) {
    const { source, name } = documentOf(input);
    if (source !== undefined) await this.open(source, name);
  }

  /** The document mode, viewing options and title from the options. */
  private applyDocumentOptions() {
    const ed = this.editor;
    const o = this.options;
    if (!ed) return;
    if (o.documentMode) ed.setEditMode(o.documentMode);
    if (o.viewing) ed.setViewingOptions(o.viewing);
    if (o.title) ed.fileName = o.title;
  }

  private async offerRecovery() {
    const db = this.options.autosave;
    const ed = this.editor;
    if (!db || this.options.offerRecovery === false) return;
    const rec = await loadAutosave(db);
    if (this.editor !== ed || !rec || Date.now() - rec.savedAt >= RECOVERY_MS) return;
    this.recovery = rec;
    this.set({ restore: { fileName: rec.fileName, savedAt: rec.savedAt } });
  }

  // ---------------------------------------------------------------------------------------------
  // Files

  private makeFiles(): FileActions {
    const pick = <K extends Exclude<keyof FileActions, 'share'>>(k: K): FileActions[K] => this.options.files?.[k] ?? this.builtinFiles[k];
    const files: FileActions = {
      newDocument: () => pick('newDocument')(),
      open: () => pick('open')(),
      openExample: (id) => pick('openExample')(id),
      downloadDocx: () => pick('downloadDocx')(),
      exportPdf: () => pick('exportPdf')(),
      print: () => pick('print')(),
    };
    // Only where the browser can share files (or the share action was replaced).
    Object.defineProperty(files, 'share', { enumerable: true, get: () => this.options.files?.share ?? (this.canShare() ? this.builtinFiles.share : undefined) });
    return files;
  }

  private canShare(): boolean {
    if (this.shareSupported === null) {
      try {
        this.shareSupported = typeof navigator !== 'undefined' && !!navigator.canShare && navigator.canShare({ files: [new File([new Uint8Array(1)], 'x.docx', { type: DOCX_MIME })] });
      } catch {
        this.shareSupported = false;
      }
    }
    return this.shareSupported;
  }

  private afterSave(ed: DocxEditor) {
    ed.markSaved();
    if (this.options.autosave) void clearAutosave(this.options.autosave);
  }

  private readonly builtinFiles: FileActions = {
    newDocument: () => {
      if (!this.confirmDiscard()) return;
      this.editor?.newDocument();
    },
    open: async () => {
      if (!this.confirmDiscard()) return;
      const w = window as unknown as FilePickerWindow;
      if (w.showOpenFilePicker) {
        try {
          const [handle] = await w.showOpenFilePicker({ types: pickerTypes, multiple: false });
          const file = await handle.getFile();
          this.openBytes(new Uint8Array(await file.arrayBuffer()), file.name);
        } catch (e) {
          if ((e as DOMException)?.name !== 'AbortError') this.notice(`Could not open the file: ${(e as Error).message}`);
        }
        return;
      }
      this.input?.click();
    },
    openExample: (id) => {
      const ex = this.options.examples?.find((x) => x.id === id);
      if (!ex || !this.confirmDiscard()) return;
      void this.openUrl(ex.url, ex.name ?? nameOfUrl(ex.url));
    },
    downloadDocx: () => {
      const ed = this.editor;
      if (!ed) return;
      downloadBlob(ed.exportBlob(), ed.fileName);
      this.afterSave(ed);
    },
    exportPdf: async () => {
      const ed = this.editor;
      if (!ed) return;
      try {
        const { exportPdf } = await import('../pdf/exportPdf');
        const bytes = await exportPdf(ed);
        downloadBlob(new Blob([bytes as BlobPart], { type: 'application/pdf' }), ed.fileName.replace(/\.docx$/i, '') + '.pdf');
      } catch (e) {
        this.notice(`Could not create the PDF: ${(e as Error).message}`);
      }
    },
    print: () => this.editor?.print(),
    share: async () => {
      const ed = this.editor;
      if (!ed) return;
      try {
        await navigator.share({ files: [new File([ed.exportBlob()], ed.fileName, { type: DOCX_MIME })], title: ed.fileName });
        this.afterSave(ed);
      } catch (e) {
        if ((e as DOMException)?.name !== 'AbortError') this.notice(`Sharing failed: ${(e as Error).message}`);
      }
    },
  };

  // ---------------------------------------------------------------------------------------------
  // Sharing

  private collabOptions(): CollabOptions {
    return { relay: this.options.relay, link: this.options.shareLink };
  }

  /** Share the open document in real time. */
  startSharing = async (): Promise<void> => {
    const ed = this.editor;
    if (!ed || this.session) return;
    const s = await CollabSession.start(ed, { name: this.state.user.name }, (collab) => this.set({ collab }), this.collabOptions());
    if (this.editor !== ed) s.leave();
    else this.session = s;
  };

  stopSharing = () => {
    this.session?.leave();
    this.session = null;
    this.set({ collab: null });
  };

  /** Join a shared document by its room id. */
  joinRoom = async (room: string): Promise<void> => {
    const ed = this.editor;
    if (!ed) return;
    this.session?.leave();
    this.session = null;
    try {
      const s = await CollabSession.join(ed, room, { name: this.state.user.name }, (collab) => this.set({ collab }), this.collabOptions());
      if (this.editor !== ed) {
        s.leave();
        return;
      }
      this.session = s;
      this.toast('Joined the shared document');
    } catch (e) {
      this.toast(`Could not join the shared document: ${(e as Error).message}`);
    }
  };

  // ---------------------------------------------------------------------------------------------
  // Options

  private key(name: string): string | undefined {
    return this.options.storageKey && `${this.options.storageKey}-${name}`;
  }

  private applyUser(user: UserInfo) {
    this.set({ user });
    if (this.editor) this.editor.author = user.name;
    this.session?.setUser({ name: user.name });
  }

  private saveUser() {
    save(this.key('user'), JSON.stringify(this.state.user));
  }

  /** New options from the component's props; documents, modes and appearance follow them. */
  setOptions(next: MarginlineOptions) {
    const prev = this.options;
    this.options = { ...next };
    if (next.theme && next.theme !== prev.theme) this.set({ theme: next.theme });
    if (next.colorScheme && next.colorScheme !== prev.colorScheme) this.set({ scheme: next.colorScheme, dark: isDark(next.colorScheme) });
    if (next.user && (next.user.name !== prev.user?.name || (next.user.email ?? '') !== (prev.user?.email ?? ''))) this.applyUser({ name: next.user.name, email: next.user.email ?? '' });
    const ed = this.editor;
    if (!ed || !this.api) return;
    if (next.documentMode && next.documentMode !== prev.documentMode) ed.setEditMode(next.documentMode);
    if (next.viewing && (next.viewing.trackedChanges !== prev.viewing?.trackedChanges || next.viewing.comments !== prev.viewing?.comments)) ed.setViewingOptions(next.viewing);
    if (next.title && next.title !== prev.title) ed.fileName = next.title;
    if (next.room && next.room !== prev.room) void this.joinRoom(next.room);
    else if (next.document && !sameDocument(next.document, prev.document)) {
      void this.openDocument(next.document).then(() => {
        if (this.editor === ed) this.applyDocumentOptions();
      });
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Lifetime

  /** The editor and interface, for the page API (while attached). */
  get host(): MarginlineHost | null {
    return this.hostRef;
  }

  /**
   * Create the editor in `host` (inside the interface's `root`) and start: open the document or
   * room from the options (or offer to recover unsaved work), then call `onReady`.
   */
  attach(parts: { root: HTMLElement; host: HTMLElement }) {
    if (this.editor) this.detach();
    this.root = parts.root;
    const layer = (this.layer ??= document.createElement('div'));
    this.updateLayer();
    document.body.appendChild(layer);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = OPEN_ACCEPT;
    input.hidden = true;
    input.dataset.testid = 'open-input';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.value = '';
      if (file) void file.arrayBuffer().then((buf) => this.openBytes(new Uint8Array(buf), file.name));
    });
    layer.appendChild(input);
    this.input = input;

    const ed = new DocxEditor(parts.host, { author: this.state.user.name, viewMode: matchesMedia('(max-width: 767px)') ? 'web' : 'print' });
    const store = new EditorStore(ed);
    const host: MarginlineHost = { editor: ed, controls: this, files: this.files };
    this.editor = ed;
    this.store = store;
    this.hostRef = host;
    if (this.options.storageKey && !loadUser(this.key('user'))) this.saveUser();

    // Requests from shortcuts and the engine.
    this.offs.push(
      ed.on('request', (e) => {
        switch (e.action) {
          case 'link': this.setLinkAtCaret(true); break;
          case 'comment': this.openComposer(); break;
          case 'find': this.setFindOpen(true); break;
          case 'replace': this.setFindOpen(true, true); break;
          case 'save': this.files.downloadDocx(); break;
          case 'print': this.files.print(); break;
          case 'editNote': this.openModal('note', { key: e.key }); break;
          case 'headerFooterOptions':
            // The bar's Options button opens the menu, or closes it when it is open.
            if (this.state.hfMenu) this.closeHeaderFooterMenu();
            else if (e.rect) this.set({ hfMenu: { at: { x: e.rect.left, y: e.rect.bottom + 4 }, pageIndex: e.pageIndex ?? 0 } });
            break;
        }
      }),
      ed.on('error', (e) => this.toast(e.message)),
      // Editing another header or footer, or the body again, closes the menu of the previous one.
      ed.on('stream', () => {
        if (this.state.hfMenu) this.closeHeaderFooterMenu();
      }),
      ed.on('load', ({ warnings }) => {
        this.set({ composerRange: null, findOpen: false, hfMenu: null });
        if (warnings.length) console.warn('Import warnings:', warnings);
      }),
      ed.on('change', ({ dirty }) => {
        const db = this.options.autosave;
        if (!dirty || !db) return;
        if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
        this.autosaveTimer = setTimeout(() => {
          try {
            void saveAutosave(db, { fileName: ed.fileName, bytes: ed.exportDocx(), savedAt: Date.now() });
          } catch {
            // Export errors are reported when the user downloads.
          }
        }, AUTOSAVE_DELAY);
      }),
    );

    const keys = (e: KeyboardEvent) => {
      const target = e.target as Node;
      if (e.key === 'Escape' && this.state.mobile && (this.state.panelOpen || this.state.composerRange)) {
        // Escape closes the phone sheets.
        this.set({ panelOpen: false, composerRange: null });
        return;
      }
      if (!this.options.globalShortcuts && !this.contains(target)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        ed.setEditMode(ed.editMode === 'suggesting' ? 'editing' : 'suggesting');
      } else if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f' && !ed.root.contains(target)) {
        e.preventDefault();
        this.setFindOpen(true);
      }
    };
    window.addEventListener('keydown', keys);
    this.offs.push(() => window.removeEventListener('keydown', keys));

    // Drop a new field from the Fields panel onto the page.
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes(FIELD_DRAG_TYPE)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    };
    const drop = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes(FIELD_DRAG_TYPE)) return;
      e.preventDefault();
      e.stopPropagation();
      const hit = ed.view.posAtCoords({ left: e.clientX, top: e.clientY });
      if (hit) ed.insertField({ at: hit.pos });
      ed.focus();
    };
    parts.host.addEventListener('dragover', over, true);
    parts.host.addEventListener('drop', drop, true);
    this.offs.push(() => {
      parts.host.removeEventListener('dragover', over, true);
      parts.host.removeEventListener('drop', drop, true);
    });

    // Phones show the reflowing layout; switching back to a wide window restores pages.
    const applyMobile = (mobile: boolean) => {
      ed.setViewMode(mobile ? 'web' : 'print');
      this.set(mobile ? { mobile, panelOpen: false } : { mobile });
    };
    applyMobile(matchesMedia(MOBILE_QUERY));
    this.offs.push(
      watchMedia(MOBILE_QUERY, applyMobile),
      watchMedia(DARK_QUERY, () => this.set({ dark: isDark(this.state.scheme) })),
      registerHost(parts.root, host),
    );
    this.notify();
    void this.start(ed);
  }

  private async start(ed: DocxEditor) {
    // Let a view that is mounted twice in a row (React's StrictMode) settle first.
    await Promise.resolve();
    if (this.editor !== ed) return;
    const o = this.options;
    if (o.room) await this.joinRoom(o.room);
    else if (o.document) await this.openDocument(o.document);
    else void this.offerRecovery();
    if (this.editor !== ed) return;
    // The page API applies the document mode, viewing options and title.
    const api = new Marginline({ documentMode: o.documentMode, viewing: o.viewing, title: o.title }, this.hostRef!);
    await api.ready;
    if (this.editor !== ed) return;
    this.api = api;
    this.set({ ready: true });
    this.options.onReady?.(api);
  }

  /** Remove the editor and stop listening; attach() may be called again. */
  detach() {
    for (const off of this.offs.splice(0)) off();
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.autosaveTimer = null;
    this.toastTimer = null;
    this.session?.leave();
    this.session = null;
    this.api = null;
    this.store?.dispose();
    this.editor?.destroy();
    this.editor = null;
    this.store = null;
    this.hostRef = null;
    this.root = null;
    this.input?.remove();
    this.input = null;
    this.layer?.remove();
    this.state = { ...this.state, collab: null, composerRange: null, toast: null, linkAtCaret: false, hfMenu: null, ready: false };
  }
}
