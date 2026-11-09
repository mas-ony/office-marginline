import { DOMSerializer, Fragment, type DOMOutputSpec, type Mark, type Node as PMNode, type ResolvedPos, Slice } from 'prosemirror-model';
import { Plugin } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { DocxDocument } from '../core/document';
import { ATTRS_DATA, schema } from '../core/model/schema';
import { REFRESH } from './meta';

export interface ClipboardHost {
  docx(): DocxDocument;
  insertImages(files: File[], pos?: number): void;
}

const ATTR_NODES = ['paragraph', 'table', 'table_row', 'table_cell', 'image', 'page_field', 'field_char', 'instr_text', 'bookmark_start', 'bookmark_end', 'footnote_ref', 'opaque_inline', 'opaque_block', 'section_break'];
const ATTR_MARKS = ['link', 'insertion', 'deletion', 'formatChange'];

function withAttrs(spec: DOMOutputSpec, attrs: Record<string, unknown>): DOMOutputSpec {
  const json = JSON.stringify(attrs);
  if (Array.isArray(spec)) {
    const [tag, second, ...rest] = spec as unknown[];
    if (second && typeof second === 'object' && !Array.isArray(second) && !(typeof Node !== 'undefined' && second instanceof Node)) {
      return [tag, { ...(second as Record<string, unknown>), [ATTRS_DATA]: json }, ...rest] as unknown as DOMOutputSpec;
    }
    return [tag, { [ATTRS_DATA]: json }, ...(second === undefined ? [] : [second]), ...rest] as unknown as DOMOutputSpec;
  }
  if (typeof HTMLElement !== 'undefined' && spec instanceof HTMLElement) spec.setAttribute(ATTRS_DATA, json);
  return spec;
}

/** Serializer for copying: like rendering, plus exact attributes so pastes back into the editor are lossless. */
export function clipboardSerializer(): DOMSerializer {
  const base = DOMSerializer.fromSchema(schema);
  const nodes = { ...base.nodes };
  const marks = { ...base.marks };
  for (const name of ATTR_NODES) {
    const type = schema.nodes[name];
    if (!type?.spec.toDOM) continue;
    const toDOM = type.spec.toDOM;
    nodes[name] = (node: PMNode) => withAttrs(toDOM(node), node.attrs);
  }
  for (const name of ATTR_MARKS) {
    const type = schema.marks[name];
    if (!type?.spec.toDOM) continue;
    const toDOM = type.spec.toDOM;
    marks[name] = (mark: Mark, inline: boolean) => withAttrs(toDOM(mark, inline), mark.attrs);
  }
  return new DOMSerializer(nodes, marks);
}

/** Remove Word's list-label spans and conditional comments from pasted HTML. */
export function cleanPastedHtml(html: string): string {
  if (!/mso-list|supportLists/i.test(html) || typeof DOMParser === 'undefined') return html;
  const cleaned = html.replace(/<!--\[if !supportLists\]-->[\s\S]*?<!--\[endif\]-->/gi, '').replace(/<!\[if !supportLists\]>[\s\S]*?<!\[endif\]>/gi, '');
  const doc = new DOMParser().parseFromString(cleaned, 'text/html');
  doc.querySelectorAll('[style]').forEach((e) => {
    if (/mso-list:\s*Ignore/i.test(e.getAttribute('style') ?? '')) e.remove();
  });
  return doc.body.innerHTML;
}

function dataUrlToBytes(url: string): { bytes: Uint8Array; type: string } | null {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
  if (!m) return null;
  const type = m[1] || 'application/octet-stream';
  if (!m[2]) return { bytes: new TextEncoder().encode(decodeURIComponent(m[3])), type };
  const bin = atob(m[3]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, type };
}

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/gif': 'gif', 'image/bmp': 'bmp', 'image/webp': 'webp', 'image/svg+xml': 'svg' };

