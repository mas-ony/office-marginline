import { Fragment, type Mark, type MarkType, type Node as PMNode, Slice } from 'prosemirror-model';
import { type EditorState, NodeSelection, TextSelection, type Transaction } from 'prosemirror-state';
import { CellSelection } from 'prosemirror-tables';
import type { EditorView } from 'prosemirror-view';
import type { DocxDocument } from '../core/document';
import { marksToRunProps } from '../core/model/marks';
import { LIST_PRESETS, type ListKind, type ListPreset } from '../core/model/numbering';
import { schema } from '../core/model/schema';
import { HIGHLIGHT_COLORS, type ColumnsSpec, type NumPr, type RunProps, type SectionProps, type SectionType } from '../core/model/types';
import { pxToEmu, twipsToPx } from '../core/ooxml/units';
import { NO_TRACK, REFRESH } from './meta';
import { effectiveNumPr } from './plugins/numbering';

export type Dispatch = (tr: Transaction) => void;

// -----------------------------------------------------------------------------------------------
// Selection helpers

export interface ParaRef {
  node: PMNode;
  pos: number;
}

/** Paragraphs touched by the selection (including inside selected table cells). */
export function selectedParagraphs(state: EditorState): ParaRef[] {
  const out: ParaRef[] = [];
  const sel = state.selection;
  const add = (from: number, to: number) => {
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.type === schema.nodes.paragraph) {
        if (!out.some((p) => p.pos === pos)) out.push({ node, pos });
        return false;
      }
      return true;
    });
  };
  if (sel instanceof CellSelection) sel.forEachCell((cell, pos) => add(pos, pos + cell.nodeSize));
  else {
    for (const r of sel.ranges) add(r.$from.pos, r.$to.pos);
    if (!out.length) {
      const $f = sel.$from;
      for (let d = $f.depth; d > 0; d--) {
        if ($f.node(d).type === schema.nodes.paragraph) {
          out.push({ node: $f.node(d), pos: $f.before(d) });
          break;
        }
      }
    }
  }
  return out.sort((a, b) => a.pos - b.pos);
}

/** Inline segments in the selection: [from, to) with their paragraph. */
function selectedInline(state: EditorState): { from: number; to: number; node: PMNode; para: PMNode }[] {
  const out: { from: number; to: number; node: PMNode; para: PMNode }[] = [];
  const sel = state.selection;
  const visit = (from: number, to: number) => {
    state.doc.nodesBetween(from, to, (node, pos, parent) => {
      if (!node.isInline) return true;
      if (parent && parent.type === schema.nodes.paragraph) {
        out.push({ from: Math.max(from, pos), to: Math.min(to, pos + node.nodeSize), node, para: parent });
      }
      return false;
    });
  };
  if (sel instanceof CellSelection) sel.forEachCell((cell, pos) => visit(pos, pos + cell.nodeSize));
  else for (const r of sel.ranges) visit(r.$from.pos, r.$to.pos);
  return out.filter((s) => s.to > s.from);
}

function cursorParagraph(state: EditorState): PMNode | null {
  const $f = state.selection.$from;
  for (let d = $f.depth; d >= 0; d--) if ($f.node(d).type === schema.nodes.paragraph) return $f.node(d);
  return null;
}

function cursorMarks(state: EditorState): readonly Mark[] {
  return state.storedMarks ?? state.selection.$from.marks();
}

export function effectiveRunProps(docx: DocxDocument, para: PMNode | null, marks: readonly Mark[]): RunProps {
  const info = marksToRunProps(marks);
  return docx.styles.effectiveRun(para?.attrs.styleId ?? null, info.props.styleId ?? null, info.props);
}

function inheritedRunProps(docx: DocxDocument, para: PMNode | null, marks: readonly Mark[]): RunProps {
  const info = marksToRunProps(marks);
  return docx.styles.effectiveRun(para?.attrs.styleId ?? null, info.props.styleId ?? null, {});
}

// -----------------------------------------------------------------------------------------------
// Run formatting

export type ToggleStyle = 'bold' | 'italic' | 'underline' | 'strike';

function toggleValue(props: RunProps, name: ToggleStyle): boolean {
  if (name === 'underline') return !!props.underline && props.underline !== 'none';
  return !!props[name];
}

