import { type RulerDrag, type RulerHandle, rulerGeometry, rulerLayout, rulerUsesMetric, startRulerDrag } from '@marginline/core/views';
import { type PointerEvent as ReactPointerEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useUI } from './context';
import { useSnapshot } from './store';

/** Horizontal ruler for the page holding the caret, with margin and indent markers. */
export function Ruler() {
  const { editor, store } = useUI();
  const ref = useRef<HTMLDivElement>(null);
  useSnapshot(store, (s) => `${s.layoutVersion}:${s.zoom}:${s.version}`);
  const [, setTick] = useState(0);
  const [drag, setDrag] = useState<RulerDrag | null>(null);
  const [metric] = useState(rulerUsesMetric);

  // Draw again once the container exists (geometry is measured against it).
  useLayoutEffect(() => setTick((t) => t + 1), []);

  useEffect(() => {
    const s = editor.scrollEl;
    const on = () => setTick((t) => t + 1);
    s.addEventListener('scroll', on, { passive: true });
    window.addEventListener('resize', on);
    return () => {
      s.removeEventListener('scroll', on);
      window.removeEventListener('resize', on);
    };
  }, [editor]);

  const g = rulerGeometry(editor, ref.current);
  if (!g) return <div className="ml-ruler" ref={ref} data-testid="ruler" aria-hidden="true" />;

  const onDown = (handle: RulerHandle) => (e: ReactPointerEvent<HTMLElement>) => startRulerDrag(editor, ref.current!, handle, e, metric, setDrag);
  const { page, ticks, sliders } = rulerLayout(g, drag, metric);
  return (
    <div className="ml-ruler" ref={ref} data-testid="ruler" role="group" aria-label="Ruler">
      <div className="ml-ruler-page" style={{ left: page.left, width: page.width }} />
      {ticks.map((t) => (
        <span key={t.key} className={t.className} style={{ left: t.left }}>
          {t.label !== undefined && <span className="ml-tick-label">{t.label}</span>}
        </span>
      ))}
      {sliders.map((s) => (
        <span key={s.handle} className={s.className} role="slider" aria-label={s.label} aria-valuenow={s.value} tabIndex={-1} title={s.title} style={{ left: s.left, width: s.width }} onPointerDown={onDown(s.handle)} />
      ))}
    </div>
  );
}
