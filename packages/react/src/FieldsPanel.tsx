import { FIELD_DRAG_TYPE, type FieldInfo } from '@marginline/core/views';
import { GripVertical, Plus, TextCursorInput, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useUI } from './context';
import { useSnapshot } from './store';

function FieldRow({ field, readOnly }: { field: FieldInfo; readOnly: boolean }) {
  const { editor } = useUI();
  const [name, setName] = useState(field.name);
  const [value, setValue] = useState(field.value);
  const editingValue = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setName(field.name), [field.name]);
  useEffect(() => {
    if (!editingValue.current) setValue(field.value);
  }, [field.value]);
  const flush = (v: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (v !== field.value || (v === '' && !field.placeholder)) editor.setFieldValue(field.name, v);
  };
  const rename = () => {
    if (name.trim() && name.trim() !== field.name) editor.renameField(field.name, name);
    else setName(field.name);
  };
  return (
    <li className="ml-field" data-testid="field-row" data-field={field.name}>
      <div className="ml-field-head">
        <input
          className="ml-field-name"
          aria-label="Field name"
          value={name}
          disabled={readOnly}
          onChange={(e) => setName(e.target.value)}
          onBlur={rename}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        />
        {field.ranges.length > 1 && <span className="ml-field-count" title="Places in the document">×{field.ranges.length}</span>}
        {!readOnly && (
          <button type="button" className="ml-icon-btn" aria-label={`Remove field ${field.name}`} title="Remove field (keep text)" onClick={() => editor.removeField(field.name)}>
            <Trash2 size={14} />
          </button>
        )}
      </div>
      <input
        className="ml-field-value"
        aria-label={`${field.name} value`}
        placeholder="Empty - type a value"
        value={value}
        disabled={readOnly}
        data-testid="field-value"
        onFocus={() => { editingValue.current = true; editor.focusField(field.name); }}
        onBlur={(e) => { editingValue.current = false; flush(e.target.value); editor.focusField(null); }}
        onChange={(e) => {
          const v = e.target.value;
          setValue(v);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => flush(v), 300);
        }}
        onKeyDown={(e) => { if (e.key === 'Enter') flush((e.target as HTMLInputElement).value); }}
      />
    </li>
  );
}

export function FieldsPanel() {
  const { editor, store } = useUI();
  const version = useSnapshot(store, (s) => s.fieldsVersion);
  const readOnly = useSnapshot(store, (s) => s.editMode === 'viewing');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fields = useMemo(() => editor.fields(), [editor, version]);
  return (
    <div className="ml-fields" data-testid="fields-panel">
      <h3 className="ml-panel-title">Fill the fields</h3>
      <div className="ml-label">Edit fields</div>
      {fields.length ? (
        <ul className="ml-field-list" aria-label="Document fields">
          {fields.map((f) => <FieldRow key={f.name} field={f} readOnly={readOnly} />)}
        </ul>
      ) : (
        <p className="ml-empty">This document has no fields yet.</p>
      )}
      {!readOnly && (
        <>
          <div className="ml-label">Add fields</div>
          <div className="ml-field-drop">
            <button
              type="button"
              className="ml-field-chip"
              draggable
              data-testid="new-field"
              title="Drag onto the page, or click to insert at the cursor"
              onDragStart={(e) => {
                e.dataTransfer.setData(FIELD_DRAG_TYPE, 'new');
                e.dataTransfer.setData('text/plain', '');
                e.dataTransfer.effectAllowed = 'copy';
              }}
              onClick={() => { editor.insertField(); editor.focus(); }}
            >
              <GripVertical size={14} /> <TextCursorInput size={15} /> New field
            </button>
            <p>Drag onto the page to add a new field, or click to insert it at the cursor. Selected text becomes the field's value.</p>
          </div>
          <button type="button" className="ml-btn is-small" onClick={() => { editor.insertField(); editor.focus(); }}>
            <Plus size={15} /> Insert field at cursor
          </button>
        </>
      )}
    </div>
  );
}
