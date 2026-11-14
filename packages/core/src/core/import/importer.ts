import { Mark, type Node as PMNode } from 'prosemirror-model';
import { DocxDocument, type HeaderFooterPart, type UrlFactory } from '../document';
import { IMAGE_CONTENT_TYPES, OoxmlPackage, REL, relTypeIs, type Relationship } from '../ooxml/package';
import { parseIntSafe, parseMeasure, parseOnOff, parsePct } from '../ooxml/units';
import { drawingTheme, isDrawingUri, readDrawing, type DrawingModel, type DrawingSource, type DrawingTheme } from '../model/drawing';
import { runPropsToMarks } from '../model/marks';
import { bulletChar, NumberingModel } from '../model/numbering';
import { parseBorders, parseParaProps, parseRunProps, parseSection, parseShading } from '../model/props';
import { schema } from '../model/schema';
import { parseCellMargins, parseTheme, StyleSheet } from '../model/styles';
import type { AnchorInfo, CommentReply, CommentThread, MediaItem, SectionProps, TrackInfo } from '../model/types';
import { attr, child, childrenNamed, elements, findAll, findFirst, parseXml, serializeNode, textContent, type XmlElement } from '../xml/xml';

export interface ImportOptions {
  fileName?: string;
  urlFactory?: UrlFactory;
}

export type { AnchorInfo } from '../model/types';

interface FieldFrame {
  instr: string;
  phase: 'instr' | 'result';
  kind: 'pending' | 'page' | 'generic' | 'hyperlink';
  pending: PMNode[];
  marks: readonly Mark[];
  link?: Mark;
}

const PAGE_FIELDS = new Set(['PAGE', 'NUMPAGES', 'SECTIONPAGES']);

const serializeAll = (els: XmlElement[]) => els.map(serializeNode).join('');

function toMarkSet(marks: readonly Mark[]): readonly Mark[] {
  let set: readonly Mark[] = Mark.none;
  for (const m of marks) set = m.addToSet(set);
  return set;
}

let fieldCounter = 0;

/** The field mark for an inline content control, keeping its properties for export. */
function fieldMark(pr: XmlElement | undefined): Mark {
  const kinds: [string, string][] = [['w:date', 'date'], ['w:dropDownList', 'dropdown'], ['w:comboBox', 'combo'], ['w14:checkbox', 'checkbox'], ['w:picture', 'picture'], ['w:richText', 'rich']];
  const kind = kinds.find(([n]) => child(pr, n))?.[1] ?? 'text';
  return schema.marks.field.create({
    id: attr(child(pr, 'w:id'), 'w:val') ?? `f${++fieldCounter}`,
    tag: attr(child(pr, 'w:tag'), 'w:val') ?? '',
    alias: attr(child(pr, 'w:alias'), 'w:val') ?? '',
    kind,
    placeholder: !!child(pr, 'w:showingPlcHdr'),
    raw: pr ? serializeNode(pr) : null,
  });
}

function trackInfo(e: XmlElement): TrackInfo {
  return { id: attr(e, 'w:id') ?? '', author: attr(e, 'w:author') ?? 'Unknown', date: attr(e, 'w:date') ?? '' };
}

function nonEmpty<T extends object>(o: T): T | null {
  return Object.keys(o).length ? o : null;
}

/** State shared by all parts of one import. */
class ImportContext {
  media = new Map<string, MediaItem>();
  warnings: string[] = [];
  /** Theme colours and line widths that drawings refer to. */
  theme: DrawingTheme = drawingTheme({});

  constructor(readonly pkg: OoxmlPackage, readonly urlFactory?: UrlFactory) {}

  relsOf(part: string): Map<string, Relationship> {
    return new Map(this.pkg.getRels(part).map((r) => [r.id, r]));
  }

  /** Load a media part referenced from `part` and return its path and display URL. */
  media4(part: string, rId: string | undefined): { path: string; url: string } | null {
    if (!rId) return null;
    const rel = this.pkg.getRels(part).find((r) => r.id === rId);
    if (!rel || rel.targetMode === 'External') return null;
    const path = this.pkg.resolveTarget(part, rel.target);
    let item = this.media.get(path);
    if (!item) {
      const bytes = this.pkg.get(path);
      if (!bytes) return null;
      const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
      item = { path, bytes, contentType: this.pkg.contentTypes.typeOf(path) ?? IMAGE_CONTENT_TYPES[ext] ?? 'application/octet-stream' };
      this.media.set(path, item);
    }
    if (!item.url && this.urlFactory) item.url = this.urlFactory(item);
    return { path, url: item.url ?? '' };
  }
}

class PartImporter {
  private openComments = new Set<string>();
  private fields: FieldFrame[] = [];
  private pendingInline: PMNode[] = [];
  private rels: Map<string, Relationship>;

  constructor(private readonly ctx: ImportContext, readonly part: string) {
    this.rels = ctx.relsOf(part);
  }

  section(sectPr: XmlElement | undefined): SectionProps {
    return parseSection(
      sectPr,
      (rId) => {
        const rel = this.rels.get(rId);
        return rel && rel.targetMode !== 'External' ? this.ctx.pkg.resolveTarget(this.part, rel.target) : undefined;
      },
      serializeAll,
    );
  }

  // -------------------------------------------------------------------------------------------
  // Blocks

  blocks(container: XmlElement | undefined): PMNode[] {
    const out: PMNode[] = [];
    if (!container) return out;
    this.collectBlocks(container, out);
    if (this.pendingInline.length) {
      out.push(schema.nodes.paragraph.create(null, this.pendingInline));
      this.pendingInline = [];
    }
    return out;
  }

