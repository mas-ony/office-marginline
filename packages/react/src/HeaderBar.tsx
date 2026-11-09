import {
  Bookmark,
  BookOpen,
  ChevronDown,
  FileDown,
  FilePlus,
  FileText,
  Keyboard,
  Menu as MenuIcon,
  MessageSquareText,
  Palette,
  PanelRightOpen,
  Printer,
  Share2,
  Superscript,
  TextCursorInput,
  TextQuote,
  Upload,
  UserPlus,
  WrapText,
} from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';
import { cx, keepFocus, Menu, MenuItem, MenuSeparator, Popover } from './controls';
import { useUI } from './context';
import { Avatar } from './review/cards';
import { useSnapshot } from './store';
import { DocumentModeTool, SearchTool } from './toolbar/tools';

function Logo() {
  return (
    <span className="ml-logo" aria-hidden="true">
      <svg viewBox="0 0 32 32" width="26" height="26">
        <rect x="5" y="3" width="20" height="26" rx="3" fill="var(--ml-accent)" />
        <path d="M10 10h10M10 15h10M10 20h6" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
        <circle cx="24" cy="23" r="5.5" fill="var(--ml-accent-2)" stroke="var(--ml-surface)" strokeWidth="2" />
      </svg>
    </span>
  );
}

function FileName() {
  const { editor, store } = useUI();
  const name = useSnapshot(store, (s) => s.fileName);
  const dirty = useSnapshot(store, (s) => s.dirty);
  const [editing, setEditing] = useState(false);
  const base = name.replace(/\.docx$/i, '');
  if (editing) {
    return (
      <input
        className="ml-filename-input"
        aria-label="Document name"
        defaultValue={base}
        autoFocus
        onFocus={(e) => e.target.select()}
        onBlur={(e) => {
          const v = e.target.value.trim();
          if (v) editor.fileName = v;
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setEditing(false);
        }}
      />
    );
  }
  return (
    <button type="button" className="ml-filename" title="Rename document" data-testid="file-name" onClick={() => setEditing(true)}>
      {base}
      {dirty && <span className="ml-dirty" aria-label="Unsaved changes" title="Unsaved changes">•</span>}
    </button>
  );
}

function MenuButton({ label, icon, text, children, testId, primary, align }: {
  label: string;
  icon?: ReactNode;
  text?: string;
  children: (close: () => void) => ReactNode;
  testId?: string;
  primary?: boolean;
  align?: 'start' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={ref} type="button" className={cx('ml-btn', primary && 'is-primary', open && 'is-pressed')} aria-label={label} aria-haspopup="menu" aria-expanded={open} data-testid={testId} onMouseDown={keepFocus} onClick={() => setOpen((o) => !o)}>
        {icon}
        {text && <span>{text}</span>}
        <ChevronDown size={14} />
      </button>
      <Popover anchor={ref.current} open={open} onClose={() => setOpen(false)} title={label} align={align}>
        {children(() => setOpen(false))}
      </Popover>
    </>
  );
}

function ExampleItems({ close }: { close: () => void }) {
  const { files, examples } = useUI();
  return (
    <>
      <MenuItem icon={<FilePlus size={16} />} label="Blank document" testId="example-blank" onSelect={() => { close(); files.newDocument(); }} />
      {examples.length > 0 && <MenuSeparator />}
      {examples.map((ex) => (
        <MenuItem key={ex.id} icon={<FileText size={16} />} label={ex.label} description={ex.description} testId={`example-${ex.id}`} onSelect={() => { close(); files.openExample(ex.id); }} />
      ))}
    </>
  );
}

function ExportItems({ close }: { close: () => void }) {
  const { files } = useUI();
  return (
    <>
      <MenuItem icon={<FileText size={16} />} label="Export DOCX" testId="export-docx" onSelect={() => { close(); files.downloadDocx(); }} />
      <MenuItem icon={<FileDown size={16} />} label="Export PDF" testId="export-pdf" onSelect={() => { close(); void files.exportPdf(); }} />
      <MenuItem icon={<Printer size={16} />} label="Print…" testId="export-print" onSelect={() => { close(); files.print(); }} />
      {files.share && <MenuItem icon={<Share2 size={16} />} label="Send file…" testId="export-share" onSelect={() => { close(); files.share?.(); }} />}
    </>
  );
}

