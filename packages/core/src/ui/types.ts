import type { Marginline } from '../api/marginline';
import type { DocumentInput, DocumentSource } from '../api/source';
import type { CollabState } from '../collab/session';
import type { EditMode, TrackedChangesView } from '../editor/DocxEditor';

export type { DocumentInput, DocumentSource };

export interface FileActions {
  newDocument(): void;
  /** "Upload DOCX": pick a file from the device. */
  open(): void;
  openExample(id: string): void;
  downloadDocx(): void;
  exportPdf(): Promise<void>;
  print(): void;
  /** System share sheet with the DOCX (only where the browser supports sharing files). */
  share?: () => void;
}

export type SidePanelTab = 'review' | 'fields';
export type ModalName = 'customize' | 'share' | 'bookmark' | 'crossRef' | 'note' | 'shortcuts' | 'user' | 'pdf' | null;
export type ThemeName = 'modern' | 'docs' | 'word' | 'blueprint';
export type ColorScheme = 'system' | 'light' | 'dark';

export interface UserInfo {
  name: string;
  email: string;
}

/** A toolbar button added through the page API (marginline.toolbar.addButton). */
export interface CustomButton {
  id: string;
  label: string;
  /** Short text or emoji shown on the button. */
  text: string;
  onClick: () => void;
}

/** A document offered in the Examples menu. */
export interface Example {
  id: string;
  label: string;
  /** Where the DOCX is fetched from. */
  url: string;
  description?: string;
  /** File name shown after opening; the last part of `url` by default. */
  name?: string;
}

/** Hooks the page API uses to drive the interface. */
export interface UIControls {
  setPanelOpen(open: boolean): void;
  setPanelTab(tab: SidePanelTab): void;
  setTheme(theme: ThemeName): void;
  setScheme(scheme: ColorScheme): void;
  setUser(user: UserInfo): void;
  addButton(b: CustomButton): void;
  removeButton(id: string): void;
  toast(message: string): void;
  /** Join a shared session by room id. */
  joinRoom(room: string): Promise<void>;
  /** Open a document as the Upload button does (the file picker when no source is given). */
  open?(source?: DocumentSource, name?: string): Promise<void>;
}

/** Options of the MarginlineEditor components (React and Vue) and of mount(). */
export interface MarginlineOptions {
  /** Opened at start, and again whenever it changes. */
  document?: DocumentInput;
  documentMode?: EditMode;
  /** Shown on comments and tracked changes. */
  user?: { name: string; email?: string };
  viewing?: { trackedChanges?: TrackedChangesView; comments?: boolean };
  /** Document name, replacing the file name. */
  title?: string;
  theme?: ThemeName;
  colorScheme?: ColorScheme;
  /** Documents for the Examples menu; without any, the menu is not shown. */
  examples?: Example[];
  /** Keeps the theme, appearance, ruler and the user's name in localStorage under `<storageKey>-…`. */
  storageKey?: string;
  /** Keeps unsaved changes in an IndexedDB database of this name and offers to recover them. */
  autosave?: string;
  /** With `autosave`: offer recovery when the editor starts without a document or room (default true). */
  offerRecovery?: boolean;
  /** Base URL of the sharing relay (default `/collab`, served by @marginline/relay). */
  relay?: string;
  /** Link that opens a shared document; by default this page with `?room=<id>`. */
  shareLink?: (room: string) => string;
  /** Join this shared document at start. */
  room?: string;
  /** Replace some of the built-in file actions (Upload, Export, Print…). */
  files?: Partial<FileActions>;
  /** Handle Ctrl+F and Ctrl+Shift+E anywhere on the page, not only inside the editor. */
  globalShortcuts?: boolean;
  /** Called once the editor is ready and the initial document (or room) has opened. */
  onReady?: (marginline: Marginline) => void;
  /** Called when the reader changes their name in the interface. */
  onUserChange?: (user: UserInfo) => void;
  /** Called when the reader picks another theme in Customize. */
  onThemeChange?: (theme: ThemeName) => void;
  /** Called when the reader picks another appearance in Customize. */
  onColorSchemeChange?: (scheme: ColorScheme) => void;
}

/** State of the interface around the editor. */
export interface UIState {
  mobile: boolean;
  panelOpen: boolean;
  panelTab: SidePanelTab;
  /** The new-comment composer, anchored at the selection it was opened for. */
  composerRange: { from: number; to: number } | null;
  findOpen: boolean;
  findReplace: boolean;
  rulerOn: boolean;
  modal: ModalName;
  modalData: Record<string, unknown>;
  toast: string | null;
  /** A message that stays until dismissed (a file that could not be opened). */
  notice: string | null;
  /** Unsaved work found by autosave, offered for recovery. */
  restore: { fileName: string; savedAt: number } | null;
  user: UserInfo;
  theme: ThemeName;
  scheme: ColorScheme;
  /** The appearance in effect (scheme 'system' follows the device). */
  dark: boolean;
  customButtons: CustomButton[];
  /** The link form at the caret (Ctrl+K). */
  linkAtCaret: boolean;
  /** The Options menu of the header or footer being edited, under its bar's button. */
  hfMenu: { at: { x: number; y: number }; pageIndex: number } | null;
  /** The shared editing session, when there is one. */
  collab: CollabState | null;
  /** The initial document (or room) has opened and the page API instance is available. */
  ready: boolean;
}

/** Font families offered by the toolbar (each shown in its own face). */
export const FONT_FAMILIES = ['Aptos', 'Arial', 'Calibri', 'Cambria', 'Courier New', 'Georgia', 'Times New Roman', 'Verdana'];

export const FONT_SIZES = [8, 9, 10, 11, 12, 14, 18, 24, 30, 36, 48, 60, 72, 96];

export const ZOOM_LEVELS = [50, 75, 90, 100, 125, 150, 200];

export const LINE_HEIGHTS = [1, 1.15, 1.5, 2, 2.5, 3];

export const THEME_NAMES: ThemeName[] = ['modern', 'docs', 'word', 'blueprint'];

export const COLOR_SCHEMES: ColorScheme[] = ['system', 'light', 'dark'];

/** Drag data type used when dropping a new field onto the page. */
export const FIELD_DRAG_TYPE = 'application/x-marginline-field';