/** Whether every selected run (or the cursor) has the style on. */
export function isStyleOn(state: EditorState, docx: DocxDocument, name: ToggleStyle): boolean {
  if (state.selection.empty) return toggleValue(effectiveRunProps(docx, cursorParagraph(state), cursorMarks(state)), name);
  const segs = selectedInline(state).filter((s) => s.node.isText);
  if (!segs.length) return false;
  return segs.every((s) => toggleValue(effectiveRunProps(docx, s.para, s.node.marks), name));
}

function markFor(name: ToggleStyle, on: boolean): Mark {
  if (name === 'underline') return schema.marks.underline.create({ type: on ? 'single' : 'none' });
  return schema.marks[name].create({ value: on });
}

/** Set a toggle style to an explicit value, removing direct formatting when the style already gives it. */
export function setToggleStyle(view: EditorView, docx: DocxDocument, name: ToggleStyle, on: boolean): boolean {
  const { state } = view;
  const type = schema.marks[name];
  if (state.selection.empty) {
    const marks = cursorMarks(state);
    const inherited = toggleValue(inheritedRunProps(docx, cursorParagraph(state), marks), name);
    let next = type.removeFromSet(marks);
    if (inherited !== on) next = markFor(name, on).addToSet(next);
    view.dispatch(state.tr.setStoredMarks(next));
    return true;
  }
  const tr = state.tr;
  for (const s of selectedInline(state)) {
    const inherited = toggleValue(inheritedRunProps(docx, s.para, s.node.marks), name);
    if (inherited === on) tr.removeMark(s.from, s.to, type);
    else tr.addMark(s.from, s.to, markFor(name, on));
  }
  view.dispatch(tr.scrollIntoView());
  return true;
}

export function toggleStyle(view: EditorView, docx: DocxDocument, name: ToggleStyle): boolean {
  return setToggleStyle(view, docx, name, !isStyleOn(view.state, docx, name));
}

/** Apply (attrs) or remove (null) a valued run mark across the selection or at the cursor. */
export function setRunMark(view: EditorView, type: MarkType, attrs: Record<string, unknown> | null, removeTypes: MarkType[] = []): boolean {
  const { state } = view;
  if (state.selection.empty) {
    let marks = cursorMarks(state);
    for (const t of [type, ...removeTypes]) marks = t.removeFromSet(marks);
    if (attrs) marks = type.create(attrs).addToSet(marks);
    view.dispatch(state.tr.setStoredMarks(marks));
    return true;
  }
  const tr = state.tr;
  for (const s of selectedInline(state)) {
    for (const t of removeTypes) tr.removeMark(s.from, s.to, t);
    if (attrs) tr.addMark(s.from, s.to, type.create(attrs));
    else tr.removeMark(s.from, s.to, type);
  }
  view.dispatch(tr.scrollIntoView());
  return true;
}

export function setFontFamily(view: EditorView, name: string): boolean {
  return setRunMark(view, schema.marks.font, { ascii: name, hAnsi: name, eastAsia: name, cs: name });
}

/** Font size in points (2-1638, rounded to half points). */
export function setFontSize(view: EditorView, pt: number): boolean {
  const size = Math.round(Math.min(1638, Math.max(1, pt)) * 2);
  return setRunMark(view, schema.marks.fontSize, { size });
}

/** Text colour as RRGGBB, or null for automatic. */
export function setTextColor(view: EditorView, hex: string | null): boolean {
  return setRunMark(view, schema.marks.color, { color: hex ? hex.replace('#', '').toUpperCase() : 'auto' });
}

/** Highlight with a named Word colour, any RRGGBB (stored as shading), or null to clear. */
export function setHighlight(view: EditorView, color: string | null): boolean {
  if (!color) return setRunMark(view, schema.marks.highlight, null, [schema.marks.shading]);
  const hex = color.replace('#', '').toUpperCase();
  const named = HIGHLIGHT_COLORS[color] ? color : Object.entries(HIGHLIGHT_COLORS).find(([, v]) => v === hex)?.[0];
  if (named) return setRunMark(view, schema.marks.highlight, { color: named }, [schema.marks.shading]);
  return setRunMark(view, schema.marks.shading, { fill: hex }, [schema.marks.highlight]);
}

