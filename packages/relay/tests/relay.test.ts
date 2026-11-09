// @vitest-environment node
import { createServer, get, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { collab, getVersion, receiveTransaction, sendableSteps } from 'prosemirror-collab';
import { EditorState, TextSelection } from 'prosemirror-state';
import { Step } from 'prosemirror-transform';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// The editor's DOCX import and schema, and the app's example documents.
import { importDocx } from '../../core/src/core/import/importer';
import { schema } from '../../core/src/core/model/schema';
import { example } from '../../core/tests/unit/helpers';
import { createRelayMiddleware, relayMiddleware } from '../src/index';

let server: Server;
let base = '';

beforeAll(async () => {
  server = createServer((req, res) => relayMiddleware(req, res, () => {
    res.statusCode = 404;
    res.end();
  }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.closeAllConnections?.();
  server.close();
});

const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/** Read Server-Sent Events from the relay until `count` events of `type` arrived. */
function readEvents(path: string, type: string, count: number): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const out: unknown[] = [];
    const req = get(`${base}${path}`, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = /^event: (.+)$/m.exec(block)?.[1];
          const data = /^data: (.+)$/m.exec(block)?.[1];
          if (ev === type && data) out.push(JSON.parse(data));
          if (out.length >= count) {
            req.destroy();
            resolve(out);
            return;
          }
        }
      });
    });
    req.on('error', (e) => (out.length >= count ? resolve(out) : reject(e)));
    setTimeout(() => {
      req.destroy();
      resolve(out);
    }, 3000);
  });
}

function client(doc: import('prosemirror-model').Node, id: string) {
  return EditorState.create({ doc, plugins: [collab({ version: 0, clientID: id })] });
}

function typeAt(state: EditorState, text: string, find: string): EditorState {
  let pos = -1;
  state.doc.descendants((n, p) => {
    if (pos >= 0 || !n.isText) return pos < 0;
    const i = n.text!.indexOf(find);
    if (i >= 0) pos = p + i;
    return false;
  });
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)).insertText(text));
}

