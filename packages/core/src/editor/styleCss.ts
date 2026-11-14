import type { DocxDocument } from '../core/document';
import {
  alignCss,
  bordersCss,
  cssIdent,
  fontStack,
  indentCss,
  lineHeightFactor,
  runFontName,
  runPropsCss,
  shadingCss,
  spacingCss,
} from '../core/model/css';
import type { ParaProps, RunProps } from '../core/model/types';

function paraCss(pPr: ParaProps): string[] {
  const css = [...indentCss(pPr.indent), ...spacingCss(pPr.spacing), ...bordersCss(pPr.borders)];
  const align = alignCss(pPr.align);
  if (align) css.push(`text-align: ${align}`);
  css.push(...shadingCss(pPr.shading));
  return css;
}

function rule(selector: string, decls: string[]): string {
  return decls.length ? `${selector} { ${decls.join('; ')}; }\n` : '';
}

/**
 * CSS for a document's styles, scoped under `scope` (a class on the editor root). Paragraph
 * styles become `.ps-<id>` classes and character styles `.cs-<id>`; direct formatting is
 * applied inline and therefore wins.
 */
export function buildDocumentCss(docx: DocxDocument, scope: string): string {
  const { styles, theme } = docx;
  const themeFonts = { major: theme.major, minor: theme.minor };
  const defaults = styles.docDefaults;
  const baseRun: RunProps = { size: 20, fonts: { ascii: 'Times New Roman' }, ...defaults.rPr };
  if (!defaults.rPr.fonts) baseRun.fonts = { ascii: 'Times New Roman' };
  const baseFont = runFontName(baseRun, themeFonts) ?? 'Times New Roman';
  let css = '';
  css += rule(`${scope} .ml-dx-doc, ${scope}.ml-dx-hf-static`, [
    `font-family: ${fontStack(baseFont)}`,
    `font-size: ${(baseRun.size ?? 20) / 2}pt`,
    `--ml-dx-lhf: ${lineHeightFactor(baseFont)}`,
    `color: #000`,
    // The same defaults again, for text boxes in drawings, which sit inside a paragraph's run
    // and must not take its formatting.
    `--ml-dx-doc-font: ${fontStack(baseFont)}`,
    `--ml-dx-doc-size: ${(baseRun.size ?? 20) / 2}pt`,
    `--ml-dx-doc-lhf: ${lineHeightFactor(baseFont)}`,
  ]);
  css += rule(`${scope} .ml-dx-p`, paraCss(defaults.pPr));

  const defaultPara = styles.defaultStyleId('paragraph');
  for (const s of styles.styles.values()) {
    if (s.type === 'paragraph') {
      const resolved = styles.resolveParagraphStyle(s.id);
      const decls = [...paraCss(resolved.pPr), ...runPropsCss(resolved.rPr, themeFonts)];
      const selectors = [`${scope} .ps-${cssIdent(s.id)}`];
      if (s.id === defaultPara) selectors.push(`${scope} .ps-default`);
      css += rule(selectors.join(', '), decls);
    } else if (s.type === 'character') {
      css += rule(`${scope} .cs-${cssIdent(s.id)}`, runPropsCss(styles.resolveCharacterStyle(s.id), themeFonts));
    }
  }
  return css;
}

/** Theme-aware font name for a run (used by toolbar state). */
export function displayFontName(docx: DocxDocument, props: RunProps): string | undefined {
  return runFontName(props, { major: docx.theme.major, minor: docx.theme.minor });
}
