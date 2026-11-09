/**
 * Client side of real-time collaboration. The relay (@marginline/relay, served by `vite` and
 * `vite preview`) orders steps; every participant starts from the same DOCX and applies the same
 * steps through prosemirror-collab. Comment threads, styles and list definitions (which live
 * outside the document tree) are shared as whole snapshots, last writer wins.
 */
import type { DocxEditor } from '../editor/DocxEditor';
import type { RemoteCursor } from '../editor/plugins/presence';
import type { CommentThread } from '../core/model/types';

export type CollabStatus = 'connecting' | 'live' | 'offline' | 'ended';

export interface Participant {
  clientID: string;
  name: string;
  color: string;
  self: boolean;
}

export interface CollabState {
  room: string;
  status: CollabStatus;
  participants: Participant[];
  link: string;
}

/** Where the relay answers and how links to a room are made. */
export interface CollabOptions {
  /** Base URL of the relay (default `/collab`). */
  relay?: string;
  /** Link that opens a room; by default the current page with `?room=<id>`. */
  link?: (room: string) => string;
}

export const DEFAULT_RELAY = '/collab';
const COMMON_STYLES = ['Hyperlink', 'TableGrid', 'ListParagraph', 'CommentText', 'CommentReference', 'Header', 'Footer', 'Title', 'Subtitle', 'Heading1', 'Heading2', 'Heading3', 'Heading4', 'Heading5', 'Quote'];

