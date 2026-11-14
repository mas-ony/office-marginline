// Generates DOCX test fixtures in packages/core/tests/fixtures and the example documents in
// apps/web-shared/public/examples.
// Run: node scripts/make-fixtures.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { zipSync, strToU8 } from 'fflate';

const OUT = new URL('../packages/core/tests/fixtures/', import.meta.url);
mkdirSync(OUT, { recursive: true });

/**
 * Zip a package with the same time on every entry, so that a rerun writes the same bytes. fflate
 * stores local time, so local midnight on 1 January 2024 gives the same bytes in every time zone.
 */
const zip = (parts) => zipSync(parts, { mtime: new Date(2024, 0, 1) });

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS = `xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml" mc:Ignorable="w14 w15"`;
const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

// --- tiny PNG encoder -------------------------------------------------------------------------
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, pixel) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = pixel(x, y);
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// --- XML helpers --------------------------------------------------------------------------------
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const t = (s) => `<w:t xml:space="preserve">${esc(s)}</w:t>`;
const run = (text, rPr = '') => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}${t(text)}</w:r>`;
const p = (content, pPr = '') => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${content}</w:p>`;

function drawing(rId, cx, cy, id, name) {
  return `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${id}" name="${name}" descr="Gradient test image"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`;
}

const styles = `${DECL}<w:styles ${NS}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi" w:eastAsiaTheme="minorHAnsi" w:cstheme="minorBidi"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="240" w:after="0"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:rFonts w:asciiTheme="majorHAnsi" w:hAnsiTheme="majorHAnsi"/><w:color w:val="2F5496"/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:contextualSpacing/></w:pPr><w:rPr><w:sz w:val="56"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>
<w:style w:type="character" w:styleId="Strong"><w:name w:val="Strong"/><w:basedOn w:val="DefaultParagraphFont"/><w:qFormat/><w:rPr><w:b/><w:bCs/></w:rPr></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:basedOn w:val="DefaultParagraphFont"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
<w:style w:type="table" w:styleId="GridAccent"><w:name w:val="Grid Accent"/><w:basedOn w:val="TableNormal"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="4472C4"/><w:left w:val="single" w:sz="4" w:space="0" w:color="4472C4"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="4472C4"/><w:right w:val="single" w:sz="4" w:space="0" w:color="4472C4"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="4472C4"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="4472C4"/></w:tblBorders></w:tblPr><w:tblStylePr w:type="firstRow"><w:rPr><w:b/><w:color w:val="FFFFFF"/></w:rPr><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="4472C4"/></w:tcPr></w:tblStylePr></w:style>
</w:styles>`;

const numbering = `${DECL}<w:numbering ${NS}>
<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>
<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val=""/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/></w:rPr></w:lvl>
<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="o"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:hint="default"/></w:rPr></w:lvl>
</w:abstractNum>
<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>
<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2)"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl>
</w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;

const list = (text, numId, ilvl) => p(run(text), `<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr>`);
const cell = (text, tcPr = '') => `<w:tc><w:tcPr>${tcPr}</w:tcPr>${p(run(text))}</w:tc>`;

const body = [
  p(run('Kitchen Sink Document'), '<w:pStyle w:val="Title"/>'),
  p([
    run('Plain, '),
    run('bold', '<w:b/>'),
    run(', '),
    run('italic', '<w:i/>'),
    run(', '),
    run('double underline', '<w:u w:val="double"/>'),
    run(', '),
    run('strike', '<w:strike/>'),
    run(', '),
    run('red', '<w:color w:val="FF0000"/>'),
    run(', '),
    run('highlighted', '<w:highlight w:val="yellow"/>'),
    run(', '),
    run('shaded', '<w:shd w:val="clear" w:color="auto" w:fill="DDEEFF"/>'),
    run(', '),
    run('Courier 14', '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="28"/>'),
    run(', E=mc'),
    run('2', '<w:vertAlign w:val="superscript"/>'),
    run(', '),
    run('strong style', '<w:rStyle w:val="Strong"/>'),
    run(', '),
    run('kerned', '<w:kern w:val="28"/><w:w w:val="90"/>'),
    run('.'),
  ].join('')),
  p(`<w:bookmarkStart w:id="0" w:name="target"/>${run('Bookmarked text. ')}<w:bookmarkEnd w:id="0"/><w:hyperlink r:id="rIdLink" w:history="1">${run('External link', '<w:rStyle w:val="Hyperlink"/>')}</w:hyperlink>${run(' and ')}<w:hyperlink w:anchor="target">${run('internal link', '<w:rStyle w:val="Hyperlink"/>')}</w:hyperlink>${run('.')}`),
  p(`${run('Left')}<w:r><w:tab/></w:r>${run('Center')}<w:r><w:tab/></w:r>${run('Right')}<w:r><w:br/></w:r>${run('After line break')}`, '<w:tabs><w:tab w:val="center" w:pos="4680"/><w:tab w:val="right" w:leader="dot" w:pos="9360"/></w:tabs>'),
  p(run('Heading One'), '<w:pStyle w:val="Heading1"/>'),
  list('Bullet one', 1, 0),
  list('Nested bullet', 1, 1),
  list('Bullet two', 1, 0),
  list('Number one', 2, 0),
  list('Number one a', 2, 1),
  list('Number two', 2, 0),
  p(run('Centered justified indent'), '<w:spacing w:before="120" w:after="120" w:line="360" w:lineRule="auto"/><w:ind w:left="720" w:right="720" w:firstLine="360"/><w:jc w:val="center"/>'),
  `<w:tbl><w:tblPr><w:tblStyle w:val="GridAccent"/><w:tblW w:w="5000" w:type="pct"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid><w:gridCol w:w="3120"/><w:gridCol w:w="3120"/><w:gridCol w:w="3120"/></w:tblGrid>
