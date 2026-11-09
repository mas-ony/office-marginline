import type { AnchoredComment, DocxEditor } from '../editor/DocxEditor';
import type { TrackedChange } from '../editor/plugins/trackChanges';

export interface ChangeSummary {
  verb: 'Added' | 'Deleted' | 'Replaced' | 'Formatted' | 'Added paragraph' | 'Deleted paragraph';
  text: string;
  /** Inserted text of a replacement. */
  with?: string;
}

export type ReviewItem =
  | { kind: 'comment'; key: string; pos: number; thread: AnchoredComment }
  | { kind: 'change'; key: string; pos: number; changes: TrackedChange[]; author: string; date: string; summary: ChangeSummary };

const clip = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function summarize(changes: TrackedChange[]): ChangeSummary {
  const del = changes.find((c) => c.type === 'deletion');
  const ins = changes.find((c) => c.type === 'insertion');
  if (del && ins) return { verb: 'Replaced', text: clip(del.text), with: clip(ins.text) };
  const c = changes[0];
  switch (c.type) {
    case 'insertion': return { verb: 'Added', text: clip(c.text) };
    case 'deletion': return { verb: 'Deleted', text: clip(c.text) };
    case 'format': return { verb: 'Formatted', text: clip(c.text) };
    case 'paragraph-insertion': return { verb: 'Added paragraph', text: '' };
    default: return { verb: 'Deleted paragraph', text: '' };
  }
}

/**
 * Comments and tracked changes in document order. A deletion directly followed by an insertion
 * from the same author is shown as one replacement.
 */
export function reviewItems(editor: DocxEditor, opts: { resolved?: boolean } = {}): ReviewItem[] {
  const items: ReviewItem[] = [];
  const changes = editor.trackedChanges();
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    const group = [c];
    const next = changes[i + 1];
    const end = c.ranges[c.ranges.length - 1].to;
    if (c.type === 'deletion' && next && next.type === 'insertion' && next.author === c.author && Math.abs(next.ranges[0].from - end) <= 1) {
      group.push(next);
      i++;
    }
    items.push({ kind: 'change', key: `change:${group.map((g) => `${g.type}:${g.id}`).join('+')}`, pos: c.ranges[0].from, changes: group, author: c.author, date: c.date, summary: summarize(group) });
  }
  for (const t of editor.comments()) {
    if (t.done && !opts.resolved) continue;
    items.push({ kind: 'comment', key: `comment:${t.id}`, pos: t.from, thread: t });
  }
  return items.sort((a, b) => a.pos - b.pos);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2:41PM Sep 21" in local time. */
export function formatWhen(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h % 12 || 12}:${m}${h < 12 ? 'AM' : 'PM'} ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/[\s_.-]+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** A stable avatar colour for an author name. */
export function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${h} 45% 42%)`;
}

/** People who can be mentioned: authors in the document and the current user. */
export function mentionPeople(editor: DocxEditor, user: string): string[] {
  const names = new Set<string>([user]);
  for (const t of editor.comments()) {
    names.add(t.author);
    for (const r of t.replies) names.add(r.author);
  }
  for (const c of editor.trackedChanges()) names.add(c.author);
  names.delete('');
  return [...names];
}

/** The "@name" being typed before the caret, if any: `query` is the text after "@". */
export function mentionAt(text: string, caret: number): { query: string } | null {
  const m = /(^|\s)@([\p{L}\p{N}_. -]{0,30})$/u.exec(text.slice(0, caret));
  return m ? { query: m[2] } : null;
}

/** Up to five people whose name starts with the mention being typed. */
export function mentionMatches(people: string[], mention: { query: string } | null): string[] {
  return mention ? people.filter((p) => p.toLowerCase().startsWith(mention.query.toLowerCase())).slice(0, 5) : [];
}

/** The text with the mention before the caret completed to `@name `. */
export function completeMention(text: string, caret: number, mention: { query: string }, name: string): string {
  const start = caret - mention.query.length - 1;
  return `${text.slice(0, start)}@${name} ${text.slice(caret)}`;
}

/** Comment text split around @mentions; parts starting with "@" are shown emphasised. */
export function splitMentions(text: string): string[] {
  return text.split(/(@[\p{L}\p{N}_.-]+(?: [\p{Lu}][\p{L}\p{N}_.-]*)?)/u);
}