export function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${h}, 70%, 42%)`;
}

function newClientID(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.getRandomValues) {
    const a = new Uint32Array(2);
    c.getRandomValues(a);
    return a[0].toString(36) + a[1].toString(36);
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

let lanAddresses: string[] = [];

const relayBase = (relay?: string) => (relay ?? DEFAULT_RELAY).replace(/\/+$/, '');

/** Whether the page was served with the collaboration relay (also learns its LAN addresses). */
export async function relayAvailable(relay?: string): Promise<boolean> {
  try {
    const r = await fetch(`${relayBase(relay)}/health`, { cache: 'no-store' });
    if (!r.ok) return false;
    const body = (await r.json()) as { ok?: boolean; addresses?: string[] };
    lanAddresses = body.addresses ?? [];
    return !!body.ok;
  } catch {
    return false;
  }
}

const LOCAL = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/;

/** Link to a room; a page opened on localhost links to the machine's LAN address instead. */
export function roomLink(room: string, link?: (room: string) => string): string {
  if (link) return link(room);
  const u = new URL(location.href);
  u.search = '';
  u.hash = '';
  if (LOCAL.test(u.hostname) && lanAddresses.length) u.hostname = lanAddresses[0];
  u.searchParams.set('room', room);
  return u.href;
}

export class CollabSession {
  readonly clientID = newClientID();
  private events: EventSource | null = null;
  private sending = false;
  private flushAgain = false;
  private offs: (() => void)[] = [];
  private lastMeta = '';
  private presenceTimer: ReturnType<typeof setTimeout> | null = null;
  private metaTimer: ReturnType<typeof setTimeout> | null = null;
  private participants: Participant[] = [];
  private status: CollabStatus = 'connecting';
  private stylesVersion = -1;
  private numberingVersion = -1;
  private readonly base: string;

  private constructor(
    readonly editor: DocxEditor,
    readonly room: string,
    private user: { name: string },
    private onState: (s: CollabState) => void,
    private readonly options: CollabOptions,
  ) {
    this.base = relayBase(options.relay);
  }

  /** Share the open document: upload it as the room's starting point and connect. */
  static async start(editor: DocxEditor, user: { name: string }, onState: (s: CollabState) => void, options: CollabOptions = {}): Promise<CollabSession> {
    // Both sides need the styles the editing commands add, so they are created up front.
    for (const id of COMMON_STYLES) editor.docx.styles.ensureStyle(id);
    const bytes = editor.exportDocx();
    const r = await fetch(`${relayBase(options.relay)}/rooms`, { method: 'POST', body: bytes as BlobPart, headers: { 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(editor.fileName) } });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
    const { room } = (await r.json()) as { room: string };
    // Start from exactly the bytes the others will load.
    const dirty = editor.dirty;
    editor.load(bytes, editor.fileName);
    if (dirty) editor.markChanged();
    const s = new CollabSession(editor, room, user, onState, options);
    s.connect();
    return s;
  }

  /** Join a shared document by its room id. */
  static async join(editor: DocxEditor, room: string, user: { name: string }, onState: (s: CollabState) => void, options: CollabOptions = {}): Promise<CollabSession> {
    const r = await fetch(`${relayBase(options.relay)}/rooms/${encodeURIComponent(room)}/doc`, { cache: 'no-store' });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
    const name = decodeURIComponent(r.headers.get('x-file-name') ?? 'Shared document.docx');
    editor.load(new Uint8Array(await r.arrayBuffer()), name);
    const s = new CollabSession(editor, room, user, onState, options);
    s.connect();
    return s;
  }

  private emitState() {
    this.onState({ room: this.room, status: this.status, participants: this.participants, link: roomLink(this.room, this.options.link) });
  }

  private connect() {
    const ed = this.editor;
    ed.startCollab(0, this.clientID, () => this.flush());
    this.stylesVersion = ed.docx.styles.version;
    this.numberingVersion = ed.docx.numbering.version;
    this.lastMeta = JSON.stringify([...ed.docx.comments.values()]);
    const open = () => {
      const params = new URLSearchParams({ client: this.clientID, since: String(ed.collabVersion), name: this.user.name, color: colorFor(this.user.name) });
      const es = new EventSource(`${this.base}/rooms/${encodeURIComponent(this.room)}/events?${params}`);
      this.events = es;
      es.onopen = () => {
        this.status = 'live';
        this.emitState();
        this.sendPresence();
        this.flush();
      };
      es.onerror = () => {
        if (this.status === 'ended') return;
        this.status = 'offline';
        this.emitState();
      };
      es.addEventListener('steps', (e) => this.onSteps(JSON.parse((e as MessageEvent).data)));
      es.addEventListener('meta', (e) => this.onMeta(JSON.parse((e as MessageEvent).data)));
      es.addEventListener('presence', (e) => this.onPresence(JSON.parse((e as MessageEvent).data)));
    };
    open();
    this.offs.push(
      ed.on('comments', () => this.scheduleMeta()),
      ed.on('selection', () => this.schedulePresence()),
      ed.on('change', () => this.scheduleMeta()),
    );
    this.emitState();
  }

  private onSteps(msg: { version: number; from: number; steps: unknown[]; clientIDs: string[] }) {
    const local = this.editor.collabVersion;
    if (msg.from > local) {
      // A gap: reconnect from the version we have; the relay resends what is missing.
      this.events?.close();
      this.events = null;
      this.reconnect();
      return;
    }
    const skip = local - msg.from;
    if (skip >= msg.steps.length) return;
    this.editor.receiveCollabSteps(msg.steps.slice(skip), msg.clientIDs.slice(skip));
    this.flush();
  }

  private reconnect() {
    const params = new URLSearchParams({ client: this.clientID, since: String(this.editor.collabVersion), name: this.user.name, color: colorFor(this.user.name) });
    const es = new EventSource(`${this.base}/rooms/${encodeURIComponent(this.room)}/events?${params}`);
    this.events = es;
    es.addEventListener('steps', (e) => this.onSteps(JSON.parse((e as MessageEvent).data)));
    es.addEventListener('meta', (e) => this.onMeta(JSON.parse((e as MessageEvent).data)));
    es.addEventListener('presence', (e) => this.onPresence(JSON.parse((e as MessageEvent).data)));
  }

  private async flush() {
    if (this.status === 'ended') return;
    if (this.sending) {
      // Steps (or the echo of ours) arrived while sending: send again when this request ends.
      this.flushAgain = true;
      return;
    }
    const s = this.editor.collabSendable();
    if (!s) return;
    this.sending = true;
    try {
      const r = await fetch(`${this.base}/rooms/${encodeURIComponent(this.room)}/steps`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version: s.version, steps: s.steps, clientID: this.clientID }),
      });
      // 409: someone else was first; their steps arrive on the event stream, then we retry.
      if (r.status === 404) this.end('The shared session has ended.');
    } catch {
      this.status = 'offline';
      this.emitState();
    } finally {
      this.sending = false;
      if (this.flushAgain) {
        this.flushAgain = false;
        void this.flush();
      }
    }
  }

  private scheduleMeta() {
    if (this.metaTimer) clearTimeout(this.metaTimer);
    this.metaTimer = setTimeout(() => void this.sendMeta(), 200);
  }

  private async sendMeta() {
    const d = this.editor.docx;
    const comments = [...d.comments.values()];
    const commentsJson = JSON.stringify(comments);
    const stylesChanged = d.styles.version !== this.stylesVersion;
    const numberingChanged = d.numbering.version !== this.numberingVersion;
    if (commentsJson === this.lastMeta && !stylesChanged && !numberingChanged) return;
    this.lastMeta = commentsJson;
    this.stylesVersion = d.styles.version;
    this.numberingVersion = d.numbering.version;
    try {
      await fetch(`${this.base}/rooms/${encodeURIComponent(this.room)}/meta`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clientID: this.clientID,
          comments,
          styles: stylesChanged || numberingChanged ? d.styles.toXml() : null,
          numbering: stylesChanged || numberingChanged ? d.numbering.toXml() : null,
        }),
      });
    } catch {
      // Sent again with the next change.
    }
  }

  private onMeta(msg: { clientID: string; comments?: CommentThread[]; styles?: string | null; numbering?: string | null }) {
    if (msg.clientID === this.clientID) return;
    const ed = this.editor;
    if (msg.styles || msg.numbering) {
      ed.replaceStylesAndNumbering(msg.styles ?? null, msg.numbering ?? null);
      this.stylesVersion = ed.docx.styles.version;
      this.numberingVersion = ed.docx.numbering.version;
    }
    if (Array.isArray(msg.comments)) {
      this.lastMeta = JSON.stringify(msg.comments);
      ed.setCommentThreads(msg.comments);
    }
  }

  private onPresence(msg: { users: (RemoteCursor & { clientID: string })[] }) {
    this.participants = msg.users.map((u) => ({ clientID: u.clientID, name: u.name, color: u.color, self: u.clientID === this.clientID }));
    this.editor.setRemoteCursors(msg.users.filter((u) => u.clientID !== this.clientID));
    this.emitState();
  }

  private schedulePresence() {
    if (this.presenceTimer) return;
    this.presenceTimer = setTimeout(() => {
      this.presenceTimer = null;
      this.sendPresence();
    }, 250);
  }

  private sendPresence() {
    const sel = this.editor.view.state.selection;
    void fetch(`${this.base}/rooms/${encodeURIComponent(this.room)}/presence`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientID: this.clientID, name: this.user.name, color: colorFor(this.user.name), anchor: sel.anchor, head: sel.head }),
    }).catch(() => undefined);
  }

  setUser(user: { name: string }) {
    this.user = user;
    this.sendPresence();
  }

  private end(reason?: string) {
    this.status = 'ended';
    this.emitState();
    if (reason) console.warn(reason);
    this.leave();
  }

  /** Disconnect; the document stays open and editable locally. */
  leave() {
    if (this.status !== 'ended') this.status = 'ended';
    this.events?.close();
    this.events = null;
    for (const off of this.offs) off();
    this.offs = [];
    if (this.metaTimer) clearTimeout(this.metaTimer);
    if (this.presenceTimer) clearTimeout(this.presenceTimer);
    this.editor.stopCollab();
  }
}
