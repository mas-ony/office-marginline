import {
  Baseline,
  Bold,
  Check,
  Columns2,
  Eye,
  Grid2x2,
  Highlighter,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListIndentDecrease,
  ListIndentIncrease,
  ListOrdered,
  Merge,
  MessageSquareText,
  Paintbrush,
  PencilLine,
  Pilcrow,
  Redo2,
  RemoveFormatting,
  Rows2,
  Ruler,
  Search,
  Split,
  Strikethrough,
  Table,
  TableProperties,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignJustify,
  TextAlignStart,
  Trash2,
  Underline,
  Undo2,
  UnfoldVertical,
  Wrench,
} from 'lucide-react';
import {
  ALIGNS as ALIGN_LABELS,
  applyLink,
  BULLET_STYLES,
  colorBar,
  type EditMode,
  FONT_FAMILIES,
  FONT_SIZES,
  fontStack,
  highlightBar,
  IMAGE_ACCEPT,
  insertTable,
  LINE_HEIGHTS,
  linkRange,
  MARKS,
  MODES as MODE_LABELS,
  normalizeLink,
  NUMBER_STYLES,
  parseFontSize,
  removeLink,
  setFontFamily,
  setFontSize,
  setHighlight,
  setLineSpacing,
  setListPreset,
  setParagraphStyle,
  setTextColor,
  TABLE_ACTIONS,
  type TableAction,
  toggleList,
  ZOOM_LEVELS,
} from '@marginline/core/views';
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { cx, keepFocus, Menu, MenuItem, MenuSeparator, Popover } from '../controls';
import { useUI } from '../context';
import { useSnapshot } from '../store';
import { ColorPalette, SplitTool, ToolButton, ToolMenu } from './parts';

const ICON = 18;

function useCursor() {
  const { store } = useUI();
  return useSnapshot(store, (s) => s.cursor);
}

function useReadOnly() {
  const { store } = useUI();
  return useSnapshot(store, (s) => s.editMode === 'viewing');
}

// -----------------------------------------------------------------------------------------------
// History and zoom

export function UndoTool() {
  const { editor, store } = useUI();
  const can = useSnapshot(store, (s) => s.canUndo);
  return <ToolButton icon={<Undo2 size={ICON} />} label="Undo" shortcut="Ctrl+Z" disabled={!can} testId="tb-undo" onClick={() => editor.undo()} />;
}

export function RedoTool() {
  const { editor, store } = useUI();
  const can = useSnapshot(store, (s) => s.canRedo);
  return <ToolButton icon={<Redo2 size={ICON} />} label="Redo" shortcut="Ctrl+Y" disabled={!can} testId="tb-redo" onClick={() => editor.redo()} />;
}

export function ZoomTool() {
  const { editor, store } = useUI();
  const zoom = useSnapshot(store, (s) => s.zoom);
  return (
    <ToolMenu label="Zoom" text={`${Math.round(zoom * 100)}%`} testId="tb-zoom" wide>
      {(close) => (
        <Menu label="Zoom">
          {ZOOM_LEVELS.map((z) => (
            <MenuItem key={z} label={`${z}%`} checked={Math.round(zoom * 100) === z} testId={`zoom-${z}`} onSelect={() => { editor.setZoom(z / 100); close(); }} />
          ))}
          <MenuSeparator />
          <MenuItem label="Fit width" testId="zoom-fit" onSelect={() => { editor.fitWidth(); close(); }} />
        </Menu>
      )}
    </ToolMenu>
  );
}

// -----------------------------------------------------------------------------------------------
// Font family and size: editable comboboxes with a list