  private collectBlocks(container: XmlElement, out: PMNode[]) {
    for (const c of elements(container)) {
      switch (c.name) {
        case 'w:p':
          out.push(...this.paragraph(c));
          break;
        case 'w:tbl':
          out.push(this.table(c));
          break;
        case 'w:sdt':
          this.collectBlocks(child(c, 'w:sdtContent') ?? c, out);
          break;
        case 'w:customXml':
        case 'w:smartTag':
          this.collectBlocks(c, out);
          break;
        case 'w:bookmarkStart':
          this.pendingInline.push(schema.nodes.bookmark_start.create({ id: attr(c, 'w:id') ?? '0', name: attr(c, 'w:name') ?? '' }));
          break;
        case 'w:bookmarkEnd':
          this.pendingInline.push(schema.nodes.bookmark_end.create({ id: attr(c, 'w:id') ?? '0' }));
          break;
        case 'w:commentRangeStart':
          this.openComments.add(attr(c, 'w:id') ?? '');
          break;
        case 'w:commentRangeEnd':
          this.openComments.delete(attr(c, 'w:id') ?? '');
          break;
        case 'w:sectPr':
        case 'w:tcPr':
        case 'w:sdtPr':
        case 'w:sdtEndPr':
        case 'w:customXmlPr':
        case 'w:proofErr':
        case 'w:permStart':
        case 'w:permEnd':
        case 'w:moveFromRangeStart':
        case 'w:moveFromRangeEnd':
        case 'w:moveToRangeStart':
        case 'w:moveToRangeEnd':
          break;
        default:
          out.push(schema.nodes.opaque_block.create({ xml: serializeNode(c), label: labelFor(c.name), part: this.part }));
      }
    }
  }

  paragraph(p: XmlElement): PMNode[] {
    const parsed = parseParaProps(child(p, 'w:pPr'));
    const mark = parseRunProps(parsed.rPr);
    const pp = parsed.props;
    const markRaw = [...mark.raw, ...(mark.change ? [mark.change] : [])];
    const attrs = {
      styleId: pp.styleId ?? null,
      align: pp.align ?? null,
      indent: pp.indent ? nonEmpty(pp.indent) : null,
      spacing: pp.spacing ? nonEmpty(pp.spacing) : null,
      numPr: pp.numPr ?? null,
      keepNext: pp.keepNext ?? null,
      keepLines: pp.keepLines ?? null,
      pageBreakBefore: pp.pageBreakBefore ?? null,
      widowControl: pp.widowControl ?? null,
      contextualSpacing: pp.contextualSpacing ?? null,
      tabs: pp.tabs ?? null,
      borders: pp.borders ? nonEmpty(pp.borders) : null,
      shading: pp.shading ?? null,
      outlineLvl: pp.outlineLvl ?? null,
      bidi: pp.bidi ?? null,
      markProps: nonEmpty(mark.props),
      markRaw: markRaw.length ? serializeAll(markRaw) : null,
      trackIns: mark.ins ? trackInfo(mark.ins) : null,
      trackDel: mark.del ? trackInfo(mark.del) : null,
      pPrChange: parsed.change ? serializeNode(parsed.change) : null,
      raw: parsed.raw.length ? serializeAll(parsed.raw) : null,
    };
    const content: PMNode[] = this.pendingInline;
    this.pendingInline = [];
    this.inline(p, Mark.none, content);
    // Instructions still pending at the end of a paragraph cannot be page fields; flush them.
    for (const f of this.fields) {
      if (f.phase === 'instr' && f.pending.length) this.decide(f, content);
    }
    const out = [schema.nodes.paragraph.create(attrs, content)];
    if (parsed.sectPr) out.push(schema.nodes.section_break.create({ section: this.section(parsed.sectPr) }));
    return out;
  }

  // -------------------------------------------------------------------------------------------
  // Tables

