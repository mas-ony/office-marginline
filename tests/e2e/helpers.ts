import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

type Ed = {
  fileName: string;
  view: { state: { doc: { textContent: string }; selection: { from: number } } };
  focus(): void;
  pageCount: number;
  zoom: number;
  viewMode: string;
  editMode: string;
  headerFooterOptions(pageIndex?: number): { headerDistance: number; footerDistance: number; differentFirstPage: boolean; differentOddEven: boolean };
  headerFooterLinked(kind: 'header' | 'footer', pageIndex?: number): boolean | null;
};

const ed = (page: Page) => page.evaluateHandle(() => (window as unknown as { docxEditor: Ed }).docxEditor);

/** Open the app with an example document (or a blank one) and wait until it is shown. */
export async function openApp(page: Page, example?: string) {
  await page.addInitScript(() => {
    try {
      indexedDB.deleteDatabase('marginline');
      localStorage.clear();
      localStorage.setItem('marginline-user', JSON.stringify({ name: 'Test Reviewer', email: '' }));
    } catch {
      // Storage may be unavailable.
    }
  });
  page.on('dialog', (d) => void d.accept());
  await page.goto(example ? `/?example=${example}` : '/?new=1');
  await expect(body(page)).toBeVisible();
  // The page API is installed once the editor is ready (after the example has opened).
  await page.waitForFunction(() => !!(window as unknown as { docxEditor?: Ed }).docxEditor);
  if (example) await expect.poll(() => fileName(page)).not.toBe('Untitled.docx');
  await page.waitForTimeout(300);
}

/**
 * Open the Tables & columns example with its picture at half size, floating at the left of the
 * text with Square wrapping (the editor has no wrapping options of its own).
 */
export async function openFloatingPicture(page: Page) {
  await openApp(page);
  const parts = unzipSync(readFileSync(new URL('../../apps/web-shared/public/examples/tables-columns.docx', import.meta.url)));
  const xml = strFromU8(parts['word/document.xml']);
  const floating = xml.replace(/<wp:inline\b[^>]*>([\s\S]*?)<\/wp:inline>/, (_, inline: string) => {
    const half = inline.replace(/cx="(\d+)" cy="(\d+)"/g, (__, cx: string, cy: string) => `cx="${Math.round(+cx / 2)}" cy="${Math.round(+cy / 2)}"`);
    // The wrapping comes after the size in an anchor, the position before it.
    const wrapped = half.replace(/<wp:extent [^>]*\/>(<wp:effectExtent [^>]*\/>)?/, '$&<wp:wrapSquare wrapText="bothSides"/>');
    const position = '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>';
    return `<wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">${position}${wrapped}</wp:anchor>`;
  });
  if (floating === xml) throw new Error('no inline picture in the example');
  parts['word/document.xml'] = strToU8(floating);
  await page.evaluate(async (bytes) => {
    type Api = { replaceFile(src: Uint8Array, name?: string): Promise<unknown> };
    await (window as unknown as { marginline: Api }).marginline.replaceFile(new Uint8Array(bytes), 'floating-picture.docx');
  }, Array.from(zipSync(parts)));
  await expect.poll(() => fileName(page)).toBe('floating-picture.docx');
}

/** The body editor (header and footer views also use the ml-dx-doc class). */
export function body(page: Page) {
  return page.locator('.ml-dx-body-host > .ml-dx-doc');
}

/** The document's file name ('' until the app is ready and has put the editor on the page). */
export function fileName(page: Page): Promise<string> {
  return page.evaluate(() => (window as unknown as { docxEditor?: Ed }).docxEditor?.fileName ?? '');
}

/** Text of the document body ('' until the app is ready). */
export function docText(page: Page): Promise<string> {
  return page.evaluate(() => (window as unknown as { docxEditor?: Ed }).docxEditor?.view.state.doc.textContent ?? '');
}

export async function editorValue<T>(page: Page, fn: (e: Ed) => T): Promise<T> {
  const h = await ed(page);
  return h.evaluate(fn as never) as Promise<T>;
}

/** Centre of the first occurrence of `word` in the body, in page coordinates. */
export async function wordPoint(page: Page, word: string): Promise<{ x: number; y: number }> {
  const p = await page.evaluate((w) => {
    const root = document.querySelector('.ml-dx-body-host > .ml-dx-doc')!;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = (n.textContent ?? '').indexOf(w);
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + w.length);
      // Scroll the document so the word itself is in the middle of the view.
      const scroller = document.querySelector('.ml-dx-scroll')!;
      const s = scroller.getBoundingClientRect();
      const b = r.getBoundingClientRect();
      scroller.scrollTop += b.top - (s.top + s.height / 2);
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }
    return null;
  }, word);
  if (!p) throw new Error(`word not found: ${word}`);
  await page.waitForTimeout(100);
  // Measure again after scrolling.
  return page.evaluate((w) => {
    const root = document.querySelector('.ml-dx-body-host > .ml-dx-doc')!;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = (n.textContent ?? '').indexOf(w);
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + w.length);
      const b = r.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }
    return { x: 0, y: 0 };
  }, word);
}

/** Select a word by double-clicking it. */
export async function selectWord(page: Page, word: string) {
  const p = await wordPoint(page, word);
  await page.mouse.dblclick(p.x, p.y);
}

/** Put the caret right after the first occurrence of `text` in the body and focus it. */
export async function caretAfter(page: Page, text: string) {
  await wordPoint(page, text);
  const ok = await page.evaluate((t) => {
    type Sel = { create(doc: unknown, pos: number): unknown };
    const ed = (window as unknown as { docxEditor: { view: { state: { doc: { descendants(fn: (n: { isText: boolean; text?: string }, pos: number) => boolean): void }; selection: { constructor: Sel }; tr: { setSelection(s: unknown): unknown } }; dispatch(tr: unknown): void; focus(): void } } }).docxEditor;
    let at = -1;
    ed.view.state.doc.descendants((n, pos) => {
      if (at >= 0) return false;
      if (!n.isText) return true;
      const i = n.text!.indexOf(t);
      if (i >= 0) at = pos + i + t.length;
      return false;
    });
    if (at < 0) return false;
    const sel = (ed.view.state.selection.constructor as Sel).create(ed.view.state.doc, at);
    ed.view.dispatch(ed.view.state.tr.setSelection(sel));
    ed.view.focus();
    return true;
  }, text);
  if (!ok) throw new Error(`text not found: ${text}`);
}

/** Run an action that downloads a file; returns the file name and bytes. */
export async function downloadOf(page: Page, action: () => Promise<unknown>): Promise<{ name: string; bytes: Buffer }> {
  const [download] = await Promise.all([page.waitForEvent('download'), action()]);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return { name: download.suggestedFilename(), bytes: Buffer.concat(chunks) };
}

/** Double-click the header of page `index` (from 0) to edit it, and wait for its bar. */
export async function editHeader(page: Page, index: number) {
  const header = page.locator('.ml-dx-page').nth(index).locator('.ml-dx-header');
  await header.scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  const box = (await header.boundingBox())!;
  // An empty header has no height; just above it is still the top margin.
  await page.mouse.dblclick(box.x + 20, box.height ? box.y + box.height / 2 : box.y - 4);
  await expect(page.locator('.ml-dx-hf-active .ml-dx-hf-bar')).toBeVisible();
}