<w:tr><w:trPr><w:tblHeader/></w:trPr>${cell('H1')}${cell('H2')}${cell('H3')}</w:tr>
<w:tr>${cell('Merged across', '<w:gridSpan w:val="2"/>')}${cell('Tall', '<w:vMerge w:val="restart"/><w:shd w:val="clear" w:color="auto" w:fill="FFF2CC"/>')}</w:tr>
<w:tr>${cell('A3')}${cell('B3')}${cell('', '<w:vMerge/>')}</w:tr>
</w:tbl>`,
  p(`${run('Image: ')}<w:r>${drawing('rIdImg', 1143000, 857250, 1, 'Picture 1')}</w:r>`),
  `<w:p>${run('Before comment. ')}<w:commentRangeStart w:id="0"/><w:commentRangeStart w:id="1"/>${run('Comment target')}<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r><w:commentRangeEnd w:id="1"/><w:r><w:commentReference w:id="1"/></w:r>${run(' after.')}</w:p>`,
  p(`${run('Tracked: ')}<w:ins w:id="10" w:author="Alice" w:date="2024-01-01T00:00:00Z">${run('inserted')}</w:ins>${run(' ')}<w:del w:id="11" w:author="Bob" w:date="2024-01-02T00:00:00Z"><w:r><w:delText>deleted</w:delText></w:r></w:del>${run(' end.')}`),
  p(`${run('Footnote here')}<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="1"/></w:r>${run(' and a field: ')}<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> DATE \\@ "yyyy" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${run('2024')}<w:r><w:fldChar w:fldCharType="end"/></w:r>`),
  p(`${run('Math: ')}<m:oMath><m:r><m:t>a+b</m:t></m:r></m:oMath>`),
  `<w:sdt><w:sdtPr><w:alias w:val="Block control"/></w:sdtPr><w:sdtContent>${p(run('Inside a content control'))}</w:sdtContent></w:sdt>`,
  p(`${run('Before page break')}<w:r><w:br w:type="page"/></w:r>${run('After page break')}`),
  p(run('End of portrait section'), `<w:sectPr><w:headerReference w:type="default" r:id="rIdH1"/><w:headerReference w:type="first" r:id="rIdH2"/><w:footerReference w:type="default" r:id="rIdF1"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/><w:cols w:space="720"/><w:titlePg/><w:docGrid w:linePitch="360"/></w:sectPr>`),
  p(run('Landscape section text.')),
  `<w:sectPr><w:footerReference w:type="default" r:id="rIdF1"/><w:type w:val="nextPage"/><w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="720" w:footer="720" w:gutter="0"/><w:pgNumType w:start="5"/><w:cols w:num="2" w:space="720"/><w:docGrid w:linePitch="360"/></w:sectPr>`,
].join('\n');

const documentXml = `${DECL}<w:document ${NS}><w:body>${body}</w:body></w:document>`;
const header1 = `${DECL}<w:hdr ${NS}>${p(run('Default header text'), '<w:jc w:val="right"/>')}</w:hdr>`;
const header2 = `${DECL}<w:hdr ${NS}>${p(run('First page header'))}</w:hdr>`;
const footer1 = `${DECL}<w:ftr ${NS}>${p(`${run('Page ')}<w:fldSimple w:instr=" PAGE   \\* MERGEFORMAT ">${run('1')}</w:fldSimple>${run(' of ')}<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> NUMPAGES </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${run('3')}<w:r><w:fldChar w:fldCharType="end"/></w:r>`, '<w:jc w:val="center"/>')}</w:ftr>`;
const comments = `${DECL}<w:comments ${NS}>
<w:comment w:id="0" w:author="Alice" w:date="2024-03-01T10:00:00Z" w:initials="A"><w:p w14:paraId="00000001"><w:r><w:annotationRef/></w:r>${run('Please review this.')}</w:p></w:comment>
<w:comment w:id="1" w:author="Bob" w:date="2024-03-02T10:00:00Z" w:initials="B"><w:p w14:paraId="00000002"><w:r><w:annotationRef/></w:r>${run('Reply from Bob.')}</w:p></w:comment>
</w:comments>`;
const commentsEx = `${DECL}<w15:commentsEx ${NS}><w15:commentEx w15:paraId="00000001" w15:done="0"/><w15:commentEx w15:paraId="00000002" w15:paraIdParent="00000001" w15:done="0"/></w15:commentsEx>`;
const footnotes = `${DECL}<w:footnotes ${NS}><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote><w:footnote w:id="1"><w:p><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r>${run(' A footnote.')}</w:p></w:footnote></w:footnotes>`;
const settings = `${DECL}<w:settings ${NS}><w:zoom w:percent="100"/><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;
const theme = `${DECL}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;

const ct = `${DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
<Override PartName="/word/header2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>
<Override PartName="/word/commentsExtended.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml"/>
<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>
<Override PartName="/word/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;

const RT = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const rels = `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${RT}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
const docRels = `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdStyles" Type="${RT}/styles" Target="styles.xml"/>
<Relationship Id="rIdNum" Type="${RT}/numbering" Target="numbering.xml"/>
<Relationship Id="rIdSettings" Type="${RT}/settings" Target="settings.xml"/>
<Relationship Id="rIdTheme" Type="${RT}/theme" Target="theme/theme1.xml"/>
<Relationship Id="rIdH1" Type="${RT}/header" Target="header1.xml"/>
<Relationship Id="rIdH2" Type="${RT}/header" Target="header2.xml"/>
<Relationship Id="rIdF1" Type="${RT}/footer" Target="footer1.xml"/>
<Relationship Id="rIdComments" Type="${RT}/comments" Target="comments.xml"/>
<Relationship Id="rIdCommentsEx" Type="http://schemas.microsoft.com/office/2011/relationships/commentsExtended" Target="commentsExtended.xml"/>
<Relationship Id="rIdFootnotes" Type="${RT}/footnotes" Target="footnotes.xml"/>
<Relationship Id="rIdImg" Type="${RT}/image" Target="media/image1.png"/>
<Relationship Id="rIdLink" Type="${RT}/hyperlink" Target="https://example.com/" TargetMode="External"/>
</Relationships>`;
const core = `${DECL}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Kitchen sink</dc:title><cp:lastModifiedBy>Fixture</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">2024-01-01T00:00:00Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">2024-01-01T00:00:00Z</dcterms:modified></cp:coreProperties>`;

const image = png(120, 90, (x, y) => [Math.round((x / 120) * 255), Math.round((y / 90) * 255), 160]);

const files = {
  '[Content_Types].xml': strToU8(ct),
  '_rels/.rels': strToU8(rels),
  'docProps/core.xml': strToU8(core),
  'word/document.xml': strToU8(documentXml),
  'word/_rels/document.xml.rels': strToU8(docRels),
  'word/styles.xml': strToU8(styles),
  'word/numbering.xml': strToU8(numbering),
  'word/settings.xml': strToU8(settings),
  'word/theme/theme1.xml': strToU8(theme),
  'word/header1.xml': strToU8(header1),
  'word/header2.xml': strToU8(header2),
  'word/footer1.xml': strToU8(footer1),
  'word/comments.xml': strToU8(comments),
  'word/commentsExtended.xml': strToU8(commentsEx),
  'word/footnotes.xml': strToU8(footnotes),
  'word/media/image1.png': new Uint8Array(image),
};
writeFileSync(new URL('kitchen-sink.docx', OUT), zip(files));
writeFileSync(new URL('gradient.png', OUT), image);

// A long document for pagination checks.
const lorem = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. ';
const longBody = Array.from({ length: 120 }, (_, i) =>
  i % 15 === 0 ? p(run(`Chapter ${i / 15 + 1}`), '<w:pStyle w:val="Heading1"/>') : p(run(`${i}. ${lorem.repeat(1 + (i % 3))}`)),
).join('') + `<w:sectPr><w:footerReference w:type="default" r:id="rIdF1"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>`;
const longFiles = {
  ...files,
  'word/document.xml': strToU8(`${DECL}<w:document ${NS}><w:body>${longBody}</w:body></w:document>`),
};
writeFileSync(new URL('long.docx', OUT), zip(longFiles));

// Multi-column sections: one column, a continuous two-column section with a separator, one column.
const pgSz = '<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>';
const colBody = [
  p(run('Newsletter'), '<w:pStyle w:val="Title"/>'),
  p(run('An introduction that spans the full width of the page before the columns begin.'), `<w:sectPr>${pgSz}<w:cols w:space="720"/></w:sectPr>`),
  ...Array.from({ length: 10 }, (_, i) => p(run(`Column paragraph ${i + 1}. ${lorem}`), i === 9 ? `<w:sectPr><w:type w:val="continuous"/>${pgSz}<w:cols w:num="2" w:sep="1" w:space="720"/></w:sectPr>` : '')),
  p(run('Back to a single column after a continuous section break.')),
  `<w:sectPr><w:type w:val="continuous"/>${pgSz}<w:cols w:space="720"/></w:sectPr>`,
].join('');
writeFileSync(new URL('columns.docx', OUT), zip({ ...files, 'word/document.xml': strToU8(`${DECL}<w:document ${NS}><w:body>${colBody}</w:body></w:document>`) }));

// Footnotes on several pages (some long, one inside a table) and endnotes after the text.
const noteStyles = styles.replace('</w:styles>', `<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="EndnoteText"><w:name w:val="endnote text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style><w:style w:type="character" w:styleId="EndnoteReference"><w:name w:val="endnote reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style></w:styles>`);
const fnRef = (id) => `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="${id}"/></w:r>`;
const enRef = (id) => `<w:r><w:rPr><w:rStyle w:val="EndnoteReference"/></w:rPr><w:endnoteReference w:id="${id}"/></w:r>`;
const noteIds = [];
const notesBody = [
  p(run('Notes test'), '<w:pStyle w:val="Title"/>'),
  ...Array.from({ length: 36 }, (_, i) => {
    const k = i + 1;
    if (i % 3 !== 1) return p(run(`${k}. ${lorem}`));
    noteIds.push(k);
    return p(`${run(`${k}. ${lorem}With a note`)}${fnRef(k)}${run(` after sentence ${k}.`)}`);
  }),
  `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="4680"/><w:gridCol w:w="4680"/></w:tblGrid><w:tr>${cell('Cell with a note')}<w:tc><w:tcPr><w:tcW w:w="4680" w:type="dxa"/></w:tcPr>${p(`${run('Table note')}${fnRef(100)}`)}</w:tc></w:tr></w:tbl>`,
  p(`${run('Endnote one')}${enRef(1)}${run(' and endnote two')}${enRef(2)}${run('.')}`),
  `<w:sectPr><w:footerReference w:type="default" r:id="rIdF1"/>${pgSz}</w:sectPr>`,
].join('');
noteIds.push(100);
const noteXml = (kind, id, text) => `<w:${kind} w:id="${id}"><w:p><w:pPr><w:pStyle w:val="${kind === 'footnote' ? 'FootnoteText' : 'EndnoteText'}"/></w:pPr><w:r><w:rPr><w:rStyle w:val="${kind === 'footnote' ? 'FootnoteReference' : 'EndnoteReference'}"/></w:rPr><w:${kind}Ref/></w:r>${run(` ${text}`)}</w:p></w:${kind}>`;
const separators = (kind) => `<w:${kind} w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></w:${kind}><w:${kind} w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:${kind}>`;
const notesFootnotes = `${DECL}<w:footnotes ${NS}>${separators('footnote')}${noteIds.map((id) => noteXml('footnote', id, id === 100 ? 'Footnote in a table cell.' : id % 4 === 2 ? `Long footnote ${id}. ${lorem}${lorem}` : `Footnote ${id}.`)).join('')}</w:footnotes>`;
const notesEndnotes = `${DECL}<w:endnotes ${NS}>${separators('endnote')}${noteXml('endnote', 1, 'First endnote text.')}${noteXml('endnote', 2, `Second endnote. ${lorem}`)}</w:endnotes>`;
writeFileSync(new URL('notes.docx', OUT), zip({
  ...files,
  '[Content_Types].xml': strToU8(ct.replace('</Types>', '<Override PartName="/word/endnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml"/></Types>')),
  'word/_rels/document.xml.rels': strToU8(docRels.replace('</Relationships>', `<Relationship Id="rIdEndnotes" Type="${RT}/endnotes" Target="endnotes.xml"/></Relationships>`)),
  'word/styles.xml': strToU8(noteStyles),
  'word/document.xml': strToU8(`${DECL}<w:document ${NS}><w:body>${notesBody}</w:body></w:document>`),
  'word/footnotes.xml': strToU8(notesFootnotes),
  'word/endnotes.xml': strToU8(notesEndnotes),
}));

// Drawings: a group of a picture, a text box and a line placed over the column, a rectangle whose
// outline comes from its shape style and the theme (with the fallback older readers use), shapes
// in the line (theme colour, gradient, dashed outline, arrow, custom outline) and a drawing canvas.
{
  const NSD = NS.replace(' mc:Ignorable', ' xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" xmlns:v="urn:schemas-microsoft-com:vml" mc:Ignorable');
  const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
  const WPG = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';
  const WPC = 'http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas';
  // Sizes and positions below are in px (9525 EMU).
  const emu = (n) => Math.round(n * 9525);
  const xfrm = (x, y, w, h, attrs = '') => `<a:xfrm${attrs}><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm>`;
  const geom = (prst, av = '') => `<a:prstGeom prst="${prst}"><a:avLst>${av}</a:avLst></a:prstGeom>`;
  const shape = (spPr) => `<wps:wsp><wps:cNvSpPr/><wps:spPr>${spPr}</wps:spPr><wps:bodyPr/></wps:wsp>`;
  const connector = (spPr) => `<wps:wsp><wps:cNvCnPr/><wps:spPr>${spPr}</wps:spPr><wps:bodyPr/></wps:wsp>`;
  let id = 0;
  const graphic = (uri, inner) => `<wp:docPr id="${++id}" name="Drawing ${id}"/><wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="${uri}">${inner}</a:graphicData></a:graphic>`;
  const inline = (w, h, uri, inner) => `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${emu(w)}" cy="${emu(h)}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>${graphic(uri, inner)}</wp:inline></w:drawing></w:r>`;
  const anchor = (w, h, x, y, uri, inner) => `<wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="${id + 1}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>${emu(x)}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>${emu(y)}</wp:posOffset></wp:positionV><wp:extent cx="${emu(w)}" cy="${emu(h)}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>${graphic(uri, inner)}</wp:anchor>`;

  // 400 × 100 with a child space of 200 × 50 starting at x 10: children are drawn twice as large.
  const group = `<wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu(400)}" cy="${emu(100)}"/><a:chOff x="${emu(10)}" y="0"/><a:chExt cx="${emu(200)}" cy="${emu(50)}"/></a:xfrm></wpg:grpSpPr>`
    + `<pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="Logo"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImg"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr>${xfrm(10, 0, 25, 50)}${geom('rect')}</pic:spPr></pic:pic>`
    + `<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr>${xfrm(40, 0, 170, 40)}${geom('rect')}<a:noFill/><a:ln><a:noFill/></a:ln></wps:spPr><wps:txbx><w:txbxContent>${p(run('Drawn heading', '<w:b/>'), '<w:spacing w:after="0"/><w:jc w:val="center"/>')}${p(run('Second line'), '<w:spacing w:after="0"/><w:jc w:val="center"/>')}</w:txbxContent></wps:txbx><wps:bodyPr rot="0" vert="horz" wrap="square" lIns="91440" tIns="45720" rIns="91440" bIns="45720" anchor="t"/></wps:wsp>`
    + connector(`${xfrm(10, 47, 200, 1, ' flipV="1"')}${geom('line')}<a:ln w="28575"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>`)
    + '</wpg:wgp>';
  const styled = `<wps:wsp><wps:cNvSpPr/><wps:spPr>${xfrm(0, 0, 23, 15)}${geom('rect')}<a:noFill/></wps:spPr><wps:style><a:lnRef idx="2"><a:schemeClr val="accent1"><a:shade val="50000"/></a:schemeClr></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></wps:style><wps:bodyPr rot="0" vert="horz" wrap="square" lIns="91440" tIns="45720" rIns="91440" bIns="45720" anchor="ctr"/></wps:wsp>`;
  const checkBox = `<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing>${anchor(23, 15, 4, 2, WPS, styled)}</w:drawing></mc:Choice><mc:Fallback><w:pict><v:rect style="position:absolute;margin-left:3pt;margin-top:1.5pt;width:17.25pt;height:11.25pt" filled="f" strokecolor="#2f528f" strokeweight="1pt"/></w:pict></mc:Fallback></mc:AlternateContent></w:r>`;
  const shapes = [
    inline(40, 30, WPS, shape(`${xfrm(0, 0, 40, 30)}${geom('ellipse')}<a:solidFill><a:schemeClr val="accent2"><a:lumMod val="75000"/></a:schemeClr></a:solidFill><a:ln><a:noFill/></a:ln>`)),
    inline(60, 30, WPS, shape(`${xfrm(0, 0, 60, 30)}${geom('roundRect', '<a:gd name="adj" fmla="val 25000"/>')}<a:gradFill><a:gsLst><a:gs pos="0"><a:schemeClr val="accent1"/></a:gs><a:gs pos="100000"><a:srgbClr val="FFFFFF"/></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill><a:ln w="9525"><a:solidFill><a:srgbClr val="1F3864"/></a:solidFill><a:prstDash val="dash"/></a:ln>`)),
    inline(60, 20, WPS, connector(`${xfrm(0, 0, 60, 20)}${geom('straightConnector1')}<a:ln w="19050"><a:solidFill><a:srgbClr val="C00000"/></a:solidFill><a:tailEnd type="triangle"/></a:ln>`)),
    inline(40, 40, WPS, shape(`${xfrm(0, 0, 40, 40)}<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst><a:path w="100" h="100"><a:moveTo><a:pt x="0" y="100"/></a:moveTo><a:lnTo><a:pt x="0" y="50"/></a:lnTo><a:arcTo wR="50" hR="50" stAng="10800000" swAng="10800000"/><a:lnTo><a:pt x="100" y="100"/></a:lnTo><a:close/></a:path></a:pathLst></a:custGeom><a:solidFill><a:srgbClr val="FFC000"><a:alpha val="50000"/></a:srgbClr></a:solidFill>`)),
  ];
  const canvas = `<wpc:wpc><wpc:bg><a:solidFill><a:srgbClr val="F2F2F2"/></a:solidFill></wpc:bg><wpc:whole><a:ln><a:noFill/></a:ln></wpc:whole>${shape(`${xfrm(10, 10, 30, 20)}${geom('diamond')}<a:solidFill><a:srgbClr val="70AD47"/></a:solidFill>`)}</wpc:wpc>`;
  const drawingsBody = [
    p(`<w:r><w:drawing>${anchor(400, 100, 0, 0, WPG, group)}</w:drawing></w:r>${run('Letterhead')}`, '<w:spacing w:after="1600"/>'),
    p(`${checkBox}${run('Check box')}`, '<w:ind w:left="567"/>'),
    p(shapes.join(run(' '))),
    p(inline(60, 40, WPC, canvas)),
    `<w:sectPr>${pgSz}</w:sectPr>`,
  ].join('');
  writeFileSync(new URL('drawings.docx', OUT), zip({ ...files, 'word/document.xml': strToU8(`${DECL}<w:document ${NSD}><w:body>${drawingsBody}</w:body></w:document>`) }));
}

