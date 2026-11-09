import {
  type AnchoredComment,
  autosizeTextarea,
  avatarColor,
  changeTextClass,
  completeMention,
  formatWhen,
  initials,
  mentionAt,
  mentionMatches,
  mentionPeople,
  type ReviewItem,
  splitMentions,
} from '@marginline/core/views';
import { Check, EllipsisVertical, RotateCcw, X } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { cx, keepFocus, Menu, MenuItem, Popover } from '../controls';
import { useUI } from '../context';

export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <span className="ml-avatar" style={{ background: avatarColor(name), width: size, height: size, fontSize: size * 0.38 }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

function CardHead({ name, date, imported, actions }: { name: string; date?: string; imported?: boolean; actions?: ReactNode }) {
  return (
    <div className="ml-card-head">
      <Avatar name={name} />
      <div className="ml-card-who">
        <div className="ml-card-name">
          <span className="ml-card-author">{name}</span>
          {imported && <span className="ml-badge">Imported</span>}
        </div>
        <div className="ml-card-time">{formatWhen(date)}</div>
      </div>
      {actions && <div className="ml-card-actions">{actions}</div>}
    </div>
  );
}

/** People who can be mentioned: authors in the document and the current user. */
function usePeople(): string[] {
  const { editor, user } = useUI();
  return useMemo(() => mentionPeople(editor, user.name), [editor, user.name]);
}

/** A comment text box with @mention suggestions. Enter submits, Shift+Enter adds a line. */
export function CommentInput({ placeholder, initial = '', submitLabel, onSubmit, onCancel, autoFocus, testId, collapsed }: {
  placeholder: string;
  initial?: string;
  submitLabel: string;
  onSubmit: (text: string) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
  testId?: string;
  /** Show as a one-line box until focused (reply boxes). */
  collapsed?: boolean;
}) {
  const [text, setText] = useState(initial);
  const [focused, setFocused] = useState(!!autoFocus);
  const ref = useRef<HTMLTextAreaElement>(null);
  const people = usePeople();
  const mention = mentionAt(text, ref.current?.selectionStart ?? text.length);
  const matches = mentionMatches(people, mention);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  useEffect(() => autosizeTextarea(ref.current), [text, focused]);
  const submit = () => {
    if (!text.trim()) return;
    onSubmit(text.trim());
    setText('');
    if (collapsed) setFocused(false);
  };
  const pick = (name: string) => {
    if (!mention) return;
    setText(completeMention(text, ref.current?.selectionStart ?? text.length, mention, name));
    requestAnimationFrame(() => ref.current?.focus());
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (matches.length && mention) pick(matches[0]);
      else submit();
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      setText(initial);
      setFocused(false);
      onCancel?.();
    }
  };
  const open = focused || !collapsed || !!text;
  return (
    <div className={cx('ml-comment-input', open && 'is-open')} onClick={(e) => e.stopPropagation()}>
      <textarea
        ref={ref}
        rows={1}
        value={text}
        placeholder={placeholder}
        aria-label={placeholder}
        data-testid={testId}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setFocused(true)}
        onKeyDown={onKey}
      />
      {matches.length > 0 && (
        <div className="ml-mentions" role="listbox" aria-label="People">
          {matches.map((p) => (
            <button key={p} type="button" role="option" aria-selected="false" className="ml-mention" onMouseDown={keepFocus} onClick={() => pick(p)}>
              <Avatar name={p} size={20} /> {p}
            </button>
          ))}
        </div>
      )}
      {open && (
        <div className="ml-comment-buttons">
          <button type="button" className="ml-btn is-quiet" onClick={() => { setText(initial); setFocused(false); onCancel?.(); }}>Cancel</button>
          <button type="button" className="ml-btn is-primary" disabled={!text.trim()} data-testid={testId ? `${testId}-submit` : undefined} onClick={submit}>{submitLabel}</button>
        </div>
      )}
    </div>
  );
}

/** Text with @mentions emphasised. */
function RichText({ text }: { text: string }) {
  return <>{splitMentions(text).map((p, i) => (p.startsWith('@') ? <span key={i} className="ml-at">{p}</span> : p))}</>;
}

function MoreMenu({ label, onEdit, onDelete, testId }: { label: string; onEdit: () => void; onDelete: () => void; testId?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={ref} type="button" className="ml-icon-btn" aria-label={label} aria-haspopup="menu" aria-expanded={open} data-testid={testId} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>
        <EllipsisVertical size={16} />
      </button>
      <Popover anchor={ref.current} open={open} onClose={() => setOpen(false)} align="end" title={label}>
        <Menu label={label}>
          <MenuItem label="Edit" testId="comment-edit" onSelect={() => { setOpen(false); onEdit(); }} />
          <MenuItem label="Delete" testId="comment-delete" onSelect={() => { setOpen(false); onDelete(); }} />
        </Menu>
      </Popover>
    </>
  );
}

