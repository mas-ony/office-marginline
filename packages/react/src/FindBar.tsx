import { searchRegExp } from '@marginline/core/views';
import { ChevronDown, ChevronRight, ChevronUp, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cx } from './controls';
import { useUI } from './context';
import { useSnapshot } from './store';

/** Find and replace bar floating over the top-right of the document. */
export function FindBar() {
  const { editor, store, setFindOpen, findReplace, mobile } = useUI();
  const search = useSnapshot(store, (s) => s.search);
  const readOnly = useSnapshot(store, (s) => s.editMode === 'viewing');
  const [query, setQuery] = useState(() => {
    const v = editor.view.state;
    return v.selection.empty ? search.query : v.doc.textBetween(v.selection.from, v.selection.to, ' ').slice(0, 100);
  });
  const [caseSensitive, setCase] = useState(false);
  const [regex, setRegex] = useState(false);
  const [showReplace, setShowReplace] = useState(findReplace);
  const [replacement, setReplacement] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const invalid = regex && !!query && !searchRegExp({ query, caseSensitive, regex, wholeWord: false });

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  useEffect(() => setShowReplace((r) => r || findReplace), [findReplace]);
  useEffect(() => {
    editor.search({ query, caseSensitive, regex, wholeWord: false });
  }, [editor, query, caseSensitive, regex]);
  useEffect(() => () => editor.clearSearch(), [editor]);

  const close = () => {
    setFindOpen(false);
    editor.focus();
  };
  return (
    <div className={cx('ml-find', mobile && 'is-mobile')} role="dialog" aria-label="Find text" data-testid="find-bar" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } }}>
      <div className="ml-find-row">
        {!readOnly && (
          <button type="button" className="ml-icon-btn" aria-label="Toggle replace" aria-expanded={showReplace} data-testid="find-toggle-replace" onClick={() => setShowReplace((r) => !r)}>
            {showReplace ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        )}
        <label className={cx('ml-find-input', invalid && 'is-invalid')}>
          <Search size={15} aria-hidden="true" />
          <input
            ref={input}
            aria-label="Find text"
            placeholder="Find"
            value={query}
            data-testid="find-input"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                editor.searchStep(e.shiftKey ? -1 : 1);
              }
            }}
          />
          <button type="button" className={cx('ml-find-opt', caseSensitive && 'is-on')} aria-label="Match case" aria-pressed={caseSensitive} title="Match case" data-testid="find-case" onClick={() => setCase((c) => !c)}>Aa</button>
          <button type="button" className={cx('ml-find-opt', regex && 'is-on')} aria-label="Use regular expression" aria-pressed={regex} title="Use regular expression" data-testid="find-regex" onClick={() => setRegex((r) => !r)}>.*</button>
        </label>
        <span className="ml-find-count" data-testid="find-count" aria-live="polite">
          {query ? (search.count ? `${search.index + 1} of ${search.count}` : invalid ? 'Invalid' : 'No results') : ''}
        </span>
        <button type="button" className="ml-icon-btn" aria-label="Previous match" disabled={!search.count} onClick={() => editor.searchStep(-1)}><ChevronUp size={16} /></button>
        <button type="button" className="ml-icon-btn" aria-label="Next match" disabled={!search.count} data-testid="find-next" onClick={() => editor.searchStep(1)}><ChevronDown size={16} /></button>
        <button type="button" className="ml-icon-btn" aria-label="Close find and replace" onClick={close}><X size={16} /></button>
      </div>
      {showReplace && !readOnly && (
        <div className="ml-find-row ml-replace-row">
          <label className="ml-find-input">
            <input aria-label="Replace with" placeholder="Replace" value={replacement} data-testid="replace-input" onChange={(e) => setReplacement(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); editor.replace(replacement); } }} />
          </label>
          <button type="button" className="ml-btn is-small" disabled={!search.count} data-testid="replace-one" onClick={() => editor.replace(replacement)}>Replace</button>
          <button type="button" className="ml-btn is-small" disabled={!search.count} data-testid="replace-all" onClick={() => editor.replaceAll(replacement)}>Replace all</button>
        </div>
      )}
    </div>
  );
}
