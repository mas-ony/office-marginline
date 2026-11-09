import type { Transaction } from 'prosemirror-state';
import type { DocxDocument } from '../core/document';

/** Transaction meta that asks decoration plugins to recompute (styles or numbering changed). */
export const REFRESH = 'ml-dx-refresh';

/** Transaction meta marking edits that must not be turned into tracked changes. */
export const NO_TRACK = 'ml-dx-no-track';

export function needsRefresh(tr: Transaction): boolean {
  return tr.docChanged || !!tr.getMeta(REFRESH);
}

/** Accessor for the document context; plugins call it lazily so documents can be swapped. */
export type DocxGetter = () => DocxDocument;

/** Transaction meta: steps received from collaborators (applied as they are, never tracked). */
export const REMOTE = 'ml-dx-remote';