function Message({ id, author, date, text, imported, readOnly, actions, testId }: {
  id: string;
  author: string;
  date?: string;
  text: string;
  imported?: boolean;
  readOnly: boolean;
  actions?: ReactNode;
  testId?: string;
}) {
  const { editor } = useUI();
  const [editing, setEditing] = useState(false);
  return (
    <div className="ml-message" data-testid={testId}>
      <CardHead
        name={author}
        date={date}
        imported={imported}
        actions={!readOnly && (
          <>
            {actions}
            <MoreMenu label="Comment options" testId={`${testId}-more`} onEdit={() => setEditing(true)} onDelete={() => editor.deleteComment(id)} />
          </>
        )}
      />
      {editing ? (
        <CommentInput placeholder="Edit comment" initial={text} submitLabel="Save" autoFocus onSubmit={(t) => { editor.editComment(id, t); setEditing(false); }} onCancel={() => setEditing(false)} />
      ) : (
        <div className="ml-card-text"><RichText text={text} /></div>
      )}
    </div>
  );
}

export function CommentCard({ thread, active, imported, onActivate }: { thread: AnchoredComment; active: boolean; imported: boolean; onActivate: () => void }) {
  const { editor, store } = useUI();
  const readOnly = store.getSnapshot().editMode === 'viewing';
  const resolve = thread.done
    ? <button type="button" className="ml-icon-btn" aria-label="Reopen comment" title="Reopen" data-testid="comment-reopen" onClick={(e) => { e.stopPropagation(); editor.resolveComment(thread.id, false); }}><RotateCcw size={16} /></button>
    : <button type="button" className="ml-icon-btn" aria-label="Resolve comment" title="Resolve" data-testid="comment-resolve" onClick={(e) => { e.stopPropagation(); editor.resolveComment(thread.id, true); }}><Check size={16} /></button>;
  return (
    <div
      className={cx('ml-card ml-comment-card', active && 'is-active', thread.done && 'is-resolved')}
      role="dialog"
      aria-label={`Comment by ${thread.author}`}
      data-testid="comment-card"
      data-comment-id={thread.id}
      tabIndex={0}
      onClick={onActivate}
      onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onActivate(); }}
    >
      {thread.done && <div className="ml-resolved-label">Resolved</div>}
      <Message id={thread.id} author={thread.author} date={thread.date} text={thread.text} imported={imported} readOnly={readOnly} actions={resolve} testId="comment-root" />
      {thread.quote && active && <div className="ml-card-quote">“{thread.quote}”</div>}
      {thread.replies.map((r) => (
        <Message key={r.id} id={r.id} author={r.author} date={r.date} text={r.text} readOnly={readOnly} testId="comment-reply" />
      ))}
      {active && !readOnly && !thread.done && (
        <CommentInput placeholder="Reply or add others with @" submitLabel="Reply" collapsed testId="reply-input" onSubmit={(t) => editor.replyToComment(thread.id, t)} />
      )}
    </div>
  );
}

export function ChangeCard({ item, active, imported, onActivate }: { item: Extract<ReviewItem, { kind: 'change' }>; active: boolean; imported: boolean; onActivate: () => void }) {
  const { editor, store } = useUI();
  const readOnly = store.getSnapshot().editMode === 'viewing';
  const s = item.summary;
  const decide = (accept: boolean) => (e: React.MouseEvent) => {
    e.stopPropagation();
    editor.decideChanges(item.changes, accept);
  };
  return (
    <div
      className={cx('ml-card ml-change-card', active && 'is-active')}
      role="dialog"
      aria-label="Tracked change discussion"
      data-testid="change-card"
      tabIndex={0}
      onClick={onActivate}
      onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onActivate(); }}
    >
      <CardHead
        name={item.author}
        date={item.date}
        imported={imported}
        actions={!readOnly && (
          <>
            <button type="button" className="ml-icon-btn" aria-label="Accept change" title="Accept" data-testid="change-accept" onClick={decide(true)}><Check size={16} /></button>
            <button type="button" className="ml-icon-btn" aria-label="Reject change" title="Reject" data-testid="change-reject" onClick={decide(false)}><X size={16} /></button>
          </>
        )}
      />
      <div className="ml-card-text">
        {s.verb}
        {s.text && <> <span className={changeTextClass(s)}>“{s.text}”</span></>}
        {s.with !== undefined && <> with <span className="ml-ins-text">“{s.with}”</span></>}
      </div>
    </div>
  );
}