console.log('fixtures written to', OUT.pathname);

// ================================================================================================
// Example documents for the Examples menu (apps/web-shared/public/examples). All content is
// written for this project.

const EX = new URL('../apps/web-shared/public/examples/', import.meta.url);
mkdirSync(EX, { recursive: true });

const exStyles = (extra = '') => styles.replace('</w:styles>', `
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="center"/><w:spacing w:after="240"/></w:pPr><w:rPr><w:i/><w:color w:val="5A6474"/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:rFonts w:asciiTheme="majorHAnsi" w:hAnsiTheme="majorHAnsi"/><w:b/><w:color w:val="1F3864"/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="160" w:after="40"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:color w:val="404040"/><w:sz w:val="23"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/><w:pPr><w:tabs><w:tab w:val="center" w:pos="4680"/><w:tab w:val="right" w:pos="9360"/></w:tabs><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:color w:val="7F7F7F"/><w:sz w:val="18"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:tabs><w:tab w:val="center" w:pos="4680"/><w:tab w:val="right" w:pos="9360"/></w:tabs><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:color w:val="7F7F7F"/><w:sz w:val="18"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="EndnoteText"><w:name w:val="endnote text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="18"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="EndnoteReference"><w:name w:val="endnote reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="864" w:right="864"/><w:jc w:val="center"/></w:pPr><w:rPr><w:i/><w:color w:val="404040"/></w:rPr></w:style>
<w:style w:type="table" w:styleId="ScheduleTable"><w:name w:val="Schedule Table"/><w:basedOn w:val="TableNormal"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="6" w:space="0" w:color="1F3864"/><w:left w:val="single" w:sz="4" w:space="0" w:color="8EA9DB"/><w:bottom w:val="single" w:sz="6" w:space="0" w:color="1F3864"/><w:right w:val="single" w:sz="4" w:space="0" w:color="8EA9DB"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="8EA9DB"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="8EA9DB"/></w:tblBorders><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblStylePr w:type="firstRow"><w:rPr><w:b/><w:color w:val="FFFFFF"/></w:rPr><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="1F3864"/></w:tcPr></w:tblStylePr><w:tblStylePr w:type="band1Horz"><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="EEF2FA"/></w:tcPr></w:tblStylePr></w:style>
${extra}</w:styles>`);

