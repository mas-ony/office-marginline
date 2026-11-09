import { expect, test } from '@playwright/test';
import { body, caretAfter, docText, editorValue, openApp, wordPoint } from './helpers';

test.describe('phone', () => {
  test('reflows the text to the screen and edits by tapping and typing', async ({ page }) => {
    await openApp(page, 'agreement');
    await expect(page.locator('.ml-app')).toHaveClass(/is-mobile/);
    expect(await editorValue(page, (e) => e.viewMode)).toBe('web');
    await expect(page.getByTestId('side-panel')).toHaveCount(0);
    // Formatting tools come first in the scrolling toolbar row.
    const ids = await page.getByTestId('toolbar').locator('[data-testid^="tb-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    expect(ids.slice(0, 6)).toEqual(['tb-undo', 'tb-redo', 'tb-bold', 'tb-italic', 'tb-underline', 'tb-strike']);
    expect(ids).not.toContain('tb-ruler');
    const p = await wordPoint(page, 'Purpose');
    await page.touchscreen.tap(p.x + 30, p.y);
    await page.keyboard.press('End');
    await page.keyboard.type(' and goals');
    await expect.poll(() => docText(page)).toContain('Purpose and goals');
    // Text in the body is readable size (not a scaled page).
    const size = await body(page).locator('p').nth(3).evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
    expect(size).toBeGreaterThan(12);
  });

  test('exports DOCX and PDF from the phone menu', async ({ page }) => {
    await openApp(page, 'formatting');
    await page.getByTestId('mobile-menu').tap();
    const [docx] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-docx').tap()]);
    expect(docx.suggestedFilename()).toBe('formatting.docx');
    await page.getByTestId('mobile-menu').tap();
    const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-pdf').tap()]);
    expect(pdf.suggestedFilename()).toBe('formatting.pdf');
  });

  test('a tap goes through the message at the bottom of the screen', async ({ page }) => {
    await openApp(page, 'agreement');
    await caretAfter(page, '1. Purpose');
    await page.keyboard.press('Enter');
    const caret = () => editorValue(page, (e) => e.view.state.selection.from);
    const before = await caret();
    // An empty paragraph has nothing to comment on: a message says so, over the text below.
    await page.keyboard.press('Control+Alt+KeyM');
    const toast = page.locator('.ml-ui-toast');
    await expect(toast).toContainText('Select the text');
    const t = (await toast.boundingBox())!;
    await page.touchscreen.tap(t.x + t.width / 2, t.y + t.height / 2);
    await expect.poll(caret).not.toBe(before);
  });

  test('toolbar menus open as bottom sheets', async ({ page }) => {
    await openApp(page, 'formatting');
    await caretAfter(page, 'Regular');
    await page.keyboard.press('Shift+Home');
    await page.getByTestId('tb-color').click();
    const sheet = page.locator('.ml-ui-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('Text color');
    const box = (await sheet.boundingBox())!;
    expect(box.width).toBeGreaterThan(400);
    await sheet.getByRole('menuitem', { name: 'dark green', exact: true }).click();
    await expect(sheet).toHaveCount(0);
    await page.getByTestId('tb-mode').click();
    await page.getByTestId('mode-suggesting').click();
    await expect(page.getByTestId('mode-banner')).toContainText('Suggesting');
  });

  test('comments: selection bubble, composer sheet and the review sheet', async ({ page }) => {
    await openApp(page, 'agreement');
    const p = await wordPoint(page, 'forecasting');
    await page.mouse.dblclick(p.x, p.y);
    await page.getByTestId('comment-bubble').tap();
    await expect(page.locator('.ml-composer-sheet')).toBeVisible();
    await page.getByTestId('composer-input').fill('Phone comment');
    await page.getByTestId('composer-input-submit').tap();
    await page.getByTestId('mobile-review').tap();
    const panel = page.locator('.ml-panel-sheet');
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId('review-count')).toHaveText('3 changes · 3 comments');
    await expect(panel.getByTestId('comment-card').filter({ hasText: 'Phone comment' })).toBeVisible();
    await panel.getByTestId('change-card').first().tap();
    await panel.getByTestId('change-card').first().getByTestId('change-accept').tap();
    await expect(panel.getByTestId('review-count')).toHaveText('2 changes · 3 comments');
  });

  test('menu: examples, page view and inserting a field', async ({ page }) => {
    await openApp(page);
    await page.getByTestId('mobile-menu').tap();
    await page.getByTestId('example-template').tap();
    await expect.poll(() => docText(page)).toContain('Consulting Agreement');
    await page.getByTestId('mobile-menu').tap();
    await page.getByTestId('m-view').tap();
    await expect.poll(() => editorValue(page, (e) => e.viewMode)).toBe('print');
    // Pages are scaled to fit the phone.
    await expect.poll(() => editorValue(page, (e) => e.zoom)).toBeLessThan(0.6);
    await page.getByTestId('mobile-menu').tap();
    await page.getByTestId('m-view').tap();
    await expect.poll(() => editorValue(page, (e) => e.viewMode)).toBe('web');
    await caretAfter(page, 'Invoices are payable within 30 days.');
    await page.getByTestId('mobile-menu').tap();
    await page.getByTestId('m-field').tap();
    await page.getByTestId('mobile-review').tap();
    await page.getByTestId('tab-fields').tap();
    await expect(page.locator('.ml-panel-sheet').getByTestId('field-row')).toHaveCount(10);
  });

  test('find bar fits the phone screen', async ({ page }) => {
    await openApp(page, 'agreement');
    await page.getByTestId('tb-search').tap();
    const bar = page.getByTestId('find-bar');
    await expect(bar).toBeVisible();
    const box = (await bar.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await page.getByTestId('find-input').fill('Client');
    await expect(page.getByTestId('find-count')).toHaveText(/1 of \d+/);
  });
});