/** Prepare pasted content: register pictures, convert pasted lists, drop comment anchors and revisions. */
function transformSlice(slice: Slice, docx: DocxDocument, pendingFetch: Set<string>): Slice {
  const listGroups = new Map<string, string>();
  const mapNodes = (frag: Fragment, inList: { last: string | null }): Fragment => {
    const out: PMNode[] = [];
    frag.forEach((node) => {
      if (node.isInline) {
        if (node.marks.some((m) => m.type === schema.marks.deletion)) return;
        const marks = node.marks.filter((m) => m.type !== schema.marks.comment && m.type !== schema.marks.insertion && m.type !== schema.marks.formatChange);
        if (node.type === schema.nodes.image) {
          const a = node.attrs;
          let attrs = a;
          if (!a.mediaPath || !docx.media.has(a.mediaPath)) {
            const data = typeof a.src === 'string' && a.src.startsWith('data:') ? dataUrlToBytes(a.src) : null;
            if (data && EXT[data.type]) {
              const path = docx.addMedia(data.bytes, data.type, EXT[data.type]);
              attrs = { ...a, mediaPath: path, src: docx.mediaUrl(path), raw: null, part: null };
            } else {
              attrs = { ...a, mediaPath: null, raw: null, part: null };
              if (a.src) pendingFetch.add(a.src);
            }
          }
          out.push(node.type.create(attrs, null, marks));
          return;
        }
        if (node.isText) out.push(schema.text(node.text!, marks));
        else out.push(node.mark(marks));
        return;
      }
      if (node.type === schema.nodes.paragraph) {
        const attrs: Record<string, unknown> = { ...node.attrs, trackIns: null, trackDel: null, pPrChange: null };
        const pl = node.attrs.pastedList as { kind: 'bullet' | 'ordered'; level: number; group?: string } | null;
        if (pl) {
          const key = `${pl.kind}:${pl.group ?? ''}`;
          let numId = listGroups.get(key);
          if (!numId || inList.last !== key) {
            numId = numId ?? docx.numbering.addList(pl.kind === 'bullet' ? 'bullet' : 'numberLatinRoman1');
            listGroups.set(key, numId);
          }
          inList.last = key;
          docx.styles.ensureStyle('ListParagraph');
          attrs.numPr = { numId, ilvl: Math.max(0, Math.min(8, pl.level)) };
          if (!attrs.styleId) attrs.styleId = 'ListParagraph';
          attrs.indent = null;
        } else inList.last = null;
        attrs.pastedList = null;
        out.push(node.type.create(attrs, mapNodes(node.content, inList), node.marks));
        return;
      }
      out.push(node.copy(mapNodes(node.content, { last: null })));
    });
    return Fragment.fromArray(out);
  };
  return new Slice(mapNodes(slice.content, { last: null }), slice.openStart, slice.openEnd);
}

async function fetchImages(view: EditorView, docx: DocxDocument, urls: Set<string>) {
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const blob = await res.blob();
      const type = blob.type || 'image/png';
      if (!EXT[type]) continue;
      const path = docx.addMedia(new Uint8Array(await blob.arrayBuffer()), type, EXT[type]);
      const src = docx.mediaUrl(path);
      const tr = view.state.tr;
      view.state.doc.descendants((node, pos) => {
        if (node.type === schema.nodes.image && node.attrs.src === url && !node.attrs.mediaPath) {
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, mediaPath: path, src });
        }
      });
      if (tr.docChanged) view.dispatch(tr.setMeta('addToHistory', false));
    } catch {
      // Cross-origin images that cannot be fetched stay display-only and are skipped on export.
    }
  }
}

function textSlice(text: string, $context: ResolvedPos): Slice {
  const marks = $context.marks().filter((m) => m.type !== schema.marks.comment && m.type !== schema.marks.link);
  const para = $context.parent.type === schema.nodes.paragraph ? $context.parent : null;
  const lineNodes = (line: string): PMNode[] => {
    const out: PMNode[] = [];
    line.split('\t').forEach((part, i) => {
      if (i > 0) out.push(schema.nodes.tab.create(null, null, marks));
      if (part) out.push(schema.text(part, marks));
    });
    return out;
  };
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const attrs = para ? { ...para.attrs, trackIns: null, trackDel: null } : null;
  return new Slice(Fragment.from(lines.map((l) => schema.nodes.paragraph.create(attrs, lineNodes(l)))), 1, 1);
}

export function clipboardPlugin(host: ClipboardHost): Plugin {
  const serializer = clipboardSerializer();
  return new Plugin({
    props: {
      clipboardSerializer: serializer,
      transformPastedHTML: (html) => cleanPastedHtml(html),
      transformPasted(slice, view) {
        const pending = new Set<string>();
        const out = transformSlice(slice, host.docx(), pending);
        if (pending.size) void fetchImages(view, host.docx(), pending);
        return out;
      },
      clipboardTextParser: (text, $context) => textSlice(text, $context),
      handlePaste(view, event) {
        const data = event.clipboardData;
        if (!data) return false;
        const files = Array.from(data.files).filter((f) => f.type.startsWith('image/'));
        if (!files.length) return false;
        const html = data.getData('text/html');
        const hasText = html ? new DOMParser().parseFromString(html, 'text/html').body.textContent?.trim() : '';
        if (hasText) return false;
        host.insertImages(files);
        view.dispatch(view.state.tr.setMeta(REFRESH, true));
        return true;
      },
      handleDrop(view, event, _slice, moved) {
        if (moved) return false;
        const files = Array.from((event as DragEvent).dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/'));
        if (!files.length) return false;
        const at = view.posAtCoords({ left: (event as DragEvent).clientX, top: (event as DragEvent).clientY });
        host.insertImages(files, at?.pos);
        event.preventDefault();
        return true;
      },
    },
  });
}

/** Read the clipboard and paste through the editor's normal paste pipeline. */
export async function pasteFromClipboard(view: EditorView, plain: boolean, insertImages: (files: File[]) => void): Promise<boolean> {
  try {
    if (!plain && navigator.clipboard?.read) {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        if (item.types.includes('text/html')) {
          view.pasteHTML(await (await item.getType('text/html')).text());
          return true;
        }
        const image = item.types.find((t) => t.startsWith('image/'));
        if (image) {
          const blob = await item.getType(image);
          insertImages([new File([blob], 'Pasted image', { type: image })]);
          return true;
        }
      }
    }
    const text = await navigator.clipboard.readText();
    view.pasteText(text);
    return true;
  } catch {
    return false;
  }
}
