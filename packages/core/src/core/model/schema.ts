import { type DOMOutputSpec, type Mark, type MarkSpec, type Node as PMNode, type NodeSpec, Schema } from 'prosemirror-model';
import { twipsToPt, emuToPx } from '../ooxml/units';
import {
  alignCss,
  bordersCss,
  cssColorToHex,
  cssIdent,
  cssLengthToPt,
  fontStack,
  hexColor,
  highlightCss,
  indentCss,
  shadingCss,
  spacingCss,
  underlineCss,
} from './css';
import { defaultSection, HIGHLIGHT_COLORS } from './types';
import { renderDrawing, type DrawingModel } from './drawing';

/** JSON attribute used to carry exact attributes through the clipboard. */
export const ATTRS_DATA = 'data-dx-attrs';

function readAttrs(dom: HTMLElement | string): Record<string, unknown> | false {
  if (typeof dom === 'string') return false;
  const json = dom.getAttribute(ATTRS_DATA);
  if (!json) return false;
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return false;
  }
}

const join = (css: (string | undefined | false | null)[]) => css.filter(Boolean).join('; ');

// ---------------------------------------------------------------------------------------------
// Nodes

export const paragraphAttrs = {
  styleId: { default: null },
  align: { default: null },
  indent: { default: null },
  spacing: { default: null },
  numPr: { default: null },
  keepNext: { default: null },
  keepLines: { default: null },
  pageBreakBefore: { default: null },
  widowControl: { default: null },
  contextualSpacing: { default: null },
  tabs: { default: null },
  borders: { default: null },
  shading: { default: null },
  outlineLvl: { default: null },
  bidi: { default: null },
  /** Run properties of the paragraph mark (RunProps). */
  markProps: { default: null },
  /** Unmodelled paragraph-mark rPr children (XML). */
  markRaw: { default: null },
  /** Tracked insertion/deletion of the paragraph mark (TrackInfo). */
  trackIns: { default: null },
  trackDel: { default: null },
  /** Raw w:pPrChange (tracked paragraph formatting change). */
  pPrChange: { default: null },
  /** Unmodelled pPr children (XML). */
  raw: { default: null },
  /** Paste helper: list kind detected in pasted HTML (bullet/ordered + level). */
  pastedList: { default: null },
};

function paragraphDOM(node: PMNode): DOMOutputSpec {
  const a = node.attrs;
  const cls = ['ml-dx-p', a.styleId ? `ps-${cssIdent(a.styleId)}` : 'ps-default'];
  if (a.trackIns) cls.push('ml-dx-mark-ins');
  if (a.trackDel) cls.push('ml-dx-mark-del');
  const css: string[] = [
    ...indentCss(a.indent),
    ...spacingCss(a.spacing),
    ...bordersCss(a.borders),
  ];
  const align = alignCss(a.align);
  if (align) css.push(`text-align: ${align}`);
  if (a.align === 'distribute') css.push('text-align-last: justify');
  css.push(...shadingCss(a.shading));
  if (a.bidi) css.push('direction: rtl');
  if (node.content.size === 0 && a.markProps?.size) css.push(`font-size: ${a.markProps.size / 2}pt`);
  const attrs: Record<string, string> = { class: cls.join(' ') };
  if (css.length) attrs.style = join(css);
  if (a.styleId) attrs['data-style'] = a.styleId;
  if (a.outlineLvl !== null && a.outlineLvl !== undefined && a.outlineLvl < 9) attrs['data-outline'] = String(a.outlineLvl);
  return ['p', attrs, 0];
}

function headingLevelFromTag(tag: string): number {
  return parseInt(tag.slice(1), 10);
}