  table(tbl: XmlElement): PMNode {
    const tblPr = child(tbl, 'w:tblPr');
    const known = new Set(['w:tblStyle', 'w:tblW', 'w:jc', 'w:tblInd', 'w:tblLayout', 'w:tblBorders', 'w:tblCellMar', 'w:tblLook', 'w:shd']);
    const raw = elements(tblPr).filter((e) => !known.has(e.name));
    const tblW = child(tblPr, 'w:tblW');
    const look = child(tblPr, 'w:tblLook');
    const lookVal = parseInt(attr(look, 'w:val') ?? '', 16);
    const lookFlag = (name: string, bit: number) => {
      const v = attr(look, `w:${name}`);
      if (v !== undefined) return parseOnOff(v);
      return Number.isFinite(lookVal) ? (lookVal & bit) !== 0 : undefined;
    };
    const grid = childrenNamed(child(tbl, 'w:tblGrid'), 'w:gridCol').map((g) => parseMeasure(attr(g, 'w:w'), 'twips') ?? 0);
    const attrs = {
      styleId: attr(child(tblPr, 'w:tblStyle'), 'w:val') ?? null,
      width: tblW ? { type: attr(tblW, 'w:type') ?? 'dxa', value: attr(tblW, 'w:type') === 'pct' ? parsePct(attr(tblW, 'w:w')) ?? 100 : parseMeasure(attr(tblW, 'w:w'), 'twips') ?? 0 } : null,
      align: attr(child(tblPr, 'w:jc'), 'w:val') ?? null,
      indent: parseMeasure(attr(child(tblPr, 'w:tblInd'), 'w:w'), 'twips') ?? null,
      layout: attr(child(tblPr, 'w:tblLayout'), 'w:type') ?? null,
      borders: parseBorders(child(tblPr, 'w:tblBorders')) ?? null,
      cellMargins: parseCellMargins(child(tblPr, 'w:tblCellMar')) ?? null,
      look: look
        ? {
            firstRow: lookFlag('firstRow', 0x20) ?? true,
            lastRow: lookFlag('lastRow', 0x40) ?? false,
            firstColumn: lookFlag('firstColumn', 0x80) ?? true,
            lastColumn: lookFlag('lastColumn', 0x100) ?? false,
            noHBand: lookFlag('noHBand', 0x200) ?? false,
            noVBand: lookFlag('noVBand', 0x400) ?? true,
          }
        : null,
      grid: grid.length ? grid : null,
      shading: parseShading(child(tblPr, 'w:shd')) ?? null,
      raw: raw.length ? serializeAll(raw) : null,
    };

    const rowEls: XmlElement[] = [];
    const collectRows = (e: XmlElement) => {
      for (const c of elements(e)) {
        if (c.name === 'w:tr') rowEls.push(c);
        else if (c.name === 'w:sdt') collectRows(child(c, 'w:sdtContent') ?? c);
        else if (c.name === 'w:customXml') collectRows(c);
      }
    };
    collectRows(tbl);

    interface CellDraft { attrs: Record<string, unknown>; content: PMNode[]; col: number; span: number }
    const rows: { attrs: Record<string, unknown>; cells: CellDraft[] }[] = [];
    const owners = new Map<number, CellDraft>();
    for (const tr of rowEls) {
      const trPr = child(tr, 'w:trPr');
      const trKnown = new Set(['w:trHeight', 'w:tblHeader', 'w:cantSplit', 'w:gridBefore', 'w:gridAfter']);
      const trRaw = [...elements(trPr).filter((e) => !trKnown.has(e.name)), ...childrenNamed(tr, 'w:tblPrEx')];
      const height = child(trPr, 'w:trHeight');
      const gridBefore = parseIntSafe(attr(child(trPr, 'w:gridBefore'), 'w:val')) ?? 0;
      const gridAfter = parseIntSafe(attr(child(trPr, 'w:gridAfter'), 'w:val')) ?? 0;
      const rowAttrs = {
        height: parseMeasure(attr(height, 'w:val'), 'twips') ?? null,
        heightRule: attr(height, 'w:hRule') ?? null,
        header: child(trPr, 'w:tblHeader') ? parseOnOff(attr(child(trPr, 'w:tblHeader'), 'w:val')) : false,
        cantSplit: child(trPr, 'w:cantSplit') ? parseOnOff(attr(child(trPr, 'w:cantSplit'), 'w:val')) : false,
        raw: trRaw.length ? serializeAll(trRaw) : null,
      };
      const cells: CellDraft[] = [];
      let col = 0;
      if (gridBefore > 0) {
        cells.push({ attrs: { colspan: gridBefore, placeholder: 'before' }, content: [schema.nodes.paragraph.create()], col, span: gridBefore });
        col += gridBefore;
      }
      const cellEls: XmlElement[] = [];
      const collectCells = (e: XmlElement) => {
        for (const c of elements(e)) {
          if (c.name === 'w:tc') cellEls.push(c);
          else if (c.name === 'w:sdt') collectCells(child(c, 'w:sdtContent') ?? c);
          else if (c.name === 'w:customXml') collectCells(c);
        }
      };
      collectCells(tr);
      const pendingContinues: { draft: CellDraft; owner: CellDraft }[] = [];
      for (const tc of cellEls) {
        const tcPr = child(tc, 'w:tcPr');
        const tcKnown = new Set(['w:tcW', 'w:gridSpan', 'w:vMerge', 'w:shd', 'w:tcBorders', 'w:vAlign', 'w:tcMar', 'w:noWrap', 'w:hMerge', 'w:cnfStyle']);
        const tcRaw = elements(tcPr).filter((e) => !tcKnown.has(e.name));
        const span = Math.max(1, parseIntSafe(attr(child(tcPr, 'w:gridSpan'), 'w:val')) ?? 1);
        const tcW = child(tcPr, 'w:tcW');
        const vMerge = child(tcPr, 'w:vMerge');
        const vMergeVal = vMerge ? attr(vMerge, 'w:val') ?? 'continue' : null;
        const draft: CellDraft = {
          attrs: {
            colspan: span,
            rowspan: 1,
            width: tcW ? { type: attr(tcW, 'w:type') ?? 'dxa', value: attr(tcW, 'w:type') === 'pct' ? parsePct(attr(tcW, 'w:w')) ?? 0 : parseMeasure(attr(tcW, 'w:w'), 'twips') ?? 0 } : null,
            shading: parseShading(child(tcPr, 'w:shd')) ?? null,
            borders: parseBorders(child(tcPr, 'w:tcBorders')) ?? null,
            vAlign: attr(child(tcPr, 'w:vAlign'), 'w:val') ?? null,
            margins: parseCellMargins(child(tcPr, 'w:tcMar')) ?? null,
            noWrap: child(tcPr, 'w:noWrap') ? true : null,
            raw: tcRaw.length ? serializeAll(tcRaw) : null,
          },
          content: [],
          col,
          span,
        };
        draft.content = this.blocks(tc);
        if (!draft.content.length || draft.content[draft.content.length - 1].type !== schema.nodes.paragraph) {
          draft.content.push(schema.nodes.paragraph.create());
        }
        if (vMergeVal === 'continue' && owners.has(col)) {
          pendingContinues.push({ draft, owner: owners.get(col)! });
        } else {
          if (vMergeVal === 'restart') owners.set(col, draft);
          else owners.delete(col);
          cells.push(draft);
        }
        col += span;
      }
      if (gridAfter > 0) {
        cells.push({ attrs: { colspan: gridAfter, placeholder: 'after' }, content: [schema.nodes.paragraph.create()], col, span: gridAfter });
        col += gridAfter;
      }
      if (cells.length === 0) {
        // Every cell continued a vertical merge; keep them unmerged so the row is valid.
        for (const { draft } of pendingContinues) cells.push(draft);
      } else {
        for (const { owner } of pendingContinues) (owner.attrs.rowspan as number)++;
      }
      cells.sort((a, b) => a.col - b.col);
      rows.push({ attrs: rowAttrs, cells });
    }

    const gridPx = grid.map((w) => Math.max(10, Math.round(w / 15)));
    const rowNodes = rows.map((r) =>
      schema.nodes.table_row.create(
        r.attrs,
        r.cells.map((c) => {
          let colwidth: number[] | null = null;
          if (gridPx.length >= c.col + c.span) colwidth = gridPx.slice(c.col, c.col + c.span);
          else {
            const w = c.attrs.width as { type: string; value: number } | null;
            if (w && w.type === 'dxa' && w.value > 0) colwidth = Array.from({ length: c.span }, () => Math.round(w.value / 15 / c.span));
          }
          // Absolute widths are represented by colwidth; only percentages need to be kept.
          const w = c.attrs.width as { type: string } | null;
          return schema.nodes.table_cell.create({ ...c.attrs, colwidth, width: w && w.type === 'pct' ? w : null }, c.content);
        }),
      ),
    );
    if (!rowNodes.length) rowNodes.push(schema.nodes.table_row.create(null, [schema.nodes.table_cell.create(null, [schema.nodes.paragraph.create()])]));
    return schema.nodes.table.create(attrs, rowNodes);
  }

