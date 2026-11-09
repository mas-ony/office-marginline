import type { Mark, Node as PMNode } from 'prosemirror-model';
import { TableMap } from 'prosemirror-tables';
import type { DocxDocument } from '../document';
import { sortChildren } from '../ooxml/order';
import { CT, IMAGE_CONTENT_TYPES, OoxmlPackage, REL, relTypeIs, type Relationship } from '../ooxml/package';
import { marksToRunProps, type RunMarkInfo } from '../model/marks';
import { buildBorders, buildParaProps, buildRunProps, buildSection, buildShading } from '../model/props';
import { schema } from '../model/schema';
import type { CommentThread, ParaProps, SectionProps, TrackInfo } from '../model/types';
import { NS, WORD_IGNORABLE } from '../xml/namespaces';
import {
  child,
  cloneXml,
  el,
  elements,
  findAll,
  findFirst,
  parseFragment,
  parseFragments,
  parseXml,
  serializeXml,
  txt,
  type XmlElement,
  type XmlNode,
} from '../xml/xml';

export interface ExportOptions {
  /** Persist "track changes" as on (w:trackRevisions) in settings. */
  trackRevisions?: boolean;
  /** Current header/footer contents keyed by part path (defaults to the parts in `doc`). */
  headerFooters?: Map<string, PMNode>;
  /** Comment threads to write (defaults to doc.comments). */
  comments?: Map<string, CommentThread>;
  now?: Date;
  author?: string;
}

const ALL_NAMESPACES: Record<string, string> = Object.fromEntries(Object.entries(NS).filter(([p]) => p !== 'xml'));

/** Run-level elements that can be stored as opaque content inside a w:r. */
const RUN_LEVEL = new Set([
  'w:drawing', 'w:pict', 'w:object', 'mc:AlternateContent', 'w:sym', 'w:ruby', 'w:contentPart',
  'w:fldData', 'w:ptab', 'w:dayShort', 'w:monthShort', 'w:yearShort', 'w:dayLong', 'w:monthLong',
  'w:yearLong', 'w:pgNum', 'w:annotationRef', 'w:separator', 'w:continuationSeparator',
]);

interface Item {
  xml: XmlElement;
  field: Mark | null;
  link: Mark | null;
  ins: Mark | null;
  del: Mark | null;
}

const sameMark = (a: Mark | null, b: Mark | null) => (a === null ? b === null : b !== null && a.eq(b));
const sameField = (a: Mark | null, b: Mark | null) => (a === null ? b === null : b !== null && a.attrs.id === b.attrs.id);

/** Properties of a content control: the imported w:sdtPr (placeholder flag updated) or new ones. */
function fieldProps(field: Mark): XmlElement {
  const a = field.attrs;
  const pr = a.raw ? parseFragment(a.raw) : el('w:sdtPr', {}, [
    a.alias ? el('w:alias', { 'w:val': a.alias }) : null,
    a.tag ? el('w:tag', { 'w:val': a.tag }) : null,
    el('w:id', { 'w:val': /^-?\d+$/.test(a.id) ? a.id : String(Math.abs(hashId(a.id))) }),
    el('w:text'),
  ]);
  pr.children = pr.children.filter((c) => !(c.type === 'element' && c.name === 'w:showingPlcHdr'));
  if (a.placeholder) pr.children.push(el('w:showingPlcHdr'));
  return pr;
}