function pastedParagraphAttrs(dom: HTMLElement): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  const style = dom.style;
  const ta = style?.textAlign;
  if (ta === 'center' || ta === 'right') attrs.align = ta;
  else if (ta === 'justify') attrs.align = 'both';
  const ml = cssLengthToPt(style?.marginLeft || style?.paddingLeft);
  const ti = cssLengthToPt(style?.textIndent);
  if ((ml && ml > 0) || ti) {
    attrs.indent = {
      ...(ml && ml > 0 ? { left: Math.round(ml * 20) } : {}),
      ...(ti && ti > 0 ? { firstLine: Math.round(ti * 20) } : {}),
      ...(ti && ti < 0 ? { hanging: Math.round(-ti * 20) } : {}),
    };
  }
  // Word HTML lists: <p style="mso-list:l0 level2 lfo1">
  const msoList = dom.getAttribute('style')?.match(/mso-list:\s*l(\d+)\s+level(\d+)/i);
  if (msoList) {
    const ordered = !/[•·o§]/.test(dom.querySelector('span[style*="mso-list:Ignore"], span[style*="mso-list: Ignore"]')?.textContent ?? '•');
    attrs.pastedList = { kind: ordered ? 'ordered' : 'bullet', level: parseInt(msoList[2], 10) - 1, group: msoList[1] };
  }
  return attrs;
}

