/**
 * Real-time collaboration relay for Marginline, as a Vite plugin (`vite` and `vite preview`) or as
 * Connect-style middleware for any Node server: the central authority of the ProseMirror
 * collaboration protocol. It keeps, per room, the DOCX the session started from and the ordered
 * list of steps; clients send steps for the version they have and receive everyone's steps,
 * comment threads and cursors over Server-Sent Events. Rooms live in memory.
 *
 * Requests, under the base path (default /collab):
 *
 *   GET  /collab/health                      { ok, rooms, addresses }
 *   POST /collab/rooms                      DOCX bytes (x-file-name header) → { room }
 *   GET  /collab/rooms/:room/doc             the starting DOCX
 *   GET  /collab/rooms/:room/events?since=N  event stream: steps, meta, presence
 *   POST /collab/rooms/:room/steps           { version, steps, clientID } → 200 | 409
 *   POST /collab/rooms/:room/meta            { clientID, comments }
 *   POST /collab/rooms/:room/presence        { clientID, name, color, anchor, head }
 */
import { randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

interface Client {
  id: string;
  res: ServerResponse | null;
  name: string;
  color: string;
  anchor: number;
  head: number;
  seen: number;
}

interface Room {
  id: string;
  fileName: string;
  docx: Buffer;
  steps: unknown[];
  clientIDs: string[];
  meta: unknown;
  clients: Map<string, Client>;
  touched: number;
}

const rooms = new Map<string, Room>();
const MAX_DOC = 64 * 1024 * 1024;
const MAX_JSON = 16 * 1024 * 1024;
const IDLE_MS = 12 * 60 * 60 * 1000;

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Request too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function send(c: Client, event: string, data: unknown) {
  if (!c.res) return;
  c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function presence(room: Room) {
  const users = [...room.clients.values()].filter((c) => c.res).map((c) => ({ clientID: c.id, name: c.name, color: c.color, anchor: c.anchor, head: c.head }));
  for (const c of room.clients.values()) send(c, 'presence', { users });
}

export interface RelayOptions {
  /** URL path the relay answers under (default `/collab`); the editor's `relay` option must match. */
  base?: string;
}

function basePath(options: RelayOptions): string {
  return `/${(options.base ?? '/collab').replace(/^\/+|\/+$/g, '')}`;
}

async function handle(req: IncomingMessage, res: ServerResponse, base: string): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (!url.pathname.startsWith(`${base}/`)) return false;
  const parts = url.pathname.slice(base.length).split('/').filter(Boolean);
  if (parts[0] === 'health') {
    // LAN addresses let a page opened on localhost offer a link other devices can open.
    const addresses = Object.entries(networkInterfaces())
      .filter(([name]) => !/^(lo|docker|br-|veth|virbr|vmnet|vboxnet|tun|tap|wg)/i.test(name))
      .flatMap(([, list]) => list ?? [])
      .filter((a) => a.family === 'IPv4' && !a.internal)
      .map((a) => a.address);
    json(res, 200, { ok: true, rooms: rooms.size, addresses });
    return true;
  }
  if (parts[0] !== 'rooms') return false;
  if (parts.length === 1 && req.method === 'POST') {
    const docx = await readBody(req, MAX_DOC);
    if (docx.length < 4 || docx[0] !== 0x50 || docx[1] !== 0x4b) {
      json(res, 400, { error: 'Expected a DOCX file' });
      return true;
    }
    const id = randomUUID().slice(0, 8);
    const fileName = decodeURIComponent(String(req.headers['x-file-name'] ?? 'Document.docx'));
    rooms.set(id, { id, fileName, docx, steps: [], clientIDs: [], meta: null, clients: new Map(), touched: Date.now() });
    json(res, 200, { room: id });
    return true;
  }
  const room = rooms.get(parts[1] ?? '');
  if (!room) {
    json(res, 404, { error: 'No such room. It may have ended.' });
    return true;
  }
  room.touched = Date.now();
  const action = parts[2];
  if (action === 'doc' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'x-file-name': encodeURIComponent(room.fileName), 'cache-control': 'no-store' });
    res.end(room.docx);
    return true;
  }
  if (action === 'events' && req.method === 'GET') {
    const clientID = url.searchParams.get('client') ?? randomUUID();
    const since = Math.max(0, Number(url.searchParams.get('since') ?? 0) || 0);
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.write(': connected\n\n');
    let c = room.clients.get(clientID);
    if (!c) {
      c = { id: clientID, res: null, name: url.searchParams.get('name') ?? 'Guest', color: url.searchParams.get('color') ?? '#2456f5', anchor: 0, head: 0, seen: Date.now() };
      room.clients.set(clientID, c);
    }
    c.res?.end();
    c.res = res;
    const client = c;
    if (since < room.steps.length) send(client, 'steps', { version: room.steps.length, from: since, steps: room.steps.slice(since), clientIDs: room.clientIDs.slice(since) });
    if (room.meta) send(client, 'meta', room.meta);
    presence(room);
    const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
    req.on('close', () => {
      clearInterval(ping);
      if (client.res === res) client.res = null;
      presence(room);
    });
    return true;
  }
  if (req.method !== 'POST') return false;
  const body = JSON.parse((await readBody(req, MAX_JSON)).toString('utf8') || '{}');
  if (action === 'steps') {
    const version = Number(body.version);
    if (version !== room.steps.length) {
      json(res, 409, { version: room.steps.length });
      return true;
    }
    const steps: unknown[] = Array.isArray(body.steps) ? body.steps : [];
    for (const s of steps) {
      room.steps.push(s);
      room.clientIDs.push(String(body.clientID));
    }
    json(res, 200, { version: room.steps.length });
    const msg = { version: room.steps.length, from: version, steps, clientIDs: steps.map(() => String(body.clientID)) };
    for (const c of room.clients.values()) send(c, 'steps', msg);
    return true;
  }
  if (action === 'meta') {
    // Late joiners get the newest comments and the newest styles and list definitions.
    const prev = (room.meta ?? {}) as { comments?: unknown; styles?: string | null; numbering?: string | null };
    const update = { clientID: String(body.clientID), comments: body.comments ?? prev.comments ?? [], styles: body.styles ?? null, numbering: body.numbering ?? null };
    room.meta = { ...update, styles: body.styles ?? prev.styles ?? null, numbering: body.numbering ?? prev.numbering ?? null };
    json(res, 200, { ok: true });
    for (const c of room.clients.values()) if (c.id !== update.clientID) send(c, 'meta', update);
    return true;
  }
  if (action === 'presence') {
    const c = room.clients.get(String(body.clientID));
    if (c) {
      c.name = String(body.name ?? c.name).slice(0, 80);
      c.color = String(body.color ?? c.color).slice(0, 32);
      c.anchor = Number(body.anchor) || 0;
      c.head = Number(body.head) || 0;
      c.seen = Date.now();
      presence(room);
    }
    json(res, 200, { ok: true });
    return true;
  }
  return false;
}

