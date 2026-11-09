/**
 * Canonical namespace prefixes used throughout the editor. Parsed WordprocessingML parts
 * are normalised to these prefixes so code can match on names like `w:p` regardless of the
 * prefixes the producing application chose (including ISO 29500 "strict" namespaces).
 */
export const NS: Record<string, string> = {
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  pic: 'http://schemas.openxmlformats.org/drawingml/2006/picture',
  m: 'http://schemas.openxmlformats.org/officeDocument/2006/math',
  v: 'urn:schemas-microsoft-com:vml',
  o: 'urn:schemas-microsoft-com:office:office',
  w10: 'urn:schemas-microsoft-com:office:word',
  mc: 'http://schemas.openxmlformats.org/markup-compatibility/2006',
  wpc: 'http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas',
  cx: 'http://schemas.microsoft.com/office/drawing/2014/chartex',
  aink: 'http://schemas.microsoft.com/office/drawing/2016/ink',
  am3d: 'http://schemas.microsoft.com/office/drawing/2017/model3d',
  wp14: 'http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing',
  w14: 'http://schemas.microsoft.com/office/word/2010/wordml',
  w15: 'http://schemas.microsoft.com/office/word/2012/wordml',
  w16cex: 'http://schemas.microsoft.com/office/word/2018/wordml/cex',
  w16cid: 'http://schemas.microsoft.com/office/word/2016/wordml/cid',
  w16: 'http://schemas.microsoft.com/office/word/2018/wordml',
  w16du: 'http://schemas.microsoft.com/office/word/2023/wordml/word16du',
  w16sdtdh: 'http://schemas.microsoft.com/office/word/2020/wordml/sdtdatahash',
  w16sdtfl: 'http://schemas.microsoft.com/office/word/2024/wordml/sdtformatlock',
  w16se: 'http://schemas.microsoft.com/office/word/2015/wordml/symex',
  wpg: 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup',
  wpi: 'http://schemas.microsoft.com/office/word/2010/wordprocessingInk',
  wne: 'http://schemas.microsoft.com/office/word/2006/wordml',
  wps: 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape',
  a14: 'http://schemas.microsoft.com/office/drawing/2010/main',
  c: 'http://schemas.openxmlformats.org/drawingml/2006/chart',
  sl: 'http://schemas.openxmlformats.org/schemaLibrary/2006/main',
  xml: 'http://www.w3.org/XML/1998/namespace',
};

/** ISO/IEC 29500 strict namespaces mapped onto their transitional canonical prefix. */
const STRICT_ALIASES: Record<string, string> = {
  'http://purl.oclc.org/ooxml/wordprocessingml/main': 'w',
  'http://purl.oclc.org/ooxml/officeDocument/relationships': 'r',
  'http://purl.oclc.org/ooxml/drawingml/wordprocessingDrawing': 'wp',
  'http://purl.oclc.org/ooxml/drawingml/main': 'a',
  'http://purl.oclc.org/ooxml/drawingml/picture': 'pic',
  'http://purl.oclc.org/ooxml/officeDocument/math': 'm',
  'http://purl.oclc.org/ooxml/drawingml/chart': 'c',
};

const URI_TO_PREFIX = new Map<string, string>();
for (const [prefix, uri] of Object.entries(NS)) URI_TO_PREFIX.set(uri, prefix);
for (const [uri, prefix] of Object.entries(STRICT_ALIASES)) URI_TO_PREFIX.set(uri, prefix);

export function canonicalPrefixFor(uri: string): string | undefined {
  return URI_TO_PREFIX.get(uri);
}

/** Prefixes declared on the root of every WordprocessingML part we write, in Word's order. */
export const WORD_ROOT_PREFIXES = [
  'wpc', 'cx', 'aink', 'am3d', 'mc', 'o', 'r', 'm', 'v', 'wp14', 'wp', 'w10', 'w', 'w14', 'w15',
  'w16cex', 'w16cid', 'w16', 'w16du', 'w16sdtdh', 'w16sdtfl', 'w16se', 'wpg', 'wpi', 'wne', 'wps',
  'a', 'pic', 'a14',
];

/** The value Word writes for mc:Ignorable on document parts. */
export const WORD_IGNORABLE = 'w14 w15 w16se w16cid w16 w16cex w16sdtdh w16sdtfl w16du wp14';