export function setVertAlign(view: EditorView, value: 'superscript' | 'subscript' | null): boolean {
  return setRunMark(view, schema.marks.vertAlign, value ? { value } : null);
}

export function clearFormatting(view: EditorView): boolean {
  const { state } = view;
  const tr = state.tr;
  const types = ['charStyle', 'font', 'fontSize', 'color', 'highlight', 'shading', 'bold', 'italic', 'underline', 'strike', 'dstrike', 'caps', 'smallCaps', 'hidden', 'vertAlign', 'charSpacing', 'position', 'runExtra'];
  if (state.selection.empty) {
    let marks = cursorMarks(state);
    for (const t of types) marks = schema.marks[t].removeFromSet(marks);
    view.dispatch(tr.setStoredMarks(marks));
    return true;
  }
  for (const s of selectedInline(state)) for (const t of types) tr.removeMark(s.from, s.to, schema.marks[t]);
  view.dispatch(tr);
  return true;
}

// -----------------------------------------------------------------------------------------------
// Paragraph formatting

export function updateParagraphs(view: EditorView, fn: (attrs: Record<string, unknown>, node: PMNode) => Record<string, unknown> | null, refresh = false): boolean {
  const { state } = view;
  const paras = selectedParagraphs(state);
  if (!paras.length) return false;
  const tr = state.tr;
  for (const p of paras) {
    const next = fn({ ...p.node.attrs }, p.node);
    if (next) tr.setNodeMarkup(p.pos, undefined, next, p.node.marks);
  }
  if (refresh) tr.setMeta(REFRESH, true);
  view.dispatch(tr.scrollIntoView());
  return true;
}

export type Alignment = 'left' | 'center' | 'right' | 'both';

export function setAlignment(view: EditorView, align: Alignment): boolean {
  return updateParagraphs(view, (a) => ({ ...a, align }));
}

/** Line spacing as a multiple of single spacing (1, 1.15, 1.5, 2...). */
export function setLineSpacing(view: EditorView, multiple: number): boolean {
  return updateParagraphs(view, (a) => ({ ...a, spacing: { ...((a.spacing as object) ?? {}), line: Math.round(240 * multiple), lineRule: 'auto' } }));
}

export function setParagraphSpacing(view: EditorView, before: number | undefined, after: number | undefined): boolean {
  return updateParagraphs(view, (a) => {
    const sp: Record<string, unknown> = { ...((a.spacing as object) ?? {}) };
    if (before !== undefined) sp.before = before;
    if (after !== undefined) sp.after = after;
    return { ...a, spacing: sp };
  });
}

const PRESET_CLEARED_MARKS = ['font', 'fontSize', 'color', 'bold', 'italic', 'underline'];

/** Apply a paragraph style (adding a built-in definition when the document lacks it). */
export function setParagraphStyle(view: EditorView, docx: DocxDocument, styleId: string): boolean {
  if (!docx.styles.ensureStyle(styleId) && !docx.styles.get(styleId)) return false;
  const defaultId = docx.styles.defaultStyleId('paragraph');
  const { state } = view;
  const paras = selectedParagraphs(state);
  const tr = state.tr;
  for (const p of paras) {
    const from = p.pos + 1;
    const to = p.pos + p.node.nodeSize - 1;
    for (const name of PRESET_CLEARED_MARKS) tr.removeMark(from, to, schema.marks[name]);
    const keepListStyle = p.node.attrs.styleId === 'ListParagraph' && styleId === defaultId;
    tr.setNodeMarkup(p.pos, undefined, {
      ...p.node.attrs,
      styleId: keepListStyle ? 'ListParagraph' : styleId === defaultId ? null : styleId,
      outlineLvl: null,
      markProps: null,
    });
  }
  view.dispatch(tr.setMeta(REFRESH, true).scrollIntoView());
  return true;
}

export function listKindOf(docx: DocxDocument, node: PMNode): ListKind | null {
  const numPr = effectiveNumPr(docx, node);
  if (!numPr || numPr.numId === '0') return null;
  return docx.numbering.kind(numPr.numId) ?? null;
}

