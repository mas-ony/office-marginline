import { reviewCountText, reviewItems, type ReviewItem, TRACKED_VIEWS as VIEWS } from '@marginline/core/views';
import { CheckCheck, MessageSquarePlus, XCircle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cx } from '../controls';
import { useUI } from '../context';
import { useSnapshot } from '../store';
import { Avatar, ChangeCard, CommentCard, CommentInput } from './cards';

/** The new-comment card: shown for the selection the composer was opened on. */
export function ComposerCard({ onDone }: { onDone?: () => void }) {
  const { editor, user, closeComposer, composerRange } = useUI();
  return (
    <div className="ml-card ml-composer is-active" role="dialog" aria-label="New comment" data-testid="comment-composer">
      <div className="ml-card-head">
        <Avatar name={user.name} />
        <div className="ml-card-who">
          <div className="ml-card-name"><span className="ml-card-author">{user.name}</span></div>
          <div className="ml-card-time">Now</div>
        </div>
      </div>
      <CommentInput
        placeholder="Add a comment"
        submitLabel="Comment"
        autoFocus
        testId="composer-input"
        onSubmit={(text) => {
          if (composerRange) editor.addCommentAt(composerRange, text);
          closeComposer();
          onDone?.();
        }}
        onCancel={() => { closeComposer(); onDone?.(); }}
      />
    </div>
  );
}

export function ReviewPanel() {
  const { editor, store, composerOpen, composerRange, openComposer, mobile } = useUI();
  const version = useSnapshot(store, (s) => `${s.commentsVersion}:${s.changesVersion}`);
  const activeComment = useSnapshot(store, (s) => s.activeComment);
  const imported = useSnapshot(store, (s) => s.imported);
  const mode = useSnapshot(store, (s) => s.editMode);
  const viewing = useSnapshot(store, (s) => s.viewing);
  const textSelected = useSnapshot(store, (s) => !!s.cursor?.textSelected);
  const [showResolved, setShowResolved] = useState(false);
  const [activeChange, setActiveChange] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const items = useMemo(() => reviewItems(editor, { resolved: showResolved }), [editor, version, showResolved]);
  const changes = items.filter((i) => i.kind === 'change').length;
  const comments = editor.comments().filter((c) => !c.done).length;

  useEffect(() => {
    if (!activeComment) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-comment-id="${CSS.escape(activeComment)}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeComment]);

  const activate = (item: ReviewItem) => {
    if (item.kind === 'comment') {
      setActiveChange(null);
      editor.selectComment(item.thread.id);
    } else {
      setActiveChange(item.key);
      editor.selectComment(null);
      editor.selectChange(item.changes[0]);
    }
  };

  const composerAt = composerOpen && composerRange ? items.findIndex((i) => i.pos > composerRange.from) : -1;
  const composer = composerOpen && !mobile ? <ComposerCard key="composer" /> : null;
  const cards = items.map((item) => (item.kind === 'comment' ? (
    <CommentCard key={item.key} thread={item.thread} active={activeComment === item.thread.id} imported={imported.has(`comment:${item.thread.id}`)} onActivate={() => activate(item)} />
  ) : (
    <ChangeCard key={item.key} item={item} active={activeChange === item.key} imported={item.changes.some((c) => imported.has(`change:${c.type}:${c.id}`))} onActivate={() => activate(item)} />
  )));
  if (composer) cards.splice(composerAt < 0 ? cards.length : composerAt, 0, composer);

  return (
    <div className="ml-review" data-testid="review-panel">
      <div className="ml-review-head">
        <span className="ml-review-count" data-testid="review-count">{reviewCountText(changes, comments)}</span>
        <label className="ml-check">
          <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} /> Resolved
        </label>
      </div>
      {mode === 'viewing' && (
        <div className="ml-review-views">
          <div className="ml-segmented" role="radiogroup" aria-label="Tracked changes">
            {VIEWS.map((v) => (
              <button key={v.value} type="button" role="radio" aria-checked={viewing.trackedChanges === v.value} className={cx(viewing.trackedChanges === v.value && 'is-on')} data-testid={`view-${v.value}`} onClick={() => editor.setViewingOptions({ trackedChanges: v.value })}>
                {v.label}
              </button>
            ))}
          </div>
          <label className="ml-check">
            <input type="checkbox" checked={viewing.comments} onChange={(e) => editor.setViewingOptions({ comments: e.target.checked })} /> Comments
          </label>
        </div>
      )}
      {changes > 0 && mode !== 'viewing' && (
        <div className="ml-review-bulk">
          <button type="button" className="ml-btn is-small" data-testid="accept-all" onClick={() => editor.decideChanges('all', true)}><CheckCheck size={15} /> Accept all</button>
          <button type="button" className="ml-btn is-small" data-testid="reject-all" onClick={() => editor.decideChanges('all', false)}><XCircle size={15} /> Reject all</button>
        </div>
      )}
      <div className="ml-review-list" ref={listRef} role="list">
        {cards.map((c, i) => <div key={c.key ?? i} role="listitem">{c}</div>)}
        {!cards.length && (
          <div className="ml-empty">
            <p>No comments or tracked changes.</p>
            <p>Select text and choose <b>Comment</b>, or switch to <b>Suggesting</b> to track your edits.</p>
          </div>
        )}
      </div>
      {mode !== 'viewing' && !composerOpen && (
        <button type="button" className="ml-btn ml-review-add" disabled={!textSelected} data-testid="panel-add-comment" onClick={openComposer}>
          <MessageSquarePlus size={16} /> Add comment
        </button>
      )}
    </div>
  );
}