function hashId(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

/** Shared counters and registries for one export. */
class ExportState {
  revId = 1;
  docPrId = 1;
  paraId = 0x1a2b0000;
  bookmarkIds = new Set<string>();
  media = new Set<string>();
  constructor(readonly doc: DocxDocument, readonly pkg: OoxmlPackage, readonly now: Date) {}

  nextParaId(): string {
    this.paraId += 0x11;
    return (this.paraId & 0x7fffffff).toString(16).toUpperCase().padStart(8, '0');
  }
}

/** Relationship bookkeeping for one part. */
class PartRels {
  rels: Relationship[];
  constructor(private readonly st: ExportState, readonly path: string) {
    this.rels = [...st.pkg.getRels(path)];
  }

  private nextId(): string {
    const used = new Set(this.rels.map((r) => r.id));
    let n = this.rels.length + 1;
    while (used.has(`rId${n}`)) n++;
    return `rId${n}`;
  }

  /** Relationship to another part (absolute path) of the given type. */
  toPart(type: string, absPath: string): string {
    const pkg = this.st.pkg;
    const found = this.rels.find((r) => relTypeIs(r.type, type) && r.targetMode !== 'External' && pkg.resolveTarget(this.path, r.target) === absPath);
    if (found) return found.id;
    const id = this.nextId();
    this.rels.push({ id, type, target: pkg.relativeTarget(this.path, absPath) });
    return id;
  }

  external(type: string, target: string): string {
    const found = this.rels.find((r) => relTypeIs(r.type, type) && r.targetMode === 'External' && r.target === target);
    if (found) return found.id;
    const id = this.nextId();
    this.rels.push({ id, type, target, targetMode: 'External' });
    return id;
  }

  /** Re-point r:* attributes of XML copied from another part. */
  remap(e: XmlElement, fromPart: string | null) {
    if (!fromPart || fromPart === this.path) return;
    const source = new Map(this.st.pkg.getRels(fromPart).map((r) => [r.id, r]));
    const walk = (x: XmlElement) => {
      for (const [k, v] of Object.entries(x.attrs)) {
        if (!k.startsWith('r:')) continue;
        const rel = source.get(v);
        if (!rel) continue;
        x.attrs[k] = rel.targetMode === 'External'
          ? this.external(rel.type, rel.target)
          : this.toPart(rel.type, this.st.pkg.resolveTarget(fromPart, rel.target));
      }
      for (const c of elements(x)) walk(c);
    };
    walk(e);
  }

  write() {
    if (this.rels.length || this.st.pkg.getRels(this.path).length) this.st.pkg.setRels(this.path, this.rels);
  }
}

interface CommentRanges {
  start: Map<number, string[]>;
  end: Map<number, string[]>;
  ids: Set<string>;
}

/** Find the first/last inline leaf index of every comment in a part. */
function commentRanges(doc: PMNode, threads: Map<string, CommentThread>): CommentRanges {
  const first = new Map<string, number>();
  const last = new Map<string, number>();
  let idx = 0;
  doc.descendants((node) => {
    if (!node.isInline) return true;
    for (const m of node.marks) {
      if (m.type !== schema.marks.comment) continue;
      const id = m.attrs.id as string;
      if (!first.has(id)) first.set(id, idx);
      last.set(id, idx);
    }
    idx++;
    return false;
  });
  const start = new Map<number, string[]>();
  const end = new Map<number, string[]>();
  const ids = new Set<string>();
  for (const [id, f] of first) {
    const thread = threads.get(id);
    if (!thread) continue;
    const members = [id, ...thread.replies.map((r) => r.id)];
    members.forEach((m) => ids.add(m));
    start.set(f, [...(start.get(f) ?? []), ...members]);
    const l = last.get(id)!;
    end.set(l, [...(end.get(l) ?? []), ...members]);
  }
  return { start, end, ids };
}

class ContentWriter {
  private inlineIndex = 0;

  constructor(private readonly st: ExportState, private readonly rels: PartRels, private readonly ranges: CommentRanges) {}

  private trackAttrs(info: TrackInfo | Mark['attrs']): Record<string, string> {
    return { 'w:id': String(this.st.revId++), 'w:author': info.author || 'Unknown', ...(info.date ? { 'w:date': info.date } : {}) };
  }

  blocks(nodes: readonly PMNode[]): XmlElement[] {
    const out: XmlElement[] = [];
    for (const node of nodes) {
      switch (node.type.name) {
        case 'paragraph':
          out.push(this.paragraph(node));
          break;
        case 'table':
          out.push(this.table(node));
          break;
        case 'section_break': {
          const sectPr = this.sectPr(node.attrs.section as SectionProps);
          const prev = out[out.length - 1];
          if (prev && prev.name === 'w:p') {
            let pPr = child(prev, 'w:pPr');
            if (!pPr) {
              pPr = el('w:pPr');
              prev.children.unshift(pPr);
            }
            pPr.children.push(sectPr);
            sortChildren(pPr);
          } else {
            out.push(el('w:p', {}, [el('w:pPr', {}, [sectPr])]));
          }
          break;
        }
        case 'opaque_block': {
          const x = parseFragment(node.attrs.xml);
          this.rels.remap(x, node.attrs.part);
          this.renumberDocPr(x);
          out.push(x);
          break;
        }
      }
    }
    return out;
  }

  sectPr(sp: SectionProps): XmlElement {
    return buildSection(
      sp,
      (path, kind) => this.rels.toPart(kind === 'header' ? REL.header : REL.footer, path),
      parseFragments(sp.raw),
    );
  }

  paragraph(node: PMNode): XmlElement {
    const a = node.attrs;
    const props: ParaProps = {};
    const set = <K extends keyof ParaProps>(k: K, v: ParaProps[K] | null) => {
      if (v !== null && v !== undefined) props[k] = v;
    };
    set('styleId', a.styleId);
    set('keepNext', a.keepNext);
    set('keepLines', a.keepLines);
    set('pageBreakBefore', a.pageBreakBefore);
    set('widowControl', a.widowControl);
    set('numPr', a.numPr);
    set('borders', a.borders);
    set('shading', a.shading);
    set('tabs', a.tabs);
    set('bidi', a.bidi);
    set('spacing', a.spacing);
    set('indent', a.indent);
    set('contextualSpacing', a.contextualSpacing);
    set('align', a.align);
    set('outlineLvl', a.outlineLvl);
    const markExtra: XmlElement[] = [];
    if (a.trackIns) markExtra.push(el('w:ins', this.trackAttrs(a.trackIns)));
    if (a.trackDel) markExtra.push(el('w:del', this.trackAttrs(a.trackDel)));
    const markRPr = buildRunProps(a.markProps ?? {}, parseFragments(a.markRaw), markExtra);
    const extra: XmlElement[] = [];
    if (markRPr) extra.push(markRPr);
    if (a.pPrChange) {
      const change = parseFragment(a.pPrChange);
      change.attrs['w:id'] = String(this.st.revId++);
      extra.push(change);
    }
    const pPr = buildParaProps(props, parseFragments(a.raw), extra);
    return el('w:p', {}, [pPr, ...this.inline(node)]);
  }

  // -------------------------------------------------------------------------------------------
  // Inline

  private rPr(info: RunMarkInfo): XmlElement | null {
    const extra: XmlElement[] = [];
    if (info.formatChange) {
      const fc = info.formatChange.attrs;
      const old = buildRunProps(fc.oldProps ?? {}, [], [], 'w:rPr') ?? el('w:rPr');
      extra.push(el('w:rPrChange', this.trackAttrs(fc), [old]));
    }
    return buildRunProps(info.props, parseFragments(info.rawXml), extra);
  }

  private textContent(text: string, deleted: boolean): XmlElement[] {
    const out: XmlElement[] = [];
    let buf = '';
    const flush = () => {
      if (!buf) return;
      const preserve = /^\s|\s$|\s\s/.test(buf) ? { 'xml:space': 'preserve' } : {};
      out.push(el(deleted ? 'w:delText' : 'w:t', preserve, [txt(buf)]));
      buf = '';
    };
    for (const ch of text) {
      if (ch === '\t') { flush(); out.push(el('w:tab')); }
      else if (ch === '\n' || ch === '\r') { flush(); out.push(el('w:br')); }
      else if (ch === '­') { flush(); out.push(el('w:softHyphen')); }
      else if (ch === '‑') { flush(); out.push(el('w:noBreakHyphen')); }
      else buf += ch;
    }
    flush();
    return out;
  }

  private renumberDocPr(x: XmlElement) {
    for (const d of findAll(x, 'wp:docPr')) d.attrs.id = String(this.st.docPrId++);
    if (x.name === 'wp:docPr') x.attrs.id = String(this.st.docPrId++);
  }

  imageXml(node: PMNode): XmlElement {
    const a = node.attrs;
    const cx = Math.max(1, Math.round(a.width));
    const cy = Math.max(1, Math.round(a.height));
    const relId = a.mediaPath ? this.rels.toPart(REL.image, a.mediaPath) : undefined;
    if (a.mediaPath) this.st.media.add(a.mediaPath);
    if (a.raw) {
      const x = parseFragment(a.raw);
      this.rels.remap(x, a.part);
      const drawing = x.name === 'w:drawing' ? x : findFirst(x, 'w:drawing');
      if (drawing) {
        const container = child(drawing, 'wp:inline') ?? child(drawing, 'wp:anchor');
        const extent = child(container, 'wp:extent');
        if (extent) {
          extent.attrs.cx = String(cx);
          extent.attrs.cy = String(cy);
        }
        const pic = container ? findFirst(container, 'pic:pic') : undefined;
        const ext = pic ? findFirst(child(pic, 'pic:spPr') ?? pic, 'a:ext') : undefined;
        if (ext) {
          ext.attrs.cx = String(cx);
          ext.attrs.cy = String(cy);
        }
        const blip = pic ? findFirst(pic, 'a:blip') : undefined;
        if (blip && relId) blip.attrs['r:embed'] = relId;
        const docPr = child(container, 'wp:docPr');
        if (docPr) {
          if (a.alt) docPr.attrs.descr = a.alt;
          else delete docPr.attrs.descr;
        }
      }
      this.renumberDocPr(x);
      return x;
    }
    const id = this.st.docPrId++;
    const name = a.name || `Picture ${id}`;
    return el('w:drawing', {}, [
      el('wp:inline', { distT: 0, distB: 0, distL: 0, distR: 0 }, [
        el('wp:extent', { cx, cy }),
        el('wp:effectExtent', { l: 0, t: 0, r: 0, b: 0 }),
        el('wp:docPr', { id, name, descr: a.alt || undefined, title: a.title || undefined }),
        el('wp:cNvGraphicFramePr', {}, [el('a:graphicFrameLocks', { noChangeAspect: 1 })]),
        el('a:graphic', {}, [
          el('a:graphicData', { uri: 'http://schemas.openxmlformats.org/drawingml/2006/picture' }, [
            el('pic:pic', {}, [
              el('pic:nvPicPr', {}, [el('pic:cNvPr', { id: 0, name }), el('pic:cNvPicPr')]),
              el('pic:blipFill', {}, [el('a:blip', { 'r:embed': relId ?? '' }), el('a:stretch', {}, [el('a:fillRect')])]),
              el('pic:spPr', {}, [
                el('a:xfrm', {}, [el('a:off', { x: 0, y: 0 }), el('a:ext', { cx, cy })]),
                el('a:prstGeom', { prst: 'rect' }, [el('a:avLst')]),
              ]),
            ]),
          ]),
        ]),
      ]),
    ]);
  }

  private nodeXml(node: PMNode, info: RunMarkInfo): { run?: XmlElement[]; marker?: XmlElement; para?: XmlElement } {
    const deleted = !!info.deletion;
    const run = (...content: XmlElement[]) => el('w:r', {}, [this.rPr(info), ...content]);
    switch (node.type.name) {
      case 'text':
        return { run: [run(...this.textContent(node.text ?? '', deleted))] };
      case 'tab':
        return { run: [run(el('w:tab'))] };
      case 'hard_break':
        return { run: [run(el('w:br', { 'w:clear': node.attrs.clear ?? undefined }))] };
      case 'page_break':
        return { run: [run(el('w:br', { 'w:type': 'page' }))] };
      case 'column_break':
        return { run: [run(el('w:br', { 'w:type': 'column' }))] };
      case 'image':
        // Pictures without stored bytes (e.g. pasted cross-origin images) cannot be written.
        if (!node.attrs.mediaPath && !node.attrs.raw) return {};
        return { run: [run(this.imageXml(node))] };
      case 'page_field': {
        const instr = node.attrs.instr || ` ${node.attrs.kind} `;
        return {
          run: [
            run(el('w:fldChar', { 'w:fldCharType': 'begin' })),
            run(el(deleted ? 'w:delInstrText' : 'w:instrText', { 'xml:space': 'preserve' }, [txt(instr)])),
            run(el('w:fldChar', { 'w:fldCharType': 'separate' })),
            run(...this.textContent('1', deleted)),
            run(el('w:fldChar', { 'w:fldCharType': 'end' })),
          ],
        };
      }
      case 'field_char':
        return { run: [run(node.attrs.raw ? parseFragment(node.attrs.raw) : el('w:fldChar', { 'w:fldCharType': node.attrs.type }))] };
      case 'instr_text':
        return { run: [run(el(deleted ? 'w:delInstrText' : 'w:instrText', { 'xml:space': 'preserve' }, [txt(node.attrs.text)]))] };
      case 'bookmark_start': {
        const id = String(node.attrs.id);
        if (this.st.bookmarkIds.has(id)) return {};
        this.st.bookmarkIds.add(id);
        return { marker: el('w:bookmarkStart', { 'w:id': id, 'w:name': node.attrs.name }) };
      }
      case 'bookmark_end':
        return { marker: el('w:bookmarkEnd', { 'w:id': String(node.attrs.id) }) };
      case 'footnote_ref':
        return {
          run: [run(node.attrs.raw ? parseFragment(node.attrs.raw) : el(node.attrs.kind === 'endnote' ? 'w:endnoteReference' : 'w:footnoteReference', { 'w:id': node.attrs.id }))],
        };
      case 'opaque_inline': {
        const x = parseFragment(node.attrs.xml);
        this.rels.remap(x, node.attrs.part);
        this.renumberDocPr(x);
        if (RUN_LEVEL.has(x.name)) return { run: [run(x)] };
        return { para: x };
      }
      default:
        return {};
    }
  }

  inline(para: PMNode): XmlNode[] {
    const items: Item[] = [];
    para.forEach((node) => {
      const idx = this.inlineIndex++;
      const info = marksToRunProps(node.marks);
      const link = info.link && !info.link.attrs.fromField ? info.link : null;
      const field = info.field ?? null;
      const ins = info.insertion ?? null;
      const del = info.deletion ?? null;
      const push = (xml: XmlElement, revs = true) => items.push({ xml, field, link, ins: revs ? ins : null, del: revs ? del : null });
      for (const id of this.ranges.start.get(idx) ?? []) push(el('w:commentRangeStart', { 'w:id': id }));
      const out = this.nodeXml(node, info);
      if (out.marker) push(out.marker);
      if (out.para) push(out.para);
      for (const r of out.run ?? []) push(r);
      for (const id of this.ranges.end.get(idx) ?? []) {
        push(el('w:commentRangeEnd', { 'w:id': id }));
        push(el('w:r', {}, [el('w:rPr', {}, [el('w:rStyle', { 'w:val': 'CommentReference' })]), el('w:commentReference', { 'w:id': id })]), false);
      }
    });
    return this.groupFields(items);
  }

  /** Runs inside the same field become one inline content control. */
  private groupFields(items: Item[]): XmlNode[] {
    const out: XmlNode[] = [];
    let i = 0;
    while (i < items.length) {
      const field = items[i].field;
      let j = i;
      while (j < items.length && sameField(items[j].field, field)) j++;
      const inner = this.groupLinks(items.slice(i, j));
      if (field) out.push(el('w:sdt', {}, [fieldProps(field), el('w:sdtContent', {}, inner)]));
      else out.push(...inner);
      i = j;
    }
    return out;
  }

  private groupLinks(items: Item[]): XmlNode[] {
    const out: XmlNode[] = [];
    let i = 0;
    while (i < items.length) {
      const link = items[i].link;
      let j = i;
      while (j < items.length && sameMark(items[j].link, link)) j++;
      const inner = this.groupRevisions(items.slice(i, j));
      if (link) {
        const a = link.attrs;
        const attrs: Record<string, string | undefined> = {};
        if (a.href) attrs['r:id'] = this.rels.external(REL.hyperlink, a.href);
        if (a.anchor) attrs['w:anchor'] = a.anchor;
        if (a.tooltip) attrs['w:tooltip'] = a.tooltip;
        attrs['w:history'] = '1';
        out.push(el('w:hyperlink', attrs, inner));
      } else out.push(...inner);
      i = j;
    }
    return out;
  }

  private groupRevisions(items: Item[]): XmlNode[] {
    const out: XmlNode[] = [];
    let i = 0;
    while (i < items.length) {
      const { ins, del } = items[i];
      let j = i;
      while (j < items.length && sameMark(items[j].ins, ins) && sameMark(items[j].del, del)) j++;
      let group: XmlNode[] = items.slice(i, j).map((it) => it.xml);
      if (del) group = [el('w:del', this.trackAttrs(del.attrs), group)];
      if (ins) group = [el('w:ins', this.trackAttrs(ins.attrs), group)];
      out.push(...group);
      i = j;
    }
    return out;
  }

  // -------------------------------------------------------------------------------------------
  // Tables

  table(node: PMNode): XmlElement {
    const a = node.attrs;
    const map = TableMap.get(node);
    const { width, height } = map;
    // Column widths in twips.
    const cols: (number | undefined)[] = new Array(width).fill(undefined);
    const grid = (a.grid as number[] | null) ?? [];
    const seen = new Set<number>();
    for (const pos of map.map) {
      if (seen.has(pos)) continue;
      seen.add(pos);
      const cell = node.nodeAt(pos)!;
      const rect = map.findCell(pos);
      const cw = cell.attrs.colwidth as number[] | null;
      cw?.forEach((w, k) => {
        const c = rect.left + k;
        if (!w || cols[c] !== undefined) return;
        // Pixel widths are rounded; keep the imported width when the column was not resized.
        cols[c] = grid[c] !== undefined && Math.abs(grid[c] / 15 - w) < 1 ? grid[c] : Math.round(w * 15);
      });
    }
    const tableTwips = a.width?.type === 'dxa' && a.width.value ? a.width.value : 9360;
    for (let c = 0; c < width; c++) if (cols[c] === undefined) cols[c] = grid[c] ?? Math.round(tableTwips / width);

    const tblPrKids: XmlElement[] = [];
    if (a.styleId) tblPrKids.push(el('w:tblStyle', { 'w:val': a.styleId }));
    if (a.width) {
      tblPrKids.push(a.width.type === 'pct'
        ? el('w:tblW', { 'w:w': Math.round(a.width.value * 50), 'w:type': 'pct' })
        : el('w:tblW', { 'w:w': Math.round(a.width.value), 'w:type': a.width.type }));
    } else tblPrKids.push(el('w:tblW', { 'w:w': 0, 'w:type': 'auto' }));
    if (a.align) tblPrKids.push(el('w:jc', { 'w:val': a.align }));
    if (a.indent !== null && a.indent !== undefined) tblPrKids.push(el('w:tblInd', { 'w:w': a.indent, 'w:type': 'dxa' }));
    if (a.borders) tblPrKids.push(buildBorders('w:tblBorders', a.borders));
    if (a.shading) tblPrKids.push(buildShading(a.shading));
    if (a.layout) tblPrKids.push(el('w:tblLayout', { 'w:type': a.layout }));
    if (a.cellMargins) {
      const m = a.cellMargins;
      tblPrKids.push(sortChildren(el('w:tblCellMar', {}, (['top', 'left', 'bottom', 'right'] as const)
        .filter((s) => m[s] !== undefined)
        .map((s) => el(`w:${s}`, { 'w:w': m[s], 'w:type': 'dxa' })))));
    }
    // Tables without w:tblLook keep it absent (new tables get Word's default look on insert).
    const look = a.look;
    if (look) {
      const lookVal = (look.firstRow ? 0x20 : 0) | (look.lastRow ? 0x40 : 0) | (look.firstColumn ? 0x80 : 0) | (look.lastColumn ? 0x100 : 0) | (look.noHBand ? 0x200 : 0) | (look.noVBand ? 0x400 : 0);
      tblPrKids.push(el('w:tblLook', {
        'w:val': lookVal.toString(16).toUpperCase().padStart(4, '0'),
        'w:firstRow': look.firstRow ? 1 : 0,
        'w:lastRow': look.lastRow ? 1 : 0,
        'w:firstColumn': look.firstColumn ? 1 : 0,
        'w:lastColumn': look.lastColumn ? 1 : 0,
        'w:noHBand': look.noHBand ? 1 : 0,
        'w:noVBand': look.noVBand ? 1 : 0,
      }));
    }
    tblPrKids.push(...parseFragments(a.raw));
    const tblPr = sortChildren(el('w:tblPr', {}, tblPrKids));
    const tblGrid = el('w:tblGrid', {}, cols.map((w) => el('w:gridCol', { 'w:w': w })));

    const rows: XmlElement[] = [];
    for (let r = 0; r < height; r++) {
      const rowNode = node.child(r);
      const tcs: XmlElement[] = [];
      let gridBefore = 0;
      let gridAfter = 0;
      let c = 0;
      while (c < width) {
        const pos = map.map[r * width + c];
        const cell = node.nodeAt(pos)!;
        const rect = map.findCell(pos);
        const span = rect.right - rect.left;
        const twips = cols.slice(rect.left, rect.right).reduce<number>((sum, w) => sum + (w ?? 0), 0);
        if (cell.attrs.placeholder === 'before') gridBefore += span;
        else if (cell.attrs.placeholder === 'after') gridAfter += span;
        else if (rect.top === r) tcs.push(this.cell(cell, span, twips, rect.bottom - rect.top > 1 ? 'restart' : null));
        else tcs.push(this.cell(cell, span, twips, 'continue'));
        c = rect.right;
      }
      const ra = rowNode.attrs;
      const trKids: XmlElement[] = [];
      if (gridBefore) trKids.push(el('w:gridBefore', { 'w:val': gridBefore }));
      if (gridAfter) trKids.push(el('w:gridAfter', { 'w:val': gridAfter }));
      if (ra.cantSplit) trKids.push(el('w:cantSplit'));
      if (ra.height) trKids.push(el('w:trHeight', { 'w:val': ra.height, 'w:hRule': ra.heightRule ?? undefined }));
      if (ra.header) trKids.push(el('w:tblHeader'));
      const rawRow = parseFragments(ra.raw);
      const tblPrEx = rawRow.filter((x) => x.name === 'w:tblPrEx');
      trKids.push(...rawRow.filter((x) => x.name !== 'w:tblPrEx'));
      const trPr = trKids.length ? sortChildren(el('w:trPr', {}, trKids)) : null;
      rows.push(el('w:tr', {}, [...tblPrEx, trPr, ...tcs]));
    }
    return el('w:tbl', {}, [tblPr, tblGrid, ...rows]);
  }

  private cell(cell: PMNode, span: number, twips: number, vMerge: 'restart' | 'continue' | null): XmlElement {
    const a = cell.attrs;
    const kids: XmlElement[] = [];
    if (a.width && a.width.type === 'pct') kids.push(el('w:tcW', { 'w:w': Math.round(a.width.value * 50), 'w:type': 'pct' }));
    else kids.push(el('w:tcW', { 'w:w': twips || a.width?.value || 0, 'w:type': 'dxa' }));
    if (span > 1) kids.push(el('w:gridSpan', { 'w:val': span }));
    if (vMerge === 'restart') kids.push(el('w:vMerge', { 'w:val': 'restart' }));
    else if (vMerge === 'continue') kids.push(el('w:vMerge'));
    if (a.borders) kids.push(buildBorders('w:tcBorders', a.borders));
    if (a.shading) kids.push(buildShading(a.shading));
    if (a.noWrap) kids.push(el('w:noWrap'));
    if (a.margins) {
      const m = a.margins;
      kids.push(sortChildren(el('w:tcMar', {}, (['top', 'left', 'bottom', 'right'] as const)
        .filter((s) => m[s] !== undefined)
        .map((s) => el(`w:${s}`, { 'w:w': m[s], 'w:type': 'dxa' })))));
    }
    if (a.vAlign) kids.push(el('w:vAlign', { 'w:val': a.vAlign }));
    kids.push(...parseFragments(a.raw));
    const tcPr = sortChildren(el('w:tcPr', {}, kids));
    if (vMerge === 'continue') return el('w:tc', {}, [tcPr, el('w:p')]);
    const content: PMNode[] = [];
    cell.forEach((n) => content.push(n));
    const blocks = this.blocks(content);
    if (!blocks.length || blocks[blocks.length - 1].name !== 'w:p') blocks.push(el('w:p'));
    return el('w:tc', {}, [tcPr, ...blocks]);
  }
}

// ---------------------------------------------------------------------------------------------

function wordRoot(name: string, attrs: Record<string, string>, children: XmlNode[]): string {
  const a = { ...attrs };
  const ignorable = (a['mc:Ignorable'] ?? WORD_IGNORABLE).split(/\s+/).filter((p) => p && (p in ALL_NAMESPACES));
  a['mc:Ignorable'] = ignorable.join(' ');
  return serializeXml({ type: 'element', name, attrs: a, children }, { namespaces: ALL_NAMESPACES });
}

function setFlag(root: XmlElement, name: string, on: boolean) {
  const idx = root.children.findIndex((c) => c.type === 'element' && c.name === name);
  if (on && idx < 0) root.children.push(el(name));
  if (!on && idx >= 0) root.children.splice(idx, 1);
}

function ensurePartRel(pkg: OoxmlPackage, from: string, type: string, defaultPath: string, contentType: string): string {
  const rel = pkg.getRels(from).find((r) => relTypeIs(r.type, type));
  if (rel) return pkg.resolveTarget(from, rel.target);
  pkg.addRel(from, type, pkg.relativeTarget(from, defaultPath));
  pkg.contentTypes.overrides.set(defaultPath, contentType);
  return defaultPath;
}

function commentElement(st: ExportState, c: { id: string; author: string; initials?: string; date?: string; text: string }, paraIds: string[]): XmlElement {
  const lines = c.text.split('\n');
  const paras = lines.map((line, i) => {
    const pid = st.nextParaId();
    paraIds.push(pid);
    return el('w:p', { 'w14:paraId': pid, 'w14:textId': '77777777' }, [
      el('w:pPr', {}, [el('w:pStyle', { 'w:val': 'CommentText' })]),
      i === 0 ? el('w:r', {}, [el('w:rPr', {}, [el('w:rStyle', { 'w:val': 'CommentReference' })]), el('w:annotationRef')]) : null,
      line ? el('w:r', {}, [el('w:t', /^\s|\s$|\s\s/.test(line) ? { 'xml:space': 'preserve' } : {}, [txt(line)])]) : null,
    ]);
  });
  return el('w:comment', {
    'w:id': c.id,
    'w:author': c.author || 'Unknown',
    'w:date': c.date ?? undefined,
    'w:initials': c.initials ?? (c.author ? c.author.split(/\s+/).map((p) => p[0]).join('').slice(0, 3) : undefined),
  }, paras);
}

/** Serialize the document. `body` is the current editor document. */
export function exportDocx(doc: DocxDocument, body: PMNode, opts: ExportOptions = {}): Uint8Array {
  const pkg = doc.pkg.clone();
  const st = new ExportState(doc, pkg, opts.now ?? new Date());
  const threads = opts.comments ?? doc.comments;
  const hfDocs = opts.headerFooters ?? new Map([...doc.headerFooters].map(([p, part]) => [p, part.doc]));

  // Main document.
  const mainRels = new PartRels(st, doc.mainPath);
  const bodyRanges = commentRanges(body, threads);
  const writer = new ContentWriter(st, mainRels, bodyRanges);
  const blocks: PMNode[] = [];
  body.forEach((n) => blocks.push(n));
  const bodyChildren: XmlNode[] = writer.blocks(blocks);
  bodyChildren.push(writer.sectPr(body.attrs.finalSection as SectionProps));
  const extras = doc.documentExtraXml.flatMap((x) => parseFragments(x));

  // Headers and footers referenced by sections.
  const sections: SectionProps[] = [];
  body.forEach((n) => { if (n.type === schema.nodes.section_break) sections.push(n.attrs.section); });
  sections.push(body.attrs.finalSection);
  const usedComments = new Set(bodyRanges.ids);
  const writtenParts = new Set<string>();
  for (const sp of sections) {
    for (const [kind, refs] of [['header', sp.headers], ['footer', sp.footers]] as const) {
      for (const path of Object.values(refs)) {
        if (!path || writtenParts.has(path)) continue;
        writtenParts.add(path);
        const hdoc = hfDocs.get(path);
        if (!hdoc) continue;
        const part = doc.headerFooters.get(path);
        const rels = new PartRels(st, path);
        const ranges = commentRanges(hdoc, threads);
        ranges.ids.forEach((id) => usedComments.add(id));
        const w = new ContentWriter(st, rels, ranges);
        const kids: PMNode[] = [];
        hdoc.forEach((n) => kids.push(n));
        const content = w.blocks(kids);
        if (!content.length) content.push(el('w:p'));
        const rootName = kind === 'header' ? 'w:hdr' : 'w:ftr';
        pkg.setText(path, wordRoot(rootName, part?.rootAttrs ?? {}, content), kind === 'header' ? CT.header : CT.footer);
        rels.write();
      }
    }
  }

  // Footnotes and endnotes added or edited in the editor; untouched notes are kept verbatim.
  for (const kind of ['footnote', 'endnote'] as const) {
    const edited = [...doc.editedNotes].filter((k) => k.startsWith(`${kind}:`) && doc.notes.has(k));
    if (!edited.length) continue;
    const ct = kind === 'footnote' ? CT.footnotes : CT.endnotes;
    const path = ensurePartRel(pkg, doc.mainPath, kind === 'footnote' ? REL.footnotes : REL.endnotes, `word/${kind}s.xml`, ct);
    doc.styles.ensureStyle(kind === 'footnote' ? 'FootnoteText' : 'EndnoteText');
    doc.styles.ensureStyle(kind === 'footnote' ? 'FootnoteReference' : 'EndnoteReference');
    const oldText = pkg.getText(path);
    const oldRoot = oldText ? parseXml(oldText).root : null;
    const rels = new PartRels(st, path);
    const w = new ContentWriter(st, rels, commentRanges(schema.nodes.doc.create(null, [schema.nodes.paragraph.create()]), threads));
    const written = new Set<string>();
    const noteXml = (key: string): XmlElement => {
      const kids: PMNode[] = [];
      doc.notes.get(key)!.forEach((n) => kids.push(n));
      const content = w.blocks(kids);
      const first = content.find((c): c is XmlElement => c.type === 'element' && c.name === 'w:p');
      if (first) {
        const at = first.children.findIndex((c) => c.type === 'element' && c.name === 'w:pPr') + 1;
        first.children.splice(at, 0,
          el('w:r', {}, [el('w:rPr', {}, [el('w:rStyle', { 'w:val': kind === 'footnote' ? 'FootnoteReference' : 'EndnoteReference' })]), el(kind === 'footnote' ? 'w:footnoteRef' : 'w:endnoteRef')]),
          el('w:r', {}, [el('w:t', { 'xml:space': 'preserve' }, [txt(' ')])]));
      }
      written.add(key);
      return el(`w:${kind}`, { 'w:id': key.slice(kind.length + 1) }, content);
    };
    const notes: XmlNode[] = [];
    if (oldRoot) {
      for (const c of oldRoot.children) {
        const key = c.type === 'element' && c.name === `w:${kind}` ? `${kind}:${c.attrs['w:id'] ?? ''}` : '';
        notes.push(key && edited.includes(key) ? noteXml(key) : c);
      }
    } else {
      notes.push(
        el(`w:${kind}`, { 'w:type': 'separator', 'w:id': -1 }, [el('w:p', {}, [el('w:pPr', {}, [el('w:spacing', { 'w:after': 0, 'w:line': 240, 'w:lineRule': 'auto' })]), el('w:r', {}, [el('w:separator')])])]),
        el(`w:${kind}`, { 'w:type': 'continuationSeparator', 'w:id': 0 }, [el('w:p', {}, [el('w:pPr', {}, [el('w:spacing', { 'w:after': 0, 'w:line': 240, 'w:lineRule': 'auto' })]), el('w:r', {}, [el('w:continuationSeparator')])])]),
      );
    }
    for (const key of edited) if (!written.has(key)) notes.push(noteXml(key));
    pkg.setText(path, wordRoot(`w:${kind}s`, oldRoot?.attrs ?? {}, notes), ct);
    rels.write();
  }

  // Comments.
  const anchored = [...threads.values()].filter((t) => usedComments.has(t.id));
  const existingComments = pkg.getRels(doc.mainPath).find((r) => relTypeIs(r.type, REL.comments));
  if (anchored.length || existingComments) {
    if (anchored.length) {
      doc.styles.ensureStyle('CommentText');
      doc.styles.ensureStyle('CommentReference');
    }
    const commentEls: XmlElement[] = [];
    const exEls: XmlElement[] = [];
    for (const t of anchored) {
      const ids: string[] = [];
      commentEls.push(commentElement(st, t, ids));
      const parentPara = ids[ids.length - 1];
      exEls.push(el('w15:commentEx', { 'w15:paraId': parentPara, 'w15:done': t.done ? 1 : 0 }));
      for (const r of t.replies) {
        const rids: string[] = [];
        commentEls.push(commentElement(st, r, rids));
        exEls.push(el('w15:commentEx', { 'w15:paraId': rids[rids.length - 1], 'w15:paraIdParent': parentPara, 'w15:done': r.done ? 1 : 0 }));
      }
    }
    const commentsPath = ensurePartRel(pkg, doc.mainPath, REL.comments, 'word/comments.xml', CT.comments);
    pkg.setText(commentsPath, wordRoot('w:comments', {}, commentEls), CT.comments);
    const exPath = ensurePartRel(pkg, doc.mainPath, REL.commentsExtended, 'word/commentsExtended.xml', CT.commentsExtended);
    pkg.setText(exPath, wordRoot('w15:commentsEx', {}, exEls), CT.commentsExtended);
  }
  // Relationship lists for the main part may have been changed by ensurePartRel; merge them.
  for (const r of pkg.getRels(doc.mainPath)) if (!mainRels.rels.some((x) => x.id === r.id)) mainRels.rels.push(r);

  // Main document part.
  const bodyEl = el('w:body', {}, bodyChildren);
  pkg.setText(doc.mainPath, wordRoot('w:document', doc.documentRootAttrs, [...extras, bodyEl]));
  mainRels.write();

  // Media.
  for (const path of st.media) {
    const item = doc.media.get(path);
    if (!item) continue;
    if (!pkg.has(path)) pkg.set(path, item.bytes);
    const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
    if (!pkg.contentTypes.typeOf(path)) pkg.ensureDefaultContentType(ext, item.contentType || IMAGE_CONTENT_TYPES[ext] || 'application/octet-stream');
  }

  // Numbering and styles (rewritten only when changed or missing).
  if (doc.numbering.version > 0 || (!doc.numbering.isEmpty && !pkg.findRel(doc.mainPath, REL.numbering))) {
    const path = ensurePartRel(pkg, doc.mainPath, REL.numbering, 'word/numbering.xml', CT.numbering);
    pkg.setText(path, doc.numbering.toXml(), CT.numbering);
  }
  if (doc.styles.version > 0 || !pkg.findRel(doc.mainPath, REL.styles)) {
    const path = ensurePartRel(pkg, doc.mainPath, REL.styles, 'word/styles.xml', CT.styles);
    pkg.setText(path, doc.styles.toXml(), CT.styles);
  }

  // Settings.
  if (doc.settings.xml && doc.settings.path) {
    const root = cloneXml(doc.settings.xml.root);
    setFlag(root, 'w:evenAndOddHeaders', !!body.attrs.evenAndOddHeaders);
    setFlag(root, 'w:trackRevisions', opts.trackRevisions ?? doc.settings.trackRevisions);
    const tab = root.children.find((c) => c.type === 'element' && c.name === 'w:defaultTabStop') as XmlElement | undefined;
    if (tab) tab.attrs['w:val'] = String(body.attrs.defaultTabStop ?? 720);
    sortChildren(root);
    pkg.setText(doc.settings.path, serializeXml(root, { namespaces: { ...ALL_NAMESPACES, ...doc.settings.xml.extraNamespaces } }));
  }

  // Core properties: modification time.
  const coreRel = pkg.findRel('', REL.coreProps);
  const corePath = coreRel ? pkg.resolveTarget('', coreRel.target) : undefined;
  const core = corePath ? pkg.getText(corePath) : undefined;
  if (corePath && core) {
    const stamp = st.now.toISOString().replace(/\.\d+Z$/, 'Z');
    const updated = /<dcterms:modified[^>]*>[^<]*<\/dcterms:modified>/.test(core)
      ? core.replace(/(<dcterms:modified[^>]*>)[^<]*(<\/dcterms:modified>)/, `$1${stamp}$2`)
      : core;
    const withAuthor = opts.author ? updated.replace(/(<cp:lastModifiedBy>)[^<]*(<\/cp:lastModifiedBy>)/, `$1${escapeXml(opts.author)}$2`) : updated;
    pkg.setText(corePath, withAuthor);
  }

  return pkg.toBytes();
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