function effectiveLeftIndent(docx: DocxDocument, node: PMNode): number {
  const direct = node.attrs.indent?.left;
  if (direct !== undefined) return direct;
  return docx.styles.effectiveParagraph(node.attrs.styleId).indent?.left ?? 0;
}

export function changeIndent(view: EditorView, docx: DocxDocument, delta: 1 | -1): boolean {
  return updateParagraphs(view, (a, node) => {
    const numPr = effectiveNumPr(docx, node);
    if (numPr && numPr.numId !== '0' && listKindOf(docx, node)) {
      const ilvl = Math.max(0, Math.min(8, numPr.ilvl + delta));
      return { ...a, numPr: { numId: numPr.numId, ilvl } };
    }
    const left = Math.max(0, effectiveLeftIndent(docx, node) + delta * 720);
    return { ...a, indent: { ...((a.indent as object) ?? {}), left } };
  }, true);
}

function siblingListNumId(state: EditorState, docx: DocxDocument, para: ParaRef, kind: ListKind, dir: -1 | 1): string | null {
  const $pos = state.doc.resolve(para.pos);
  const parent = $pos.parent;
  const index = $pos.index();
  const sibling = parent.maybeChild(index + dir);
  if (!sibling || sibling.type !== schema.nodes.paragraph) return null;
  const numPr = effectiveNumPr(docx, sibling);
  return numPr && docx.numbering.kind(numPr.numId) === kind ? numPr.numId : null;
}

/** Toggle bullets or numbering for the selected paragraphs. */
export function toggleList(view: EditorView, docx: DocxDocument, kind: ListKind, preset?: ListPreset): boolean {
  const { state } = view;
  const paras = selectedParagraphs(state);
  if (!paras.length) return false;
  const tr = state.tr;
  const defaultId = docx.styles.defaultStyleId('paragraph');
  const allIn = !preset && paras.every((p) => listKindOf(docx, p.node) === kind);
  if (allIn) {
    for (const p of paras) {
      const styleHasList = !!docx.styles.resolveParagraphStyle(p.node.attrs.styleId).pPr.numPr?.numId;
      tr.setNodeMarkup(p.pos, undefined, {
        ...p.node.attrs,
        numPr: styleHasList ? { numId: '0', ilvl: 0 } : null,
        styleId: p.node.attrs.styleId === 'ListParagraph' ? null : p.node.attrs.styleId,
      });
    }
  } else {
    let numId = preset ? null : siblingListNumId(state, docx, paras[0], kind, -1) ?? siblingListNumId(state, docx, paras[paras.length - 1], kind, 1);
    if (!numId) numId = docx.numbering.addList(preset ?? (kind === 'bullet' ? 'bullet' : 'numberLatinRoman1'));
    docx.styles.ensureStyle('ListParagraph');
    for (const p of paras) {
      const cur = effectiveNumPr(docx, p.node);
      const ilvl = cur && listKindOf(docx, p.node) ? cur.ilvl : 0;
      const sid = p.node.attrs.styleId;
      tr.setNodeMarkup(p.pos, undefined, {
        ...p.node.attrs,
        numPr: { numId, ilvl },
        styleId: !sid || sid === defaultId ? 'ListParagraph' : sid,
        indent: null,
      });
    }
  }
  view.dispatch(tr.setMeta(REFRESH, true).scrollIntoView());
  return true;
}

/** Apply a bullet/numbering preset: to the whole list under the cursor, or start a new list. */
export function setListPreset(view: EditorView, docx: DocxDocument, preset: ListPreset): boolean {
  const { state } = view;
  const paras = selectedParagraphs(state);
  const first = paras[0];
  const current = first ? effectiveNumPr(docx, first.node) : null;
  const kind = LIST_PRESETS[preset].kind;
  if (!current || !listKindOf(docx, first.node)) return toggleList(view, docx, kind, preset);
  const numId = docx.numbering.addList(preset);
  const tr = state.tr;
  state.doc.descendants((node, pos) => {
    if (node.type !== schema.nodes.paragraph) return true;
    const np = effectiveNumPr(docx, node);
    if (np && np.numId === current.numId) tr.setNodeMarkup(pos, undefined, { ...node.attrs, numPr: { numId, ilvl: np.ilvl } as NumPr });
    return false;
  });
  view.dispatch(tr.setMeta(REFRESH, true));
  return true;
}

