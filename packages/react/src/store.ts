import type { EditorSnapshot, EditorStore } from '@marginline/core';
import { useSyncExternalStore } from 'react';

/** A value from the editor's snapshot; the component renders again when it changes. */
export function useSnapshot<T>(store: EditorStore, select: (s: EditorSnapshot) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.getSnapshot()));
}
