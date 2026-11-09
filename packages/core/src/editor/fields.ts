import { Mark, type Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { schema } from '../core/model/schema';

/** One run of text inside a content control. */
export interface FieldRange {
  id: string;
  from: number;
  to: number;
}

/** A fillable field: every content control sharing a name (tag, or alias when untagged). */
export interface FieldInfo {
  /** The field name shown in the Fields panel. */
  name: string;
  tag: string;
  alias: string;
  kind: string;
  /** Current value; empty while the control shows its placeholder. */
  value: string;
  placeholder: boolean;
  ranges: FieldRange[];
}

export const fieldName = (attrs: { tag?: string; alias?: string; id?: string }) => attrs.tag || attrs.alias || `field-${attrs.id}`;

/** Content control ranges in document order, merged per control id. */
export function fieldRanges(doc: PMNode): { mark: Mark; range: FieldRange }[] {
  const out: { mark: Mark; range: FieldRange }[] = [];
  doc.descendants((node, pos) => {
    if (!node.isInline) return true;
    const m = node.marks.find((x) => x.type === schema.marks.field);
    if (!m) return false;
    const last = out[out.length - 1];
    if (last && last.mark.attrs.id === m.attrs.id && last.range.to === pos) last.range.to = pos + node.nodeSize;
    else out.push({ mark: m, range: { id: m.attrs.id, from: pos, to: pos + node.nodeSize } });
    return false;
  });
  return out;
}

/** Fields grouped by name, in order of first appearance. */
export function listFields(doc: PMNode): FieldInfo[] {
  const byName = new Map<string, FieldInfo>();
  for (const { mark, range } of fieldRanges(doc)) {
    const name = fieldName(mark.attrs);
    let f = byName.get(name);
    if (!f) {
      const placeholder = !!mark.attrs.placeholder;
      f = {
        name,
        tag: mark.attrs.tag,
        alias: mark.attrs.alias,
        kind: mark.attrs.kind,
        value: placeholder ? '' : doc.textBetween(range.from, range.to, '', ''),
        placeholder,
        ranges: [],
      };
      byName.set(name, f);
    }
    f.ranges.push(range);
  }
  return [...byName.values()];
}

function placeholderText(name: string): string {
  return `[${name}]`;
}

/**
 * Set the value of every control named `name`. An empty value shows a placeholder, as Word
 * does for an empty content control.
 */
export function setFieldValue(view: EditorView, name: string, value: string): boolean {
  const { state } = view;
  const targets = fieldRanges(state.doc).filter((f) => fieldName(f.mark.attrs) === name);
  if (!targets.length) return false;
  const tr = state.tr;
  for (let i = targets.length - 1; i >= 0; i--) {
    const { mark, range } = targets[i];
    const first = state.doc.nodeAt(range.from);
    const empty = value === '';
    const marks = (first?.marks ?? [mark]).filter((m) => m.type !== schema.marks.field);
    const field = schema.marks.field.create({ ...mark.attrs, placeholder: empty });
    const text = empty ? placeholderText(mark.attrs.alias || mark.attrs.tag || 'Field') : value;
    tr.replaceWith(range.from, range.to, schema.text(text, Mark.setFrom([...marks, field])));
  }
  view.dispatch(tr);
  return true;
}

/** Rename a field: updates the tag (and alias) of every control with that name. */
export function renameField(view: EditorView, name: string, next: string): boolean {
  const trimmed = next.trim();
  if (!trimmed || trimmed === name) return false;
  const { state } = view;
  const tr = state.tr;
  for (const { mark, range } of fieldRanges(state.doc)) {
    if (fieldName(mark.attrs) !== name) continue;
    const renamed = schema.marks.field.create({ ...mark.attrs, tag: trimmed, alias: mark.attrs.alias ? trimmed : mark.attrs.alias, raw: null });
    tr.removeMark(range.from, range.to, mark).addMark(range.from, range.to, renamed);
  }
  if (!tr.docChanged) return false;
  view.dispatch(tr);
  return true;
}

let created = 0;

function newFieldId(doc: PMNode): string {
  const used = new Set(fieldRanges(doc).map((f) => f.range.id));
  let id = '';
  do id = String(1000000 + Math.floor(Math.random() * 8000000) + created++);
  while (used.has(id));
  return id;
}

/** A field name not used in the document yet ("field_1", "field_2"...). */
export function uniqueFieldName(doc: PMNode, base = 'field'): string {
  const used = new Set(listFields(doc).map((f) => f.name));
  let n = 1;
  while (used.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

/**
 * Insert a field at the selection: the selected text becomes its value, otherwise a placeholder
 * is inserted. Returns the field name.
 */
export function insertField(view: EditorView, opts: { name?: string; value?: string; at?: number } = {}): string | null {
  const { state } = view;
  const name = opts.name?.trim() || uniqueFieldName(state.doc);
  const id = newFieldId(state.doc);
  const tr = state.tr;
  const from = opts.at ?? state.selection.from;
  const to = opts.at ?? state.selection.to;
  const $from = state.doc.resolve(from);
  if (!$from.parent.inlineContent) return null;
  if (from === to || opts.value !== undefined) {
    const value = opts.value ?? '';
    const placeholder = value === '';
    const marks = $from.marks().filter((m) => m.type !== schema.marks.field && m.type !== schema.marks.link);
    const field = schema.marks.field.create({ id, tag: name, alias: name, kind: 'text', placeholder });
    tr.replaceWith(from, to, schema.text(placeholder ? placeholderText(name) : value, field.addToSet(marks)));
  } else {
    tr.addMark(from, to, schema.marks.field.create({ id, tag: name, alias: name, kind: 'text', placeholder: false }));
  }
  view.dispatch(tr.scrollIntoView());
  return name;
}

/** Remove the controls named `name`, keeping their text (placeholders are removed). */
export function removeField(view: EditorView, name: string): boolean {
  const { state } = view;
  const tr = state.tr;
  const targets = fieldRanges(state.doc).filter((f) => fieldName(f.mark.attrs) === name);
  for (let i = targets.length - 1; i >= 0; i--) {
    const { mark, range } = targets[i];
    if (mark.attrs.placeholder) tr.delete(range.from, range.to);
    else tr.removeMark(range.from, range.to, mark);
  }
  if (!tr.docChanged) return false;
  view.dispatch(tr);
  return true;
}

// -----------------------------------------------------------------------------------------------
// Highlighting the field being edited in the Fields panel.

interface FieldsState {
  focus: string | null;
  decos: DecorationSet;
}

export const fieldsKey = new PluginKey<FieldsState>('ml-dx-fields');

function decorate(doc: PMNode, focus: string | null): DecorationSet {
  if (!focus) return DecorationSet.empty;
  const decos = fieldRanges(doc)
    .filter((f) => fieldName(f.mark.attrs) === focus)
    .map((f) => Decoration.inline(f.range.from, f.range.to, { class: 'ml-dx-field-focus' }));
  return DecorationSet.create(doc, decos);
}

export function fieldsPlugin(): Plugin<FieldsState> {
  return new Plugin<FieldsState>({
    key: fieldsKey,
    state: {
      init: (): FieldsState => ({ focus: null, decos: DecorationSet.empty }),
      apply(tr, prev, _old, state) {
        const meta = tr.getMeta(fieldsKey) as { focus: string | null } | undefined;
        if (meta) return { focus: meta.focus, decos: decorate(state.doc, meta.focus) };
        if (tr.docChanged && prev.focus) return { focus: prev.focus, decos: decorate(state.doc, prev.focus) };
        return prev;
      },
    },
    props: { decorations: (state) => fieldsKey.getState(state)?.decos },
  });
}

export function focusField(state: EditorState, name: string | null): Transaction {
  return state.tr.setMeta(fieldsKey, { focus: name }).setMeta('addToHistory', false);
}