// -----------------------------------------------------------------------------------------------
// Breaks and sections

export function insertPageBreak(view: EditorView): boolean {
  const { state } = view;
  const tr = state.tr.deleteSelection();
  const pos = tr.selection.from;
  const $pos = tr.doc.resolve(pos);
  if (!$pos.parent.isTextblock) return false;
  tr.insert(pos, schema.nodes.page_break.create(null, null, $pos.marks()));
  tr.split(pos + 1);
  tr.setSelection(TextSelection.create(tr.doc, pos + 3));
  view.dispatch(tr.scrollIntoView());
  return true;
}

export interface SectionRef {
  index: number;
  props: SectionProps;
  /** Position of the section_break node that carries the props, or null for the final section. */
  pos: number | null;
}

/** The section containing document position `pos`. */
export function sectionAt(doc: PMNode, pos: number): SectionRef {
  let index = 0;
  let found: SectionRef | null = null;
  doc.forEach((node, offset) => {
    if (found || node.type !== schema.nodes.section_break) return;
    if (offset + node.nodeSize > pos) found = { index, props: node.attrs.section, pos: offset };
    index++;
  });
  return found ?? { index, props: doc.attrs.finalSection, pos: null };
}

export function allSections(doc: PMNode): SectionRef[] {
  const out: SectionRef[] = [];
  doc.forEach((node, offset) => {
    if (node.type === schema.nodes.section_break) out.push({ index: out.length, props: node.attrs.section, pos: offset });
  });
  out.push({ index: out.length, props: doc.attrs.finalSection, pos: null });
  return out;
}

export function setSectionProps(tr: Transaction, ref: SectionRef, props: SectionProps): Transaction {
  if (ref.pos === null) tr.setDocAttribute('finalSection', props);
  else tr.setNodeMarkup(tr.mapping.map(ref.pos), undefined, { section: props });
  return tr;
}

export function updateSection(view: EditorView, fn: (props: SectionProps) => SectionProps, at?: number): boolean {
  const { state } = view;
  const ref = sectionAt(state.doc, at ?? state.selection.from);
  const tr = setSectionProps(state.tr, ref, fn(structuredClone(ref.props)));
  view.dispatch(tr.setMeta(REFRESH, true));
  return true;
}

export function insertSectionBreak(view: EditorView, type: Extract<SectionType, 'nextPage' | 'continuous'>): boolean {
  const { state } = view;
  const $from = state.selection.$from;
  if ($from.depth !== 1 || $from.parent.type !== schema.nodes.paragraph) return false;
  const ref = sectionAt(state.doc, $from.pos);
  const tr = state.tr.deleteSelection();
  const pos = tr.selection.from;
  tr.split(pos);
  const between = pos + 1;
  const ended: SectionProps = structuredClone(ref.props);
  tr.insert(between, schema.nodes.section_break.create({ section: ended }));
  const following = structuredClone(ref.props);
  following.type = type;
  if (ref.pos === null) tr.setDocAttribute('finalSection', following);
  else tr.setNodeMarkup(tr.mapping.map(ref.pos), undefined, { section: following });
  tr.setSelection(TextSelection.create(tr.doc, between + 2));
  view.dispatch(tr.setMeta(REFRESH, true).scrollIntoView());
  return true;
}

export interface MarginsTwips {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
  header?: number;
  footer?: number;
}

export function setSectionMargins(view: EditorView, m: MarginsTwips, at?: number): boolean {
  return updateSection(view, (p) => {
    const next = { ...p.margins };
    for (const k of Object.keys(m) as (keyof MarginsTwips)[]) if (m[k] !== undefined) next[k] = Math.max(0, Math.round(m[k]!));
    // Keep at least one inch of usable width and height.
    next.left = Math.min(next.left, p.pageWidth - next.right - 1440);
    next.right = Math.min(next.right, p.pageWidth - next.left - 1440);
    next.top = Math.min(next.top, p.pageHeight - next.bottom - 1440);
    next.bottom = Math.min(next.bottom, p.pageHeight - next.top - 1440);
    return { ...p, margins: next };
  }, at);
}