/** Top bar: file actions, examples, collaboration, customization and export. */
export function HeaderBar() {
  const { files, examples, openModal, panelOpen, setPanelOpen, mobile, setPanelTab, store, collab } = useUI();
  const comments = useSnapshot(store, (s) => s.commentsVersion);
  void comments;
  if (mobile) return <MobileHeader />;
  return (
    <header className="ml-header" data-testid="header">
      <Logo />
      <span className="ml-app-name">Marginline</span>
      <button type="button" className="ml-btn" data-testid="upload" onClick={() => files.open()}>
        <Upload size={16} /> Upload DOCX
      </button>
      <FileName />
      {examples.length > 0 ? (
        <MenuButton label="Examples" text="Examples" icon={<BookOpen size={16} />} testId="examples">
          {(close) => <Menu label="Examples"><ExampleItems close={close} /></Menu>}
        </MenuButton>
      ) : (
        <button type="button" className="ml-btn" data-testid="new-document" onClick={() => files.newDocument()}>
          <FilePlus size={16} /> New
        </button>
      )}
      <span className="ml-spacer" />
      {collab && collab.participants.length > 0 && (
        <span className="ml-people" aria-label={`${collab.participants.length} people here`} data-testid="participants">
          {collab.participants.slice(0, 5).map((p) => <span key={p.clientID} title={p.self ? `${p.name} (you)` : p.name}><Avatar name={p.name} size={28} /></span>)}
        </span>
      )}
      <button type="button" className={cx('ml-btn', collab && 'is-live')} data-testid="share" onClick={() => openModal('share')}>
        <UserPlus size={16} /> {collab ? 'Sharing' : 'Share'}
      </button>
      <button type="button" className="ml-btn" aria-label="Open customization options" data-testid="customize" onClick={() => openModal('customize')}>
        <Palette size={16} /> Customize
      </button>
      <MenuButton label="Export" icon={<FileDown size={16} />} testId="export" align="end">
        {(close) => <Menu label="Export"><ExportItems close={close} /></Menu>}
      </MenuButton>
      <button type="button" className="ml-icon-btn" aria-label="Keyboard shortcuts" title="Keyboard shortcuts" onClick={() => openModal('shortcuts')}>
        <Keyboard size={17} />
      </button>
      {!panelOpen && (
        <button type="button" className="ml-icon-btn" aria-label="Show side panel" title="Show side panel" data-testid="panel-open" onClick={() => { setPanelTab('review'); setPanelOpen(true); }}>
          <PanelRightOpen size={18} />
        </button>
      )}
    </header>
  );
}

function MobileHeader() {
  const { openModal, setPanelOpen, store } = useUI();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const count = useSnapshot(store, (s) => s.commentsVersion + s.changesVersion);
  void count;
  return (
    <header className="ml-header is-mobile" data-testid="header">
      <button ref={ref} type="button" className="ml-icon-btn" aria-label="Menu" aria-haspopup="menu" aria-expanded={open} data-testid="mobile-menu" onClick={() => setOpen(true)}>
        <MenuIcon size={20} />
      </button>
      <FileName />
      <span className="ml-spacer" />
      <SearchTool />
      <DocumentModeTool />
      <button type="button" className="ml-icon-btn" aria-label="Comments and changes" data-testid="mobile-review" onClick={() => setPanelOpen(true)}>
        <MessageSquareText size={20} />
      </button>
      <Popover anchor={ref.current} open={open} onClose={() => setOpen(false)} title="Marginline">
        <MobileMenu close={() => setOpen(false)} openModal={openModal} />
      </Popover>
    </header>
  );
}

function MobileMenu({ close, openModal }: { close: () => void; openModal: ReturnType<typeof useUI>['openModal'] }) {
  const { files, editor, store } = useUI();
  const viewMode = useSnapshot(store, (s) => s.viewMode);
  const readOnly = useSnapshot(store, (s) => s.editMode === 'viewing');
  return (
    <Menu label="Menu">
      <MenuItem icon={<Upload size={16} />} label="Upload DOCX" testId="m-upload" onSelect={() => { close(); files.open(); }} />
      <ExampleItems close={close} />
      <MenuSeparator />
      <MenuItem
        icon={viewMode === 'web' ? <FileText size={16} /> : <WrapText size={16} />}
        label={viewMode === 'web' ? 'Show pages' : 'Reflow text'}
        description={viewMode === 'web' ? 'Page layout, scaled to the screen' : 'Text fits the screen width'}
        testId="m-view"
        onSelect={() => {
          close();
          if (viewMode === 'web') {
            editor.setViewMode('print');
            requestAnimationFrame(() => editor.fitWidth());
          } else editor.setViewMode('web');
        }}
      />
      {!readOnly && (
        <>
          <MenuItem icon={<TextCursorInput size={16} />} label="Insert field" testId="m-field" onSelect={() => { close(); editor.insertField(); }} />
          <MenuItem icon={<Superscript size={16} />} label="Insert footnote…" testId="m-footnote" onSelect={() => { close(); openModal('note', { kind: 'footnote' }); }} />
          <MenuItem icon={<Bookmark size={16} />} label="Create bookmark…" testId="m-bookmark" onSelect={() => { close(); openModal('bookmark'); }} />
          <MenuItem icon={<TextQuote size={16} />} label="Insert cross-reference…" testId="m-crossref" onSelect={() => { close(); openModal('crossRef'); }} />
        </>
      )}
      <MenuSeparator />
      <ExportItems close={close} />
      <MenuSeparator />
      <MenuItem icon={<UserPlus size={16} />} label="Share (collaborate)" testId="m-share" onSelect={() => { close(); openModal('share'); }} />
      <MenuItem icon={<Palette size={16} />} label="Customize" testId="m-customize" onSelect={() => { close(); openModal('customize'); }} />
    </Menu>
  );
}