  // -------------------------------------------------------------------------------------------
  // Inline content

  private commentMarks(): Mark[] {
    return [...this.openComments].map((id) => schema.marks.comment.create({ id }));
  }

  /** Where content produced now should go: the innermost field still collecting its instruction, or `out`. */
  private target(out: PMNode[], below = this.fields.length): PMNode[] {
    for (let i = below - 1; i >= 0; i--) {
      const f = this.fields[i];
      if (f.phase === 'instr' && f.kind === 'pending') return f.pending;
    }
    return out;
  }

  private fieldLinkMarks(): Mark[] {
    return this.fields.filter((f) => f.phase === 'result' && f.link).map((f) => f.link!);
  }

  private skippingResult(): boolean {
    return this.fields.some((f) => f.phase === 'result' && f.kind === 'page');
  }

  private decide(frame: FieldFrame, out: PMNode[], withSeparate = false) {
    const idx = this.fields.indexOf(frame);
    const dest = this.target(out, idx);
    if (frame.kind === 'pending') {
      const word = frame.instr.trim().split(/\s+/)[0]?.toUpperCase() ?? '';
      const nested = idx > 0;
      if (PAGE_FIELDS.has(word) && !nested) {
        frame.kind = 'page';
        frame.pending = [];
        const format = /\\\*\s*(\w+)/.exec(frame.instr)?.[1] ?? null;
        dest.push(schema.nodes.page_field.create({ kind: word, instr: frame.instr, format }, null, frame.marks));
        return;
      }
      frame.kind = word === 'HYPERLINK' ? 'hyperlink' : 'generic';
      if (frame.kind === 'hyperlink') {
        const anchor = /\\l\s+"([^"]*)"/.exec(frame.instr)?.[1];
        const url = /HYPERLINK\s+"([^"]*)"/i.exec(frame.instr)?.[1];
        frame.link = schema.marks.link.create({ href: url ?? '', anchor: anchor ?? null, fromField: true });
      }
    }
    if (frame.kind === 'page') return;
    dest.push(...frame.pending);
    frame.pending = [];
    if (withSeparate) dest.push(schema.nodes.field_char.create({ type: 'separate' }, null, frame.marks));
  }

  private fldChar(c: XmlElement, marks: readonly Mark[], out: PMNode[]) {
    const type = attr(c, 'w:fldCharType');
    const raw = elements(c).length ? serializeNode(c) : null;
    if (type === 'begin') {
      if (this.skippingResult()) {
        this.fields.push({ instr: '', phase: 'result', kind: 'page', pending: [], marks });
        return;
      }
      this.fields.push({ instr: '', phase: 'instr', kind: 'pending', pending: [schema.nodes.field_char.create({ type: 'begin', raw }, null, marks)], marks });
      return;
    }
    const frame = this.fields[this.fields.length - 1];
    if (!frame) {
      out.push(schema.nodes.field_char.create({ type: type ?? 'end', raw }, null, marks));
      return;
    }
    if (type === 'separate') {
      if (frame.phase === 'instr') this.decide(frame, out, true);
      frame.phase = 'result';
    } else if (type === 'end') {
      if (frame.phase === 'instr') this.decide(frame, out);
      this.fields.pop();
      if (frame.kind !== 'page') this.target(out).push(schema.nodes.field_char.create({ type: 'end', raw }, null, marks));
    }
  }

  inline(container: XmlElement | undefined, ctxMarks: readonly Mark[], out: PMNode[]) {
    if (!container) return;
    for (const c of elements(container)) {
      switch (c.name) {
        case 'w:pPr':
        case 'w:rPr':
          break;
        case 'w:r':
          this.run(c, ctxMarks, out);
          break;
        case 'w:hyperlink': {
          const rel = this.rels.get(attr(c, 'r:id') ?? '');
          const link = schema.marks.link.create({
            href: rel?.target ?? '',
            anchor: attr(c, 'w:anchor') ?? null,
            tooltip: attr(c, 'w:tooltip') ?? null,
          });
          this.inline(c, [...ctxMarks, link], out);
          break;
        }
        case 'w:ins':
        case 'w:moveTo':
          this.inline(c, [...ctxMarks, schema.marks.insertion.create(trackInfo(c))], out);
          break;
        case 'w:del':
        case 'w:moveFrom':
          this.inline(c, [...ctxMarks, schema.marks.deletion.create(trackInfo(c))], out);
          break;
        case 'w:fldSimple':
          this.fldSimple(c, ctxMarks, out);
          break;
        case 'w:smartTag':
        case 'w:customXml':
        case 'w:dir':
        case 'w:bdo':
          this.inline(c, ctxMarks, out);
          break;
        case 'w:sdt':
          this.inline(child(c, 'w:sdtContent'), [...ctxMarks, fieldMark(child(c, 'w:sdtPr'))], out);
          break;
        case 'w:bookmarkStart':
          this.target(out).push(schema.nodes.bookmark_start.create({ id: attr(c, 'w:id') ?? '0', name: attr(c, 'w:name') ?? '' }));
          break;
        case 'w:bookmarkEnd':
          this.target(out).push(schema.nodes.bookmark_end.create({ id: attr(c, 'w:id') ?? '0' }));
          break;
        case 'w:commentRangeStart':
          this.openComments.add(attr(c, 'w:id') ?? '');
          break;
        case 'w:commentRangeEnd':
          this.openComments.delete(attr(c, 'w:id') ?? '');
          break;
        case 'm:oMath':
        case 'm:oMathPara': {
          const text = findAll(c, 'm:t').map(textContent).join('');
          this.target(out).push(schema.nodes.opaque_inline.create({ xml: serializeNode(c), label: 'Equation', text, part: this.part }, null, toMarkSet([...ctxMarks, ...this.commentMarks()])));
          break;
        }
        case 'w:proofErr':
        case 'w:permStart':
        case 'w:permEnd':
        case 'w:smartTagPr':
        case 'w:customXmlPr':
        case 'w:sdtPr':
        case 'w:sdtEndPr':
        case 'w:moveFromRangeStart':
        case 'w:moveFromRangeEnd':
        case 'w:moveToRangeStart':
        case 'w:moveToRangeEnd':
        case 'w:customXmlInsRangeStart':
        case 'w:customXmlInsRangeEnd':
        case 'w:customXmlDelRangeStart':
        case 'w:customXmlDelRangeEnd':
          break;
        default:
          this.target(out).push(schema.nodes.opaque_inline.create({ xml: serializeNode(c), label: labelFor(c.name), part: this.part }));
      }
    }
  }

  private fldSimple(c: XmlElement, ctxMarks: readonly Mark[], out: PMNode[]) {
    const instr = attr(c, 'w:instr') ?? '';
    const word = instr.trim().split(/\s+/)[0]?.toUpperCase() ?? '';
    const firstRun = child(c, 'w:r');
    const runMarks = toMarkSet([...ctxMarks, ...runPropsToMarks(parseRunProps(child(firstRun, 'w:rPr')).props)]);
    if (PAGE_FIELDS.has(word) && !this.fields.length) {
      const format = /\\\*\s*(\w+)/.exec(instr)?.[1] ?? null;
      out.push(schema.nodes.page_field.create({ kind: word, instr, format }, null, runMarks));
      return;
    }
    const dest = this.target(out);
    dest.push(schema.nodes.field_char.create({ type: 'begin' }, null, runMarks));
    dest.push(schema.nodes.instr_text.create({ text: instr }, null, runMarks));
    dest.push(schema.nodes.field_char.create({ type: 'separate' }, null, runMarks));
    let marks = ctxMarks;
    if (word === 'HYPERLINK') {
      const url = /HYPERLINK\s+"([^"]*)"/i.exec(instr)?.[1];
      const anchor = /\\l\s+"([^"]*)"/.exec(instr)?.[1];
      marks = [...ctxMarks, schema.marks.link.create({ href: url ?? '', anchor: anchor ?? null, fromField: true })];
    }
    this.inline(c, marks, dest);
    dest.push(schema.nodes.field_char.create({ type: 'end' }, null, runMarks));
  }

  private run(r: XmlElement, ctxMarks: readonly Mark[], out: PMNode[]) {
    const rPr = parseRunProps(child(r, 'w:rPr'));
    const markList: Mark[] = [...ctxMarks, ...runPropsToMarks(rPr.props, rPr.raw.length ? serializeAll(rPr.raw) : null), ...this.commentMarks()];
    if (rPr.change) {
      const info = trackInfo(rPr.change);
      markList.push(schema.marks.formatChange.create({
        ...info,
        oldProps: parseRunProps(child(rPr.change, 'w:rPr')).props,
        raw: serializeNode(rPr.change),
      }));
    }
    const marks = toMarkSet(markList);
    const text = (dest: PMNode[], t: string) => {
      if (t) dest.push(schema.text(t, toMarkSet([...marks, ...this.fieldLinkMarks()])));
    };
    const atom = (dest: PMNode[], node: PMNode) => dest.push(node);
    for (const c of elements(r)) {
      if (c.name === 'w:rPr') continue;
      if (c.name === 'w:fldChar') {
        this.fldChar(c, marks, out);
        continue;
      }
      if (c.name === 'w:instrText' || c.name === 'w:delInstrText') {
        const frame = this.fields[this.fields.length - 1];
        if (frame && frame.phase === 'instr') {
          frame.instr += textContent(c);
          (frame.kind === 'pending' ? frame.pending : this.target(out)).push(schema.nodes.instr_text.create({ text: textContent(c) }, null, marks));
        } else if (!this.skippingResult()) {
          this.target(out).push(schema.nodes.instr_text.create({ text: textContent(c) }, null, marks));
        }
        continue;
      }
      if (this.skippingResult()) continue;
      const dest = this.target(out);
      switch (c.name) {
        case 't':
        case 'w:t':
        case 'w:delText':
          text(dest, textContent(c));
          break;
        case 'w:tab':
        case 'w:ptab':
          atom(dest, schema.nodes.tab.create(null, null, marks));
          break;
        case 'w:br': {
          const type = attr(c, 'w:type');
          if (type === 'page') atom(dest, schema.nodes.page_break.create(null, null, marks));
          else if (type === 'column') atom(dest, schema.nodes.column_break.create(null, null, marks));
          else atom(dest, schema.nodes.hard_break.create({ clear: attr(c, 'w:clear') ?? null }, null, marks));
          break;
        }
        case 'w:cr':
          atom(dest, schema.nodes.hard_break.create(null, null, marks));
          break;
        case 'w:noBreakHyphen':
          text(dest, '‑');
          break;
        case 'w:softHyphen':
          text(dest, '­');
          break;
        case 'w:sym': {
          const code = parseInt(attr(c, 'w:char') ?? '', 16);
          const ch = Number.isFinite(code) ? bulletChar(String.fromCharCode(code), attr(c, 'w:font')) : '?';
          atom(dest, schema.nodes.opaque_inline.create({ xml: serializeNode(c), label: `Symbol (${attr(c, 'w:font') ?? ''})`, text: ch, part: this.part }, null, marks));
          break;
        }
        case 'w:drawing':
          atom(dest, this.drawing(c, c, marks));
          break;
        case 'mc:AlternateContent':
          atom(dest, this.alternateContent(c, marks));
          break;
        case 'w:pict':
        case 'w:object':
          atom(dest, this.vml(c, marks));
          break;
        case 'w:footnoteReference':
        case 'w:endnoteReference':
          atom(dest, schema.nodes.footnote_ref.create({
            id: attr(c, 'w:id') ?? '0',
            kind: c.name === 'w:footnoteReference' ? 'footnote' : 'endnote',
            raw: attr(c, 'w:customMarkFollows') ? serializeNode(c) : null,
          }, null, marks));
          break;
        case 'w:commentReference':
        case 'w:annotationRef':
        case 'w:lastRenderedPageBreak':
        case 'w:separator':
        case 'w:continuationSeparator':
        case 'w:footnoteRef':
        case 'w:endnoteRef':
          break;
        default:
          atom(dest, schema.nodes.opaque_inline.create({ xml: serializeNode(c), label: labelFor(c.name), part: this.part }, null, marks));
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // Drawings

  private anchorInfo(anchor: XmlElement): AnchorInfo {
    const posH = child(anchor, 'wp:positionH');
    const posV = child(anchor, 'wp:positionV');
    const wrapEl = elements(anchor).find((e) => e.name.startsWith('wp:wrap'));
    const wrapName = wrapEl?.name.slice(7) ?? 'None';
    const wrap = ({ Square: 'square', Tight: 'tight', Through: 'through', TopAndBottom: 'topAndBottom', None: 'none' } as const)[wrapName as 'Square'] ?? 'none';
    const num = (e: XmlElement | undefined) => (e ? parseIntSafe(textContent(e).trim()) : undefined);
    return {
      wrap,
      behindDoc: parseOnOff(attr(anchor, 'behindDoc') ?? '0'),
      hRelative: attr(posH, 'relativeFrom'),
      hAlign: child(posH, 'wp:align') ? textContent(child(posH, 'wp:align')!).trim() : undefined,
      hOffset: num(child(posH, 'wp:posOffset')),
      vRelative: attr(posV, 'relativeFrom'),
      vAlign: child(posV, 'wp:align') ? textContent(child(posV, 'wp:align')!).trim() : undefined,
      vOffset: num(child(posV, 'wp:posOffset')),
      distT: parseIntSafe(attr(anchor, 'distT')) ?? 0,
      distB: parseIntSafe(attr(anchor, 'distB')) ?? 0,
      distL: parseIntSafe(attr(anchor, 'distL')) ?? 0,
      distR: parseIntSafe(attr(anchor, 'distR')) ?? 0,
    };
  }

  /** `drawing` is the w:drawing element; `rawEl` is what gets preserved (drawing or AlternateContent). */
  private drawing(drawing: XmlElement, rawEl: XmlElement, marks: readonly Mark[], fallbackSrc?: string): PMNode {
    const container = child(drawing, 'wp:inline') ?? child(drawing, 'wp:anchor');
    const extent = child(container, 'wp:extent');
    const cx = parseIntSafe(attr(extent, 'cx')) ?? 914400;
    const cy = parseIntSafe(attr(extent, 'cy')) ?? 914400;
    const docPr = child(container, 'wp:docPr');
    const graphicData = container ? findFirst(container, 'a:graphicData') : undefined;
    const uri = attr(graphicData, 'uri') ?? '';
    // Only a picture graphic is a picture: pictures in groups and canvases are parts of those.
    const pic = child(graphicData, 'pic:pic');
    const isAnchor = container?.name === 'wp:anchor';
    if (pic) {
      const blip = findFirst(pic, 'a:blip');
      const media = this.ctx.media4(this.part, attr(blip, 'r:embed'));
      if (media) {
        return schema.nodes.image.create({
          src: media.url,
          mediaPath: media.path,
          width: cx,
          height: cy,
          alt: attr(docPr, 'descr') ?? '',
          title: attr(docPr, 'title') ?? '',
          name: attr(docPr, 'name') ?? '',
          anchor: isAnchor ? this.anchorInfo(container!) : null,
          raw: serializeNode(rawEl),
          part: this.part,
        }, null, marks);
      }
    }
    const label = uri.includes('chart') ? 'Chart' : uri.includes('diagram') ? 'SmartArt' : uri.includes('wordprocessingGroup') ? 'Group' : uri.includes('Canvas') ? 'Drawing canvas' : 'Shape';
    const text = container ? findAll(container, 'w:t').map(textContent).join(' ').slice(0, 200) : '';
    let model: DrawingModel | null = null;
    if (container && isDrawingUri(uri)) {
      try {
        model = readDrawing(container, this.drawingSource(), isAnchor ? this.anchorInfo(container) : null);
        // Nothing it can draw (charts in a group, say): show the placeholder instead.
        if (model && !model.parts.length) model = null;
      } catch (e) {
        this.ctx.warnings.push(`Could not read a drawing: ${(e as Error).message}`);
      }
    }
    return schema.nodes.opaque_inline.create({ xml: serializeNode(rawEl), label, width: cx, height: cy, text, src: fallbackSrc ?? null, part: this.part, drawing: model }, null, marks);
  }

  private drawingSource(): DrawingSource {
    return {
      theme: this.ctx.theme,
      media: (rId) => this.ctx.media4(this.part, rId),
      // Its own importer: fields, comments and bookmarks in a text box are not the paragraph's.
      text: (content) => new PartImporter(this.ctx, this.part).blocks(content).map((n) => n.toJSON()),
    };
  }

  private alternateContent(ac: XmlElement, marks: readonly Mark[]): PMNode {
    const choice = child(ac, 'mc:Choice');
    const fallback = child(ac, 'mc:Fallback');
    const imagedata = fallback ? findFirst(fallback, 'v:imagedata') : undefined;
    const fallbackSrc = imagedata ? this.ctx.media4(this.part, attr(imagedata, 'r:id'))?.url : undefined;
    const drawing = choice ? findFirst(choice, 'w:drawing') : undefined;
    if (drawing) return this.drawing(drawing, ac, marks, fallbackSrc);
    return schema.nodes.opaque_inline.create({ xml: serializeNode(ac), label: 'Object', src: fallbackSrc ?? null, part: this.part }, null, marks);
  }

  private vml(pict: XmlElement, marks: readonly Mark[]): PMNode {
    const imagedata = findFirst(pict, 'v:imagedata');
    const shape = findFirst(pict, 'v:shape');
    const style = attr(shape, 'style') ?? '';
    const dim = (name: string) => {
      const m = new RegExp(`${name}:\\s*([\\d.]+)(pt|px|in|cm|mm)?`).exec(style);
      if (!m) return undefined;
      return parseMeasure(`${m[1]}${m[2] ?? 'pt'}`, 'emu');
    };
    const media = imagedata ? this.ctx.media4(this.part, attr(imagedata, 'r:id')) : null;
    const width = dim('width') ?? 1828800;
    const height = dim('height') ?? 1371600;
    const text = findAll(pict, 'w:t').map(textContent).join(' ').slice(0, 200);
    return schema.nodes.opaque_inline.create({
      xml: serializeNode(pict),
      label: pict.name === 'w:object' ? 'Embedded object' : 'Legacy drawing',
      width,
      height,
      text,
      src: media?.url ?? null,
      part: this.part,
    }, null, marks);
  }
}

function labelFor(name: string): string {
  const local = name.replace(/^.*:/, '');
  return local.charAt(0).toUpperCase() + local.slice(1);
}

// -------------------------------------------------------------------------------------------
// Comments

function commentText(c: XmlElement): string {
  return childrenNamed(c, 'w:p')
    .map((p) => {
      let s = '';
      const walk = (e: XmlElement) => {
        for (const k of elements(e)) {
          if (k.name === 'w:t') s += textContent(k);
          else if (k.name === 'w:tab') s += '\t';
          else if (k.name === 'w:br' || k.name === 'w:cr') s += '\n';
          else if (k.name !== 'w:pPr' && k.name !== 'w:rPr') walk(k);
        }
      };
      walk(p);
      return s;
    })
    .join('\n');
}

function importComments(pkg: OoxmlPackage, mainPath: string): Map<string, CommentThread> {
  const threads = new Map<string, CommentThread>();
  const rel = pkg.findRel(mainPath, REL.comments);
  if (!rel) return threads;
  const path = pkg.resolveTarget(mainPath, rel.target);
  const xml = pkg.getText(path);
  if (!xml) return threads;
  const { root } = parseXml(xml);
  interface Raw { id: string; author: string; initials?: string; date?: string; text: string; paraId?: string }
  const all: Raw[] = childrenNamed(root, 'w:comment').map((c) => {
    const paras = childrenNamed(c, 'w:p');
    return {
      id: attr(c, 'w:id') ?? '',
      author: attr(c, 'w:author') ?? 'Unknown',
      initials: attr(c, 'w:initials'),
      date: attr(c, 'w:date'),
      text: commentText(c),
      paraId: attr(paras[paras.length - 1], 'w14:paraId'),
    };
  });
  const ext = new Map<string, { parent?: string; done: boolean }>();
  const extRel = pkg.getRels(mainPath).find((r) => relTypeIs(r.type, REL.commentsExtended));
  const extXml = extRel ? pkg.getText(pkg.resolveTarget(mainPath, extRel.target)) : undefined;
  if (extXml) {
    for (const e of childrenNamed(parseXml(extXml).root, 'w15:commentEx')) {
      const pid = attr(e, 'w15:paraId');
      if (pid) ext.set(pid, { parent: attr(e, 'w15:paraIdParent'), done: parseOnOff(attr(e, 'w15:done') ?? '0') });
    }
  }
  const byPara = new Map<string, Raw>();
  for (const c of all) if (c.paraId) byPara.set(c.paraId, c);
  const rootOf = (c: Raw, depth = 0): Raw => {
    const parentPara = c.paraId ? ext.get(c.paraId)?.parent : undefined;
    const parent = parentPara ? byPara.get(parentPara) : undefined;
    return parent && depth < 50 ? rootOf(parent, depth + 1) : c;
  };
  for (const c of all) {
    const r = rootOf(c);
    if (r === c) {
      threads.set(c.id, { id: c.id, author: c.author, initials: c.initials, date: c.date, text: c.text, done: c.paraId ? ext.get(c.paraId)?.done : false, replies: [] });
    }
  }
  for (const c of all) {
    const r = rootOf(c);
    if (r === c) continue;
    const reply: CommentReply = { id: c.id, author: c.author, initials: c.initials, date: c.date, text: c.text, done: c.paraId ? ext.get(c.paraId)?.done : false };
    threads.get(r.id)?.replies.push(reply);
  }
  return threads;
}

// -------------------------------------------------------------------------------------------

function collectSections(body: PMNode): SectionProps[] {
  const out: SectionProps[] = [];
  body.forEach((n) => {
    if (n.type === schema.nodes.section_break) out.push(n.attrs.section as SectionProps);
  });
  out.push(body.attrs.finalSection as SectionProps);
  return out;
}

/** Import a .docx file. Throws with a readable message if the file is not a usable DOCX. */
export function importDocx(bytes: Uint8Array, opts: ImportOptions = {}): DocxDocument {
  const pkg = OoxmlPackage.fromBytes(bytes);
  const mainPath = pkg.mainDocumentPath();
  const relText = (type: string) => {
    const r = pkg.findRel(mainPath, type);
    return r && r.targetMode !== 'External' ? pkg.getText(pkg.resolveTarget(mainPath, r.target)) : undefined;
  };
  const styles = StyleSheet.parse(relText(REL.styles));
  const numbering = NumberingModel.parse(relText(REL.numbering), styles);
  const xml = pkg.getText(mainPath);
  if (!xml) throw new Error('Not a valid DOCX file: the main document part is empty');
  const { root, extraNamespaces } = parseXml(xml);
  if (root.name !== 'w:document') throw new Error(`Unsupported main document (${root.name}); only WordprocessingML documents can be opened`);
  // Settings (read first: drawings need the colour mapping)
  const settingsRel = pkg.findRel(mainPath, REL.settings);
  const settingsPath = settingsRel ? pkg.resolveTarget(mainPath, settingsRel.target) : null;
  const settingsXml = settingsPath ? pkg.getText(settingsPath) : undefined;
  const settingsDoc = settingsXml ? parseXml(settingsXml) : null;
  const sroot = settingsDoc?.root;
  const theme = parseTheme(relText(REL.theme));

  const ctx = new ImportContext(pkg, opts.urlFactory);
  ctx.theme = drawingTheme(theme.colors, theme.lineWidths, child(sroot, 'w:clrSchemeMapping'));
  const imp = new PartImporter(ctx, mainPath);
  const bodyEl = child(root, 'w:body');
  const blocks = imp.blocks(bodyEl);
  if (!blocks.length || blocks[blocks.length - 1].type !== schema.nodes.paragraph) blocks.push(schema.nodes.paragraph.create());

  const evenAndOdd = !!child(sroot, 'w:evenAndOddHeaders') && parseOnOff(attr(child(sroot, 'w:evenAndOddHeaders'), 'w:val'));
  const defaultTabStop = parseMeasure(attr(child(sroot, 'w:defaultTabStop'), 'w:val'), 'twips') ?? 720;
  const trackRevisions = !!child(sroot, 'w:trackRevisions') && parseOnOff(attr(child(sroot, 'w:trackRevisions'), 'w:val'));

  const finalSection = imp.section(child(bodyEl, 'w:sectPr'));
  const body = schema.nodes.doc.create({ finalSection, evenAndOddHeaders: evenAndOdd, defaultTabStop }, blocks);

  const doc = new DocxDocument(pkg, mainPath, body, styles, numbering, opts.fileName ?? 'Document.docx');
  doc.setUrlFactory(opts.urlFactory);
  doc.theme = theme;
  doc.documentRootAttrs = { ...root.attrs };
  doc.documentExtraXml = elements(root).filter((e) => e.name !== 'w:body').map(serializeNode);
  doc.documentNamespaces = extraNamespaces;
  doc.settings = { trackRevisions, xml: settingsDoc, path: settingsPath };

  // Headers and footers referenced by any section.
  for (const sp of collectSections(body)) {
    for (const [kind, refs] of [['header', sp.headers], ['footer', sp.footers]] as const) {
      for (const path of Object.values(refs)) {
        if (!path || doc.headerFooters.has(path)) continue;
        const text = pkg.getText(path);
        if (!text) continue;
        try {
          const parsed = parseXml(text);
          const hfImp = new PartImporter(ctx, path);
          const hfBlocks = hfImp.blocks(parsed.root);
          if (!hfBlocks.length || hfBlocks[hfBlocks.length - 1].type !== schema.nodes.paragraph) hfBlocks.push(schema.nodes.paragraph.create());
          const part: HeaderFooterPart = {
            path,
            kind,
            doc: schema.nodes.doc.create(null, hfBlocks),
            rootAttrs: { ...parsed.root.attrs },
            extraNamespaces: parsed.extraNamespaces,
          };
          doc.headerFooters.set(path, part);
        } catch (e) {
          doc.warnings.push(`Could not read ${path}: ${(e as Error).message}`);
        }
      }
    }
  }

  // Footnotes and endnotes (separators excluded).
  for (const [kind, relType] of [['footnote', REL.footnotes], ['endnote', REL.endnotes]] as const) {
    const rel = pkg.findRel(mainPath, relType);
    if (!rel) continue;
    const path = pkg.resolveTarget(mainPath, rel.target);
    const text = pkg.getText(path);
    if (!text) continue;
    try {
      const notesImp = new PartImporter(ctx, path);
      for (const n of childrenNamed(parseXml(text).root, `w:${kind}`)) {
        const type = attr(n, 'w:type');
        if (type && type !== 'normal') continue;
        const blocks = notesImp.blocks(n);
        if (blocks.length) doc.notes.set(`${kind}:${attr(n, 'w:id') ?? ''}`, schema.nodes.doc.create(null, blocks));
      }
    } catch (e) {
      doc.warnings.push(`Could not read ${path}: ${(e as Error).message}`);
    }
  }

  doc.comments = importComments(pkg, mainPath);
  doc.media = ctx.media;
  doc.warnings.push(...ctx.warnings);
  return doc;
}