export function setSectionColumns(view: EditorView, cols: ColumnsSpec, at?: number): boolean {
  return updateSection(view, (p) => ({ ...p, cols }), at);
}

export function setOrientation(view: EditorView, orient: 'portrait' | 'landscape', at?: number): boolean {
  return updateSection(view, (p) => {
    const landscape = p.pageWidth > p.pageHeight;
    if ((orient === 'landscape') === landscape) return { ...p, orient };
    return { ...p, orient, pageWidth: p.pageHeight, pageHeight: p.pageWidth };
  }, at);
}

export function setPageSize(view: EditorView, width: number, height: number, at?: number): boolean {
  return updateSection(view, (p) => {
    const landscape = p.pageWidth > p.pageHeight;
    return landscape ? { ...p, pageWidth: Math.max(width, height), pageHeight: Math.min(width, height) } : { ...p, pageWidth: Math.min(width, height), pageHeight: Math.max(width, height) };
  }, at);
}

/** Content width (px) of the section around the selection. */
export function contentWidthPx(state: EditorState): number {
  const p = sectionAt(state.doc, state.selection.from).props;
  return twipsToPx(p.pageWidth - p.margins.left - p.margins.right - (p.margins.gutter || 0));
}

// -----------------------------------------------------------------------------------------------
// Tables

export function insertTable(view: EditorView, docx: DocxDocument, rows: number, cols: number): boolean {
  const { state } = view;
  docx.styles.ensureStyle('TableGrid');
  const width = Math.max(cols * 24, contentWidthPx(state));
  const colW = Math.floor(width / cols);
  const row = () => schema.nodes.table_row.create(null, Array.from({ length: cols }, () => schema.nodes.table_cell.create({ colwidth: [colW] }, schema.nodes.paragraph.create())));
  const table = schema.nodes.table.create({ styleId: 'TableGrid', width: { type: 'pct', value: 100 }, look: { firstRow: true, lastRow: false, firstColumn: true, lastColumn: false, noHBand: false, noVBand: true } }, Array.from({ length: rows }, row));
  const tr = state.tr;
  const $from = state.selection.$from;
  let insertPos: number;
  const para = $from.parent;
  const paraPos = $from.depth > 0 ? $from.before($from.depth) : 0;
  if (para.type === schema.nodes.paragraph && para.content.size === 0) {
    tr.replaceWith(paraPos, paraPos + para.nodeSize, [table, schema.nodes.paragraph.create()]);
    insertPos = paraPos;
  } else {
    const after = $from.depth > 0 ? $from.after($from.depth) : state.doc.content.size;
    tr.insert(after, [table, schema.nodes.paragraph.create()]);
    insertPos = after;
  }
  tr.setSelection(TextSelection.create(tr.doc, insertPos + 4));
  view.dispatch(tr.setMeta(REFRESH, true).scrollIntoView());
  return true;
}

// -----------------------------------------------------------------------------------------------
// Images

function sniffImageType(bytes: Uint8Array): string | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'image/gif';
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp';
  return null;
}

async function decodeImage(blob: Blob): Promise<{ width: number; height: number; img: CanvasImageSource }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(blob);
      return { width: bmp.width, height: bmp.height, img: bmp };
    } catch {
      // Fall back to an <img> element below.
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { width: img.naturalWidth, height: img.naturalHeight, img };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Insert a picture at the cursor, converting formats Word may not read (e.g. WebP) to PNG. */
export async function insertImage(view: EditorView, docx: DocxDocument, file: Blob, name = 'Picture'): Promise<boolean> {
  let bytes = new Uint8Array(await file.arrayBuffer());
  let type = sniffImageType(bytes);
  const decoded = await decodeImage(file);
  if (!type) {
    const canvas = document.createElement('canvas');
    canvas.width = decoded.width;
    canvas.height = decoded.height;
    canvas.getContext('2d')!.drawImage(decoded.img, 0, 0);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!png) throw new Error('This image format is not supported');
    bytes = new Uint8Array(await png.arrayBuffer());
    type = 'image/png';
  }
  const ext = type === 'image/jpeg' ? 'jpeg' : type.split('/')[1];
  const maxW = contentWidthPx(view.state);
  let w = decoded.width;
  let h = decoded.height;
  if (w > maxW) {
    h = (h * maxW) / w;
    w = maxW;
  }
  const path = docx.addMedia(bytes, type, ext);
  const node = schema.nodes.image.create({ src: docx.mediaUrl(path), mediaPath: path, width: pxToEmu(w), height: pxToEmu(h), name, alt: '' });
  const tr = view.state.tr.replaceSelectionWith(node);
  view.dispatch(tr.scrollIntoView());
  return true;
}