const nodes: Record<string, NodeSpec> = {
  doc: {
    content: 'block+',
    attrs: {
      /** SectionProps of the last section (body-level w:sectPr). */
      finalSection: { default: defaultSection() },
      evenAndOddHeaders: { default: false },
      defaultTabStop: { default: 720 },
    },
  },

  paragraph: {
    group: 'block',
    content: 'inline*',
    attrs: paragraphAttrs,
    toDOM: paragraphDOM,
    parseDOM: [
      { tag: 'p[data-dx-attrs]', getAttrs: readAttrs },
      { tag: 'p', getAttrs: (dom) => pastedParagraphAttrs(dom as HTMLElement) },
      ...[1, 2, 3, 4, 5, 6].map((level) => ({
        tag: `h${level}`,
        getAttrs: (dom: HTMLElement | string) => ({
          ...pastedParagraphAttrs(dom as HTMLElement),
          styleId: `Heading${headingLevelFromTag(`h${level}`)}`,
        }),
      })),
      { tag: 'blockquote', getAttrs: () => ({ styleId: 'Quote' }) },
      {
        tag: 'li',
        getAttrs: (dom) => {
          const li = dom as HTMLElement;
          let level = 0;
          let parent = li.parentElement;
          let kind: 'bullet' | 'ordered' = parent?.tagName === 'OL' ? 'ordered' : 'bullet';
          let first = true;
          while (parent) {
            if (parent.tagName === 'UL' || parent.tagName === 'OL') {
              if (first) {
                kind = parent.tagName === 'OL' ? 'ordered' : 'bullet';
                first = false;
              } else level++;
            }
            parent = parent.parentElement;
          }
          return { pastedList: { kind, level: Math.min(level, 8) } };
        },
      },
      { tag: 'div.ml-dx-p', getAttrs: readAttrs },
      { tag: 'pre', preserveWhitespace: 'full', getAttrs: () => ({ markProps: null }) },
    ],
  },

  section_break: {
    group: 'block',
    atom: true,
    selectable: true,
    attrs: { section: { default: defaultSection() } },
    toDOM: (node) => ['div', { class: 'ml-dx-section-break', contenteditable: 'false', [ATTRS_DATA]: JSON.stringify(node.attrs) }],
    parseDOM: [{ tag: 'div.ml-dx-section-break', getAttrs: readAttrs }],
  },

  table: {
    group: 'block',
    content: 'table_row+',
    tableRole: 'table',
    isolating: true,
    attrs: {
      styleId: { default: null },
      width: { default: null },
      align: { default: null },
      indent: { default: null },
      layout: { default: null },
      borders: { default: null },
      cellMargins: { default: null },
      look: { default: null },
      grid: { default: null },
      shading: { default: null },
      raw: { default: null },
    },
    toDOM: (node) => ['table', { class: `ml-dx-table${node.attrs.styleId ? ` ts-${cssIdent(node.attrs.styleId)}` : ''}` }, ['tbody', 0]],
    parseDOM: [
      { tag: 'table[data-dx-attrs]', getAttrs: readAttrs },
      { tag: 'table' },
    ],
  },

  table_row: {
    content: 'table_cell+',
    tableRole: 'row',
    attrs: {
      height: { default: null },
      heightRule: { default: null },
      header: { default: false },
      cantSplit: { default: false },
      raw: { default: null },
    },
    toDOM: (node) => {
      const css: string[] = [];
      if (node.attrs.height) css.push(`height: ${twipsToPt(node.attrs.height)}pt`);
      return ['tr', css.length ? { style: join(css) } : {}, 0];
    },
    parseDOM: [{ tag: 'tr[data-dx-attrs]', getAttrs: readAttrs }, { tag: 'tr' }],
  },

  table_cell: {
    content: 'block+',
    tableRole: 'cell',
    isolating: true,
    attrs: {
      colspan: { default: 1 },
      rowspan: { default: 1 },
      /** Column widths in px for prosemirror-tables (one per spanned column). */
      colwidth: { default: null },
      width: { default: null },
      shading: { default: null },
      borders: { default: null },
      vAlign: { default: null },
      margins: { default: null },
      noWrap: { default: null },
      /** Placeholder cells stand for w:gridBefore / w:gridAfter. */
      placeholder: { default: null },
      raw: { default: null },
    },
    toDOM: (node) => {
      const a = node.attrs;
      const attrs: Record<string, string> = { class: 'ml-dx-cell' };
      if (a.colspan !== 1) attrs.colspan = String(a.colspan);
      if (a.rowspan !== 1) attrs.rowspan = String(a.rowspan);
      if (a.placeholder) attrs.class += ' ml-dx-cell-placeholder';
      const css: string[] = [];
      if (a.shading) css.push(`background-color: #${a.shading}`);
      if (a.vAlign) css.push(`vertical-align: ${a.vAlign === 'center' ? 'middle' : a.vAlign}`);
      if (a.noWrap) css.push('white-space: nowrap');
      if (css.length) attrs.style = join(css);
      return ['td', attrs, 0];
    },
    parseDOM: [
      { tag: 'td[data-dx-attrs]', getAttrs: readAttrs },
      { tag: 'th[data-dx-attrs]', getAttrs: readAttrs },
      {
        tag: 'td, th',
        getAttrs: (dom) => {
          const e = dom as HTMLElement;
          const colspan = Number(e.getAttribute('colspan') || 1);
          const bg = cssColorToHex(e.style?.backgroundColor);
          return { colspan, rowspan: Number(e.getAttribute('rowspan') || 1), shading: bg ?? null };
        },
      },
    ],
  },

  text: { group: 'inline' },

  tab: {
    group: 'inline',
    inline: true,
    atom: true,
    selectable: false,
    toDOM: () => ['span', { class: 'ml-dx-tab' }, '\t'],
    parseDOM: [{ tag: 'span.ml-dx-tab' }, { tag: 'span[style*="mso-tab-count"]' }],
    leafText: () => '\t',
  },

  hard_break: {
    group: 'inline',
    inline: true,
    selectable: false,
    attrs: { clear: { default: null } },
    toDOM: () => ['br', { class: 'ml-dx-br' }],
    parseDOM: [{ tag: 'br' }],
    leafText: () => '\n',
  },

  page_break: {
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,
    toDOM: () => ['span', { class: 'ml-dx-page-break', contenteditable: 'false' }],
    parseDOM: [{ tag: 'span.ml-dx-page-break' }],
    leafText: () => '\n',
  },

  column_break: {
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,
    toDOM: () => ['span', { class: 'ml-dx-column-break', contenteditable: 'false' }],
    parseDOM: [{ tag: 'span.ml-dx-column-break' }],
    leafText: () => '\n',
  },

  image: {
    group: 'inline',
    inline: true,
    atom: true,
    draggable: true,
    attrs: {
      src: { default: '' },
      /** Package path of the media part, e.g. word/media/image1.png. */
      mediaPath: { default: null },
      /** Size in EMU. */
      width: { default: 914400 },
      height: { default: 914400 },
      alt: { default: '' },
      title: { default: '' },
      name: { default: '' },
      /** Floating placement (AnchorInfo) or null for inline images. */
      anchor: { default: null },
      /** Original w:drawing / w:pict XML, re-used on export. */
      raw: { default: null },
      /** Package part the raw XML came from (its r:id references resolve there). */
      part: { default: null },
    },
    toDOM: (node) => {
      const a = node.attrs;
      return ['img', {
        src: a.src,
        alt: a.alt,
        title: a.title || null,
        width: String(Math.round(emuToPx(a.width))),
        height: String(Math.round(emuToPx(a.height))),
        class: 'ml-dx-image',
      } as Record<string, string>];
    },
    parseDOM: [
      { tag: 'img[data-dx-attrs]', getAttrs: readAttrs },
      {
        tag: 'img[src]',
        getAttrs: (dom) => {
          const img = dom as HTMLImageElement;
          const w = Number(img.getAttribute('width')) || img.width || 200;
          const h = Number(img.getAttribute('height')) || img.height || 150;
          return { src: img.getAttribute('src'), alt: img.getAttribute('alt') ?? '', width: Math.round(w * 9525), height: Math.round(h * 9525) };
        },
      },
    ],
  },

  /** A field rendered from page geometry: PAGE, NUMPAGES or SECTIONPAGES. */
  page_field: {
    group: 'inline',
    inline: true,
    atom: true,
    attrs: { kind: { default: 'PAGE' }, instr: { default: ' PAGE ' }, format: { default: null } },
    toDOM: (node) => ['span', { class: 'ml-dx-page-field', 'data-kind': node.attrs.kind, contenteditable: 'false' }, '#'],
    parseDOM: [{ tag: 'span.ml-dx-page-field', getAttrs: readAttrs }],
    leafText: () => '#',
  },

  /** Complex field delimiters (w:fldChar) kept for round-tripping. */
  field_char: {
    group: 'inline',
    inline: true,
    atom: true,
    selectable: false,
    attrs: { type: { default: 'begin' }, raw: { default: null } },
    toDOM: (node) => ['span', { class: `ml-dx-fld ml-dx-fld-${node.attrs.type}`, contenteditable: 'false' }],
    parseDOM: [{ tag: 'span.ml-dx-fld', getAttrs: readAttrs }],
    leafText: () => '',
  },

  instr_text: {
    group: 'inline',
    inline: true,
    atom: true,
    selectable: false,
    attrs: { text: { default: '' } },
    toDOM: (node) => ['span', { class: 'ml-dx-instr', contenteditable: 'false', 'data-instr': node.attrs.text }],
    parseDOM: [{ tag: 'span.ml-dx-instr', getAttrs: readAttrs }],
    leafText: () => '',
  },

  bookmark_start: {
    group: 'inline',
    inline: true,
    atom: true,
    selectable: false,
    attrs: { id: { default: '0' }, name: { default: '' }, raw: { default: null } },
    toDOM: (node) => ['span', { class: 'ml-dx-bookmark', id: node.attrs.name ? `bm-${node.attrs.name}` : null, contenteditable: 'false' } as Record<string, string>],
    parseDOM: [{ tag: 'span.ml-dx-bookmark', getAttrs: readAttrs }],
    leafText: () => '',
  },

  bookmark_end: {
    group: 'inline',
    inline: true,
    atom: true,
    selectable: false,
    attrs: { id: { default: '0' } },
    toDOM: () => ['span', { class: 'ml-dx-bookmark-end', contenteditable: 'false' }],
    parseDOM: [{ tag: 'span.ml-dx-bookmark-end', getAttrs: readAttrs }],
    leafText: () => '',
  },

  footnote_ref: {
    group: 'inline',
    inline: true,
    atom: true,
    attrs: { id: { default: '0' }, kind: { default: 'footnote' }, raw: { default: null } },
    // The number is drawn from data-num (set by the decor plugin); size and raise come from the
    // run formatting (usually the superscript "Footnote Reference" style), as in Word.
    toDOM: (node) => ['span', { class: 'ml-dx-footnote-ref', 'data-id': node.attrs.id, 'data-kind': node.attrs.kind, contenteditable: 'false' }],
    parseDOM: [{ tag: 'span.ml-dx-footnote-ref', getAttrs: readAttrs }, { tag: 'sup.ml-dx-footnote-ref', getAttrs: readAttrs }],
    leafText: () => '',
  },

  /** Inline content the editor cannot edit (math, charts, shapes...) preserved verbatim. */
  /**
   * Inline content the editor cannot edit (math, charts, shapes...) preserved verbatim. Shapes,
   * groups and canvases it can draw carry a DrawingModel in `drawing`.
   */
  opaque_inline: {
    group: 'inline',
    inline: true,
    atom: true,
    attrs: { xml: { default: '' }, label: { default: 'Object' }, width: { default: null }, height: { default: null }, text: { default: '' }, src: { default: null }, part: { default: null }, drawing: { default: null } },
    toDOM: (node) => {
      const a = node.attrs;
      if (a.drawing) {
        try {
          return renderDrawing(a.drawing as DrawingModel, schema);
        } catch {
          // Drawn as the placeholder below.
        }
      }
      const css: string[] = [];
      if (a.width) css.push(`width: ${Math.round(emuToPx(a.width))}px`);
      if (a.height) css.push(`height: ${Math.round(emuToPx(a.height))}px`);
      if (a.src) return ['img', { class: 'ml-dx-opaque ml-dx-opaque-img', src: a.src, style: join(css), title: a.label } as Record<string, string>];
      return ['span', { class: `ml-dx-opaque${a.width ? ' ml-dx-opaque-box' : ''}`, contenteditable: 'false', title: a.label, style: join(css) }, a.text || a.label];
    },
    parseDOM: [{ tag: '.ml-dx-opaque', getAttrs: readAttrs }, { tag: '.ml-dx-drawing', getAttrs: readAttrs }],
    leafText: (node) => node.attrs.text || '',
  },

  opaque_block: {
    group: 'block',
    atom: true,
    attrs: { xml: { default: '' }, label: { default: 'Unsupported content' }, part: { default: null } },
    toDOM: (node) => ['div', { class: 'ml-dx-opaque-block', contenteditable: 'false' }, node.attrs.label],
    parseDOM: [{ tag: 'div.ml-dx-opaque-block', getAttrs: readAttrs }],
  },
};

