import type { Marginline, MarginlineOptions } from '@marginline/core';
import { createApp, h, shallowReactive } from 'vue';
import MarginlineEditor from './MarginlineEditor.vue';

export interface MountedEditor {
  /** Resolves with the page API instance once the initial document (or room) has opened. */
  ready: Promise<Marginline>;
  /** Change options, as new props would. */
  update(options: MarginlineOptions): void;
  /** Remove the editor from the page. */
  destroy(): void;
}

/** Render the editor into an element, without writing Vue code. */
export function mount(element: HTMLElement, options: MarginlineOptions = {}): MountedEditor {
  let resolve!: (ml: Marginline) => void;
  const ready = new Promise<Marginline>((r) => (resolve = r));
  const current = shallowReactive<MarginlineOptions>({ ...options });
  const app = createApp({
    render() {
      const { onReady, onUserChange, onThemeChange, onColorSchemeChange, ...props } = current;
      return h(MarginlineEditor, {
        ...props,
        onReady: (ml: Marginline) => {
          resolve(ml);
          onReady?.(ml);
        },
        'onUpdate:user': onUserChange,
        'onUpdate:theme': onThemeChange,
        'onUpdate:colorScheme': onColorSchemeChange,
      });
    },
  });
  app.mount(element);
  return {
    ready,
    update(next) {
      Object.assign(current, next);
    },
    destroy() {
      app.unmount();
    },
  };
}
