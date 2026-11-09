import { clampToWindow, contextMenuAt, contextMenuState, insertTable, modKey as mod, pasteFromClipboard, pasteMatching, pasteRefusedMessage, removeLink } from '@marginline/core/views';
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  ClipboardType,
  Copy,
  Link2,
  MessageSquare,
  PaintBucket,
  Redo2,
  Scissors,
  Superscript,
  Table,
  TableProperties,
  TextQuote,
  Undo2,
  Unlink,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Menu, MenuItem, MenuSeparator } from './controls';
import { useUI } from './context';
import { ColorPalette } from './toolbar/parts';
import { LinkForm, TableActionsMenu, TableGrid } from './toolbar/tools';

type Page = 'main' | 'table' | 'cellBg' | 'link' | 'insertTable';

/** The document context menu (right click). */
export function ContextMenu() {
  const { editor, layer, mobile, openModal, openComposer, toast } = useUI();
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const [page, setPage] = useState<Page>('main');
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });

  useEffect(() => {
    const onContext = (e: MouseEvent) => {
      if (!contextMenuAt(editor, e, mobile)) return;
      setPage('main');
      setAt({ x: e.clientX, y: e.clientY });
    };
    document.addEventListener('contextmenu', onContext);
    return () => document.removeEventListener('contextmenu', onContext);
  }, [editor, mobile]);

  useEffect(() => {
    if (!at) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      if (e.type === 'pointerdown' && (ref.current?.contains(e.target as Node) || (e.target as HTMLElement).closest?.('.ml-ui-popover'))) return;
      setAt(null);
    };
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', close, true);
    window.addEventListener('blur', close);
    editor.scrollEl.addEventListener('scroll', close as EventListener, { passive: true });
    return () => {
      document.removeEventListener('pointerdown', close, true);
      document.removeEventListener('keydown', close, true);
      window.removeEventListener('blur', close);
      editor.scrollEl.removeEventListener('scroll', close as EventListener);
    };
  }, [at, editor]);

  useLayoutEffect(() => {
    if (!at || !ref.current) return;
    setPos(clampToWindow(at.x, at.y, ref.current));
  }, [at, page]);

  if (!at) return null;
  const view = editor.activeView;
  const { readOnly, hasText, inTable, link, body } = contextMenuState(editor);
  const done = () => setAt(null);
  const paste = (kind: 'source' | 'match' | 'text') => async () => {
    done();
    const ok = kind === 'match' ? await pasteMatching(view) : await pasteFromClipboard(view, kind === 'text', (files) => void editor.insertImages(files));
    if (!ok) toast(pasteRefusedMessage(kind));
  };

  let content;
  if (page === 'table') {
    content = (
      <>
        <button type="button" className="ml-ui-menuitem ml-menu-back" onClick={() => setPage('main')}><ChevronLeft size={16} /> Edit table</button>
        <TableActionsMenu onDone={done} />
      </>
    );
  } else if (page === 'cellBg') {
    content = (
      <>
        <button type="button" className="ml-ui-menuitem ml-menu-back" onClick={() => setPage('main')}><ChevronLeft size={16} /> Cell background</button>
        <ColorPalette label="Cell background" value={null} none="No color" onPick={(hex) => { editor.setCellBackground(hex); done(); }} />
      </>
    );
  } else if (page === 'link') {
    content = <LinkForm onDone={() => { done(); editor.focus(); }} />;
  } else if (page === 'insertTable') {
    content = <TableGrid onPick={(r, c) => { insertTable(editor.activeView, editor.docx, r, c); done(); editor.focus(); }} />;
  } else {
    content = (
      <Menu label="Context menu">
        <MenuItem icon={<MessageSquare size={16} />} label="Comment" testId="ctx-comment" disabled={readOnly || !body} onSelect={() => { done(); openComposer(); }} />
        <MenuSeparator />
        <MenuItem icon={<Scissors size={16} />} label="Cut" shortcut={`${mod}+X`} disabled={readOnly || !hasText} onSelect={() => { document.execCommand('cut'); done(); }} />
        <MenuItem icon={<Copy size={16} />} label="Copy" shortcut={`${mod}+C`} disabled={!hasText} onSelect={() => { document.execCommand('copy'); done(); }} />
        <MenuItem icon={<ClipboardPaste size={16} />} label="Keep Source Formatting" shortcut={`${mod}+V`} disabled={readOnly} testId="ctx-paste" onSelect={paste('source')} />
        <MenuItem icon={<ClipboardPaste size={16} />} label="Match Destination Formatting" shortcut={`${mod}+Shift+V`} disabled={readOnly} onSelect={paste('match')} />
        <MenuItem icon={<ClipboardType size={16} />} label="Keep Text Only" disabled={readOnly} onSelect={paste('text')} />
        <MenuSeparator />
        <MenuItem icon={<Undo2 size={16} />} label="Undo" shortcut={`${mod}+Z`} disabled={!editor.canUndo} onSelect={() => { editor.undo(); done(); }} />
        <MenuItem icon={<Redo2 size={16} />} label="Redo" shortcut={`${mod}+Shift+Z`} disabled={!editor.canRedo} onSelect={() => { editor.redo(); done(); }} />
        <MenuSeparator />
        <MenuItem icon={<Bookmark size={16} />} label="Create bookmark" testId="ctx-bookmark" disabled={readOnly || !body} onSelect={() => { done(); openModal('bookmark'); }} />
        <MenuItem icon={<TextQuote size={16} />} label="Insert cross-reference" testId="ctx-crossref" disabled={readOnly || !body} onSelect={() => { done(); openModal('crossRef'); }} />
        <MenuItem icon={<Link2 size={16} />} label={link ? 'Edit link' : 'Insert link'} testId="ctx-link" disabled={readOnly} onSelect={() => setPage('link')} />
        {link && <MenuItem icon={<Unlink size={16} />} label="Remove link" disabled={readOnly} onSelect={() => { removeLink(view); done(); }} />}
        {!inTable && <MenuItem icon={<Table size={16} />} label="Insert table" testId="ctx-table" disabled={readOnly} onSelect={() => setPage('insertTable')} />}
        <MenuItem icon={<Superscript size={16} />} label="Insert footnote" testId="ctx-footnote" disabled={readOnly || !body} onSelect={() => { done(); openModal('note', { kind: 'footnote' }); }} />
        {inTable && (
          <>
            <MenuSeparator />
            <button type="button" className="ml-ui-menuitem" role="menuitem" data-testid="ctx-edit-table" disabled={readOnly} onClick={() => setPage('table')}>
              <span className="ml-ui-menuitem-icon"><TableProperties size={16} /></span>
              <span className="ml-ui-menuitem-text"><span className="ml-ui-menuitem-label">Edit table</span></span>
              <ChevronRight size={16} />
            </button>
            <button type="button" className="ml-ui-menuitem" role="menuitem" data-testid="ctx-cell-bg" disabled={readOnly} onClick={() => setPage('cellBg')}>
              <span className="ml-ui-menuitem-icon"><PaintBucket size={16} /></span>
              <span className="ml-ui-menuitem-text"><span className="ml-ui-menuitem-label">Cell background</span></span>
              <ChevronRight size={16} />
            </button>
          </>
        )}
      </Menu>
    );
  }
  return createPortal(
    <div ref={ref} className="ml-ui-popover ml-context" style={{ position: 'fixed', left: pos.left, top: pos.top }} data-testid="context-menu">
      {content}
    </div>,
    layer,
  );
}
