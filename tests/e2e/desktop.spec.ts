import { expect, test } from '@playwright/test';
import { body, caretAfter, docText, downloadOf, editHeader, editorValue, fileName, openApp, openFloatingPicture, selectWord, wordPoint } from './helpers';

test.describe('desktop', () => {
  test('types and formats text from the toolbar', async ({ page }) => {
    await openApp(page);
    await body(page).click();
    await page.keyboard.type('Quarterly planning notes');
    await expect.poll(() => docText(page)).toBe('Quarterly planning notes');
    await selectWord(page, 'planning');
    await page.getByTestId('tb-bold').click();
    await expect(page.getByTestId('tb-bold')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('tb-size').fill('18');
    await page.getByTestId('tb-size').press('Enter');
    await expect(body(page).locator('strong, b, [style*="font-weight"]').first()).toBeVisible();
    await selectWord(page, 'notes');
    await page.getByTestId('tb-color').click();
    await page.getByRole('menuitem', { name: 'dark red', exact: true }).click();
    const color = await page.evaluate(() => {
      const r = document.createRange();
      const walker = document.createTreeWalker(document.querySelector('.ml-dx-body-host > .ml-dx-doc')!, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.textContent === 'notes') return getComputedStyle(n.parentElement!).color;
      void r;
      return '';
    });
    expect(color).not.toBe('rgb(0, 0, 0)');
    await expect(page.getByTestId('tb-undo')).toBeEnabled();
    await page.getByTestId('tb-undo').click();
    await expect(page.getByTestId('tb-redo')).toBeEnabled();
  });

  test('ruler drag changes the left margin', async ({ page }) => {
    await openApp(page, 'formatting');
    await page.getByTestId('tb-ruler').click();
    await caretAfter(page, 'Regular, ');
    const handle = page.getByRole('slider', { name: 'Left margin' });
    const box = (await handle.boundingBox())!;
    // Drag the grey margin area half an inch to the right.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 48, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    const left = await page.evaluate(() => (window as unknown as { docxEditor: { view: { state: { doc: { attrs: { finalSection: { margins: { left: number } } } } } } } }).docxEditor.view.state.doc.attrs.finalSection.margins.left);
    expect(left).toBeGreaterThan(1440 + 400);
  });

  test('two people edit the same document in real time', async ({ browser, page }) => {
    await openApp(page, 'agreement');
    await page.getByTestId('share').click();
    await page.getByTestId('share-start').click();
    const link = await page.getByTestId('share-link').inputValue();
    expect(link).toMatch(/\?room=[0-9a-f]{8}$/);
    await page.keyboard.press('Escape');
    const other = await browser.newPage();
    const room = new URL(link).search;
    await other.goto(`/${room}`);
    await expect.poll(() => fileName(other)).toBe('agreement.docx');
    await expect(page.getByTestId('participants').locator('.ml-avatar')).toHaveCount(2);
    await caretAfter(page, '1. Purpose');
    await page.keyboard.type(' (shared)');
    await expect.poll(() => docText(other)).toContain('1. Purpose (shared)');
    await caretAfter(other, '2. Scope of work');
    await other.keyboard.type(' (both)');
    await expect.poll(() => docText(page)).toContain('2. Scope of work (both)');
    await other.close();
  });

  test('header Options insert page X of Y and set the distance and a different first page', async ({ page }) => {
    await openApp(page, 'agreement');
    const n = await editorValue(page, (e) => e.pageCount);
    expect(n).toBeGreaterThan(1);
    const pages = page.locator('.ml-dx-page');
    const bar = page.locator('.ml-dx-hf-active .ml-dx-hf-bar');
    const options = bar.getByRole('button', { name: 'Options' });
    const menu = page.getByTestId('hf-options');
    await editHeader(page, 0);
    await page.keyboard.press('End');
    await page.keyboard.type(' ');
    await options.click();
    await expect(options).toHaveAttribute('aria-expanded', 'true');
    // Its button closes it again.
    await options.click();
    await expect(menu).toHaveCount(0);
    await expect(options).toHaveAttribute('aria-expanded', 'false');
    await options.click();
    await menu.getByTestId('hf-page-x-of-y').click();
    await expect(menu).toHaveCount(0);
    await bar.getByRole('button', { name: 'Close header and footer' }).click();
    // The shared header numbers each page.
    for (const i of [0, 1]) await expect(pages.nth(i).locator('.ml-dx-header')).toContainText(`Marginline example Page ${i + 1} of ${n}`);

    // Escape drops a distance typed in the menu; Enter applies it.
    const distance = () => editorValue(page, (e) => e.headerFooterOptions(0).headerDistance);
    const before = await distance();
    await editHeader(page, 0);
    await options.click();
    await menu.getByTestId('hf-header-distance').fill('0.9');
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(bar).toBeVisible();
    expect(await distance()).toBe(before);
    // The cursor is back in the header.
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('.ml-dx-hf-active'))).toBe(true);
    await options.click();
    await menu.getByTestId('hf-header-distance').fill('0.3');
    await page.keyboard.press('Enter');
    await expect.poll(distance).toBe(432);

    // A different first page leaves page 1 without the header the other pages share.
    await editHeader(page, 1);
    await options.click();
    await expect(menu.getByTestId('hf-different-first')).toHaveAttribute('aria-checked', 'false');
    await menu.getByTestId('hf-different-first').click();
    await expect.poll(() => editorValue(page, (e) => e.headerFooterOptions(0).differentFirstPage)).toBe(true);
    await expect(pages.nth(0).locator('.ml-dx-header')).not.toContainText('Marginline example');
    await expect(pages.nth(1).locator('.ml-dx-header')).toContainText(`Page 2 of ${n}`);
    await editHeader(page, 1);
    await options.click();
    await expect(menu.getByTestId('hf-different-first')).toHaveAttribute('aria-checked', 'true');
  });

  test('header Options link a section to the previous one and unlink it', async ({ page }) => {
    await openApp(page, 'tables');
    const pages = page.locator('.ml-dx-page');
    const bar = page.locator('.ml-dx-hf-active .ml-dx-hf-bar');
    const close = bar.getByRole('button', { name: 'Close header and footer' });
    const link = page.getByTestId('hf-options').getByTestId('hf-link');
    const linked = () => editorValue(page, (e) => e.headerFooterLinked('header', 2));
    // The last section (from page 3) has its own header; the first one has none yet.
    expect(await editorValue(page, (e) => e.headerFooterLinked('header', 0))).toBeNull();
    expect(await linked()).toBe(false);
    await editHeader(page, 0);
    await page.keyboard.type('Lease file');
    await close.click();

    await editHeader(page, 2);
    await bar.getByRole('button', { name: 'Options' }).click();
    await expect(link).toHaveText('Link to previous');
    await link.click();
    await expect.poll(linked).toBe(true);
    await expect(pages.nth(2).locator('.ml-dx-header')).toHaveText('Lease file');

    // Unlinking gives the section a copy, which then changes on its own.
    await editHeader(page, 2);
    await bar.getByRole('button', { name: 'Options' }).click();
    await expect(link).toContainText('Unlink from previous');
    await expect(link).toContainText('Same as previous');
    await link.click();
    await expect.poll(linked).toBe(false);
    await editHeader(page, 2);
    await page.keyboard.press('End');
    await page.keyboard.type(' (copy)');
    await close.click();
    await expect(pages.nth(2).locator('.ml-dx-header')).toHaveText('Lease file (copy)');
    await expect(pages.nth(0).locator('.ml-dx-header')).toHaveText('Lease file');
  });

  test('a square-wrapped picture takes a click over the paragraph that wraps around it', async ({ page }) => {
    await openFloatingPicture(page);
    const picture = page.locator('img.ml-dx-image[alt^="Site plan"]');
    const selected = page.locator('.ml-dx-image-wrap.ProseMirror-selectednode img[alt^="Site plan"]');
    await picture.scrollIntoViewIfNeeded();
    await picture.click();
    await expect(selected).toHaveCount(1);
    const word = await wordPoint(page, 'Lease');
    await page.mouse.click(word.x, word.y);
    await expect(selected).toHaveCount(0);
    await picture.click();
    await expect(selected).toHaveCount(1);
  });

  test('adds a comment from the selection bubble, replies and resolves it', async ({ page }) => {
    await openApp(page, 'agreement');
    await expect(page.getByTestId('review-count')).toHaveText('3 changes · 2 comments');
    await selectWord(page, 'forecasting');
    await page.getByTestId('comment-bubble').click();
    await page.getByTestId('composer-input').fill('Should this say “planning”?');
    await page.getByTestId('composer-input-submit').click();
    await expect(page.getByTestId('review-count')).toHaveText('3 changes · 3 comments');
    const card = page.getByTestId('comment-card').filter({ hasText: 'Should this say' });
    await expect(card).toContainText('Test Reviewer');
    await card.click();
    await card.getByTestId('reply-input').click();
    await card.getByTestId('reply-input').fill('Yes, @Maya Okafor agreed.');
    await card.getByTestId('reply-input-submit').click();
    await expect(card).toContainText('Yes, @Maya Okafor agreed.');
    await card.getByTestId('comment-resolve').first().click();
    await expect(page.getByTestId('review-count')).toHaveText('3 changes · 2 comments');
    await page.getByLabel('Resolved').check();
    await expect(page.getByTestId('comment-card').filter({ hasText: 'Should this say' })).toContainText('Resolved');
  });

  test('records edits as suggestions and accepts or rejects them', async ({ page }) => {
    await openApp(page, 'agreement');
    await page.getByTestId('tb-mode').click();
    await page.getByTestId('mode-suggesting').click();
    await caretAfter(page, 'Monthly accuracy reports and model retraining.');
    await page.keyboard.type(' Quarterly reviews.');
    const added = page.getByTestId('change-card').filter({ hasText: 'Quarterly reviews.' });
    await expect(added).toContainText('Added');
    await expect(page.getByTestId('review-count')).toHaveText('4 changes · 2 comments');
    await added.click();
    await added.getByTestId('change-accept').click();
    await expect(page.getByTestId('review-count')).toHaveText('3 changes · 2 comments');
    expect(await docText(page)).toContain('retraining. Quarterly reviews.');
    await page.getByTestId('reject-all').click();
    await expect(page.getByTestId('review-count')).toHaveText('0 changes · 2 comments');
    expect(await docText(page)).toContain('due within 45 days');
  });

  test('viewing mode is read-only and switches between original, markup and final', async ({ page }) => {
    await openApp(page, 'agreement');
    await page.getByTestId('tb-mode').click();
    await page.getByTestId('mode-viewing').click();
    await expect(page.locator('.ml-dx-root')).toHaveClass(/ml-dx-final/);
    await expect(page.getByTestId('tb-bold')).toBeDisabled();
    const before = await docText(page);
    await body(page).click();
    await page.keyboard.type('zzz');
    expect(await docText(page)).toBe(before);
    await page.getByTestId('view-original').click();
    await expect(page.locator('.ml-dx-root')).toHaveClass(/ml-dx-original/);
    await expect(page.locator('.ml-dx-body-host .ml-dx-ins').first()).toBeHidden();
    await page.getByTestId('view-markup').click();
    await expect(page.locator('.ml-dx-root')).not.toHaveClass(/ml-dx-original|ml-dx-final/);
  });

  test('finds with regular expressions and replaces all matches', async ({ page }) => {
    await openApp(page, 'agreement');
    await body(page).click();
    await page.keyboard.press('Control+f');
    await expect(page.getByTestId('find-bar')).toBeVisible();
    await page.getByTestId('find-input').fill('Week \\d+');
    await expect(page.getByTestId('find-count')).toHaveText('No results');
    await page.getByTestId('find-regex').click();
    await expect(page.getByTestId('find-count')).toHaveText('1 of 2');
    await page.getByTestId('find-next').click();
    await expect(page.getByTestId('find-count')).toHaveText('2 of 2');
    await page.getByTestId('find-toggle-replace').click();
    await page.getByTestId('replace-input').fill('Sprint');
    await page.getByTestId('replace-all').click();
    await expect.poll(() => docText(page)).not.toContain('Week 1');
    expect(await docText(page)).toContain('Sprint');
  });

  test('fills template fields from the Fields panel', async ({ page }) => {
    await openApp(page, 'template');
    await page.getByTestId('tab-fields').click();
    const row = page.locator('[data-testid="field-row"][data-field="client_name"]');
    await expect(page.getByTestId('field-row')).toHaveCount(9);
    const value = row.getByTestId('field-value');
    await value.fill('Contoso Ltd');
    await value.press('Enter');
    await expect.poll(() => docText(page)).toContain('between Contoso Ltd (the “Client”)');
    expect((await docText(page)).match(/Contoso Ltd/g)).toHaveLength(2);
    await caretAfter(page, 'Invoices are payable within 30 days.');
    await page.getByTestId('new-field').click();
    await expect(page.getByTestId('field-row')).toHaveCount(10);
    expect(await docText(page)).toContain('[field_1]');
  });

  test('context menu inserts tables, bookmarks, cross-references and footnotes', async ({ page }) => {
    await openApp(page, 'formatting');
    const p = await wordPoint(page, 'Before a page break.');
    await page.mouse.click(p.x, p.y, { button: 'right' });
    await expect(page.getByTestId('context-menu')).toBeVisible();
    await page.getByTestId('ctx-table').click();
    await page.getByRole('gridcell', { name: '2 x 3' }).click();
    await expect(body(page).locator('table')).toHaveCount(1);
    const cell = await page.evaluate(() => {
      const td = document.querySelector('.ml-dx-body-host .ml-dx-table td')!.getBoundingClientRect();
      return { x: td.x + 10, y: td.y + td.height / 2 };
    });
    await page.mouse.click(cell.x, cell.y, { button: 'right' });
    await page.getByTestId('ctx-edit-table').click();
    await page.getByTestId('table-addRowAfter').click();
    await expect(body(page).locator('table tr')).toHaveCount(3);

    await selectWord(page, 'quotation');
    const q = await wordPoint(page, 'quotation');
    await page.mouse.click(q.x, q.y, { button: 'right' });
    await page.getByTestId('ctx-bookmark').click();
    await page.getByLabel('Bookmark name').fill('Quote_sample');
    await page.getByTestId('bookmark-add').click();
    const target = await wordPoint(page, 'Centred paragraph');
    await page.mouse.click(target.x, target.y, { button: 'right' });
    await page.getByTestId('ctx-crossref').click();
    await page.getByRole('option', { name: /Quote_sample/ }).click();
    await page.getByTestId('crossref-insert').click();
    await expect(body(page).locator('a.ml-dx-link[href="#bm-Quote_sample"]')).toHaveCount(1);

    const end = await wordPoint(page, 'Right-aligned paragraph.');
    await page.mouse.click(end.x, end.y, { button: 'right' });
    await page.getByTestId('ctx-footnote').click();
    await page.getByLabel('Footnote text').fill('Added from the context menu.');
    await page.getByTestId('note-save').click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { docxEditor: { noteText(k: string): string } }).docxEditor.noteText('footnote:3'))).toBe('Added from the context menu.');
  });

  test('edits a header after double-clicking it', async ({ page }) => {
    await openApp(page, 'agreement');
    await expect.poll(() => editorValue(page, (e) => e.pageCount)).toBeGreaterThan(1);
    const pages = page.locator('.ml-dx-page');
    await editHeader(page, 0);
    const bar = page.locator('.ml-dx-hf-active .ml-dx-hf-bar');
    await expect(bar.locator('.ml-dx-hf-label')).toHaveText('Header');
    await page.keyboard.press('End');
    await page.keyboard.type(' (revision 2)');
    await bar.getByRole('button', { name: 'Close header and footer' }).click();
    await expect(page.locator('.ml-dx-hf-active')).toHaveCount(0);
    // The pages share the header, so each shows the change; the body is unchanged.
    for (const i of [0, 1]) await expect(pages.nth(i).locator('.ml-dx-header')).toContainText('Marginline example (revision 2)');
    expect(await docText(page)).not.toContain('revision 2');
  });

  test('exports DOCX and a PDF made in the browser', async ({ page }) => {
    await openApp(page, 'agreement');
    await page.getByTestId('export').click();
    const docx = await downloadOf(page, () => page.getByTestId('export-docx').click());
    expect(docx.name).toBe('agreement.docx');
    expect(docx.bytes.subarray(0, 2).toString()).toBe('PK');
    await page.getByTestId('export').click();
    const pdf = await downloadOf(page, () => page.getByTestId('export-pdf').click());
    expect(pdf.name).toBe('agreement.pdf');
    const text = pdf.bytes.toString('latin1');
    expect(text.startsWith('%PDF-1.7')).toBe(true);
    expect(text.match(/\/Type \/Page /g)).toHaveLength(2);
    expect(text).toContain('/FontFile2');
    expect(text).toContain('Producer (Marginline)');
  });

  test('page API: Document API queries, tracked replace and a custom toolbar button', async ({ page }) => {
    await openApp(page, 'agreement');
    const receipt = await page.evaluate(async () => {
      const ml = (window as unknown as { marginline: { doc: { query: { match(q: unknown): Promise<{ items: { target: unknown }[] }> }; replace(i: unknown, o: unknown): Promise<{ status: string; detail: string }> }; toolbar: { addButton(b: unknown): void } } }).marginline;
      const m = await ml.doc.query.match({ select: { type: 'text', pattern: 'sixty days' }, require: 'first' });
      ml.toolbar.addButton({ id: 'stamp', label: 'Insert stamp', text: '★', onClick: () => (window as unknown as { marginline: { doc: { text: { insert(o: unknown): unknown } } } }).marginline.doc.text.insert({ text: '[APPROVED]' }) });
      return ml.doc.replace({ target: m.items[0].target, text: 'thirty days' }, { changeMode: 'tracked' });
    });
    expect(receipt).toEqual(expect.objectContaining({ status: 'applied', detail: 'replacement recorded in tracked mode' }));
    await expect(page.getByTestId('change-card').filter({ hasText: 'thirty days' })).toBeVisible();
    await caretAfter(page, 'Signatures');
    await page.getByTestId('custom-stamp').click();
    await expect.poll(() => docText(page)).toContain('Signatures[APPROVED]');
  });

  test('customize: themes, dark appearance and the demo toolbar button', async ({ page }) => {
    await openApp(page, 'formatting');
    await page.getByTestId('customize').click();
    await page.getByTestId('theme-word').click();
    await page.getByTestId('scheme-dark').click();
    // The interface and its layer of menus and dialogs carry the theme; the page itself does not.
    for (const el of [page.getByTestId('app'), page.locator('.ml-layer')]) {
      await expect(el).toHaveClass(/theme-word/);
      await expect(el).toHaveClass(/is-dark/);
    }
    await expect(page.locator('html')).not.toHaveClass(/theme-|is-dark/);
    await page.getByTestId('add-demo-button').click();
    await page.getByTestId('user-name').fill('Alex Morgan');
    await page.getByRole('button', { name: 'Done' }).click();
    await caretAfter(page, 'Regular, ');
    await page.getByTestId('custom-today').click();
    await expect.poll(() => docText(page)).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/);
    expect(await editorValue(page, (e) => (e as unknown as { author: string }).author)).toBe('Alex Morgan');
  });

  test('moves tools into the overflow menu on narrow windows', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 800 });
    await openApp(page, 'formatting');
    await expect(page.getByTestId('tb-more')).toBeVisible();
    await page.getByTestId('tb-more').click();
    const overflow = page.getByTestId('tb-overflow');
    await expect(overflow).toBeVisible();
    await expect(overflow.getByTestId('tb-line-height')).toBeVisible();
    await page.keyboard.press('Escape');
    await caretAfter(page, 'Right-aligned paragraph.');
    await page.getByTestId('tb-more').click();
    await overflow.getByTestId('tb-line-height').click();
    await page.getByTestId('line-2').click();
    const line = await page.evaluate(() => {
      const ed = (window as unknown as { docxEditor: { view: { state: { selection: { $from: { parent: { attrs: { spacing: { line: number } | null } } } } } } } }).docxEditor;
      return ed.view.state.selection.$from.parent.attrs.spacing?.line;
    });
    expect(line).toBe(480);
  });

  test('examples menu opens the 300-page report', async ({ page }) => {
    await openApp(page);
    await page.getByTestId('examples').click();
    await page.getByTestId('example-long').click();
    await expect.poll(() => fileName(page)).toBe('long-report.docx');
    await expect.poll(() => editorValue(page, (e) => e.pageCount), { timeout: 20_000 }).toBeGreaterThan(250);
    await page.getByTestId('tb-zoom').click();
    await page.getByTestId('zoom-50').click();
    expect(await editorValue(page, (e) => e.zoom)).toBe(0.5);
  });

  test('page fields in the text show the page they are on', async ({ page }) => {
    await openApp(page, 'formatting');
    const at = await page.evaluate(() => {
      type N = { isText: boolean; text?: string };
      type Ed = { view: { state: { doc: { descendants(fn: (n: N, pos: number) => boolean): void }; schema: { text(t: string): unknown; nodes: { page_field: { create(attrs: unknown): unknown } } }; tr: { insert(pos: number, nodes: unknown[]): unknown } }; dispatch(tr: unknown): void } };
      const ed = (window as unknown as { docxEditor: Ed }).docxEditor;
      const { state } = ed.view;
      let at = -1;
      state.doc.descendants((n, pos) => {
        if (at < 0 && n.isText && n.text!.startsWith('This page starts after')) at = pos + n.text!.length;
        return at < 0;
      });
      const field = (kind: string) => state.schema.nodes.page_field.create({ kind, instr: ` ${kind} ` });
      ed.view.dispatch(state.tr.insert(at, [state.schema.text(' Page '), field('PAGE'), state.schema.text(' of '), field('NUMPAGES')]));
      return at;
    });
    const fields = page.locator('.ml-dx-body-host .ml-dx-page-field');
    // The closing section follows a page break, so it is past the first page.
    const pageNo = await page.evaluate((pos) => (window as unknown as { docxEditor: { pageOfPos(p: number): number } }).docxEditor.pageOfPos(pos) + 1, at);
    expect(pageNo).toBeGreaterThan(1);
    await expect(fields.first()).toHaveText(String(pageNo));
    await expect(fields.nth(1)).toHaveText(String(await editorValue(page, (e) => e.pageCount)));
  });
});