export function isImageSelected(state: EditorState): boolean {
  return state.selection instanceof NodeSelection && state.selection.node.type === schema.nodes.image;
}

// -----------------------------------------------------------------------------------------------
// Links

export function linkRange(state: EditorState): { from: number; to: number; mark: Mark } | null {
  const $pos = state.selection.$from;
  const parent = $pos.parent;
  const start = $pos.start();
  const kids: { node: PMNode; from: number; to: number }[] = [];
  parent.forEach((node, offset) => kids.push({ node, from: start + offset, to: start + offset + node.nodeSize }));
  const at = kids.findIndex((k) => k.from <= $pos.pos && $pos.pos < k.to);
  // The child after the cursor first, then the one before it (cursor at the end of a link).
  for (const idx of [at, at < 0 ? kids.length - 1 : at - 1]) {
    if (idx < 0 || idx >= kids.length) continue;
    const mark = kids[idx].node.marks.find((m) => m.type === schema.marks.link);
    if (!mark) continue;
    let l = idx;
    let r = idx;
    while (l > 0 && mark.isInSet(kids[l - 1].node.marks)) l--;
    while (r < kids.length - 1 && mark.isInSet(kids[r + 1].node.marks)) r++;
    return { from: kids[l].from, to: kids[r].to, mark };
  }
  return null;
}

export function setLink(view: EditorView, docx: DocxDocument, href: string, text?: string): boolean {
  const { state } = view;
  docx.styles.ensureStyle('Hyperlink');
  const link = schema.marks.link.create({ href });
  const style = schema.marks.charStyle.create({ styleId: 'Hyperlink' });
  const existing = linkRange(state);
  const tr = state.tr;
  if (existing && state.selection.empty) {
    tr.removeMark(existing.from, existing.to, schema.marks.link).addMark(existing.from, existing.to, link);
  } else if (state.selection.empty) {
    const label = text || href;
    const marks = [...cursorMarks(state).filter((m) => m.type !== schema.marks.link && m.type !== schema.marks.charStyle), link, style];
    tr.replaceSelectionWith(schema.text(label, marks), false);
  } else {
    const { from, to } = state.selection;
    tr.addMark(from, to, link).addMark(from, to, style);
  }
  view.dispatch(tr.setMeta(REFRESH, true).scrollIntoView());
  return true;
}

/**
 * Link the selection (or the link at the caret) to `href`, optionally replacing its text; with
 * nothing selected the text (or the address) is inserted as a new link.
 */
export function applyLink(view: EditorView, docx: DocxDocument, href: string, text?: string): boolean {
  const { state } = view;
  docx.styles.ensureStyle('Hyperlink');
  const link = schema.marks.link.create({ href });
  const style = schema.marks.charStyle.create({ styleId: 'Hyperlink' });
  const range = state.selection.empty ? linkRange(state) : { from: state.selection.from, to: state.selection.to };
  const tr = state.tr;
  if (!range) {
    const marks = [...cursorMarks(state).filter((m) => m.type !== schema.marks.link && m.type !== schema.marks.charStyle), link, style];
    tr.replaceSelectionWith(schema.text(text || href, marks), false);
  } else if (text && text !== state.doc.textBetween(range.from, range.to, ' ', ' ')) {
    const first = state.doc.nodeAt(range.from);
    const base = (first?.marks ?? []).filter((m) => m.type !== schema.marks.link && m.type !== schema.marks.charStyle);
    tr.replaceWith(range.from, range.to, schema.text(text, [...base, link, style]));
  } else {
    tr.removeMark(range.from, range.to, schema.marks.link).addMark(range.from, range.to, link).addMark(range.from, range.to, style);
  }
  view.dispatch(tr.setMeta(REFRESH, true).scrollIntoView());
  return true;
}