function Combo({ label, value, options, render, onCommit, width, testId, disabled, numeric }: {
  label: string;
  value: string;
  options: string[];
  render?: (o: string) => ReactNode;
  onCommit: (v: string) => void;
  width: number;
  testId: string;
  disabled?: boolean;
  numeric?: boolean;
}) {
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => setText(value), [value]);
  const commit = (v: string) => {
    setOpen(false);
    if (v.trim()) onCommit(v.trim());
    else setText(value);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit(text);
    } else if (e.key === 'Escape') {
      setText(value);
      setOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
    }
  };
  return (
    <div ref={wrap} className={cx('ml-combo', open && 'is-open')} style={{ width }}>
      <input
        className="ml-combo-input"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        value={text}
        disabled={disabled}
        inputMode={numeric ? 'decimal' : undefined}
        data-testid={testId}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        onFocus={(e) => e.target.select()}
      />
      <button type="button" className="ml-combo-arrow" aria-label={`${label} options`} disabled={disabled} data-testid={`${testId}-options`} onMouseDown={keepFocus} onClick={() => setOpen((o) => !o)}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
      </button>
      <Popover anchor={wrap.current} open={open} onClose={() => setOpen(false)} title={label}>
        <div className="ml-ui-menu ml-listbox" role="listbox" aria-label={label}>
          {options.map((o) => (
            <button
              key={o}
              type="button"
              role="option"
              aria-selected={o === value}
              aria-label={`${label} - ${o}`}
              className={cx('ml-ui-menuitem', o === value && 'is-checked')}
              onMouseDown={keepFocus}
              onClick={() => commit(o)}
            >
              <span className="ml-ui-menuitem-label">{render ? render(o) : o}</span>
            </button>
          ))}
        </div>
      </Popover>
    </div>
  );
}

export function FontFamilyTool() {
  const { editor } = useUI();
  const cursor = useCursor();
  const ro = useReadOnly();
  const value = cursor?.fontFamily ?? '';
  return (
    <Combo
      label="Font family"
      value={value}
      options={FONT_FAMILIES}
      render={(f) => <span style={{ fontFamily: fontStack(f) }}>{f}</span>}
      width={132}
      testId="tb-font"
      disabled={ro}
      onCommit={(f) => {
        setFontFamily(editor.activeView, f);
        editor.focus();
      }}
    />
  );
}

export function FontSizeTool() {
  const { editor } = useUI();
  const cursor = useCursor();
  const ro = useReadOnly();
  const size = cursor?.fontSize;
  return (
    <Combo
      label="Font size"
      value={size ? String(size) : ''}
      options={FONT_SIZES.map(String)}
      width={58}
      testId="tb-size"
      numeric
      disabled={ro}
      onCommit={(v) => {
        const n = parseFontSize(v);
        if (n !== null) setFontSize(editor.activeView, n);
        editor.focus();
      }}
    />
  );
}

// -----------------------------------------------------------------------------------------------
// Character formatting

export function MarkTool({ kind }: { kind: 'bold' | 'italic' | 'underline' | 'strike' }) {
  const { editor } = useUI();
  const cursor = useCursor();
  const ro = useReadOnly();
  const icon = { bold: <Bold size={ICON} />, italic: <Italic size={ICON} />, underline: <Underline size={ICON} />, strike: <Strikethrough size={ICON} /> }[kind];
  const meta = MARKS[kind];
  return <ToolButton icon={icon} label={meta.label} shortcut={meta.key} active={!!cursor?.[kind]} disabled={ro} testId={`tb-${kind}`} onClick={() => editor.runAction(kind)} />;
}

export function ColorTool() {
  const { editor } = useUI();
  const cursor = useCursor();
  const ro = useReadOnly();
  const color = cursor?.color ?? null;
  return (
    <ToolMenu
      label="Text color"
      chevron={false}
      disabled={ro}
      testId="tb-color"
      icon={<span className="ml-color-icon"><Baseline size={ICON} /><span className="ml-color-bar" style={{ background: colorBar(color) }} /></span>}
    >
      {(close) => (
        <ColorPalette label="Text color" value={color} none="Automatic" onPick={(hex) => { setTextColor(editor.activeView, hex); close(); editor.focus(); }} />
      )}
    </ToolMenu>
  );
}

