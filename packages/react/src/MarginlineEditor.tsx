import {
  caretPanelPosition,
  commentBubblePosition,
  cx,
  dismissOnOutside,
  type DocxEditor,
  type EditorStore,
  type MarginlineOptions,
  MarginlineUI,
  rootClassOf,
  type UIState,
} from '@marginline/core/views';
import { MessageSquarePlus, X } from 'lucide-react';
import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { ContextMenu } from './ContextMenu';
import { Toast } from './controls';
import { UIContext, type UIContextValue, useUI } from './context';
import { Dialogs } from './Dialogs';
import { FindBar } from './FindBar';
import { HeaderBar } from './HeaderBar';
import { HeaderFooterMenu } from './HeaderFooterMenu';
import { ComposerCard } from './review/ReviewPanel';
import { Ruler } from './Ruler';
import { SidePanel } from './SidePanel';
import { useSnapshot } from './store';
import { LinkForm } from './toolbar/tools';
import { Toolbar } from './toolbar/Toolbar';

export interface MarginlineEditorProps extends MarginlineOptions {
  className?: string;
  style?: CSSProperties;
}

/** Fixed-position panel at the caret (used for Ctrl+K). */
function CaretPanel({ editor, onClose, children }: { editor: DocxEditor; onClose: () => void; children: ReactNode }) {
  const { layer } = useUI();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  useLayoutEffect(() => setPos(caretPanelPosition(editor, ref.current)), [editor]);
  useEffect(() => dismissOnOutside(() => ref.current, onClose), [onClose]);
  return createPortal(<div ref={ref} className="ml-ui-popover ml-caret-panel" style={{ position: 'fixed', ...pos }}>{children}</div>, layer);
}

/** The "add comment" bubble beside the page next to a selection. */
function CommentBubble() {
  const { editor, store, openComposer, composerOpen, mobile } = useUI();
  const selected = useSnapshot(store, (s) => !!s.cursor?.textSelected);
  const stream = useSnapshot(store, (s) => s.stream);
  const readOnly = useSnapshot(store, (s) => s.editMode === 'viewing');
  useSnapshot(store, (s) => `${s.version}`);
  const [, tick] = useState(0);
  useEffect(() => {
    const on = () => tick((t) => t + 1);
    editor.scrollEl.addEventListener('scroll', on, { passive: true });
    window.addEventListener('resize', on);
    return () => {
      editor.scrollEl.removeEventListener('scroll', on);
      window.removeEventListener('resize', on);
    };
  }, [editor]);
  if (!selected || stream !== 'body' || readOnly || composerOpen) return null;
  const at = commentBubblePosition(editor, mobile);
  if (!at) return null;
  return (
    <button
      type="button"
      className="ml-comment-bubble"
      style={at}
      aria-label="Add comment"
      title="Add comment"
      data-testid="comment-bubble"
      onMouseDown={(e) => e.preventDefault()}
      onClick={openComposer}
    >
      <MessageSquarePlus size={18} />
    </button>
  );
}

/** "Page 3 of 12" while scrolling. */
function PageIndicator() {
  const { store } = useUI();
  const page = useSnapshot(store, (s) => s.pageIndex);
  const count = useSnapshot(store, (s) => s.pageCount);
  const mode = useSnapshot(store, (s) => s.viewMode);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 1400);
    return () => clearTimeout(t);
  }, [page]);
  if (mode !== 'print' || count < 2) return null;
  return <div className={cx('ml-page-indicator', visible && 'is-visible')} aria-live="polite" data-testid="page-indicator">Page {page + 1} of {count}</div>;
}

function StreamBanner() {
  const { editor, store } = useUI();
  const stream = useSnapshot(store, (s) => s.stream);
  const label = useSnapshot(store, (s) => s.streamLabel);
  if (stream === 'body') return null;
  return (
    <div className="ml-stream" role="status" data-testid="stream-banner">
      Editing {label || stream}
      <button type="button" className="ml-btn is-small" onClick={() => editor.exitHeaderFooter()}>Close {stream}</button>
    </div>
  );
}

function SuggestingBanner() {
  const { store, mobile } = useUI();
  const mode = useSnapshot(store, (s) => s.editMode);
  if (mode === 'editing' || !mobile) return null;
  return <div className={cx('ml-mode-banner', `is-${mode}`)} data-testid="mode-banner">{mode === 'suggesting' ? 'Suggesting: your edits are tracked' : 'Viewing: read only'}</div>;
}

/** Unsaved work found by autosave, and messages that stay until dismissed. */
function Banners({ restore, notice }: { restore: UIState['restore']; notice: string | null }) {
  const { ui, layer } = useUI();
  return createPortal(
    <>
      {restore && (
        <div className="ml-restore" role="alertdialog" aria-label="Recover document" data-testid="restore-banner">
          <span>Recover unsaved changes to “{restore.fileName}” from {new Date(restore.savedAt).toLocaleString()}?</span>
          <button type="button" className="ml-btn is-primary" onClick={ui.recover}>Recover</button>
          <button type="button" className="ml-btn" onClick={ui.discardRecovery}>Discard</button>
        </div>
      )}
      {notice && (
        <div className="ml-notice" role="alert" data-testid="notice">
          <span>{notice}</span>
          <button type="button" className="ml-btn" onClick={() => ui.notice(null)}>OK</button>
        </div>
      )}
    </>,
    layer,
  );
}

