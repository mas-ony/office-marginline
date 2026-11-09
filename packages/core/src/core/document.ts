import type { Node as PMNode } from 'prosemirror-model';
import { OoxmlPackage } from './ooxml/package';
import { NumberingModel } from './model/numbering';
import { StyleSheet, type ThemeInfo } from './model/styles';
import type { CommentThread, MediaItem } from './model/types';
import type { XmlDocument } from './xml/xml';

export interface HeaderFooterPart {
  path: string;
  kind: 'header' | 'footer';
  doc: PMNode;
  /** Attributes of the original root element (namespace declarations excluded). */
  rootAttrs: Record<string, string>;
  extraNamespaces: Record<string, string>;
}

export interface DocumentSettings {
  trackRevisions: boolean;
  xml: XmlDocument | null;
  path: string | null;
}

export type UrlFactory = (item: MediaItem) => string;

/**
 * Everything that makes up an open DOCX besides the body content: the original package (for
 * parts that pass through unchanged), styles, numbering, comments, media and header/footer
 * contents. The body itself lives in the editor state and is passed to the exporter.
 */
export class DocxDocument {
  pkg: OoxmlPackage;
  mainPath: string;
  fileName: string;
  /** Initial body as imported. */
  body: PMNode;
  headerFooters = new Map<string, HeaderFooterPart>();
  /** Footnote and endnote contents keyed "footnote:<id>" / "endnote:<id>". */
  notes = new Map<string, PMNode>();
  /** Notes added or edited in the editor; their parts are rewritten on export. */
  editedNotes = new Set<string>();
  styles: StyleSheet;
  numbering: NumberingModel;
  theme: ThemeInfo = { colors: {} };
  comments = new Map<string, CommentThread>();
  media = new Map<string, MediaItem>();
  settings: DocumentSettings = { trackRevisions: false, xml: null, path: null };
  /** Root attributes of word/document.xml (e.g. mc:Ignorable) and extra namespaces. */
  documentRootAttrs: Record<string, string> = {};
  documentNamespaces: Record<string, string> = {};
  /** Serialized children of w:document other than w:body (e.g. w:background). */
  documentExtraXml: string[] = [];
  /** Non-fatal problems found while importing. */
  warnings: string[] = [];
  private urlFactory?: UrlFactory;

  constructor(pkg: OoxmlPackage, mainPath: string, body: PMNode, styles: StyleSheet, numbering: NumberingModel, fileName = 'Document.docx') {
    this.pkg = pkg;
    this.mainPath = mainPath;
    this.body = body;
    this.styles = styles;
    this.numbering = numbering;
    this.fileName = fileName;
  }

  setUrlFactory(f: UrlFactory | undefined) {
    this.urlFactory = f;
  }

  /** Display URL for a media part (object URL in browsers). */
  mediaUrl(path: string | null | undefined): string {
    if (!path) return '';
    const item = this.media.get(path);
    if (!item) return '';
    if (!item.url && this.urlFactory) item.url = this.urlFactory(item);
    return item.url ?? '';
  }

  /** Register new media (e.g. an inserted picture) and return its package path. */
  addMedia(bytes: Uint8Array, contentType: string, ext: string): string {
    let n = this.media.size + 1;
    const taken = (p: string) => this.media.has(p) || this.pkg.has(p);
    let path = `word/media/image${n}.${ext}`;
    while (taken(path)) path = `word/media/image${++n}.${ext}`;
    this.media.set(path, { path, bytes, contentType });
    return path;
  }

  /** A new part path for a header or footer. */
  newHeaderFooterPath(kind: 'header' | 'footer'): string {
    let n = 1;
    while (this.headerFooters.has(`word/${kind}${n}.xml`) || this.pkg.has(`word/${kind}${n}.xml`)) n++;
    return `word/${kind}${n}.xml`;
  }

  dispose() {
    for (const m of this.media.values()) {
      if (m.url && typeof URL !== 'undefined' && m.url.startsWith('blob:')) URL.revokeObjectURL(m.url);
    }
  }
}