export function removeLink(view: EditorView): boolean {
  const { state } = view;
  const range = state.selection.empty ? linkRange(state) : { from: state.selection.from, to: state.selection.to };
  if (!range) return false;
  const tr = state.tr.removeMark(range.from, range.to, schema.marks.link);
  tr.doc.nodesBetween(range.from, range.to, (node, pos) => {
    const cs = node.marks.find((m) => m.type === schema.marks.charStyle && m.attrs.styleId === 'Hyperlink');
    if (cs) tr.removeMark(Math.max(pos, range.from), Math.min(pos + node.nodeSize, range.to), cs);
  });
  view.dispatch(tr);
  return true;
}

// -----------------------------------------------------------------------------------------------
// Comments

export function nextCommentId(docx: DocxDocument): string {
  let max = -1;
  for (const t of docx.comments.values()) {
    max = Math.max(max, parseInt(t.id, 10) || 0);
    for (const r of t.replies) max = Math.max(max, parseInt(r.id, 10) || 0);
  }
  return String(max + 1);
}

/** Word boundaries around a position (used when commenting without a selection). */
export function wordAt(state: EditorState, pos: number): { from: number; to: number } | null {
  const $pos = state.doc.resolve(pos);
  if (!$pos.parent.isTextblock) return null;
  const text = $pos.parent.textBetween(0, $pos.parent.content.size, '￼', '￼');
  let s = $pos.parentOffset;
  let e = $pos.parentOffset;
  const word = /[\p{L}\p{N}_'-]/u;
  while (s > 0 && word.test(text[s - 1])) s--;
  while (e < text.length && word.test(text[e])) e++;
  if (s === e) return null;
  return { from: $pos.start() + s, to: $pos.start() + e };
}

export function addComment(view: EditorView, docx: DocxDocument, text: string, author: string, initials?: string): string | null {
  const { state } = view;
  const range = state.selection.empty ? wordAt(state, state.selection.from) : { from: state.selection.from, to: state.selection.to };
  if (!range) return null;
  const id = nextCommentId(docx);
  docx.comments.set(id, { id, author, initials, date: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), text, replies: [], done: false });
  const tr = state.tr.addMark(range.from, range.to, schema.marks.comment.create({ id }));
  view.dispatch(tr.setMeta(NO_TRACK, true));
  return id;
}

export function removeCommentMarks(view: EditorView, id: string): void {
  const { state } = view;
  const tr = state.tr;
  state.doc.descendants((node, pos) => {
    if (!node.isInline) return true;
    for (const m of node.marks) if (m.type === schema.marks.comment && m.attrs.id === id) tr.removeMark(pos, pos + node.nodeSize, m);
    return false;
  });
  view.dispatch(tr.setMeta(NO_TRACK, true));
}

// -----------------------------------------------------------------------------------------------
// Text insertion

/** Insert plain text, turning line breaks into paragraphs and tabs into tab characters. */
export function insertPlainText(view: EditorView, text: string): boolean {
  const { state } = view;
  const marks = cursorMarks(state).filter((m) => m.type !== schema.marks.comment);
  const para = cursorParagraph(state);
  const lineNodes = (line: string): PMNode[] => {
    const out: PMNode[] = [];
    line.split('\t').forEach((part, i) => {
      if (i > 0) out.push(schema.nodes.tab.create(null, null, marks));
      if (part) out.push(schema.text(part, marks));
    });
    return out;
  };
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const tr = state.tr;
  if (lines.length === 1) {
    tr.replaceSelection(new Slice(Fragment.from(lineNodes(lines[0])), 0, 0));
  } else {
    const attrs = para ? { ...para.attrs, trackIns: null, trackDel: null } : null;
    const paras = lines.map((l) => schema.nodes.paragraph.create(attrs, lineNodes(l)));
    tr.replaceSelection(new Slice(Fragment.from(paras), 1, 1));
  }
  view.dispatch(tr.scrollIntoView());
  return true;
}
