import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

export interface SearchOptions {
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  /** Treat the query as a regular expression. */
  regex: boolean;
}

export interface SearchMatch {
  from: number;
  to: number;
  /** Paragraph text around the match, for result lists. */
  context: string;
  matchStart: number;
  matchEnd: number;
}

export interface SearchState extends SearchOptions {
  results: SearchMatch[];
  index: number;
  decos: DecorationSet;
}

export const searchKey = new PluginKey<SearchState>('ml-dx-search');

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The search expression, or null when a regular expression does not compile. */
export function searchRegExp(opts: SearchOptions): RegExp | null {
  let source = opts.regex ? opts.query : escapeRegExp(opts.query);
  if (opts.wholeWord) source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`;
  try {
    return new RegExp(source, `gu${opts.caseSensitive ? '' : 'i'}`);
  } catch {
    return null;
  }
}

export function findMatches(doc: PMNode, opts: SearchOptions): SearchMatch[] {
  if (!opts.query) return [];
  const re = searchRegExp(opts);
  if (!re) return [];
  const out: SearchMatch[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = '';
    const starts: number[] = [];
    node.forEach((child, offset) => {
      const docPos = pos + 1 + offset;
      if (child.isText) {
        for (let i = 0; i < child.text!.length; i++) starts.push(docPos + i);
        text += child.text;
      } else {
        starts.push(docPos);
        text += child.type.name === 'tab' ? '\t' : '￼';
      }
    });
    starts.push(pos + node.nodeSize - 1);
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (!m[0].length) {
        re.lastIndex++;
        continue;
      }
      const s = m.index;
      const e = m.index + m[0].length;
      const ctxStart = Math.max(0, s - 30);
      out.push({
        from: starts[s],
        to: starts[e - 1] + 1,
        context: text.slice(ctxStart, Math.min(text.length, e + 50)).replace(/￼/g, ''),
        matchStart: s - ctxStart,
        matchEnd: e - ctxStart,
      });
    }
    return false;
  });
  return out;
}

function decorate(doc: PMNode, results: SearchMatch[], index: number): DecorationSet {
  if (!results.length) return DecorationSet.empty;
  return DecorationSet.create(doc, results.map((r, i) => Decoration.inline(r.from, r.to, { class: i === index ? 'ml-dx-search-hit ml-dx-search-current' : 'ml-dx-search-hit' })));
}

const EMPTY: SearchState = { query: '', caseSensitive: false, wholeWord: false, regex: false, results: [], index: -1, decos: DecorationSet.empty };

export function searchPlugin(): Plugin<SearchState> {
  return new Plugin<SearchState>({
    key: searchKey,
    state: {
      init: () => EMPTY,
      apply(tr, prev, _old, state) {
        const meta = tr.getMeta(searchKey) as Partial<SearchOptions & { index: number }> | undefined;
        if (!meta && (!tr.docChanged || !prev.query)) return prev;
        const opts: SearchOptions = {
          query: meta?.query ?? prev.query,
          caseSensitive: meta?.caseSensitive ?? prev.caseSensitive,
          wholeWord: meta?.wholeWord ?? prev.wholeWord,
          regex: meta?.regex ?? prev.regex,
        };
        const results = findMatches(state.doc, opts);
        let index = meta?.index ?? prev.index;
        if (!results.length) index = -1;
        else if (index < 0 || index >= results.length) index = 0;
        return { ...opts, results, index, decos: decorate(state.doc, results, index) };
      },
    },
    props: { decorations: (state) => searchKey.getState(state)?.decos },
  });
}

export function setSearch(state: EditorState, opts: Partial<SearchOptions & { index: number }>): Transaction {
  return state.tr.setMeta(searchKey, opts).setMeta('addToHistory', false);
}

/** Move to the next/previous match, selecting it. */
export function gotoMatch(state: EditorState, dir: 1 | -1): Transaction | null {
  const s = searchKey.getState(state);
  if (!s || !s.results.length) return null;
  let index = s.index + dir;
  if (index >= s.results.length) index = 0;
  if (index < 0) index = s.results.length - 1;
  const r = s.results[index];
  return state.tr
    .setMeta(searchKey, { index })
    .setSelection(TextSelection.create(state.doc, r.from, r.to))
    .scrollIntoView()
    .setMeta('addToHistory', false);
}

/** The text replacing one match; regular expressions may refer to groups ($1, $<name>). */
function replacementFor(state: EditorState, s: SearchState, r: SearchMatch, replacement: string): string {
  if (!s.regex) return replacement;
  const re = searchRegExp(s);
  if (!re) return replacement;
  const single = new RegExp(re.source, re.flags.replace('g', ''));
  return state.doc.textBetween(r.from, r.to, '', '').replace(single, replacement);
}

export function replaceCurrent(state: EditorState, replacement: string): Transaction | null {
  const s = searchKey.getState(state);
  if (!s || s.index < 0) return null;
  const r = s.results[s.index];
  const tr = state.tr.insertText(replacementFor(state, s, r, replacement), r.from, r.to);
  return tr.setMeta(searchKey, { index: s.index });
}

export function replaceAll(state: EditorState, replacement: string): Transaction | null {
  const s = searchKey.getState(state);
  if (!s || !s.results.length) return null;
  const tr = state.tr;
  for (let i = s.results.length - 1; i >= 0; i--) tr.insertText(replacementFor(state, s, s.results[i], replacement), s.results[i].from, s.results[i].to);
  return tr;
}
