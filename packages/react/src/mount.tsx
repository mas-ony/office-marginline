import type { Marginline, MarginlineOptions } from '@marginline/core';
import { createRoot } from 'react-dom/client';
import { MarginlineEditor } from './MarginlineEditor';

export interface MountedEditor {
  /** Resolves with the page API instance once the initial document (or room) has opened. */
  ready: Promise<Marginline>;
  /** Change options, as new props would. */
  update(options: MarginlineOptions): void;
  /** Remove the editor from the page. */
  destroy(): void;
}

/** Render the editor into an element, without writing React code. */
export function mount(element: HTMLElement, options: MarginlineOptions = {}): MountedEditor {
  const root = createRoot(element);
  let resolve!: (ml: Marginline) => void;
  const ready = new Promise<Marginline>((r) => (resolve = r));
  let current = options;
  const render = () => {
    const onReady = (ml: Marginline) => {
      resolve(ml);
      current.onReady?.(ml);
    };
    root.render(<MarginlineEditor {...current} onReady={onReady} />);
  };
  render();
  return {
    ready,
    update(next) {
      current = { ...current, ...next };
      render();
    },
    destroy() {
      root.unmount();
    },
  };
}
