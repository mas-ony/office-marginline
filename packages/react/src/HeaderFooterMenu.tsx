import { clampToWindow, distanceText, headerFooterMenuState, headerFooterOptionsButton, parseDistance, rulerUsesMetric } from '@marginline/core/views';
import { ArrowDownToLine, ArrowUpToLine, FileDigit, Hash, Layers, Link2, Sigma, Unlink } from 'lucide-react';
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useUI } from './context';
import { Menu, MenuItem, MenuSeparator } from './controls';

/** A distance from the page edge, applied on Enter or on leaving the field (not when the menu is dismissed). */
function DistanceField({ icon, label, value, max, metric, testId, discard, onCommit }: {
  icon: ReactNode;
  label: string;
  value: number;
  max: number;
  metric: boolean;
  testId: string;
  discard: { readonly current: boolean };
  onCommit: (twips: number) => void;
}) {
  const [text, setText] = useState(() => distanceText(value, metric));
  useEffect(() => setText(distanceText(value, metric)), [value, metric]);
  const commit = () => {
    if (discard.current) return;
    const twips = parseDistance(text, max, metric);
    if (twips === null || twips === value) setText(distanceText(value, metric));
    else onCommit(twips);
  };
  return (
    <label className="ml-hf-distance">
      <span className="ml-ui-menuitem-icon">{icon}</span>
      <span className="ml-hf-distance-label">{label}</span>
      <input
        className="ml-input"
        aria-label={`${label} (${metric ? 'centimetres' : 'inches'})`}
        value={text}
        inputMode="decimal"
        data-testid={testId}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
      />
      <span className="ml-hf-unit">{metric ? 'cm' : 'in'}</span>
    </label>
  );
}

/** The Options menu of the header or footer being edited, opened from the button on its bar. */
export function HeaderFooterMenu({ at, pageIndex, onClose }: { at: { x: number; y: number }; pageIndex: number; onClose: () => void }) {
  const { editor, layer } = useUI();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: at.x, top: at.y });
  const [metric] = useState(rulerUsesMetric);
  // Set when Escape dismisses the menu or it is removed: what was typed in a distance field is then dropped.
  const discard = useRef(false);
  useLayoutEffect(() => {
    discard.current = false;
    return () => {
      discard.current = true;
    };
  }, []);

  useLayoutEffect(() => {
    if (ref.current) setPos(clampToWindow(at.x, at.y, ref.current));
  }, [at]);

  useEffect(() => {
    const button = headerFooterOptionsButton(editor);
    button?.setAttribute('aria-expanded', 'true');
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent) {
        if (e.key !== 'Escape') return;
        discard.current = true;
        onClose();
        editor.focus();
        return;
      }
      if (e.type === 'pointerdown' && ref.current?.contains(e.target as Node)) return;
      // Leaving a distance field this way applies what was typed in it.
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && ref.current?.contains(focused)) focused.blur();
      // Its own button closes it as well, through the request the button sends.
      if (e.type === 'pointerdown' && button?.contains(e.target as Node)) return;
      onClose();
    };
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', close, true);
    window.addEventListener('blur', close);
    editor.scrollEl.addEventListener('scroll', close, { passive: true });
    return () => {
      button?.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', close, true);
      document.removeEventListener('keydown', close, true);
      window.removeEventListener('blur', close);
      editor.scrollEl.removeEventListener('scroll', close);
    };
  }, [editor, onClose]);

  const { kind, editing, options, linked } = headerFooterMenuState(editor, pageIndex);
  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };
  const field = (k: 'PAGE' | 'NUMPAGES' | 'SECTIONPAGES' | 'PAGEXOFY') => run(() => editor.insertPageField(k));
  const set = (o: Parameters<typeof editor.setHeaderFooterOptions>[1]) => editor.setHeaderFooterOptions(pageIndex, o);
  return createPortal(
    <div ref={ref} className="ml-ui-popover ml-context" style={{ position: 'fixed', left: pos.left, top: pos.top }} data-testid="hf-options">
      <Menu label={kind === 'header' ? 'Header options' : 'Footer options'}>
        <MenuItem icon={<Hash size={16} />} label="Insert current page number" disabled={!editing} testId="hf-page-number" onSelect={field('PAGE')} />
        <MenuItem icon={<Sigma size={16} />} label="Insert total page count" disabled={!editing} testId="hf-total-pages" onSelect={field('NUMPAGES')} />
        <MenuItem icon={<Layers size={16} />} label="Insert section page count" disabled={!editing} testId="hf-section-pages" onSelect={field('SECTIONPAGES')} />
        <MenuItem icon={<FileDigit size={16} />} label="Insert page X of Y" disabled={!editing} testId="hf-page-x-of-y" onSelect={field('PAGEXOFY')} />
        <MenuSeparator />
        <MenuItem label="Different first page" checked={options.differentFirstPage} toggle testId="hf-different-first" onSelect={run(() => set({ differentFirstPage: !options.differentFirstPage }))} />
        <MenuItem label="Different odd and even pages" description="Applies to the whole document." checked={options.differentOddEven} toggle testId="hf-odd-even" onSelect={run(() => set({ differentOddEven: !options.differentOddEven }))} />
        {linked !== null && (
          <>
            <MenuSeparator />
            <MenuItem
              icon={linked ? <Unlink size={16} /> : <Link2 size={16} />}
              label={linked ? 'Unlink from previous' : 'Link to previous'}
              description={linked ? 'Same as previous' : undefined}
              testId="hf-link"
              onSelect={run(() => editor.setHeaderFooterLinked(kind, pageIndex, !linked))}
            />
          </>
        )}
      </Menu>
      <div className="ml-hf-distances" role="group" aria-label="Distances from the page edge">
        <DistanceField icon={<ArrowUpToLine size={16} />} label="Header distance from edge" value={options.headerDistance} max={options.maxDistance} metric={metric} testId="hf-header-distance" discard={discard} onCommit={(v) => set({ headerDistance: v })} />
        <DistanceField icon={<ArrowDownToLine size={16} />} label="Footer distance from edge" value={options.footerDistance} max={options.maxDistance} metric={metric} testId="hf-footer-distance" discard={discard} onCommit={(v) => set({ footerDistance: v })} />
      </div>
    </div>,
    layer,
  );
}
