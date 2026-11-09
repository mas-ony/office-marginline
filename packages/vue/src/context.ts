import type { DocxEditor, EditorSnapshot, EditorStore, Example, MarginlineUI, UIState } from '@marginline/core';
import { computed, type ComputedRef, inject, type InjectionKey, type ShallowRef } from 'vue';

export interface UIContext {
  ui: MarginlineUI;
  /** State of the interface; templates and computed values that read it follow it. */
  state: Readonly<ShallowRef<UIState>>;
  /** The editor's snapshot (read it through useSnapshot). */
  snapshot: Readonly<ShallowRef<EditorSnapshot>>;
  editor: DocxEditor;
  store: EditorStore;
  /** Where menus, dialogs and messages are rendered (on the page's body). */
  layer: HTMLElement;
  /** Documents for the Examples menu. */
  examples: ComputedRef<Example[]>;
}

export const UI_KEY: InjectionKey<UIContext> = Symbol('marginline-ui');

export function useUI(): UIContext {
  const v = inject(UI_KEY);
  if (!v) throw new Error('Marginline UI context missing');
  return v;
}

/** A value from the editor's snapshot; what reads it updates when the value changes. */
export function useSnapshot<T>(select: (s: EditorSnapshot) => T): ComputedRef<T> {
  const { snapshot } = useUI();
  return computed(() => select(snapshot.value));
}
