import type { Node as PMNode } from 'prosemirror-model';
import { EditorState, Plugin } from 'prosemirror-state';
import { Decoration, DecorationSet, EditorView, type NodeViewConstructor } from 'prosemirror-view';
import type { DocxDocument } from '../core/document';
import { layoutTabs } from './layout/layout';
import type { NoteRef } from './noteRefs';
import { decorPlugin } from './plugins/decor';
import { numberingPlugin } from './plugins/numbering';
import { tableStylePlugin } from './plugins/tableStyle';

/** Shows the note's number at the start of its first paragraph. */
function labelPlugin(label: string): Plugin {
  return new Plugin({
    props: {
      decorations: (state) => {
        if (!label) return DecorationSet.empty;
        let at = -1;
        state.doc.descendants((node, pos) => {
          if (at >= 0) return false;
          if (node.isTextblock) {
            at = pos + 1;
            return false;
          }
          return true;
        });
        if (at < 0) return DecorationSet.empty;
        const widget = Decoration.widget(at, () => {
          const sup = document.createElement('sup');
          sup.className = 'ml-dx-note-num';
          sup.textContent = label;
          return sup;
        }, { side: -1 });
        return DecorationSet.create(state.doc, [widget]);
      },
    },
  });
}

export interface NotesHost {
  docx(): DocxDocument;
  zoom(): number;
  nodeViews(getDocx: () => DocxDocument): Record<string, NodeViewConstructor>;
}

interface Proto {
  view: EditorView;
  host: HTMLElement;
  width: number;
  height: number;
  valid: boolean;
  tabCache: WeakMap<PMNode, string>;
}

/**
 * Footnote and endnote bodies. They are shown read-only: each note is rendered once off-screen
 * (to measure it for pagination) and copied onto the pages that reference it.
 */
export class NotesManager {
  private protos = new Map<string, Proto>();
  private generation = 0;

  constructor(private host: NotesHost, private measureHost: HTMLElement) {}

  has(key: string): boolean {
    return this.host.docx().notes.has(key);
  }

  /** Re-measure every note (e.g. after web fonts finished loading). */
  invalidate() {
    for (const p of this.protos.values()) p.valid = false;
    this.generation++;
  }

  /** Forget the rendering of one note after its content changed. */
  noteChanged(key: string) {
    for (const [id, p] of this.protos) {
      if (!id.startsWith(`${key}|`)) continue;
      p.view.destroy();
      p.host.remove();
      this.protos.delete(id);
    }
    this.generation++;
  }

  reset() {
    for (const p of this.protos.values()) {
      p.view.destroy();
      p.host.remove();
    }
    this.protos.clear();
    this.generation++;
  }

  private proto(key: string, label: string, width: number): Proto | null {
    const doc = this.host.docx().notes.get(key);
    if (!doc) return null;
    const id = `${key}|${label}`;
    let p = this.protos.get(id);
    if (p && p.valid && Math.abs(p.width - width) < 0.5) return p;
    if (!p) {
      const host = document.createElement('div');
      host.className = 'ml-dx-hf-proto';
      this.measureHost.appendChild(host);
      const get = () => this.host.docx();
      const view = new EditorView(host, {
        state: EditorState.create({ doc, plugins: [numberingPlugin(get), decorPlugin(get), tableStylePlugin(get), labelPlugin(label)] }),
        editable: () => false,
        nodeViews: this.host.nodeViews(get),
        attributes: { class: 'ml-dx-doc ml-dx-note-doc' },
      });
      p = { view, host, width: 0, height: 0, valid: false, tabCache: new WeakMap() };
      this.protos.set(id, p);
    }
    if (!p.valid) p.tabCache = new WeakMap();
    p.host.style.width = `${width}px`;
    layoutTabs(p.view, this.host.docx(), this.host.zoom() || 1, p.tabCache);
    p.height = (p.view.dom as HTMLElement).offsetHeight;
    p.width = width;
    // A hidden measuring host (web view) reports zero; measure again once it is visible.
    p.valid = p.height > 0;
    return p;
  }

  height(key: string, label: string, width: number): number {
    return this.proto(key, label, width)?.height ?? 0;
  }

  /** Fill `area` with static copies of the notes, keeping its content when nothing changed. */
  render(area: HTMLElement, refs: NoteRef[], width: number) {
    const key = `${this.generation}@${Math.round(width)}@${refs.map((r) => `${r.key}|${r.label}`).join(',')}`;
    if (area.dataset.key === key) return;
    const parts: HTMLElement[] = [];
    for (const r of refs) {
      const p = this.proto(r.key, r.label, width);
      if (!p) continue;
      const clone = p.view.dom.cloneNode(true) as HTMLElement;
      clone.removeAttribute('contenteditable');
      clone.removeAttribute('translate');
      clone.classList.add('ml-dx-note');
      clone.dataset.note = r.key;
      parts.push(clone);
    }
    area.replaceChildren(...parts);
    area.dataset.key = key;
  }
}
