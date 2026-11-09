import { strToU8, zipSync } from 'fflate';
import { defaultStylesXml } from './model/styles';
import { A4, LETTER } from './model/types';
import { NS, WORD_IGNORABLE, WORD_ROOT_PREFIXES } from './xml/namespaces';

const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';
const RT = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

export interface BlankOptions {
  pageSize?: 'letter' | 'a4';
  font?: string;
  title?: string;
  author?: string;
}

/** Page size most likely expected for the user's locale. */
export function localePageSize(locale = typeof navigator !== 'undefined' ? navigator.language : 'en-US'): 'letter' | 'a4' {
  return /^(en-(US|CA|PH)|es-(MX|US|CO|VE|CL|PR|GT|CR|PA|DO|SV|HN|NI|BO|EC|PE|PY|UY|AR)|fr-CA|pt-BR)$/i.test(locale) ? 'letter' : 'a4';
}

/** Build a minimal, valid DOCX package containing one empty paragraph. */
export function createBlankDocx(opts: BlankOptions = {}): Uint8Array {
  const size = (opts.pageSize ?? 'letter') === 'a4' ? A4 : LETTER;
  const font = opts.font ?? 'Calibri';
  const decls = WORD_ROOT_PREFIXES.map((p) => `xmlns:${p}="${NS[p]}"`).join(' ');
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const document = `${DECL}<w:document ${decls} mc:Ignorable="${WORD_IGNORABLE}"><w:body><w:p/><w:sectPr><w:pgSz w:w="${size.width}" w:h="${size.height}"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/><w:cols w:space="720"/><w:docGrid w:linePitch="360"/></w:sectPr></w:body></w:document>`;
  const settings = `${DECL}<w:settings ${decls} mc:Ignorable="${WORD_IGNORABLE}"><w:zoom w:percent="100"/><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/><w:compatSetting w:name="overrideTableStyleFontSizeAndJustification" w:uri="http://schemas.microsoft.com/office/word" w:val="1"/><w:compatSetting w:name="enableOpenTypeFeatures" w:uri="http://schemas.microsoft.com/office/word" w:val="1"/><w:compatSetting w:name="doNotFlipMirrorIndents" w:uri="http://schemas.microsoft.com/office/word" w:val="1"/></w:compat></w:settings>`;
  const fontTable = `${DECL}<w:fonts ${decls} mc:Ignorable="${WORD_IGNORABLE}"><w:font w:name="${esc(font)}"><w:panose1 w:val="020F0502020204030204"/><w:charset w:val="00"/><w:family w:val="swiss"/><w:pitch w:val="variable"/></w:font><w:font w:name="Times New Roman"><w:panose1 w:val="02020603050405020304"/><w:charset w:val="00"/><w:family w:val="roman"/><w:pitch w:val="variable"/></w:font></w:fonts>`;
  const contentTypes = `${DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
  const rels = `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${RT}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${RT}/extended-properties" Target="docProps/app.xml"/></Relationships>`;
  const docRels = `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${RT}/styles" Target="styles.xml"/><Relationship Id="rId2" Type="${RT}/settings" Target="settings.xml"/><Relationship Id="rId3" Type="${RT}/fontTable" Target="fontTable.xml"/></Relationships>`;
  const core = `${DECL}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(opts.title ?? '')}</dc:title><dc:creator>${esc(opts.author ?? '')}</dc:creator><cp:lastModifiedBy>${esc(opts.author ?? '')}</cp:lastModifiedBy><cp:revision>1</cp:revision><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
  const app = `${DECL}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>DOCX Editor</Application><DocSecurity>0</DocSecurity></Properties>`;
  return zipSync({
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rels),
    'word/document.xml': strToU8(document),
    'word/_rels/document.xml.rels': strToU8(docRels),
    'word/styles.xml': strToU8(defaultStylesXml(font)),
    'word/settings.xml': strToU8(settings),
    'word/fontTable.xml': strToU8(fontTable),
    'docProps/core.xml': strToU8(core),
    'docProps/app.xml': strToU8(app),
  });
}