// ---------------------------------------------------------------------------------------------
// Marks

const valueAttr = { value: { default: true } };

/** A mark for an OOXML toggle property: renders `tagTrue` when on, an overriding span when explicitly off. */
function boolMark(tagTrue: string, cssFalse: string, extraParse: MarkSpec['parseDOM'] = []): MarkSpec {
  return {
    attrs: valueAttr,
    toDOM: (mark) => (mark.attrs.value ? [tagTrue, 0] : ['span', { style: cssFalse }, 0]),
    parseDOM: [{ tag: tagTrue }, ...(extraParse ?? [])],
  };
}

const marks: Record<string, MarkSpec> = {
  link: {
    attrs: { href: { default: '' }, anchor: { default: null }, tooltip: { default: null }, fromField: { default: false } },
    inclusive: false,
    toDOM: (mark) => ['a', {
      href: mark.attrs.href || (mark.attrs.anchor ? `#bm-${mark.attrs.anchor}` : '#'),
      title: mark.attrs.tooltip || mark.attrs.href || '',
      class: 'ml-dx-link',
      rel: 'noopener noreferrer',
    }, 0],
    parseDOM: [
      { tag: 'a[data-dx-attrs]', getAttrs: readAttrs },
      { tag: 'a[href]', getAttrs: (dom) => ({ href: (dom as HTMLElement).getAttribute('href'), tooltip: (dom as HTMLElement).getAttribute('title') }) },
    ],
  },

  /** A plain-text content control (w:sdt) shown as a fillable field. */
  field: {
    attrs: { id: { default: '' }, tag: { default: '' }, alias: { default: '' }, kind: { default: 'text' }, placeholder: { default: false }, raw: { default: null } },
    inclusive: false,
    toDOM: (mark) => ['span', {
      class: mark.attrs.placeholder ? 'ml-dx-field ml-dx-field-placeholder' : 'ml-dx-field',
      'data-field-id': mark.attrs.id,
      'data-field-tag': mark.attrs.tag,
      title: mark.attrs.alias || mark.attrs.tag,
    }, 0],
    parseDOM: [{ tag: 'span.ml-dx-field', getAttrs: (dom) => ({ id: (dom as HTMLElement).getAttribute('data-field-id'), tag: (dom as HTMLElement).getAttribute('data-field-tag') ?? '' }) }],
  },

  comment: {
    attrs: { id: { default: '' } },
    excludes: '',
    inclusive: false,
    toDOM: (mark) => ['span', { class: 'ml-dx-comment', 'data-comment-id': mark.attrs.id }, 0],
    parseDOM: [{ tag: 'span.ml-dx-comment', getAttrs: (dom) => ({ id: (dom as HTMLElement).getAttribute('data-comment-id') }) }],
  },

  insertion: {
    attrs: { id: { default: '' }, author: { default: '' }, date: { default: '' } },
    excludes: '',
    inclusive: true,
    toDOM: (mark) => ['ins', { class: 'ml-dx-ins', 'data-author': mark.attrs.author, 'data-change-id': mark.attrs.id, title: `Inserted by ${mark.attrs.author}` }, 0],
    parseDOM: [{ tag: 'ins.ml-dx-ins', getAttrs: readAttrs }],
  },

  deletion: {
    attrs: { id: { default: '' }, author: { default: '' }, date: { default: '' } },
    excludes: '',
    inclusive: false,
    toDOM: (mark) => ['del', { class: 'ml-dx-del', 'data-author': mark.attrs.author, 'data-change-id': mark.attrs.id, title: `Deleted by ${mark.attrs.author}` }, 0],
    parseDOM: [{ tag: 'del.ml-dx-del', getAttrs: readAttrs }],
  },

  formatChange: {
    attrs: { id: { default: '' }, author: { default: '' }, date: { default: '' }, oldProps: { default: null }, raw: { default: null } },
    excludes: '',
    inclusive: false,
    toDOM: (mark) => ['span', { class: 'ml-dx-fmt-change', 'data-change-id': mark.attrs.id, title: `Formatted by ${mark.attrs.author}` }, 0],
    parseDOM: [{ tag: 'span.ml-dx-fmt-change', getAttrs: readAttrs }],
  },

  charStyle: {
    attrs: { styleId: { default: '' } },
    toDOM: (mark) => ['span', { class: `cs-${cssIdent(mark.attrs.styleId)}`, 'data-cstyle': mark.attrs.styleId }, 0],
    parseDOM: [{ tag: 'span[data-cstyle]', getAttrs: (dom) => ({ styleId: (dom as HTMLElement).getAttribute('data-cstyle') }) }],
  },

  font: {
    attrs: {
      ascii: { default: null }, hAnsi: { default: null }, eastAsia: { default: null }, cs: { default: null },
      asciiTheme: { default: null }, hAnsiTheme: { default: null }, eastAsiaTheme: { default: null }, cstheme: { default: null },
      hint: { default: null },
    },
    toDOM: (mark) => {
      const name = mark.attrs.ascii ?? mark.attrs.hAnsi ?? mark.attrs.eastAsia;
      return ['span', name ? { style: `font-family: ${fontStack(name)}`, 'data-font': name } : { 'data-theme-font': mark.attrs.asciiTheme ?? mark.attrs.hAnsiTheme ?? '' }, 0];
    },
    parseDOM: [
      { tag: 'span[data-font]', getAttrs: (dom) => ({ ascii: (dom as HTMLElement).getAttribute('data-font'), hAnsi: (dom as HTMLElement).getAttribute('data-font') }) },
      {
        style: 'font-family',
        getAttrs: (value) => {
          const first = (value as string).split(',')[0]?.trim().replace(/^["']|["']$/g, '');
          if (!first || /^(inherit|initial|-apple-system|system-ui|sans-serif|serif|monospace)$/i.test(first)) return false;
          return { ascii: first, hAnsi: first };
        },
      },
    ],
  },

  fontSize: {
    attrs: { size: { default: 22 } },
    toDOM: (mark) => ['span', { style: `font-size: ${mark.attrs.size / 2}pt` }, 0],
    parseDOM: [
      {
        style: 'font-size',
        getAttrs: (value) => {
          const pt = cssLengthToPt(value as string);
          return pt && pt > 1 && pt < 1000 ? { size: Math.round(pt * 2) } : false;
        },
      },
    ],
  },

  color: {
    attrs: { color: { default: '000000' }, themeColor: { default: null }, themeShade: { default: null }, themeTint: { default: null } },
    toDOM: (mark) => ['span', { style: `color: ${hexColor(mark.attrs.color) ?? 'inherit'}` }, 0],
    parseDOM: [{ style: 'color', getAttrs: (value) => { const c = cssColorToHex(value as string); return c ? { color: c } : false; } }],
  },

  highlight: {
    attrs: { color: { default: 'yellow' } },
    toDOM: (mark) => ['span', { class: 'ml-dx-hl', style: `background-color: ${highlightCss(mark.attrs.color) ?? 'transparent'}` }, 0],
    parseDOM: [
      { tag: 'mark', getAttrs: () => ({ color: 'yellow' }) },
      {
        style: 'background-color',
        getAttrs: (value) => {
          const c = cssColorToHex(value as string);
          if (!c) return false;
          const named = Object.entries(HIGHLIGHT_COLORS).find(([, hex]) => hex === c);
          return named ? { color: named[0] } : false;
        },
      },
    ],
  },

  shading: {
    attrs: { fill: { default: 'FFFF00' } },
    toDOM: (mark) => ['span', { style: `background-color: #${mark.attrs.fill}` }, 0],
    parseDOM: [
      {
        style: 'background-color',
        getAttrs: (value) => {
          const c = cssColorToHex(value as string);
          if (!c || c === 'FFFFFF') return false;
          if (Object.values(HIGHLIGHT_COLORS).includes(c)) return false;
          return { fill: c };
        },
      },
    ],
  },

  bold: boolMark('strong', 'font-weight: normal', [
    { tag: 'b', getAttrs: (dom) => ((dom as HTMLElement).style.fontWeight === 'normal' ? false : null) },
    { style: 'font-weight', getAttrs: (value) => (/^(bold|bolder|[6-9]00)$/.test(value as string) ? null : false) },
  ]),

  italic: boolMark('em', 'font-style: normal', [
    { tag: 'i' },
    { style: 'font-style=italic' },
  ]),

  underline: {
    attrs: { type: { default: 'single' }, color: { default: null } },
    toDOM: (mark) => {
      const deco = underlineCss(mark.attrs.type);
      if (!deco) return ['span', { style: 'text-decoration: none' }, 0];
      const css = [`text-decoration: ${deco}`];
      if (mark.attrs.color) css.push(`text-decoration-color: ${hexColor(mark.attrs.color) ?? 'currentColor'}`);
      return ['u', { style: join(css), 'data-u': mark.attrs.type }, 0];
    },
    parseDOM: [
      { tag: 'u[data-u]', getAttrs: (dom) => ({ type: (dom as HTMLElement).getAttribute('data-u') }) },
      { tag: 'u' },
      { style: 'text-decoration', getAttrs: (value) => ((value as string).includes('underline') ? {} : false) },
      { style: 'text-decoration-line', getAttrs: (value) => ((value as string).includes('underline') ? {} : false) },
    ],
  },

  strike: boolMark('s', 'text-decoration: none', [
    { tag: 'strike' },
    { tag: 'del:not(.ml-dx-del)' },
    { style: 'text-decoration', getAttrs: (value) => ((value as string).includes('line-through') ? null : false) },
  ]),

  dstrike: {
    attrs: valueAttr,
    toDOM: (mark) => ['span', { style: mark.attrs.value ? 'text-decoration: line-through double' : 'text-decoration: none', 'data-dstrike': '1' }, 0],
    parseDOM: [{ tag: 'span[data-dstrike]' }],
  },

  caps: {
    attrs: valueAttr,
    toDOM: (mark) => ['span', { style: `text-transform: ${mark.attrs.value ? 'uppercase' : 'none'}` }, 0],
    parseDOM: [{ style: 'text-transform=uppercase' }],
  },

  smallCaps: {
    attrs: valueAttr,
    toDOM: (mark) => ['span', { style: `font-variant: ${mark.attrs.value ? 'small-caps' : 'normal'}` }, 0],
    parseDOM: [{ style: 'font-variant=small-caps' }],
  },

  hidden: {
    attrs: valueAttr,
    toDOM: (mark) => ['span', { class: mark.attrs.value ? 'ml-dx-hidden' : '' }, 0],
    parseDOM: [{ tag: 'span.ml-dx-hidden' }],
  },

  vertAlign: {
    attrs: { value: { default: 'superscript' } },
    excludes: 'vertAlign',
    toDOM: (mark) => (mark.attrs.value === 'subscript' ? ['sub', 0] : mark.attrs.value === 'superscript' ? ['sup', 0] : ['span', 0]),
    parseDOM: [
      { tag: 'sup:not(.ml-dx-footnote-ref)', getAttrs: () => ({ value: 'superscript' }) },
      { tag: 'sub', getAttrs: () => ({ value: 'subscript' }) },
    ],
  },

  charSpacing: {
    attrs: { value: { default: 0 } },
    toDOM: (mark) => ['span', { style: `letter-spacing: ${twipsToPt(mark.attrs.value)}pt` }, 0],
    parseDOM: [],
  },

  position: {
    attrs: { value: { default: 0 } },
    toDOM: (mark) => ['span', { style: `position: relative; top: ${-mark.attrs.value / 2}pt` }, 0],
    parseDOM: [],
  },

  /** Unmodelled w:rPr children (serialized XML), kept so runs round-trip exactly. */
  runExtra: {
    attrs: { xml: { default: '' } },
    toDOM: () => ['span', { class: 'ml-dx-rx' }, 0],
    parseDOM: [],
  },
};

export const schema = new Schema({ nodes, marks });

export type DocxSchema = typeof schema;

/** Names of marks that encode run formatting (as opposed to links, comments and revisions). */
export const FORMAT_MARKS = [
  'charStyle', 'font', 'fontSize', 'color', 'highlight', 'shading', 'bold', 'italic', 'underline',
  'strike', 'dstrike', 'caps', 'smallCaps', 'hidden', 'vertAlign', 'charSpacing', 'position', 'runExtra',
] as const;

export const REVISION_MARKS = ['insertion', 'deletion', 'formatChange'] as const;

export function isFormatMark(mark: Mark): boolean {
  return (FORMAT_MARKS as readonly string[]).includes(mark.type.name);
}
