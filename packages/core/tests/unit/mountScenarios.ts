/**
 * Scenarios for the mount() of the React and Vue packages (run by their own tests): the same
 * library behaviour from both interfaces.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { Marginline } from '../../src/api/marginline';
import type { MarginlineOptions } from '../../src/ui/types';
import { example } from './helpers';

interface Mounted {
  ready: Promise<Marginline>;
  update(options: MarginlineOptions): void;
  destroy(): void;
}

const wait = { timeout: 3000 };
/** Opening a document in jsdom takes a moment; the first test also loads the modules. */
const slow = 20_000;

/** The element once it exists. */
function find<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): Promise<T> {
  return vi.waitFor(() => {
    const el = root.querySelector<T>(selector);
    if (!el) throw new Error(`${selector} not found`);
    return el;
  }, wait);
}

/** Type into a text box the way the browser does (React and Vue both see the input event). */
function type(input: HTMLInputElement, text: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

export function mountScenarios(mount: (element: HTMLElement, options?: MarginlineOptions) => Mounted) {
  const open: Mounted[] = [];
  const place = () => document.body.appendChild(document.createElement('div'));
  const start = (el: HTMLElement, options: MarginlineOptions) => {
    const m = mount(el, options);
    open.push(m);
    return m;
  };

  afterEach(() => {
    for (const m of open.splice(0)) m.destroy();
    document.body.innerHTML = '';
  });

  it('opens the document, keeps its classes off <html> and removes everything again', async () => {
    const el = place();
    const m = start(el, { document: example('agreement.docx'), title: 'Service agreement', theme: 'word' });
    const ml = await m.ready;
    expect(ml.activeEditor.native.fileName).toBe('Service agreement.docx');
    const app = el.querySelector('[data-testid="app"]')!;
    const layers = document.querySelectorAll('.ml-layer');
    expect(app.classList.contains('theme-word')).toBe(true);
    expect(layers).toHaveLength(1);
    expect(layers[0].classList.contains('theme-word')).toBe(true);
    expect(document.documentElement.className).toBe('');
    expect((await find('[data-testid="file-name"]', el)).textContent).toBe('Service agreement');

    m.update({ theme: 'docs' });
    await vi.waitFor(() => expect(app.classList.contains('theme-docs')).toBe(true), wait);
    expect(layers[0].classList.contains('theme-docs')).toBe(true);

    m.destroy();
    open.length = 0;
    await vi.waitFor(() => expect(document.querySelector('.ml-layer')).toBeNull(), wait);
    expect(el.childElementCount).toBe(0);
  }, slow);

  it('shows dialogs in its layer and reports a new name from Customize', async () => {
    const el = place();
    const onUserChange = vi.fn();
    const m = start(el, { document: example('agreement.docx'), user: { name: 'Robin' }, onUserChange });
    await m.ready;
    (await find('[data-testid="customize"]', el)).click();
    const dialog = await find('[data-testid="customize-dialog"]');
    expect(dialog.closest('.ml-layer')).not.toBeNull();
    const name = dialog.querySelector<HTMLInputElement>('[data-testid="user-name"]')!;
    expect(name.value).toBe('Robin');
    type(name, 'Robin Example');
    await vi.waitFor(() => expect(name.value).toBe('Robin Example'), wait);
    [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Done')!.click();
    await vi.waitFor(() => expect(onUserChange).toHaveBeenCalledWith({ name: 'Robin Example', email: '' }), wait);
    await vi.waitFor(() => expect(document.querySelector('[data-testid="customize-dialog"]')).toBeNull(), wait);
  }, slow);

  it('keeps two editors on one page apart', async () => {
    const a = place();
    const b = place();
    const [mla, mlb] = await Promise.all([
      start(a, { document: example('agreement.docx') }).ready,
      start(b, { document: example('template.docx') }).ready,
    ]);
    expect(mla.activeEditor.native).not.toBe(mlb.activeEditor.native);
    expect(document.querySelectorAll('.ml-layer')).toHaveLength(2);
    expect(new Marginline({ selector: b }).activeEditor.native).toBe(mlb.activeEditor.native);
    expect(new Marginline({ selector: a }).activeEditor.native).toBe(mla.activeEditor.native);
    expect((await mlb.doc.fields.list()).length).toBeGreaterThan(5);
    expect(await mla.doc.fields.list()).not.toEqual(await mlb.doc.fields.list());
  }, slow);
}