let sweep: ReturnType<typeof setInterval> | null = null;

/** Rooms nobody has used for 12 hours are removed. */
function startSweep() {
  if (sweep) return;
  sweep = setInterval(() => {
    const now = Date.now();
    for (const [id, r] of rooms) if (now - r.touched > IDLE_MS && ![...r.clients.values()].some((c) => c.res)) rooms.delete(id);
  }, 10 * 60 * 1000);
  sweep.unref?.();
}

export type RelayMiddleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;

/**
 * Connect-style middleware serving the relay; other requests go to `next`. Use it with
 * `http.createServer`, Connect or Express.
 */
export function createRelayMiddleware(options: RelayOptions = {}): RelayMiddleware {
  const base = basePath(options);
  return (req, res, next) => {
    if (!req.url?.startsWith(`${base}/`)) {
      next();
      return;
    }
    startSweep();
    handle(req, res, base).then((done) => {
      if (!done) json(res, 404, { error: 'Unknown collaboration request' });
    }).catch((e: Error) => json(res, 500, { error: e.message }));
  };
}

/** Middleware serving the relay under /collab. */
export const relayMiddleware: RelayMiddleware = createRelayMiddleware();

/** Vite plugin serving the relay from the dev and preview servers. */
export function collabRelay(options: RelayOptions = {}): Plugin {
  const middleware = createRelayMiddleware(options);
  return {
    name: 'marginline-collab-relay',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
