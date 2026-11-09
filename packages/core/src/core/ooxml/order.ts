import type { XmlElement, XmlNode } from '../xml/xml';

/**
 * Child element order for WordprocessingML property containers (ECMA-376 Part 1, transitional
 * schema). Word rejects files whose property children are out of order, so every container we
 * write is sorted with these tables. Unknown children keep their relative order at the end.
 */
export const ORDER: Record<string, string[]> = {
  'w:pPr': [
    'w:pStyle', 'w:keepNext', 'w:keepLines', 'w:pageBreakBefore', 'w:framePr', 'w:widowControl',
    'w:numPr', 'w:suppressLineNumbers', 'w:pBdr', 'w:shd', 'w:tabs', 'w:suppressAutoHyphens',
    'w:kinsoku', 'w:wordWrap', 'w:overflowPunct', 'w:topLinePunct', 'w:autoSpaceDE', 'w:autoSpaceDN',
    'w:bidi', 'w:adjustRightInd', 'w:snapToGrid', 'w:spacing', 'w:ind', 'w:contextualSpacing',
    'w:mirrorIndents', 'w:suppressOverlap', 'w:jc', 'w:textDirection', 'w:textAlignment',
    'w:textboxTightWrap', 'w:outlineLvl', 'w:divId', 'w:cnfStyle', 'w:rPr', 'w:sectPr', 'w:pPrChange',
  ],
  'w:rPr': [
    'w:ins', 'w:del', 'w:moveFrom', 'w:moveTo',
    'w:rStyle', 'w:rFonts', 'w:b', 'w:bCs', 'w:i', 'w:iCs', 'w:caps', 'w:smallCaps', 'w:strike',
    'w:dstrike', 'w:outline', 'w:shadow', 'w:emboss', 'w:imprint', 'w:noProof', 'w:snapToGrid',
    'w:vanish', 'w:webHidden', 'w:color', 'w:spacing', 'w:w', 'w:kern', 'w:position', 'w:sz',
    'w:szCs', 'w:highlight', 'w:u', 'w:effect', 'w:bdr', 'w:shd', 'w:fitText', 'w:vertAlign',
    'w:rtl', 'w:cs', 'w:em', 'w:lang', 'w:eastAsianLayout', 'w:specVanish', 'w:oMath',
    'w14:glow', 'w14:shadow', 'w14:reflection', 'w14:textOutline', 'w14:textFill', 'w14:scene3d',
    'w14:props3d', 'w14:ligatures', 'w14:numForm', 'w14:numSpacing', 'w14:stylisticSets',
    'w14:cntxtAlts', 'w:rPrChange',
  ],
  'w:sectPr': [
    'w:headerReference', 'w:footerReference', 'w:footnotePr', 'w:endnotePr', 'w:type', 'w:pgSz',
    'w:pgMar', 'w:paperSrc', 'w:pgBorders', 'w:lnNumType', 'w:pgNumType', 'w:cols', 'w:formProt',
    'w:vAlign', 'w:noEndnote', 'w:titlePg', 'w:textDirection', 'w:bidi', 'w:rtlGutter', 'w:docGrid',
    'w:printerSettings', 'w:sectPrChange',
  ],
  'w:tblPr': [
    'w:tblStyle', 'w:tblpPr', 'w:tblOverlap', 'w:bidiVisual', 'w:tblStyleRowBandSize',
    'w:tblStyleColBandSize', 'w:tblW', 'w:jc', 'w:tblCellSpacing', 'w:tblInd', 'w:tblBorders',
    'w:shd', 'w:tblLayout', 'w:tblCellMar', 'w:tblLook', 'w:tblCaption', 'w:tblDescription',
    'w:tblPrChange',
  ],
  'w:trPr': [
    'w:cnfStyle', 'w:divId', 'w:gridBefore', 'w:gridAfter', 'w:wBefore', 'w:wAfter', 'w:cantSplit',
    'w:trHeight', 'w:tblHeader', 'w:tblCellSpacing', 'w:jc', 'w:hidden', 'w:ins', 'w:del',
    'w:trPrChange',
  ],
  'w:tcPr': [
    'w:cnfStyle', 'w:tcW', 'w:gridSpan', 'w:hMerge', 'w:vMerge', 'w:tcBorders', 'w:shd', 'w:noWrap',
    'w:tcMar', 'w:textDirection', 'w:tcFitText', 'w:vAlign', 'w:hideMark', 'w:headers', 'w:cellIns',
    'w:cellDel', 'w:cellMerge', 'w:tcPrChange',
  ],
  'w:pBdr': ['w:top', 'w:left', 'w:bottom', 'w:right', 'w:between', 'w:bar'],
  'w:tblBorders': ['w:top', 'w:left', 'w:start', 'w:bottom', 'w:right', 'w:end', 'w:insideH', 'w:insideV'],
  'w:tcBorders': ['w:top', 'w:left', 'w:start', 'w:bottom', 'w:right', 'w:end', 'w:insideH', 'w:insideV', 'w:tl2br', 'w:tr2bl'],
  'w:tblCellMar': ['w:top', 'w:left', 'w:start', 'w:bottom', 'w:right', 'w:end'],
  'w:tcMar': ['w:top', 'w:left', 'w:start', 'w:bottom', 'w:right', 'w:end'],
  'w:style': [
    'w:name', 'w:aliases', 'w:basedOn', 'w:next', 'w:link', 'w:autoRedefine', 'w:hidden',
    'w:uiPriority', 'w:semiHidden', 'w:unhideWhenUsed', 'w:qFormat', 'w:locked', 'w:personal',
    'w:personalCompose', 'w:personalReply', 'w:rsid', 'w:pPr', 'w:rPr', 'w:tblPr', 'w:trPr', 'w:tcPr',
    'w:tblStylePr',
  ],
  'w:lvl': [
    'w:start', 'w:numFmt', 'w:lvlRestart', 'w:pStyle', 'w:isLgl', 'w:suff', 'w:lvlText',
    'w:lvlPicBulletId', 'w:legacy', 'w:lvlJc', 'w:pPr', 'w:rPr',
  ],
  'w:abstractNum': ['w:nsid', 'w:multiLevelType', 'w:tmpl', 'w:name', 'w:styleLink', 'w:numStyleLink', 'w:lvl'],
  'w:num': ['w:abstractNumId', 'w:lvlOverride'],
  'w:numbering': ['w:numPicBullet', 'w:abstractNum', 'w:num', 'w:numIdMacAtCleanup'],
  'w:settings': [
    'w:writeProtection', 'w:view', 'w:zoom', 'w:removePersonalInformation', 'w:removeDateAndTime',
    'w:doNotDisplayPageBoundaries', 'w:displayBackgroundShape', 'w:printPostScriptOverText',
    'w:printFractionalCharacterWidth', 'w:printFormsData', 'w:embedTrueTypeFonts',
    'w:embedSystemFonts', 'w:saveSubsetFonts', 'w:saveFormsData', 'w:mirrorMargins',
    'w:alignBordersAndEdges', 'w:bordersDoNotSurroundHeader', 'w:bordersDoNotSurroundFooter',
    'w:gutterAtTop', 'w:hideSpellingErrors', 'w:hideGrammaticalErrors', 'w:activeWritingStyle',
    'w:proofState', 'w:formsDesign', 'w:attachedTemplate', 'w:linkStyles', 'w:stylePaneFormatFilter',
    'w:stylePaneSortMethod', 'w:documentType', 'w:mailMerge', 'w:revisionView', 'w:trackRevisions',
    'w:doNotTrackMoves', 'w:doNotTrackFormatting', 'w:documentProtection', 'w:autoFormatOverride',
    'w:styleLockTheme', 'w:styleLockQFSet', 'w:defaultTabStop', 'w:autoHyphenation',
    'w:consecutiveHyphenLimit', 'w:hyphenationZone', 'w:doNotHyphenateCaps', 'w:showEnvelope',
    'w:summaryLength', 'w:clickAndTypeStyle', 'w:defaultTableStyle', 'w:evenAndOddHeaders',
    'w:bookFoldRevPrinting', 'w:bookFoldPrinting', 'w:bookFoldPrintingSheets',
    'w:drawingGridHorizontalSpacing', 'w:drawingGridVerticalSpacing',
    'w:displayHorizontalDrawingGridEvery', 'w:displayVerticalDrawingGridEvery',
    'w:doNotUseMarginsForDrawingGridOrigin', 'w:drawingGridHorizontalOrigin',
    'w:drawingGridVerticalOrigin', 'w:doNotShadeFormData', 'w:noPunctuationKerning',
    'w:characterSpacingControl', 'w:printTwoOnOne', 'w:strictFirstAndLastChars',
    'w:noLineBreaksAfter', 'w:noLineBreaksBefore', 'w:savePreviewPicture',
    'w:doNotValidateAgainstSchema', 'w:saveInvalidXml', 'w:ignoreMixedContent',
    'w:alwaysShowPlaceholderText', 'w:doNotDemarcateInvalidXml', 'w:saveXmlDataOnly',
    'w:useXSLTWhenSaving', 'w:saveThroughXslt', 'w:showXMLTags', 'w:alwaysMergeEmptyNamespace',
    'w:updateFields', 'w:hdrShapeDefaults', 'w:footnotePr', 'w:endnotePr', 'w:compat', 'w:docVars',
    'w:rsids', 'm:mathPr', 'w:attachedSchema', 'w:themeFontLang', 'w:clrSchemeMapping',
    'w:doNotIncludeSubdocsInStats', 'w:doNotAutoCompressPictures', 'w:forceUpgrade', 'w:captions',
    'w:readModeInkLockDown', 'w:smartTagType', 'sl:schemaLibrary', 'w:shapeDefaults',
    'w:doNotEmbedSmartTags', 'w:decimalSymbol', 'w:listSeparator',
  ],
};

/** Sort the element children of a property container in schema order (in place). */
export function sortChildren(e: XmlElement): XmlElement {
  const order = ORDER[e.name];
  if (!order) return e;
  const rank = (n: XmlNode, idx: number) => {
    if (n.type !== 'element') return order.length + idx / 1e6;
    const r = order.indexOf(n.name);
    return (r === -1 ? order.length : r) + idx / 1e6;
  };
  const ranked = e.children.map((c, idx) => ({ c, r: rank(c, idx) }));
  ranked.sort((a, b) => a.r - b.r);
  e.children = ranked.map((x) => x.c);
  return e;
}