const exNumbering = numbering.replace('<w:num w:numId="1">', `<w:abstractNum w:abstractNumId="2"><w:multiLevelType w:val="multilevel"/>
<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="432" w:hanging="432"/></w:pPr></w:lvl>
<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1.%2"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="1008" w:hanging="576"/></w:pPr></w:lvl>
<w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="(%3)"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="1440" w:hanging="432"/></w:pPr></w:lvl>
<w:lvl w:ilvl="3"><w:start w:val="1"/><w:numFmt w:val="lowerRoman"/><w:lvlText w:val="(%4)"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="1872" w:hanging="432"/></w:pPr></w:lvl>
</w:abstractNum>
<w:num w:numId="1">`).replace('</w:numbering>', `<w:num w:numId="3"><w:abstractNumId w:val="2"/></w:num>
</w:numbering>`);

const SECT = (extra = '', hdr = true) => `<w:sectPr>${hdr ? '<w:headerReference w:type="default" r:id="rIdH1"/><w:footerReference w:type="default" r:id="rIdF1"/>' : ''}${pgSz}<w:cols w:space="720"/>${extra}</w:sectPr>`;
const exHeader = (text) => `${DECL}<w:hdr ${NS}>${p(`${run(text)}<w:r><w:tab/></w:r><w:r><w:tab/></w:r>${run('Marginline example')}`, '<w:pStyle w:val="Header"/>')}</w:hdr>`;
const exFooter = `${DECL}<w:ftr ${NS}>${p(`${run('Page ')}<w:fldSimple w:instr=" PAGE ">${run('1')}</w:fldSimple>${run(' of ')}<w:fldSimple w:instr=" NUMPAGES ">${run('1')}</w:fldSimple>`, '<w:pStyle w:val="Footer"/><w:jc w:val="center"/>')}</w:ftr>`;

