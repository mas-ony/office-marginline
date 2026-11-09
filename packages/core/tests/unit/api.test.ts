import { strFromU8, unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installPageApi, Marginline, registerHost } from '../../src/api/marginline';
import type { DocxEditor } from '../../src/editor/DocxEditor';
import type { CustomButton, FileActions, UIControls } from '../../src/ui/types';
import { openEditor } from './editorHelpers';
import { example } from './helpers';

let editor: DocxEditor;
let uninstall: () => void;
const buttons: CustomButton[] = [];

function controls(ed: DocxEditor): UIControls {
  return {
    setPanelOpen: vi.fn(),
    setPanelTab: vi.fn(),
    setTheme: vi.fn(),
    setScheme: vi.fn(),
    setUser: (u) => {
      ed.author = u.name;
    },
    addButton: (b) => buttons.push(b),
    removeButton: (id) => buttons.splice(buttons.findIndex((b) => b.id === id), 1),
    toast: vi.fn(),
    joinRoom: vi.fn(),
  };
}

const files = { newDocument: vi.fn(), open: vi.fn(), openExample: vi.fn(), downloadDocx: vi.fn(), exportPdf: vi.fn(), print: vi.fn() } as unknown as FileActions;

const ml = () => (window as unknown as { marginline: Marginline }).marginline;

/** Blob bytes (jsdom's Blob has no arrayBuffer()). */
function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(blob);
  });
}

beforeEach(() => {
  editor = openEditor(example('agreement.docx'), 'agreement.docx', 'API User');
  uninstall = installPageApi(new Marginline({}, { editor, controls: controls(editor), files }));
});

afterEach(() => {
  ml().destroy();
  uninstall();
  editor.destroy();
});

