import type {
  CollabState,
  ColorScheme,
  CustomButton,
  DocxEditor,
  EditorStore,
  Example,
  FileActions,
  Marginline,
  MarginlineUI,
  ModalName,
  SidePanelTab,
  ThemeName,
  UserInfo,
} from '@marginline/core';
import { createContext, useContext } from 'react';

export interface UIContextValue {
  ui: MarginlineUI;
  editor: DocxEditor;
  store: EditorStore;
  /** Where menus, dialogs and messages are rendered (on the page's body). */
  layer: HTMLElement;
  mobile: boolean;
  panelOpen: boolean;
  setPanelOpen(open: boolean): void;
  panelTab: SidePanelTab;
  setPanelTab(tab: SidePanelTab): void;
  /** The new-comment composer, anchored at the selection it was opened for. */
  composerOpen: boolean;
  composerRange: { from: number; to: number } | null;
  openComposer(): void;
  closeComposer(): void;
  findOpen: boolean;
  setFindOpen(open: boolean, replace?: boolean): void;
  findReplace: boolean;
  rulerOn: boolean;
  setRulerOn(on: boolean): void;
  modal: ModalName;
  modalData: Record<string, unknown>;
  openModal(m: ModalName, data?: Record<string, unknown>): void;
  toast(message: string): void;
  files: FileActions;
  examples: Example[];
  user: UserInfo;
  setUser(u: UserInfo): void;
  theme: ThemeName;
  setTheme(t: ThemeName): void;
  scheme: ColorScheme;
  setScheme(s: ColorScheme): void;
  customButtons: CustomButton[];
  /** The shared editing session, when there is one. */
  collab: CollabState | null;
  startSharing(): Promise<void>;
  stopSharing(): void;
  /** The page API instance for this editor, once it is ready. */
  api: Marginline | null;
}

export const UIContext = createContext<UIContextValue | null>(null);

export function useUI(): UIContextValue {
  const v = useContext(UIContext);
  if (!v) throw new Error('UIContext missing');
  return v;
}
