import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { expect, type Locator, type Page } from '@playwright/test';
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
 * text with Square wrapping (the editor has no wrapping options of its own), or wrapped top and
 * bottom; `position` is its distance from the column's left edge in EMU, or its alignment.
 */
export async function openFloatingPicture(page: Page, wrap: 'square' | 'topAndBottom' = 'square', position: number | 'left' | 'center' | 'right' = 0) {
  await openApp(page);
  const parts = unzipSync(readFileSync(new URL('../../apps/web-shared/public/examples/tables-columns.docx', import.meta.url)));
  const xml = strFromU8(parts['word/document.xml']);
  const floating = xml.replace(/<wp:inline\b[^>]*>([\s\S]*?)<\/wp:inline>/, (_, inline: string) => {
    const half = inline.replace(/cx="(\d+)" cy="(\d+)"/g, (__, cx: string, cy: string) => `cx="${Math.round(+cx / 2)}" cy="${Math.round(+cy / 2)}"`);
    // The wrapping comes after the size in an anchor, the position before it.
    const wrapping = wrap === 'square' ? '<wp:wrapSquare wrapText="bothSides"/>' : '<wp:wrapTopAndBottom/>';
    const wrapped = half.replace(/<wp:extent [^>]*\/>(<wp:effectExtent [^>]*\/>)?/, `$&${wrapping}`);
    const across = typeof position === 'number' ? `<wp:posOffset>${position}</wp:posOffset>` : `<wp:align>${position}</wp:align>`;
    const placed = `<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column">${across}</wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>`;
    return `<wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">${placed}${wrapped}</wp:anchor>`;
  });
  if (floating === xml) throw new Error('no inline picture in the example');
  parts['word/document.xml'] = strToU8(floating);
  await page.evaluate(async (bytes) => {
    type Api = { replaceFile(src: Uint8Array, name?: string): Promise<unknown> };
    await (window as unknown as { marginline: Api }).marginline.replaceFile(new Uint8Array(bytes), 'floating-picture.docx');
  }, Array.from(zipSync(parts)));
  await expect.poll(() => fileName(page)).toBe('floating-picture.docx');
}

/** Open a test document from packages/core/tests/fixtures. */
export async function openFixture(page: Page, name: string) {
  await openApp(page);
  await loadFixture(page, name);
}

/** Load a test document from packages/core/tests/fixtures into the open editor. */
export async function loadFixture(page: Page, name: string) {
  const bytes = readFileSync(new URL(`../../packages/core/tests/fixtures/${name}`, import.meta.url));
  await page.evaluate(async ([data, file]) => {
    type Api = { replaceFile(src: Uint8Array, name?: string): Promise<unknown> };
    await (window as unknown as { marginline: Api }).marginline.replaceFile(new Uint8Array(data), file);
  }, [Array.from(bytes), name] as const);
  await expect.poll(() => fileName(page)).toBe(name);
}

/**
 * Open the drawings test document: a group of a picture, a text box and a line, a rectangle
 * outlined by its shape style, shapes in the line and a drawing canvas.
 */
export function openDrawings(page: Page) {
  return openFixture(page, 'drawings.docx');
}

/** The streams of a PDF made by the app, inflated and joined: page contents, fonts and pictures. */
export function pdfStreams(bytes: Buffer): string {
  const out: string[] = [];
  for (const m of bytes.toString('latin1').matchAll(/\/Filter \/FlateDecode \/Length (\d+) >>\nstream\n/g)) {
    const start = m.index + m[0].length;
    out.push(inflateSync(bytes.subarray(start, start + Number(m[1]))).toString('latin1'));
  }
  return out.join('\n');
}

const clocks = new WeakSet<Page>();

/**
 * Print with Ctrl+P and count the pages Chrome makes. The editor lays out its print pages, calls
 * window.print a moment later and removes the pages a second after that: the page's clock is
 * held while the PDF is made.
 */
export async function printedPages(page: Page): Promise<number> {
  await page.evaluate(() => {
    const w = window as unknown as { print(): void; e2ePrints: number };
    w.e2ePrints = 0;
    w.print = () => {
      w.e2ePrints += 1;
    };
  });
  await body(page).focus();
  if (!clocks.has(page)) {
    await page.clock.install();
    clocks.add(page);
  }
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await page.keyboard.press('ControlOrMeta+P');
  await page.clock.runFor(200);
  expect(await page.evaluate(() => (window as unknown as { e2ePrints: number }).e2ePrints)).toBe(1);
  await expect(page.locator('.ml-dx-print-host')).toHaveCount(1);
  const pdf = await page.pdf({ preferCSSPageSize: true });
  await page.clock.runFor(1000);
  await expect(page.locator('.ml-dx-print-host')).toHaveCount(0);
  await page.clock.resume();
  return pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)?.length ?? 0;
}

/** A picture's distances from its paragraph's left and right content edges, in pixels at 100% zoom. */
export async function picturePlace(page: Page, picture: Locator): Promise<{ left: number; right: number }> {
  const zoom = await editorValue(page, (e) => e.zoom);
  return picture.evaluate((img, z) => {
    const para = img.closest('.ml-dx-image-wrap')!.parentElement!.closest('.ml-dx-p')!;
    const s = getComputedStyle(para);
    const p = para.getBoundingClientRect();
    const r = img.getBoundingClientRect();
    return {
      left: (r.left - p.left) / z - parseFloat(s.paddingLeft) - parseFloat(s.borderLeftWidth),
      right: (p.right - r.right) / z - parseFloat(s.paddingRight) - parseFloat(s.borderRightWidth),
    };
  }, zoom);
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