describe('page API (window.marginline)', () => {
  it('queries text and replaces it as a tracked change, returning a receipt', async () => {
    const match = await ml().doc.query.match({ select: { type: 'text', pattern: 'twelve months' }, require: 'first' });
    expect(match.items).toHaveLength(1);
    expect(match.items[0].matchKind).toBe('text');
    const receipt = await ml().doc.replace({ target: match.items[0].target, text: 'eighteen months' }, { changeMode: 'tracked' });
    expect(receipt).toMatchObject({ status: 'applied', operation: 'replace', detail: 'replacement recorded in tracked mode' });
    const changes = await ml().doc.trackChanges.list();
    expect(changes.filter((c) => c.author === 'API User').map((c) => [c.type, c.text])).toEqual([['deletion', 'twelve months'], ['insertion', 'eighteen months']]);
    // The editor is back in its own mode afterwards.
    expect(ml().documentMode).toBe('editing');
    // A target from before the edit is stale.
    const stale = await ml().doc.replace({ target: match.items[0].target, text: 'x' });
    expect(stale.status).toBe('failed');
    expect(stale.detail).toMatch(/older revision/);
  });

  it('inserts text, decides changes and works with comments and fields', async () => {
    await ml().doc.text.insert({ text: 'Appendix follows.', at: 'end' });
    expect(ml().doc.getText()).toMatch(/Appendix follows\.\s*$/);
    const decided = await ml().doc.trackChanges.decide({ decision: 'accept', target: 'all' });
    expect(decided.status).toBe('applied');
    expect(await ml().doc.trackChanges.list()).toHaveLength(0);

    const m = await ml().doc.query.match({ select: { type: 'text', pattern: 'confidential information' }, require: 'first' });
    const created = await ml().doc.comments.create({ target: m.items[0].target, text: 'Define this term.' });
    expect(created.status).toBe('applied');
    await ml().doc.comments.reply({ commentId: created.commentId!, text: 'Agreed.' });
    await ml().doc.comments.resolve({ commentId: created.commentId! });
    const comments = await ml().doc.comments.list({ includeResolved: true });
    const c = comments.find((x) => x.id === created.commentId)!;
    expect(c).toMatchObject({ text: 'Define this term.', resolved: true, quote: 'confidential information' });
    expect(c.replies.map((r) => r.text)).toEqual(['Agreed.']);

    const field = await ml().doc.fields.insert({ name: 'client', value: 'Cedar Point', target: (await ml().doc.query.match({ select: { type: 'text', pattern: 'Cedar Point Logistics Inc.' }, require: 'first' })).items[0].target });
    expect(field.status).toBe('applied');
    await ml().doc.fields.set({ name: 'client', value: 'Cedar Point Group' });
    expect((await ml().doc.fields.list()).find((f) => f.name === 'client')?.value).toBe('Cedar Point Group');
  });

  it('exports DOCX blobs, optionally without comments', async () => {
    const blob = (await ml().export({ exportType: ['docx'], triggerDownload: false })) as Blob;
    const files2 = unzipSync(await blobBytes(blob));
    expect(strFromU8(files2['word/comments.xml'])).toContain('two quarters');
    const clean = (await ml().export({ triggerDownload: false, commentsType: 'clean' })) as Blob;
    const xml = strFromU8(unzipSync(await blobBytes(clean))['word/document.xml']);
    expect(xml).not.toContain('w:commentRangeStart');
  });

  it('changes modes, viewing options and zoom, and reports events', () => {
    const modes: unknown[] = [];
    const zooms: unknown[] = [];
    ml().on('documentModeChange', (e) => modes.push(e)).on('zoomChange', (e) => zooms.push(e));
    ml().setDocumentMode('suggesting');
    ml().setViewingOptions({ trackedChanges: 'original' });
    ml().setZoom(125);
    expect(modes).toEqual([{ documentMode: 'suggesting' }]);
    expect(zooms).toEqual([{ zoom: 125 }]);
    expect(ml().zoom).toBe(125);
    expect(editor.viewingOptions.trackedChanges).toBe('original');
    expect(() => ml().setDocumentMode('reviewing' as never)).toThrow();
    expect(ml().diagnostics.getSnapshot().events.map((e) => e.type)).toContain('documentModeChange');
  });

  it('adds toolbar buttons and opens documents through new Marginline()', async () => {
    ml().toolbar.addButton({ id: 'today', label: 'Today', text: '📅', onClick: () => undefined });
    expect(buttons.map((b) => b.id)).toEqual(['today']);
    const ready = vi.fn();
    const created = new Marginline({ document: example('template.docx'), documentMode: 'viewing', user: { name: 'Robin' }, onReady: ready });
    await created.ready;
    expect(ready).toHaveBeenCalledTimes(1);
    expect(editor.fileName).toBe('Document.docx');
    expect(created.documentMode).toBe('viewing');
    expect(editor.author).toBe('Robin');
    expect((await created.doc.fields.list()).length).toBeGreaterThan(5);
    const bad = await created.replaceDocument(new Uint8Array([1, 2, 3]));
    expect(bad.ok).toBe(false);
    created.destroy();
  });

  it('drives the editor that selector points at when the page has several', async () => {
    const other = openEditor(example('template.docx'), 'template.docx', 'Other');
    const rootA = document.createElement('div');
    const rootB = document.createElement('div');
    rootB.id = 'editor-b';
    rootB.innerHTML = '<p class="inner"></p>';
    document.body.append(rootA, rootB);
    const offA = registerHost(rootA, ml().host);
    const offB = registerHost(rootB, { editor: other, controls: controls(other), files });
    try {
      const b = new Marginline({ selector: '#editor-b' });
      expect(b.host.editor).toBe(other);
      expect(new Marginline({ selector: rootB.querySelector<HTMLElement>('.inner')! }).host.editor).toBe(other);
      expect(new Marginline({ selector: rootA }).host.editor).toBe(editor);
      // Without a selector: the page's editor (installed by installPageApi).
      expect(new Marginline().host.editor).toBe(editor);
      expect((await b.doc.fields.list()).length).toBeGreaterThan(5);
      expect(b.doc.getText()).not.toBe(ml().doc.getText());
      // Removing the page's editor leaves the other mounted one as the default.
      offA();
      expect(new Marginline().host.editor).toBe(other);
    } finally {
      offB();
      rootA.remove();
      rootB.remove();
      other.destroy();
    }
    expect(() => new Marginline()).toThrow(/not ready/);
  });
});
