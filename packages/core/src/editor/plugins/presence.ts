import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

/** Another participant's cursor in a shared session. */
export interface RemoteCursor {
  clientID: string;
  name: string;
  color: string;
  anchor: number;
  head: number;
}

export const presenceKey = new PluginKey<DecorationSet>('ml-dx-presence');

function decorate(doc: PMNode, cursors: RemoteCursor[]): DecorationSet {
  const size = doc.content.size;
  const decos: Decoration[] = [];
  for (const c of cursors) {
    const head = Math.max(0, Math.min(size, c.head));
    const anchor = Math.max(0, Math.min(size, c.anchor));
    const from = Math.min(head, anchor);
    const to = Math.max(head, anchor);
    if (to > from) decos.push(Decoration.inline(from, to, { class: 'ml-dx-remote-sel', style: `background-color: ${c.color}33` }));
    decos.push(Decoration.widget(head, () => {
      const caret = document.createElement('span');
      caret.className = 'ml-dx-remote-caret';
      caret.style.borderColor = c.color;
      const label = document.createElement('span');
      label.className = 'ml-dx-remote-name';
      label.style.backgroundColor = c.color;
      label.textContent = c.name;
      caret.appendChild(label);
      return caret;
    }, { key: `${c.clientID}:${c.name}:${c.color}`, side: 1, ignoreSelection: true }));
  }
  return DecorationSet.create(doc, decos);
}

/** Shows remote cursors; set them with tr.setMeta(presenceKey, cursors). */
export function presencePlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: presenceKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, prev, _old, state) {
        const cursors = tr.getMeta(presenceKey) as RemoteCursor[] | undefined;
        if (cursors) return decorate(state.doc, cursors);
        return tr.docChanged ? prev.map(tr.mapping, tr.doc) : prev;
      },
    },
    props: { decorations: (state) => presenceKey.getState(state) },
  });
}
