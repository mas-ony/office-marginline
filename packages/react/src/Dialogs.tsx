import { type ColorScheme, DATE_BUTTON_SNIPPET, SCHEMES, shortcutLabel, SHORTCUTS, suggestedBookmarkName, THEMES, validBookmarkName } from '@marginline/core/views';
import { Bookmark, Heading, Moon, Plus, Sun, SunMoon } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { cx, Field, Modal } from './controls';
import { useUI } from './context';
import { ShareDialog } from './ShareDialog';

function BookmarkDialog() {
  const { editor, openModal, toast } = useUI();
  const [name, setName] = useState(() => suggestedBookmarkName(editor));
  const existing = editor.bookmarks();
  const valid = validBookmarkName(name);
  const close = () => openModal(null);
  const add = () => {
    if (!valid) return;
    if (editor.createBookmark(name)) {
      toast(`Bookmark “${name}” created`);
      close();
      editor.focus();
    }
  };
  return (
    <Modal title="Create bookmark" open onClose={close} testId="bookmark-dialog" footer={(
      <>
        <button type="button" className="ml-btn" onClick={close}>Cancel</button>
        <button type="button" className="ml-btn is-primary" disabled={!valid} data-testid="bookmark-add" onClick={add}>Add</button>
      </>
    )}>
      <Field label="Bookmark name" htmlFor="bm-name">
        <input id="bm-name" className="ml-input" value={name} placeholder="e.g. Payment_terms" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
      </Field>
      <p className="ml-hint">{name && !valid ? 'Start with a letter; use letters, numbers and underscores (up to 40).' : 'The bookmark marks the selected text, or the caret position.'}</p>
      {existing.length > 0 && (
        <>
          <div className="ml-label">Bookmarks in this document</div>
          <ul className="ml-pick-list">
            {existing.map((b) => (
              <li key={b.id}>
                <button type="button" className="ml-pick" onClick={() => { editor.scrollToPos(b.pos); close(); }}>
                  <Bookmark size={14} /> <b>{b.name}</b> <span>{b.text}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
}

function CrossRefDialog() {
  const { editor, openModal } = useUI();
  const [kind, setKind] = useState<'bookmark' | 'heading'>(() => (editor.bookmarks().length ? 'bookmark' : 'heading'));
  const bookmarks = useMemo(() => editor.bookmarks(), [editor]);
  const headings = useMemo(() => editor.headings(), [editor]);
  const [pick, setPick] = useState<string | null>(null);
  const close = () => openModal(null);
  const insert = () => {
    if (!pick) return;
    if (kind === 'bookmark') editor.insertCrossReference({ bookmark: pick });
    else editor.insertCrossReference({ headingPos: Number(pick) });
    close();
    editor.focus();
  };
  const list = kind === 'bookmark'
    ? bookmarks.map((b) => ({ key: b.name, icon: <Bookmark size={14} />, label: b.name, detail: b.text }))
    : headings.map((h) => ({ key: String(h.pos), icon: <Heading size={14} />, label: h.text, detail: `Heading ${h.level}` }));
  return (
    <Modal title="Insert cross-reference" open onClose={close} testId="crossref-dialog" footer={(
      <>
        <button type="button" className="ml-btn" onClick={close}>Cancel</button>
        <button type="button" className="ml-btn is-primary" disabled={!pick} data-testid="crossref-insert" onClick={insert}>Insert</button>
      </>
    )}>
      <div className="ml-segmented" role="radiogroup" aria-label="Reference type">
        <button type="button" role="radio" aria-checked={kind === 'bookmark'} className={cx(kind === 'bookmark' && 'is-on')} onClick={() => { setKind('bookmark'); setPick(null); }}>Bookmarks</button>
        <button type="button" role="radio" aria-checked={kind === 'heading'} className={cx(kind === 'heading' && 'is-on')} onClick={() => { setKind('heading'); setPick(null); }}>Headings</button>
      </div>
      {list.length ? (
        <ul className="ml-pick-list" role="listbox" aria-label={kind === 'bookmark' ? 'Bookmarks' : 'Headings'}>
          {list.map((it) => (
            <li key={it.key}>
              <button type="button" role="option" aria-selected={pick === it.key} className={cx('ml-pick', pick === it.key && 'is-on')} onClick={() => setPick(it.key)} onDoubleClick={() => { setPick(it.key); setTimeout(insert, 0); }}>
                {it.icon} <b>{it.label}</b> <span>{it.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ml-hint">{kind === 'bookmark' ? 'There are no bookmarks yet. Select text and choose Create bookmark.' : 'There are no headings in this document.'}</p>
      )}
      <p className="ml-hint">The reference is inserted as linked text; {shortcutLabel('Ctrl')}+click it to jump to the target.</p>
    </Modal>
  );
}

function NoteDialog() {
  const { editor, openModal, modalData } = useUI();
  const key = modalData.key as string | undefined;
  const kind = (modalData.kind as 'footnote' | 'endnote' | undefined) ?? (key?.startsWith('endnote:') ? 'endnote' : 'footnote');
  const [text, setText] = useState(() => (key ? editor.noteText(key) : ''));
  const close = () => openModal(null);
  const save = () => {
    if (key) editor.setNoteText(key, text);
    else editor.insertNote(kind, text);
    close();
    editor.focus();
  };
  const label = kind === 'endnote' ? 'endnote' : 'footnote';
  return (
    <Modal title={key ? `Edit ${label}` : `Insert ${label}`} open onClose={close} testId="note-dialog" footer={(
      <>
        <button type="button" className="ml-btn" onClick={close}>Cancel</button>
        <button type="button" className="ml-btn is-primary" data-testid="note-save" onClick={save}>{key ? 'Save' : 'Insert'}</button>
      </>
    )}>
      <Field label={`${label[0].toUpperCase()}${label.slice(1)} text`} htmlFor="note-text">
        <textarea id="note-text" className="ml-input" rows={4} value={text} autoFocus onChange={(e) => setText(e.target.value)} />
      </Field>
      {!key && <p className="ml-hint">The reference mark is inserted at the caret; the note appears at the bottom of its page.</p>}
    </Modal>
  );
}

const SCHEME_ICONS: Record<ColorScheme, ReactNode> = {
  system: <SunMoon size={15} />,
  light: <Sun size={15} />,
  dark: <Moon size={15} />,
};

function CustomizeDialog() {
  const { theme, setTheme, scheme, setScheme, openModal, customButtons, user, setUser, api } = useUI();
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const close = () => {
    if (name.trim() && (name.trim() !== user.name || email.trim() !== user.email)) setUser({ name: name.trim(), email: email.trim() });
    openModal(null);
  };
  const hasDemo = customButtons.some((b) => b.id === 'today');
  return (
    <Modal title="Customize the editor" open onClose={close} testId="customize-dialog" wide footer={<button type="button" className="ml-btn is-primary" onClick={close}>Done</button>}>
      <h3 className="ml-dialog-h">Set the theme</h3>
      <div className="ml-theme-grid" role="radiogroup" aria-label="Theme">
        {THEMES.map((t) => (
          <button key={t.id} type="button" role="radio" aria-checked={theme === t.id} className={cx('ml-theme-card', theme === t.id && 'is-on')} data-theme-preview={t.id} data-testid={`theme-${t.id}`} onClick={() => setTheme(t.id)}>
            <span className="ml-theme-swatch" aria-hidden="true"><i /><i /><i /></span>
            <b>{t.label}</b>
            <small>{t.description}</small>
          </button>
        ))}
      </div>
      <div className="ml-segmented" role="radiogroup" aria-label="Appearance">
        {SCHEMES.map((s) => (
          <button key={s.id} type="button" role="radio" aria-checked={scheme === s.id} className={cx(scheme === s.id && 'is-on')} data-testid={`scheme-${s.id}`} onClick={() => setScheme(s.id)}>
            {SCHEME_ICONS[s.id]} {s.label}
          </button>
        ))}
      </div>
      <h3 className="ml-dialog-h">Customize the toolbar</h3>
      <p className="ml-hint">Add your own toolbar controls that change the document, with the page API.</p>
      <div className="ml-row">
        <button type="button" className="ml-btn" disabled={hasDemo} data-testid="add-demo-button" onClick={() => {
          if (!api) return;
          api.toolbar.addButton({
            id: 'today',
            label: "Insert today's date",
            text: '📅',
            onClick: () => void api.doc.text.insert({ text: new Date().toLocaleDateString() }),
          });
        }}>
          <Plus size={15} /> {hasDemo ? 'Date button added' : "Quick demo: add a date button"}
        </button>
      </div>
      <pre className="ml-code" aria-label="Demo code">{DATE_BUTTON_SNIPPET}</pre>
      <h3 className="ml-dialog-h">Your name</h3>
      <p className="ml-hint">Shown on your comments and tracked changes.</p>
      <div className="ml-row">
        <input className="ml-input" aria-label="Your name" data-testid="user-name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="ml-input" aria-label="Your email" type="email" placeholder="Email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
    </Modal>
  );
}

function ShortcutsDialog() {
  const { openModal } = useUI();
  return (
    <Modal title="Keyboard shortcuts" open onClose={() => openModal(null)} testId="shortcuts-dialog">
      <table className="ml-shortcuts">
        <tbody>
          {SHORTCUTS.map(([k, d]) => (
            <tr key={k}><td><kbd>{shortcutLabel(k)}</kbd></td><td>{d}</td></tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}

export function Dialogs() {
  const { modal } = useUI();
  switch (modal) {
    case 'bookmark': return <BookmarkDialog />;
    case 'crossRef': return <CrossRefDialog />;
    case 'note': return <NoteDialog />;
    case 'customize': return <CustomizeDialog />;
    case 'share': return <ShareDialog />;
    case 'shortcuts': return <ShortcutsDialog />;
    default: return null;
  }
}
