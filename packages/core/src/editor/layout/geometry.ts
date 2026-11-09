import type { Node as PMNode } from 'prosemirror-model';
import type { HeaderFooterType, SectionProps } from '../../core/model/types';
import { twipsToPx } from '../../core/ooxml/units';
import type { NoteRef } from '../noteRefs';

export const PAGE_GAP = 20;
export const CANVAS_PAD_Y = 24;
export const CANVAS_PAD_X = 24;

export interface SectionGeom {
  index: number;
  props: SectionProps;
  pageW: number;
  pageH: number;
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  headerDist: number;
  footerDist: number;
  contentW: number;
  /** Content-box left relative to the page. */
  contentX: number;
  /** Index of the first top-level block of the section and the index after its last. */
  startBlock: number;
  endBlock: number;
}

export interface PageInfo {
  index: number;
  /** Displayed page number (honours section restarts). */
  number: number;
  numberText: string;
  section: number;
  firstInSection: boolean;
  /** Page rectangle in canvas coordinates (unscaled CSS px). */
  top: number;
  left: number;
  width: number;
  height: number;
  bodyTop: number;
  bodyBottom: number;
  header: string | null;
  footer: string | null;
  headerType: HeaderFooterType;
  /** Document position of the first content on the page. */
  startPos: number;
  blank: boolean;
  /** Footnotes shown at the bottom of the page, in reference order. */
  notes: NoteRef[];
  /** Height taken by the footnotes above the bottom margin (separator included). */
  notesH: number;
  /** Endnotes placed after the end of the text on this page and where they start (page px). */
  endnotes: NoteRef[];
  endnotesTop: number;
}

/** Split the body into sections (each ends at a section_break or the end of the document). */
export function computeSections(doc: PMNode): SectionGeom[] {
  const out: SectionGeom[] = [];
  let start = 0;
  let index = 0;
  const push = (props: SectionProps, end: number) => {
    const m = props.margins;
    const pageW = twipsToPx(props.pageWidth);
    const pageH = twipsToPx(props.pageHeight);
    const marginLeft = twipsToPx(m.left + (m.gutter || 0));
    const marginRight = twipsToPx(m.right);
    out.push({
      index: out.length,
      props,
      pageW,
      pageH,
      marginTop: twipsToPx(Math.abs(m.top)),
      marginBottom: twipsToPx(Math.abs(m.bottom)),
      marginLeft,
      marginRight,
      headerDist: twipsToPx(m.header),
      footerDist: twipsToPx(m.footer),
      contentW: Math.max(48, pageW - marginLeft - marginRight),
      contentX: marginLeft,
      startBlock: start,
      endBlock: end,
    });
  };
  doc.forEach((node) => {
    if (node.type.name === 'section_break') {
      push(node.attrs.section as SectionProps, index + 1);
      start = index + 1;
    }
    index++;
  });
  push(doc.attrs.finalSection as SectionProps, index);
  return out;
}

/** Column offsets and widths (px, relative to the section's content box). */
export function columnLayout(sg: SectionGeom): { x: number[]; w: number[] } {
  const c = sg.props.cols;
  if (!c || c.num <= 1) return { x: [0], w: [sg.contentW] };
  if (!c.equalWidth && c.cols.length > 1) {
    const raw = c.cols.map((col) => ({ w: twipsToPx(col.w), space: twipsToPx(col.space || 0) }));
    const total = raw.reduce((s, col, i) => s + col.w + (i < raw.length - 1 ? col.space : 0), 0);
    const k = total > sg.contentW ? sg.contentW / total : 1;
    const x: number[] = [];
    const w: number[] = [];
    let at = 0;
    raw.forEach((col, i) => {
      x.push(at);
      w.push(col.w * k);
      at += (col.w + (i < raw.length - 1 ? col.space : 0)) * k;
    });
    return { x, w };
  }
  const space = twipsToPx(c.space ?? 720);
  const width = Math.max(24, (sg.contentW - space * (c.num - 1)) / c.num);
  return { x: Array.from({ length: c.num }, (_, i) => i * (width + space)), w: Array.from({ length: c.num }, () => width) };
}

/** Find the header/footer part for a page, following OOXML inheritance from earlier sections. */
export function resolveHeaderFooter(sections: SectionGeom[], sectionIndex: number, kind: 'header' | 'footer', type: HeaderFooterType): string | null {
  for (let s = sectionIndex; s >= 0; s--) {
    const refs = kind === 'header' ? sections[s].props.headers : sections[s].props.footers;
    if (refs[type]) return refs[type]!;
  }
  return null;
}

export function headerTypeFor(section: SectionGeom, firstInSection: boolean, pageNumber: number, evenAndOdd: boolean): HeaderFooterType {
  if (section.props.titlePg && firstInSection) return 'first';
  if (evenAndOdd && pageNumber % 2 === 0) return 'even';
  return 'default';
}

function toRoman(n: number): string {
  const map: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
  return out;
}

export function formatPageNumber(n: number, fmt: string | null): string {
  switch (fmt) {
    case 'upperRoman': return toRoman(n);
    case 'lowerRoman': return toRoman(n).toLowerCase();
    case 'upperLetter': return String.fromCharCode(64 + (((n - 1) % 26) + 1)).repeat(Math.floor((n - 1) / 26) + 1);
    case 'lowerLetter': return String.fromCharCode(96 + (((n - 1) % 26) + 1)).repeat(Math.floor((n - 1) / 26) + 1);
    case 'numberInDash': return `- ${n} -`;
    default: return String(n);
  }
}