/** Build a package from document parts; only the parts given are written. */
function pack({ body: bodyXml, header, headerXml, comments: cmts, commentsEx: cmtsEx, footnotes: fns, endnotes: ens, media = {}, extraRels = '', title = 'Example', stylesXml = exStyles(), numberingXml = exNumbering, ns = NS }) {
  const overrides = [
    ['/word/document.xml', 'document.main+xml'],
    ['/word/styles.xml', 'styles+xml'],
    ['/word/numbering.xml', 'numbering+xml'],
    ['/word/settings.xml', 'settings+xml'],
    ['/word/header1.xml', 'header+xml'],
    ['/word/footer1.xml', 'footer+xml'],
    ...(cmts ? [['/word/comments.xml', 'comments+xml'], ['/word/commentsExtended.xml', 'commentsExtended+xml']] : []),
    ...(fns ? [['/word/footnotes.xml', 'footnotes+xml']] : []),
    ...(ens ? [['/word/endnotes.xml', 'endnotes+xml']] : []),
  ];
  const ctXml = `${DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>${overrides.map(([n, t]) => `<Override PartName="${n}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${t}"/>`).join('')}<Override PartName="/word/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
  const relsXml = `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdStyles" Type="${RT}/styles" Target="styles.xml"/>
<Relationship Id="rIdNum" Type="${RT}/numbering" Target="numbering.xml"/>
<Relationship Id="rIdSettings" Type="${RT}/settings" Target="settings.xml"/>
<Relationship Id="rIdTheme" Type="${RT}/theme" Target="theme/theme1.xml"/>
<Relationship Id="rIdH1" Type="${RT}/header" Target="header1.xml"/>
<Relationship Id="rIdF1" Type="${RT}/footer" Target="footer1.xml"/>
${cmts ? `<Relationship Id="rIdComments" Type="${RT}/comments" Target="comments.xml"/><Relationship Id="rIdCommentsEx" Type="http://schemas.microsoft.com/office/2011/relationships/commentsExtended" Target="commentsExtended.xml"/>` : ''}
${fns ? `<Relationship Id="rIdFootnotes" Type="${RT}/footnotes" Target="footnotes.xml"/>` : ''}
${ens ? `<Relationship Id="rIdEndnotes" Type="${RT}/endnotes" Target="endnotes.xml"/>` : ''}
${Object.keys(media).map((name, i) => `<Relationship Id="rIdMedia${i + 1}" Type="${RT}/image" Target="media/${name}"/>`).join('')}
${extraRels}
</Relationships>`;
  const coreXml = core.replace('<dc:title>Kitchen sink</dc:title>', `<dc:title>${esc(title)}</dc:title>`);
  const out = {
    '[Content_Types].xml': strToU8(ctXml),
    '_rels/.rels': strToU8(rels),
    'docProps/core.xml': strToU8(coreXml),
    'word/document.xml': strToU8(`${DECL}<w:document ${ns}><w:body>${bodyXml}</w:body></w:document>`),
    'word/_rels/document.xml.rels': strToU8(relsXml),
    'word/styles.xml': strToU8(stylesXml),
    'word/numbering.xml': strToU8(numberingXml),
    'word/settings.xml': strToU8(settings),
    'word/theme/theme1.xml': strToU8(theme),
    'word/header1.xml': strToU8(headerXml ?? exHeader(header ?? title)),
    'word/footer1.xml': strToU8(exFooter),
  };
  if (cmts) {
    out['word/comments.xml'] = strToU8(cmts);
    out['word/commentsExtended.xml'] = strToU8(cmtsEx);
  }
  if (fns) out['word/footnotes.xml'] = strToU8(fns);
  if (ens) out['word/endnotes.xml'] = strToU8(ens);
  for (const [name, bytes] of Object.entries(media)) out[`word/media/${name}`] = new Uint8Array(bytes);
  return zip(out);
}

const ins = (id, author, date, text) => `<w:ins w:id="${id}" w:author="${author}" w:date="${date}">${run(text)}</w:ins>`;
const del = (id, author, date, text) => `<w:del w:id="${id}" w:author="${author}" w:date="${date}"><w:r><w:delText xml:space="preserve">${esc(text)}</w:delText></w:r></w:del>`;
const cStart = (id) => `<w:commentRangeStart w:id="${id}"/>`;
const cEnd = (id) => `<w:commentRangeEnd w:id="${id}"/><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="${id}"/></w:r>`;
const commentXml = (id, author, date, text, paraId) => `<w:comment w:id="${id}" w:author="${author}" w:date="${date}" w:initials="${author.split(' ').map((x) => x[0]).join('')}"><w:p w14:paraId="${paraId}"><w:r><w:annotationRef/></w:r>${run(text)}</w:p></w:comment>`;
const H = (text, level = 1) => p(run(text), `<w:pStyle w:val="Heading${level}"/>`);
const numbered = (text, ilvl = 0, numId = 3) => p(run(text), `<w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr><w:spacing w:after="100"/>`);
const bullet = (content, ilvl = 0) => p(content.startsWith('<w:') ? content : run(content), `<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="1"/></w:numPr>`);
const tc = (content, w, extra = '') => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${extra}</w:tcPr>${content.startsWith('<w:p') ? content : p(run(content))}</w:tc>`;
const table = (widths, rows, style = 'ScheduleTable') => `<w:tbl><w:tblPr><w:tblStyle w:val="${style}"/><w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${rows.map((r, i) => `<w:tr>${i === 0 ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${r.map((c, j) => tc(c, widths[j])).join('')}</w:tr>`).join('')}</w:tbl>`;

// --- 1. Review: an agreement with comments and tracked changes ----------------------------------
{
  const A = 'Maya Okafor', B = 'Lucas Brandt', C = 'Priya Raman';
  const d1 = '2026-09-14T09:12:00Z', d2 = '2026-09-15T15:40:00Z', d3 = '2026-09-18T11:05:00Z';
  const body = [
    p(run('Software Services Agreement'), '<w:pStyle w:val="Title"/><w:jc w:val="center"/>'),
    p(run('Between Harbor Lane Analytics Ltd. and Cedar Point Logistics Inc.'), '<w:pStyle w:val="Subtitle"/>'),
    H('1. Purpose'),
    p(`${run('This agreement sets out how Harbor Lane Analytics (the “Provider”) will design, build and ')}${del(101, B, d2, 'operate ')}${ins(102, B, d2, 'support ')}${run('a shipment forecasting service for Cedar Point Logistics (the “Client”). It replaces the letter of intent dated 2 June 2026.')}`),
    p(`${run('The service will help the Client plan warehouse capacity ')}${cStart(1)}${run('two quarters in advance')}${cEnd(1)}${run(' using order history, carrier schedules and regional demand signals.')}`),
    H('2. Scope of work'),
    bullet('Discovery workshops with the Client’s planning team.'),
    bullet('A forecasting model trained on three years of shipment data.'),
    bullet(`${run('A web dashboard ')}${ins(103, C, d3, 'with role-based access ')}${run('for planners and managers.')}`),
    bullet('Monthly accuracy reports and model retraining.'),
    H('3. Fees and payment'),
    p(`${run('The Client will pay the fees in the schedule below. Invoices are due within ')}${del(104, A, d1, '45')}${ins(105, A, d1, '30')}${run(' days of receipt.')}`),
    table([2600, 1500, 2200, 3060], [
      ['Milestone', 'Fee', 'Due', 'Notes'],
      ['Discovery complete', '15%', 'On acceptance', 'Workshop notes and data inventory'],
      ['Model in pilot', '35%', 'Week 10', 'Pilot with two regional warehouses'],
      ['Dashboard launch', '35%', 'Week 16', 'Includes training sessions'],
      ['First quarter of support', '15%', 'Quarterly', 'Accuracy reports and retraining'],
    ]),
    p(''),
    H('4. Confidentiality'),
    p(`${cStart(2)}${run('Each party will keep the other party’s confidential information secure and use it only to perform this agreement.')}${cEnd(2)}${run(' This obligation lasts for three years after the agreement ends.')}`),
    H('5. Term and termination'),
    p(`${run('The agreement starts on the effective date and runs for twelve months. Either party may end it with ')}${cStart(3)}${run('sixty days’ written notice')}${cEnd(3)}${run('.')}`),
    H('Signatures'),
    table([4680, 4680], [
      ['Harbor Lane Analytics Ltd.', 'Cedar Point Logistics Inc.'],
      ['Name: ______________________', 'Name: ______________________'],
      ['Date: ______________________', 'Date: ______________________'],
    ]),
    SECT(),
  ].join('');
  const cmts = `${DECL}<w:comments ${NS}>
${commentXml(1, C, d3, 'Can we say “up to two quarters”? The pilot data only covers one season.', '10000001')}
${commentXml(4, A, '2026-09-18T13:20:00Z', 'Agreed, I will update the wording before signing.', '10000004')}
${commentXml(2, B, d2, 'Legal asked to keep this clause unchanged from the master template.', '10000002')}
${commentXml(3, A, d1, 'Ninety days was our original position. @Lucas Brandt please confirm.', '10000003')}
</w:comments>`;
  const cmtsEx = `${DECL}<w15:commentsEx ${NS}><w15:commentEx w15:paraId="10000001" w15:done="0"/><w15:commentEx w15:paraId="10000004" w15:paraIdParent="10000001" w15:done="0"/><w15:commentEx w15:paraId="10000002" w15:done="1"/><w15:commentEx w15:paraId="10000003" w15:done="0"/></w15:commentsEx>`;
  // The reply (id 4) shares the anchor of comment 1.
  const bodyWithReply = body.replace(`${cStart(1)}`, `${cStart(1)}${cStart(4)}`).replace(`${cEnd(1)}`, `${cEnd(1)}${cEnd(4)}`);
  writeFileSync(new URL('agreement.docx', EX), pack({ body: bodyWithReply, comments: cmts, commentsEx: cmtsEx, title: 'Software Services Agreement', header: 'Software Services Agreement' }));
}

// --- 2. Templating: content controls to fill ----------------------------------------------------
{
  let fid = 2000;
  const field = (tag, alias, value) => `<w:sdt><w:sdtPr><w:alias w:val="${alias}"/><w:tag w:val="${tag}"/><w:id w:val="${++fid}"/><w:text/></w:sdtPr><w:sdtContent>${run(value)}</w:sdtContent></w:sdt>`;
  const body = [
    p(run('Consulting Agreement'), '<w:pStyle w:val="Title"/>'),
    p(`${run('Effective date: ', '<w:b/>')}${field('effective_date', 'Effective Date', 'October 1, 2026')}`),
    p(`${run('This Consulting Agreement is made between ')}${field('client_name', 'Client Name', 'Northwind Traders')}${run(' (the “Client”) and ')}${field('consultant_name', 'Consultant Name', 'Rivera & Stone Consulting')}${run(' (the “Consultant”).')}`),
    H('1. Services'),
    p(`${run('The Consultant will deliver the project ')}${field('project_name', 'Project Name', 'Supply Chain Review')}${run(' as described below.')}`),
    table([3000, 6360], [
      ['Item', 'Detail'],
      ['Project', `${p(field('project_name', 'Project Name', 'Supply Chain Review'))}`],
      ['Start date', `${p(field('start_date', 'Start Date', 'October 15, 2026'))}`],
      ['Completion date', `${p(field('end_date', 'Completion Date', 'January 31, 2027'))}`],
      ['Fee', `${p(field('fee', 'Fee', 'USD 48,000'))}`],
    ]),
    p(''),
    H('2. Payment'),
    p(`${run('The Client will pay ')}${field('fee', 'Fee', 'USD 48,000')}${run(' in three equal instalments. Invoices are payable within 30 days.')}`),
    H('3. Contacts'),
    p(`${run('Notices to the Client go to ')}${field('client_contact', 'Client Contact', 'Jordan Ellis, Head of Operations')}${run('. Notices to the Consultant go to ')}${field('consultant_contact', 'Consultant Contact', 'Ana Rivera, Partner')}${run('.')}`),
    H('4. Signatures'),
    p(`${run('Signed for ')}${field('client_name', 'Client Name', 'Northwind Traders')}${run(': ______________________')}`),
    p(`${run('Signed for ')}${field('consultant_name', 'Consultant Name', 'Rivera & Stone Consulting')}${run(': ______________________')}`),
    SECT(),
  ].join('');
  writeFileSync(new URL('template.docx', EX), pack({ body, title: 'Consulting Agreement', header: 'Consulting Agreement (template)' }));
}

// --- 3. A long report (about 300 pages) ----------------------------------------------------------
{
  const topics = ['warehouse capacity', 'carrier performance', 'customer demand', 'inventory turnover', 'transport costs', 'returns handling', 'staff scheduling', 'energy use', 'safety incidents', 'supplier lead times'];
  const sentence = (i, j) => `In period ${i + 1}.${j + 1}, ${topics[(i + j) % topics.length]} changed as the network adjusted to seasonal volumes, and the operations team recorded the effect on service levels, cost per order and planning accuracy across every region. `;
  let noteId = 0;
  const notes = [];
  const parts = [p(run('Annual Operations Report'), '<w:pStyle w:val="Title"/>'), p(run('Fiscal year 2026 — internal edition'), '<w:pStyle w:val="Subtitle"/>')];
  for (let ch = 0; ch < 165; ch++) {
    parts.push(H(`Chapter ${ch + 1}: ${topics[ch % topics.length][0].toUpperCase()}${topics[ch % topics.length].slice(1)}`));
    for (let k = 0; k < 9; k++) {
      let content = run(sentence(ch, k).repeat(2 + (k % 3)));
      if (k === 4) {
        noteId++;
        notes.push(`<w:footnote w:id="${noteId}"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r>${run(` Source: regional operations dashboard, chapter ${ch + 1}.`)}</w:p></w:footnote>`);
        content += `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="${noteId}"/></w:r>`;
      }
      parts.push(p(content));
      if (k === 6) parts.push(table([3120, 3120, 3120], [['Measure', 'Target', 'Result'], ['On-time delivery', '96%', `${90 + (ch % 9)}%`], ['Cost per order', 'USD 4.10', `USD ${(3.8 + (ch % 7) / 10).toFixed(2)}`], ['Forecast error', '8%', `${6 + (ch % 5)}%`]]), p(''));
    }
  }
  parts.push(SECT());
  const fns = `${DECL}<w:footnotes ${NS}>${separators('footnote')}${notes.join('')}</w:footnotes>`;
  writeFileSync(new URL('long-report.docx', EX), pack({ body: parts.join(''), footnotes: fns, title: 'Annual Operations Report', header: 'Annual Operations Report 2026' }));
}

// --- 4. Tables & columns ------------------------------------------------------------------------
{
  // A simple site plan drawn pixel by pixel.
  const W = 560, Hh = 260;
  const plan = png(W, Hh, (x, y) => {
    const line = (v, a) => Math.abs(v - a) < 1.5;
    const inRect = (x0, y0, x1, y1) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
    const edge = (x0, y0, x1, y1) => inRect(x0, y0, x1, y1) && (line(x, x0) || line(x, x1) || line(y, y0) || line(y, y1));
    if (edge(20, 20, 540, 240) || edge(60, 60, 250, 210) || edge(290, 60, 500, 140) || edge(290, 160, 500, 210)) return [31, 56, 100];
    if (inRect(60, 60, 250, 210) && (x + y) % 18 === 0) return [143, 169, 219];
    if (inRect(290, 60, 500, 140)) return [232, 238, 250];
    if (inRect(290, 160, 500, 210)) return [255, 242, 204];
    if (y > 228 && y < 236 && x > 30 && x < 530 && x % 24 < 12) return [120, 120, 120];
    return [255, 255, 255];
  });
  const cols2 = `<w:sectPr><w:type w:val="continuous"/>${pgSz}<w:cols w:num="2" w:sep="1" w:space="540"/></w:sectPr>`;
  const merged = `<w:tbl><w:tblPr><w:tblStyle w:val="ScheduleTable"/><w:tblW w:w="9360" w:type="dxa"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid><w:gridCol w:w="2340"/><w:gridCol w:w="2340"/><w:gridCol w:w="2340"/><w:gridCol w:w="2340"/></w:tblGrid>
<w:tr><w:trPr><w:tblHeader/></w:trPr>${tc('Building', 2340)}${tc('Level', 2340)}${tc('Use', 2340)}${tc('Area (m²)', 2340)}</w:tr>
<w:tr>${tc('North hall', 2340, '<w:vMerge w:val="restart"/><w:vAlign w:val="center"/>')}${tc('Ground', 2340)}${tc('Loading docks', 2340)}${tc('1,850', 2340)}</w:tr>
<w:tr>${tc('', 2340, '<w:vMerge/>')}${tc('First', 2340)}${tc('Offices', 2340)}${tc('920', 2340)}</w:tr>
<w:tr>${tc('South hall', 2340, '<w:vMerge w:val="restart"/><w:vAlign w:val="center"/>')}${tc('Ground', 2340)}${tc('Cold storage', 2340, '<w:shd w:val="clear" w:color="auto" w:fill="DDEBF7"/>')}${tc('1,240', 2340)}</w:tr>
<w:tr>${tc('', 2340, '<w:vMerge/>')}${tc('First', 2340)}${tc('Packing', 2340)}${tc('1,100', 2340)}</w:tr>
<w:tr>${tc('Total floor area', 7020, '<w:gridSpan w:val="3"/><w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>')}${tc('5,110', 2340, '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>')}</w:tr>
</w:tbl>`;
  const lorem2 = 'The site is organised so that inbound and outbound flows never cross. Trucks enter from the east gate, unload at the north hall and leave through the south lane, while staff parking and the visitor entrance stay on the west side. ';
  const body = [
    p(`<w:r>${drawing('rIdMedia1', 5334000, 2476500, 1, 'Site plan').replace('Gradient test image', 'Site plan of the distribution centre')}</w:r>`, '<w:jc w:val="center"/>'),
    p(run('Distribution Centre Lease Summary'), '<w:pStyle w:val="Title"/><w:jc w:val="center"/>'),
    p(run('Prepared for the facilities committee.'), `<w:pStyle w:val="Subtitle"/><w:sectPr>${pgSz}<w:cols w:space="720"/></w:sectPr>`),
    H('Site overview', 2),
    p(run(lorem2.repeat(2)), '<w:jc w:val="both"/>'),
    H('Access and parking', 2),
    p(`${run('Access is controlled at both gates. The lease includes 120 parking spaces, of which ')}${del(201, 'Tomás Ferreira', '2026-09-20T10:00:00Z', '20')}${ins(202, 'Tomás Ferreira', '2026-09-20T10:00:00Z', '24')}${run(' are reserved for electric vehicles.')}`, '<w:jc w:val="both"/>'),
    p(run(lorem2.repeat(2)), '<w:jc w:val="both"/>'),
    H('Maintenance', 2),
    p(run(lorem2.repeat(3)), `<w:jc w:val="both"/>${cols2}`),
    H('Space schedule'),
    merged,
    p(''),
    H('Rent schedule'),
    table([2340, 2340, 2340, 2340], [['Year', 'Base rent', 'Service charge', 'Total'], ['2027', 'EUR 412,000', 'EUR 38,500', 'EUR 450,500'], ['2028', 'EUR 424,360', 'EUR 39,600', 'EUR 463,960'], ['2029', 'EUR 437,090', 'EUR 40,800', 'EUR 477,890']]),
    SECT(),
  ].join('');
  writeFileSync(new URL('tables-columns.docx', EX), pack({ body, media: { 'plan.png': plan }, title: 'Distribution Centre Lease Summary', header: 'Lease summary' }));
}

// --- 5. International & RTL ---------------------------------------------------------------------
{
  const rtl = (text) => p(`<w:r><w:rPr><w:rtl/></w:rPr>${t(text)}</w:r>`, '<w:bidi/>');
  const label = (text) => p(run(text, '<w:b/><w:color w:val="1F3864"/>'), '<w:spacing w:before="200" w:after="40"/>');
  const rtlTable = `<w:tbl><w:tblPr><w:bidiVisual/><w:tblStyle w:val="ScheduleTable"/><w:tblW w:w="9360" w:type="dxa"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid><w:gridCol w:w="3600"/><w:gridCol w:w="2880"/><w:gridCol w:w="2880"/></w:tblGrid>
<w:tr><w:trPr><w:tblHeader/></w:trPr>${['الخدمة', 'الوحدة', 'السعر'].map((c) => `<w:tc><w:tcPr><w:tcW w:w="2880" w:type="dxa"/></w:tcPr>${rtl(c)}</w:tc>`).join('')}</w:tr>
<w:tr>${['ترجمة المستندات', 'لكل صفحة', '١٢٠'].map((c) => `<w:tc><w:tcPr><w:tcW w:w="2880" w:type="dxa"/></w:tcPr>${rtl(c)}</w:tc>`).join('')}</w:tr>
<w:tr>${['مراجعة العقود', 'لكل ساعة', '٣٥٠'].map((c) => `<w:tc><w:tcPr><w:tcW w:w="2880" w:type="dxa"/></w:tcPr>${rtl(c)}</w:tc>`).join('')}</w:tr>
</w:tbl>`;
  const body = [
    p(run('Multilingual Service Notice'), '<w:pStyle w:val="Title"/>'),
    p(run('The same notice in several scripts, including right-to-left languages.'), '<w:pStyle w:val="Subtitle"/><w:jc w:val="left"/>'),
    label('English'),
    p(run('Our support desk is open every weekday. Requests received after six in the evening are answered the next morning.')),
    label('العربية (Arabic)'),
    rtl('مكتب الدعم مفتوح في جميع أيام العمل. يتم الرد على الطلبات التي تصل بعد السادسة مساءً في صباح اليوم التالي.'),
    label('עברית (Hebrew)'),
    rtl('מוקד התמיכה פתוח בכל ימי העבודה. פניות שמתקבלות אחרי שש בערב נענות בבוקר שלמחרת.'),
    label('فارسی (Persian)'),
    rtl('میز پشتیبانی در همه روزهای کاری باز است. درخواست‌هایی که پس از ساعت شش عصر برسند صبح روز بعد پاسخ داده می‌شوند.'),
    label('中文 (Chinese)'),
    p(run('我们的客服中心在每个工作日开放。晚上六点以后收到的请求将在第二天上午回复。')),
    label('日本語 (Japanese)'),
    p(run('サポート窓口は平日毎日営業しています。午後六時以降に受け付けたお問い合わせには翌朝回答いたします。')),
    label('한국어 (Korean)'),
    p(run('고객 지원 센터는 평일에 운영됩니다. 오후 여섯 시 이후에 접수된 요청은 다음 날 아침에 답변드립니다.')),
    label('Ελληνικά (Greek)'),
    p(run('Το γραφείο υποστήριξης είναι ανοιχτό κάθε εργάσιμη ημέρα. Τα αιτήματα μετά τις έξι το απόγευμα απαντώνται το επόμενο πρωί.')),
    label('Русский (Russian)'),
    p(run('Служба поддержки работает в будние дни. На запросы, полученные после шести вечера, мы отвечаем на следующее утро.')),
    label('Price list (right-to-left table)'),
    rtlTable,
    p(''),
    SECT(),
  ].join('');
  writeFileSync(new URL('international.docx', EX), pack({ body, title: 'Multilingual Service Notice', header: 'Multilingual notice' }));
}

// --- 6. Formatting: styles, lists, notes, links and bookmarks -----------------------------------
{
  const fn = (id) => `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="${id}"/></w:r>`;
  const en = (id) => `<w:r><w:rPr><w:rStyle w:val="EndnoteReference"/></w:rPr><w:endnoteReference w:id="${id}"/></w:r>`;
  const body = [
    p(run('Style and Formatting Sampler'), '<w:pStyle w:val="Title"/>'),
    p(run('A tour of the formatting this editor reads, edits and writes back.'), '<w:pStyle w:val="Subtitle"/><w:jc w:val="left"/>'),
    H('Character formatting'),
    p([run('Regular, '), run('bold', '<w:b/>'), run(', '), run('italic', '<w:i/>'), run(', '), run('underlined', '<w:u w:val="single"/>'), run(', '), run('double underline', '<w:u w:val="double"/>'), run(', '), run('struck', '<w:strike/>'), run(', '), run('small caps', '<w:smallCaps/>'), run(', H'), run('2', '<w:vertAlign w:val="subscript"/>'), run('O and x'), run('2', '<w:vertAlign w:val="superscript"/>'), run('.')].join('')),
    p([run('Colours: '), run('teal', '<w:color w:val="0E7C7B"/>'), run(', '), run('crimson', '<w:color w:val="B4233C"/>'), run(', '), run('highlighted', '<w:highlight w:val="yellow"/>'), run(', '), run('shaded', '<w:shd w:val="clear" w:color="auto" w:fill="E2EFDA"/>'), run('. Fonts: '), run('Georgia', '<w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/>'), run(', '), run('Courier New', '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/>'), run(', '), run('Times New Roman 14', '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="28"/>'), run('.')].join('')),
    H('Paragraphs'),
    p(run('Centred paragraph with extra spacing before and after.'), '<w:jc w:val="center"/><w:spacing w:before="240" w:after="240"/>'),
    p(run('Right-aligned paragraph.'), '<w:jc w:val="right"/>'),
    p(run('Justified paragraph with a first-line indent. The text is long enough to wrap over several lines so the justification and the indent are both visible on the page, as they would be in a printed report.'), '<w:jc w:val="both"/><w:ind w:firstLine="720"/>'),
    p(run('Double-spaced paragraph showing a larger line height across the wrapped lines of text in this sample paragraph.'), '<w:spacing w:line="480" w:lineRule="auto"/>'),
    p(run('A quotation in the Quote style.'), '<w:pStyle w:val="Quote"/>'),
    H('Lists'),
    numbered('Planning'),
    numbered('Collect requirements', 1),
    numbered('Interview stakeholders', 2),
    numbered('Review existing reports', 2),
    numbered('Agree the scope', 1),
    numbered('Delivery'),
    numbered('Build and test', 1),
    bullet('Bulleted item'),
    bullet('Nested bullet', 1),
    bullet('Another bulleted item'),
    H('Notes, links and bookmarks'),
    p(`${run('Footnotes appear at the bottom of the page')}${fn(1)}${run(' and endnotes after the text')}${en(1)}${run('. A second footnote is here')}${fn(2)}${run('.')}`),
    p(`${run('Visit ')}<w:hyperlink r:id="rIdLink" w:history="1">${run('example.com', '<w:rStyle w:val="Hyperlink"/>')}</w:hyperlink>${run(' or jump to the ')}<w:hyperlink w:anchor="closing" w:history="1">${run('closing section', '<w:rStyle w:val="Hyperlink"/>')}</w:hyperlink>${run('.')}`),
    p(`${run('Before a page break.')}<w:r><w:br w:type="page"/></w:r>`),
    p(`<w:bookmarkStart w:id="5" w:name="closing"/>${run('Closing section')}<w:bookmarkEnd w:id="5"/>`, '<w:pStyle w:val="Heading1"/>'),
    p(run('This page starts after a manual page break. Its heading carries the bookmark “closing” that the link above points to.')),
    SECT(),
  ].join('');
  const noteX = (kind, id, text) => `<w:${kind} w:id="${id}"><w:p><w:pPr><w:pStyle w:val="${kind === 'footnote' ? 'FootnoteText' : 'EndnoteText'}"/></w:pPr><w:r><w:rPr><w:rStyle w:val="${kind === 'footnote' ? 'FootnoteReference' : 'EndnoteReference'}"/></w:rPr><w:${kind}Ref/></w:r>${run(` ${text}`)}</w:p></w:${kind}>`;
  const fns = `${DECL}<w:footnotes ${NS}>${separators('footnote')}${noteX('footnote', 1, 'A footnote attached to the first sentence.')}${noteX('footnote', 2, 'Click a note on the page to edit its text.')}</w:footnotes>`;
  const ens = `${DECL}<w:endnotes ${NS}>${separators('endnote')}${noteX('endnote', 1, 'An endnote, listed after the last paragraph.')}</w:endnotes>`;
  writeFileSync(new URL('formatting.docx', EX), pack({ body, footnotes: fns, endnotes: ens, title: 'Style and Formatting Sampler', header: 'Formatting sampler', extraRels: `<Relationship Id="rIdLink" Type="${RT}/hyperlink" Target="https://example.com/" TargetMode="External"/>` }));
}

console.log('examples written to', EX.pathname);