/** The complete editor: toolbar, document, review panel, menus and dialogs. */
export function MarginlineEditor({ className, style, ...options }: MarginlineEditorProps) {
  const [ui] = useState(() => new MarginlineUI(options));
  const state = useSyncExternalStore(ui.subscribe, ui.getState, ui.getState);
  const root = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [parts, setParts] = useState<{ editor: DocxEditor; store: EditorStore; layer: HTMLElement } | null>(null);

  // Later props are passed on (the first ones created the interface).
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) ui.setOptions(options);
  });

  useEffect(() => {
    mounted.current = true;
    ui.attach({ root: root.current!, host: host.current! });
    setParts({ editor: ui.editor!, store: ui.store!, layer: ui.layer! });
    return () => ui.detach();
  }, [ui]);

  const examples = options.examples;
  const value = useMemo<UIContextValue | null>(() => (parts ? {
    ui,
    editor: parts.editor,
    store: parts.store,
    layer: parts.layer,
    mobile: state.mobile,
    panelOpen: state.panelOpen,
    setPanelOpen: ui.setPanelOpen,
    panelTab: state.panelTab,
    setPanelTab: ui.setPanelTab,
    composerOpen: !!state.composerRange,
    composerRange: state.composerRange,
    openComposer: ui.openComposer,
    closeComposer: ui.closeComposer,
    findOpen: state.findOpen,
    setFindOpen: ui.setFindOpen,
    findReplace: state.findReplace,
    rulerOn: state.rulerOn,
    setRulerOn: ui.setRulerOn,
    modal: state.modal,
    modalData: state.modalData,
    openModal: ui.openModal,
    toast: ui.toast,
    files: ui.files,
    examples: examples ?? [],
    user: state.user,
    setUser: ui.setUser,
    theme: state.theme,
    setTheme: ui.setTheme,
    scheme: state.scheme,
    setScheme: ui.setScheme,
    customButtons: state.customButtons,
    collab: state.collab,
    startSharing: ui.startSharing,
    stopSharing: ui.stopSharing,
    api: state.ready ? ui.api : null,
  } : null), [ui, parts, state, examples]);

  const { mobile, panelOpen, composerRange, rulerOn, findOpen, linkAtCaret, hfMenu, toast } = state;
  const editor = parts?.editor;
  return (
    <div ref={root} className={cx(rootClassOf(state), className)} style={style} data-testid="app">
      {value && (
        <UIContext.Provider value={value}>
          <HeaderBar />
          <Toolbar />
          <StreamBanner />
          <SuggestingBanner />
        </UIContext.Provider>
      )}
      <div className="ml-workspace">
        <div className="ml-doc-area">
          {value && rulerOn && !mobile && (
            <UIContext.Provider value={value}><Ruler /></UIContext.Provider>
          )}
          <div className="ml-doc-host" ref={host} data-testid="doc-host" />
          {value && (
            <UIContext.Provider value={value}>
              {findOpen && <FindBar />}
              <CommentBubble />
              <PageIndicator />
            </UIContext.Provider>
          )}
        </div>
        {value && panelOpen && !mobile && (
          <UIContext.Provider value={value}><SidePanel /></UIContext.Provider>
        )}
      </div>
      {value && (
        <UIContext.Provider value={value}>
          {mobile && panelOpen && (
            <div className="ml-ui-sheet-backdrop" onPointerDown={(e) => e.target === e.currentTarget && ui.setPanelOpen(false)}>
              <div className="ml-ui-sheet ml-panel-sheet" role="dialog" aria-label="Review and fields">
                <div className="ml-ui-sheet-grip" />
                <button type="button" className="ml-icon-btn ml-sheet-close" aria-label="Close" onClick={() => ui.setPanelOpen(false)}><X size={18} /></button>
                <SidePanel inSheet />
              </div>
            </div>
          )}
          {mobile && composerRange && (
            <div className="ml-ui-sheet-backdrop" onPointerDown={(e) => e.target === e.currentTarget && ui.closeComposer()}>
              <div className="ml-ui-sheet ml-composer-sheet" role="dialog" aria-label="New comment">
                <div className="ml-ui-sheet-grip" />
                <ComposerCard />
              </div>
            </div>
          )}
          {linkAtCaret && editor && (
            <CaretPanel editor={editor} onClose={() => ui.setLinkAtCaret(false)}>
              <LinkForm onDone={() => { ui.setLinkAtCaret(false); editor.focus(); }} />
            </CaretPanel>
          )}
          <ContextMenu />
          {hfMenu && <HeaderFooterMenu at={hfMenu.at} pageIndex={hfMenu.pageIndex} onClose={ui.closeHeaderFooterMenu} />}
          <Dialogs />
          {toast && <Toast message={toast} />}
          <Banners restore={state.restore} notice={state.notice} />
        </UIContext.Provider>
      )}
    </div>
  );
}
