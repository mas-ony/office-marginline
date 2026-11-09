/** Plain data types shared by the importer, the editor and the exporter. Measures are twips unless noted. */

export interface FontSpec {
  ascii?: string;
  hAnsi?: string;
  eastAsia?: string;
  cs?: string;
  asciiTheme?: string;
  hAnsiTheme?: string;
  eastAsiaTheme?: string;
  cstheme?: string;
  hint?: string;
}

export interface ColorSpec {
  /** RRGGBB hex or "auto". */
  val: string;
  themeColor?: string;
  themeShade?: string;
  themeTint?: string;
}

export interface RunProps {
  styleId?: string;
  bold?: boolean;
  italic?: boolean;
  /** ST_Underline value, e.g. single, double, dotted, wave; "none" turns underline off. */
  underline?: string;
  underlineColor?: string;
  strike?: boolean;
  dstrike?: boolean;
  caps?: boolean;
  smallCaps?: boolean;
  vanish?: boolean;
  color?: ColorSpec;
  /** Named highlight colour (ST_HighlightColor) or "none". */
  highlight?: string;
  /** Background fill RRGGBB from w:shd. */
  shading?: string;
  fonts?: FontSpec;
  /** Font size in half-points. */
  size?: number;
  vertAlign?: 'superscript' | 'subscript' | 'baseline';
  /** Character spacing in twips. */
  spacing?: number;
  /** Raised/lowered position in half-points. */
  position?: number;
}

export interface Indent {
  left?: number;
  right?: number;
  firstLine?: number;
  hanging?: number;
}

export interface Spacing {
  before?: number;
  after?: number;
  /** For lineRule auto: 240ths of a line. Otherwise twips. */
  line?: number;
  lineRule?: 'auto' | 'exact' | 'atLeast';
  beforeAutospacing?: boolean;
  afterAutospacing?: boolean;
}

export interface TabStop {
  pos: number;
  val: string;
  leader?: string;
}

export interface BorderSpec {
  val: string;
  /** Width in eighths of a point. */
  sz?: number;
  /** Spacing in points. */
  space?: number;
  color?: string;
}

export interface BoxBorders {
  top?: BorderSpec;
  left?: BorderSpec;
  bottom?: BorderSpec;
  right?: BorderSpec;
  between?: BorderSpec;
  insideH?: BorderSpec;
  insideV?: BorderSpec;
}

export interface NumPr {
  numId: string;
  ilvl: number;
}

export interface ParaProps {
  styleId?: string;
  keepNext?: boolean;
  keepLines?: boolean;
  pageBreakBefore?: boolean;
  widowControl?: boolean;
  numPr?: NumPr;
  borders?: BoxBorders;
  shading?: string;
  tabs?: TabStop[];
  spacing?: Spacing;
  indent?: Indent;
  contextualSpacing?: boolean;
  align?: string;
  outlineLvl?: number;
  bidi?: boolean;
}

export interface TrackInfo {
  id: string;
  author: string;
  date: string;
}

export type SectionType = 'nextPage' | 'continuous' | 'evenPage' | 'oddPage' | 'nextColumn';

export interface ColumnsSpec {
  num: number;
  space: number;
  equalWidth: boolean;
  sep: boolean;
  cols: { w: number; space: number }[];
}

export type HeaderFooterType = 'default' | 'first' | 'even';

export interface SectionProps {
  type: SectionType | null;
  pageWidth: number;
  pageHeight: number;
  orient: 'portrait' | 'landscape' | null;
  margins: {
    top: number;
    right: number;
    bottom: number;
    left: number;
    header: number;
    footer: number;
    gutter: number;
  };
  cols: ColumnsSpec;
  /** Header/footer part paths by type, e.g. { default: 'word/header1.xml' }. */
  headers: Partial<Record<HeaderFooterType, string>>;
  footers: Partial<Record<HeaderFooterType, string>>;
  titlePg: boolean;
  pgNumStart: number | null;
  pgNumFmt: string | null;
  vAlign: string | null;
  /** Unknown sectPr children, serialized. */
  raw: string | null;
}

export const LETTER = { width: 12240, height: 15840 };
export const A4 = { width: 11906, height: 16838 };

export function defaultSection(size: { width: number; height: number } = LETTER): SectionProps {
  return {
    type: null,
    pageWidth: size.width,
    pageHeight: size.height,
    orient: null,
    margins: { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 720, footer: 720, gutter: 0 },
    cols: { num: 1, space: 720, equalWidth: true, sep: false, cols: [] },
    headers: {},
    footers: {},
    titlePg: false,
    pgNumStart: null,
    pgNumFmt: null,
    vAlign: null,
    raw: null,
  };
}

export interface CommentReply {
  id: string;
  author: string;
  initials?: string;
  date?: string;
  text: string;
  done?: boolean;
}

export interface CommentThread {
  id: string;
  author: string;
  initials?: string;
  date?: string;
  text: string;
  done?: boolean;
  replies: CommentReply[];
}

export interface MediaItem {
  path: string;
  contentType: string;
  bytes: Uint8Array;
  /** Object URL for display (created lazily in browsers). */
  url?: string;
}

/** Named Word highlight colours (ST_HighlightColor) and their RGB values. */
export const HIGHLIGHT_COLORS: Record<string, string> = {
  yellow: 'FFFF00',
  green: '00FF00',
  cyan: '00FFFF',
  magenta: 'FF00FF',
  blue: '0000FF',
  red: 'FF0000',
  darkBlue: '000080',
  darkCyan: '008080',
  darkGreen: '008000',
  darkMagenta: '800080',
  darkRed: '800000',
  darkYellow: '808000',
  darkGray: '808080',
  lightGray: 'C0C0C0',
  black: '000000',
  white: 'FFFFFF',
};