export function HighlightTool() {
  const { editor } = useUI();
  const cursor = useCursor();
  const ro = useReadOnly();
  const hl = cursor?.highlight ?? null;
  return (
    <ToolMenu
      label="Highlight"
      chevron={false}
      disabled={ro}
      testId="tb-highlight"
      icon={<span className="ml-color-icon"><Highlighter size={ICON} /><span className="ml-color-bar" style={{ background: highlightBar(hl) }} /></span>}
    >
      {(close) => (
        <ColorPalette label="Highlight" value={hl?.startsWith('#') ? hl : null} none="None" onPick={(hex) => { setHighlight(editor.activeView, hex ? `#${hex}` : null); close(); editor.focus(); }} />
      )}
    </ToolMenu>
  );
}

// -----------------------------------------------------------------------------------------------
// Link, image and table

export function LinkTool() {
  const { editor } = useUI();
  const cursor = useCursor();
  const ro = useReadOnly();
  return (
    <ToolMenu label="Link" chevron={false} disabled={ro} active={!!cursor?.link} testId="tb-link" icon={<Link2 size={ICON} />}>
      {(close) => <LinkForm onDone={() => { close(); editor.focus(); }} />}
    </ToolMenu>
  );
}

/** "Add link" form: text to show and the address. Also edits or removes the link at the caret. */
export function LinkForm({ onDone }: { onDone: () => void }) {
  const { editor } = useUI();
  const v = editor.activeView;
  const existing = useMemo(() => linkRange(v.state), [v]);
  const sel = v.state.selection;
  const initialText = existing ? v.state.doc.textBetween(existing.from, existing.to) : v.state.doc.textBetween(sel.from, sel.to, ' ');
  const [text, setText] = useState(initialText);
  const [href, setHref] = useState(existing?.mark.attrs.href ?? '');
  const apply = () => {
    const url = normalizeLink(href);
    if (!url) return;
    applyLink(v, editor.docx, url, text.trim() || undefined);
    onDone();
  };
  return (
    <form className="ml-link-form" data-testid="link-form" onSubmit={(e) => { e.preventDefault(); apply(); }}>
      <div className="ml-form-title">{existing ? 'Edit link' : 'Add link'}</div>
      <label className="ml-input-row">
        <span className="ml-input-icon">T</span>
        <input aria-label="Text" placeholder="Text" value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <label className="ml-input-row">
        <Link2 size={16} className="ml-input-icon" />
        <input aria-label="Type or paste a link" placeholder="Type or paste a link" value={href} autoFocus onChange={(e) => setHref(e.target.value)} />
      </label>
      <div className="ml-form-actions">
        {existing && (
          <button type="button" className="ml-btn" onClick={() => { removeLink(v); onDone(); }}>Remove</button>
        )}
        {existing && /^https?:/i.test(existing.mark.attrs.href) && (
          <a className="ml-btn" href={existing.mark.attrs.href} target="_blank" rel="noopener noreferrer">Open</a>
        )}
        <button type="submit" className="ml-btn is-primary" disabled={!href.trim()}>Apply</button>
      </div>
    </form>
  );
}

export function ImageTool() {
  const { editor } = useUI();
  const ro = useReadOnly();
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <ToolButton icon={<ImageIcon size={ICON} />} label="Image" disabled={ro} testId="tb-image" onClick={() => input.current?.click()} />
      <input
        ref={input}
        type="file"
        accept={IMAGE_ACCEPT}
        hidden
        data-testid="image-input"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) void editor.insertImages(files);
        }}
      />
    </>
  );
}

