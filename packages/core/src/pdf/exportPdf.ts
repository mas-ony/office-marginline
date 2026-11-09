import type { DocxEditor } from '../editor/DocxEditor';
import { collect } from './collect';
import { writePdf } from './writer';

/** Create a PDF of the document as laid out in the editor (pages, fonts, pictures, links). */
export async function exportPdf(editor: DocxEditor): Promise<Uint8Array> {
  if (typeof document !== 'undefined' && document.fonts?.ready) await document.fonts.ready;
  const { canvas, pages, cleanup } = editor.renderForExport();
  try {
    const { pages: pdfPages } = await collect(canvas, pages);
    return writePdf(pdfPages, { title: editor.fileName.replace(/\.docx$/i, ''), author: editor.author });
  } finally {
    cleanup();
  }
}