describe('collaboration relay', () => {
  it('creates a room from a DOCX and serves it back', async () => {
    const bytes = example('agreement.docx');
    const r = await fetch(`${base}/collab/rooms`, { method: 'POST', body: new Blob([bytes as BlobPart]), headers: { 'x-file-name': encodeURIComponent('agreement.docx') } });
    const { room } = (await r.json()) as { room: string };
    expect(room).toMatch(/^[0-9a-f]{8}$/);
    const doc = await fetch(`${base}/collab/rooms/${room}/doc`);
    expect(doc.headers.get('x-file-name')).toBe('agreement.docx');
    expect(new Uint8Array(await doc.arrayBuffer())).toEqual(bytes);
    const health = (await (await fetch(`${base}/collab/health`)).json()) as { ok: boolean; addresses: string[] };
    expect(health.ok).toBe(true);
    expect(Array.isArray(health.addresses)).toBe(true);
    expect((await fetch(`${base}/collab/rooms`, { method: 'POST', body: 'not a docx' })).status).toBe(400);
    expect((await fetch(`${base}/collab/rooms/nope/doc`)).status).toBe(404);
  });

  it('orders concurrent steps so both clients end with the same document', async () => {
    const bytes = example('agreement.docx');
    const { room } = (await (await fetch(`${base}/collab/rooms`, { method: 'POST', body: new Blob([bytes as BlobPart]) })).json()) as { room: string };
    const doc = importDocx(bytes).body;
    let a = client(doc, 'A');
    let b = client(doc, 'B');
    a = typeAt(a, 'Edited by A. ', 'This agreement sets out');
    b = typeAt(b, 'Edited by B. ', 'The service will help');

    const sendA = sendableSteps(a)!;
    expect((await post(`/collab/rooms/${room}/steps`, { version: sendA.version, steps: sendA.steps.map((s) => s.toJSON()), clientID: 'A' })).status).toBe(200);
    // B is behind: the relay refuses its steps until it has A's.
    const sendB = sendableSteps(b)!;
    const refused = await post(`/collab/rooms/${room}/steps`, { version: sendB.version, steps: sendB.steps.map((s) => s.toJSON()), clientID: 'B' });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { version: number }).version).toBe(sendA.steps.length);

    const [catchUp] = (await readEvents(`/collab/rooms/${room}/events?client=B&since=0`, 'steps', 1)) as { steps: unknown[]; clientIDs: string[] }[];
    b = b.apply(receiveTransaction(b, catchUp.steps.map((j) => Step.fromJSON(schema, j as Record<string, unknown>)), catchUp.clientIDs));
    const rebased = sendableSteps(b)!;
    expect(rebased.version).toBe(sendA.steps.length);
    expect((await post(`/collab/rooms/${room}/steps`, { version: rebased.version, steps: rebased.steps.map((s) => s.toJSON()), clientID: 'B' })).status).toBe(200);

    const [all] = (await readEvents(`/collab/rooms/${room}/events?client=A&since=0`, 'steps', 1)) as { steps: unknown[]; clientIDs: string[] }[];
    a = a.apply(receiveTransaction(a, all.steps.map((j) => Step.fromJSON(schema, j as Record<string, unknown>)), all.clientIDs));
    // B's own steps come back from the relay too, which confirms them.
    const [mine] = (await readEvents(`/collab/rooms/${room}/events?client=B&since=${rebased.version}`, 'steps', 1)) as { steps: unknown[]; clientIDs: string[] }[];
    expect(mine.clientIDs.every((id) => id === 'B')).toBe(true);
    b = b.apply(receiveTransaction(b, mine.steps.map((j) => Step.fromJSON(schema, j as Record<string, unknown>)), mine.clientIDs));
    expect(sendableSteps(b)).toBeNull();
    expect(getVersion(a)).toBe(getVersion(b));
    expect(a.doc.eq(b.doc)).toBe(true);
    expect(a.doc.textContent).toContain('Edited by A. This agreement');
    expect(a.doc.textContent).toContain('Edited by B. The service');
    expect(sendableSteps(a)).toBeNull();
  });

  it('keeps the newest comments and styles for late joiners', async () => {
    const { room } = (await (await fetch(`${base}/collab/rooms`, { method: 'POST', body: new Blob([example('agreement.docx') as BlobPart]) })).json()) as { room: string };
    await post(`/collab/rooms/${room}/meta`, { clientID: 'A', comments: [{ id: '9', text: 'first' }], styles: '<w:styles/>', numbering: '<w:numbering/>' });
    await post(`/collab/rooms/${room}/meta`, { clientID: 'A', comments: [{ id: '9', text: 'second' }] });
    const [meta] = (await readEvents(`/collab/rooms/${room}/events?client=C&since=0`, 'meta', 1)) as { comments: { text: string }[]; styles: string }[];
    expect(meta.comments[0].text).toBe('second');
    expect(meta.styles).toBe('<w:styles/>');
  });

  it('answers under another base path and passes other requests on', async () => {
    const custom = createRelayMiddleware({ base: '/live/' });
    const other = createServer((req, res) => custom(req, res, () => {
      res.statusCode = 418;
      res.end();
    }));
    await new Promise<void>((resolve) => other.listen(0, '127.0.0.1', resolve));
    const at = `http://127.0.0.1:${(other.address() as AddressInfo).port}`;
    try {
      expect(((await (await fetch(`${at}/live/health`)).json()) as { ok: boolean }).ok).toBe(true);
      const { room } = (await (await fetch(`${at}/live/rooms`, { method: 'POST', body: new Blob([example('agreement.docx') as BlobPart]) })).json()) as { room: string };
      expect((await fetch(`${at}/live/rooms/${room}/doc`)).status).toBe(200);
      expect((await fetch(`${at}/collab/health`)).status).toBe(418);
      expect((await fetch(`${at}/lively/health`)).status).toBe(418);
    } finally {
      other.closeAllConnections?.();
      other.close();
    }
  });
});