export function TableGrid({ onPick }: { onPick: (rows: number, cols: number) => void }) {
  const [hover, setHover] = useState({ r: 1, c: 1 });
  const N = 10;
  return (
    <div className="ml-table-grid" data-testid="table-grid">
      <div className="ml-grid" role="grid" aria-label="Table size" onMouseLeave={() => setHover({ r: 1, c: 1 })}>
        {Array.from({ length: N }, (_, r) => (
          <div key={r} className="ml-grid-row" role="row">
            {Array.from({ length: N }, (_, c) => (
              <button
                key={c}
                type="button"
                role="gridcell"
                aria-label={`${r + 1} x ${c + 1}`}
                className={cx('ml-grid-cell', r < hover.r && c < hover.c && 'is-on')}
                onMouseDown={keepFocus}
                onMouseEnter={() => setHover({ r: r + 1, c: c + 1 })}
                onFocus={() => setHover({ r: r + 1, c: c + 1 })}
                onClick={() => onPick(r + 1, c + 1)}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="ml-grid-label">{hover.r} x {hover.c}</div>
    </div>
  );
}

export function TableTool() {
  const { editor } = useUI();
  const ro = useReadOnly();
  return (
    <ToolMenu label="Table" chevron={false} disabled={ro} testId="tb-table" icon={<Table size={ICON} />}>
      {(close) => <TableGrid onPick={(r, c) => { insertTable(editor.activeView, editor.docx, r, c); close(); editor.focus(); }} />}
    </ToolMenu>
  );
}

const TABLE_ICONS: Record<TableAction, ReactNode> = {
  addRowBefore: <Rows2 size={16} />,
  addRowAfter: <Rows2 size={16} />,
  addColumnBefore: <Columns2 size={16} />,
  addColumnAfter: <Columns2 size={16} />,
  deleteRow: <Trash2 size={16} />,
  deleteColumn: <Trash2 size={16} />,
  deleteTable: <Trash2 size={16} />,
  removeBorders: <Grid2x2 size={16} />,
  mergeCells: <Merge size={16} />,
  splitCell: <Split size={16} />,
  fixTables: <Wrench size={16} />,
};

export function TableActionsMenu({ onDone }: { onDone: () => void }) {
  const { editor } = useUI();
  return (
    <Menu label="Table actions">
      {TABLE_ACTIONS.map((a) => (
        <MenuItem
          key={a.action}
          icon={TABLE_ICONS[a.action]}
          label={a.label}
          testId={`table-${a.action}`}
          disabled={!editor.canTableAction(a.action)}
          onSelect={() => { editor.tableAction(a.action); onDone(); editor.focus(); }}
        />
      ))}
    </Menu>
  );
}

export function TableActionsTool() {
  const cursor = useCursor();
  const ro = useReadOnly();
  return (
    <ToolMenu label="Table actions" chevron={false} disabled={ro || !cursor?.inTable} testId="tb-table-actions" icon={<TableProperties size={ICON} />}>
      {(close) => <TableActionsMenu onDone={close} />}
    </ToolMenu>
  );
}

// -----------------------------------------------------------------------------------------------
// Paragraph formatting

const ALIGN_ICONS = {
  left: <TextAlignStart size={ICON} />,
  center: <TextAlignCenter size={ICON} />,
  right: <TextAlignEnd size={ICON} />,
  both: <TextAlignJustify size={ICON} />,
};

const ALIGNS = ALIGN_LABELS.map((a) => ({ ...a, icon: ALIGN_ICONS[a.value] }));

export function AlignTool() {
  const { editor } = useUI();
  const cursor = useCursor();
  const ro = useReadOnly();
  const cur = ALIGNS.find((a) => a.value === (cursor?.align ?? 'left')) ?? ALIGNS[0];
  return (
    <ToolMenu label="Text align" disabled={ro} testId="tb-align" icon={cur.icon}>
      {(close) => (
        <div className="ml-icon-menu" role="menu" aria-label="Text align">
          {ALIGNS.map((a) => (
            <button key={a.value} type="button" role="menuitem" aria-label={a.label} data-tip={a.label} data-testid={`align-${a.value}`} className={cx('ml-tool', a.value === cur.value && 'is-active')} onMouseDown={keepFocus} onClick={() => { editor.runAction(a.action); close(); }}>
              {a.icon}
            </button>
          ))}
        </div>
      )}
    </ToolMenu>
  );
}

export function BulletListTool() {
  const { editor } = useUI();
  const cursor = useCursor();
  const ro = useReadOnly();
  return (
    <SplitTool icon={<List size={ICON} />} label="Bullet list" optionsLabel="Bullet list options" testId="tb-bullets" disabled={ro} active={cursor?.listKind === 'bullet'} onClick={() => editor.runAction('bulletList')}>
      {(close) => (
        <div className="ml-icon-menu" role="menu" aria-label="Bullet styles">
          {BULLET_STYLES.map((b) => (
            <button key={b.preset} type="button" role="menuitem" aria-label={b.label} data-tip={b.label} data-testid={`bullet-${b.preset}`} className={cx('ml-tool ml-glyph', cursor?.listPreset === b.preset && 'is-active')} onMouseDown={keepFocus} onClick={() => {
              const v = editor.activeView;
              if (cursor?.listKind === 'bullet') setListPreset(v, editor.docx, b.preset);
              else toggleList(v, editor.docx, 'bullet', b.preset);
              close();
            }}>
              {b.glyph}
            </button>
          ))}
        </div>
      )}
    </SplitTool>
  );
}

export function NumberedListTool() {
  const { editor } = useUI();
  const cursor = useCursor();
  const ro = useReadOnly();
  return (
    <SplitTool icon={<ListOrdered size={ICON} />} label="Numbered list" optionsLabel="Numbered list options" testId="tb-numbers" disabled={ro} active={cursor?.listKind === 'ordered'} onClick={() => editor.runAction('numberedList')}>
      {(close) => (
        <div className="ml-number-menu" role="menu" aria-label="Number styles">
          {NUMBER_STYLES.map((n) => (
            <button key={n.preset} type="button" role="menuitem" aria-label={n.label} title={n.label} data-testid={`numbers-${n.preset}`} className={cx('ml-number-style', cursor?.listPreset === n.preset && 'is-active')} onMouseDown={keepFocus} onClick={() => {
              const v = editor.activeView;
              if (cursor?.listKind === 'ordered') setListPreset(v, editor.docx, n.preset);
              else toggleList(v, editor.docx, 'ordered', n.preset);
              close();
            }}>
              {n.sample.map((s, i) => <span key={i}><b>{s}</b><i /></span>)}
            </button>
          ))}
        </div>
      )}
    </SplitTool>
  );
}

export function IndentTool({ dir }: { dir: 'outdent' | 'indent' }) {
  const { editor } = useUI();
  const ro = useReadOnly();
  return dir === 'outdent'
    ? <ToolButton icon={<ListIndentDecrease size={ICON} />} label="Left indent" shortcut="Shift+Tab" disabled={ro} testId="tb-outdent" onClick={() => editor.runAction('outdent')} />
    : <ToolButton icon={<ListIndentIncrease size={ICON} />} label="Right indent" shortcut="Tab" disabled={ro} testId="tb-indent" onClick={() => editor.runAction('indent')} />;
}

export function LineHeightTool() {
  const { editor } = useUI();
  const cursor = useCursor();
  const ro = useReadOnly();
  const cur = cursor?.lineSpacing ?? null;
  return (
    <ToolMenu label="Line height" chevron={false} disabled={ro} testId="tb-line-height" icon={<UnfoldVertical size={ICON} />}>
      {(close) => (
        <Menu label="Line height">
          {LINE_HEIGHTS.map((h) => (
            <MenuItem key={h} label={h.toFixed(2)} checked={cur !== null && Math.abs(cur - h) < 0.01} testId={`line-${h}`} onSelect={() => { setLineSpacing(editor.activeView, h); close(); editor.focus(); }} />
          ))}
        </Menu>
      )}
    </ToolMenu>
  );
}

export function StylesTool() {
  const { editor, store } = useUI();
  const cursor = useCursor();
  const ro = useReadOnly();
  useSnapshot(store, (s) => s.stylesVersion);
  const styles = editor.docx.styles.paragraphStyleList();
  return (
    <ToolMenu label="Linked styles" chevron={false} disabled={ro} testId="tb-styles" icon={<Pilcrow size={ICON} />}>
      {(close) => (
        <div className="ml-ui-menu ml-styles-menu" role="menu" aria-label="Linked styles">
          {styles.map((s) => (
            <button
              key={s.id}
              type="button"
              role="menuitemradio"
              aria-checked={cursor?.styleId === s.id}
              className={cx('ml-ui-menuitem ml-style-item', cursor?.styleId === s.id && 'is-checked')}
              data-testid={`style-${s.id}`}
              onMouseDown={keepFocus}
              onClick={() => { setParagraphStyle(editor.activeView, editor.docx, s.id); close(); editor.focus(); }}
            >
              <span className={cx('ml-style-sample', `ml-style-${s.id.toLowerCase()}`)}>{s.label}</span>
              {cursor?.styleId === s.id && <Check size={14} />}
            </button>
          ))}
        </div>
      )}
    </ToolMenu>
  );
}

export function CopyFormatTool() {
  const { editor, store } = useUI();
  const ro = useReadOnly();
  const on = useSnapshot(store, (s) => s.painter);
  return <ToolButton icon={<Paintbrush size={ICON} />} label="Copy formatting" active={on} disabled={ro} testId="tb-format-painter" onClick={() => (on ? editor.stopFormatPainter() : editor.startFormatPainter())} />;
}

export function ClearFormatTool() {
  const { editor } = useUI();
  const ro = useReadOnly();
  return <ToolButton icon={<RemoveFormatting size={ICON} />} label="Clear formatting" disabled={ro} testId="tb-clear" onClick={() => editor.runAction('clearFormatting')} />;
}

export function RulerTool() {
  const { rulerOn, setRulerOn } = useUI();
  return <ToolButton icon={<Ruler size={ICON} />} label="Ruler" active={rulerOn} testId="tb-ruler" onClick={() => setRulerOn(!rulerOn)} />;
}

// -----------------------------------------------------------------------------------------------
// Search and document mode

export function SearchTool() {
  const { findOpen, setFindOpen } = useUI();
  return <ToolButton icon={<Search size={ICON} />} label="Search" shortcut="Ctrl+F" active={findOpen} testId="tb-search" onClick={() => setFindOpen(!findOpen)} />;
}

const MODE_ICONS: Record<EditMode, ReactNode> = {
  editing: <PencilLine size={ICON} />,
  suggesting: <MessageSquareText size={ICON} />,
  viewing: <Eye size={ICON} />,
};

const MODES = MODE_LABELS.map((m) => ({ ...m, icon: MODE_ICONS[m.mode] }));

export function DocumentModeTool({ showLabel }: { showLabel?: boolean }) {
  const { editor, store } = useUI();
  const mode = useSnapshot(store, (s) => s.editMode);
  const cur = MODES.find((m) => m.mode === mode) ?? MODES[0];
  return (
    <ToolMenu label="Document mode" icon={cur.icon} text={showLabel ? cur.label : undefined} testId="tb-mode" align="end" active={mode !== 'editing'}>
      {(close) => (
        <div className="ml-ui-menu ml-mode-menu" role="menu" aria-label="Document mode">
          {MODES.map((m) => (
            <button
              key={m.mode}
              type="button"
              role="menuitemradio"
              aria-checked={m.mode === mode}
              aria-label={`${m.label} ${m.description}`}
              className={cx('ml-ui-menuitem ml-mode-item', m.mode === mode && 'is-checked')}
              data-testid={`mode-${m.mode}`}
              onMouseDown={keepFocus}
              onClick={() => { editor.setEditMode(m.mode); close(); }}
            >
              <span className="ml-mode-icon">{m.icon}</span>
              <span className="ml-mode-text"><b>{m.label}</b><small>{m.description}</small></span>
            </button>
          ))}
        </div>
      )}
    </ToolMenu>
  );
}
