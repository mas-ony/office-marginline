import { fitToolbar, phoneToolbar, type ToolbarItem, toolbarItems, withSeparators } from '@marginline/core/views';
import { EllipsisVertical } from 'lucide-react';
import { Fragment, type ReactNode, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cx, keepFocus, Popover } from '../controls';
import { useUI } from '../context';
import { useSnapshot } from '../store';
import { ToolSeparator } from './parts';
import {
  AlignTool,
  BulletListTool,
  ClearFormatTool,
  ColorTool,
  CopyFormatTool,
  DocumentModeTool,
  FontFamilyTool,
  FontSizeTool,
  HighlightTool,
  ImageTool,
  IndentTool,
  LineHeightTool,
  LinkTool,
  MarkTool,
  NumberedListTool,
  RedoTool,
  RulerTool,
  SearchTool,
  StylesTool,
  TableActionsTool,
  TableTool,
  UndoTool,
  ZoomTool,
} from './tools';

const TOOLS: Record<string, () => ReactNode> = {
  undo: () => <UndoTool />,
  redo: () => <RedoTool />,
  zoom: () => <ZoomTool />,
  font: () => <FontFamilyTool />,
  size: () => <FontSizeTool />,
  bold: () => <MarkTool kind="bold" />,
  italic: () => <MarkTool kind="italic" />,
  underline: () => <MarkTool kind="underline" />,
  strike: () => <MarkTool kind="strike" />,
  color: () => <ColorTool />,
  highlight: () => <HighlightTool />,
  link: () => <LinkTool />,
  image: () => <ImageTool />,
  table: () => <TableTool />,
  'table-actions': () => <TableActionsTool />,
  align: () => <AlignTool />,
  bullets: () => <BulletListTool />,
  numbers: () => <NumberedListTool />,
  outdent: () => <IndentTool dir="outdent" />,
  indent: () => <IndentTool dir="indent" />,
  'line-height': () => <LineHeightTool />,
  styles: () => <StylesTool />,
  'copy-format': () => <CopyFormatTool />,
  clear: () => <ClearFormatTool />,
  ruler: () => <RulerTool />,
};

function CustomTool({ item }: { item: ToolbarItem }) {
  const { editor } = useUI();
  const b = item.custom!;
  return (
    <button type="button" className="ml-tool ml-custom" aria-label={b.label} data-tip={b.label} data-testid={`custom-${b.id}`} onMouseDown={keepFocus} onClick={() => { b.onClick(); editor.focus(); }}>
      <span aria-hidden="true">{b.text}</span>
    </button>
  );
}

function renderRow(items: ToolbarItem[], nodes: Map<string, ReactNode>): ReactNode {
  return withSeparators(items).map(({ item, separator }) => (
    <Fragment key={item.id}>
      {separator && <ToolSeparator />}
      <span className="ml-tool-slot" data-item={item.id}>{nodes.get(item.id)}</span>
    </Fragment>
  ));
}

/** The single-row toolbar; items that do not fit move into "⋮". */
export function Toolbar() {
  const { mobile, customButtons, store } = useUI();
  const viewMode = useSnapshot(store, (s) => s.viewMode);
  const rowRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const [width, setWidth] = useState(10_000);
  const [moreOpen, setMoreOpen] = useState(false);
  const closeMore = useCallback(() => setMoreOpen(false), []);
  const items = useMemo(() => toolbarItems(customButtons), [customButtons]);
  const nodes = useMemo(() => new Map(items.map((it) => [it.id, it.custom ? <CustomTool item={it} /> : TOOLS[it.id]()])), [items]);

  useLayoutEffect(() => {
    const el = rowRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  if (mobile) {
    return (
      <div className="ml-toolbar is-mobile" role="toolbar" aria-label="Toolbar" data-testid="toolbar">
        <div className="ml-toolbar-scroll">{renderRow(phoneToolbar(items, viewMode), nodes)}</div>
      </div>
    );
  }

  const shown = fitToolbar(items, width);
  const visible = items.filter((i) => shown.has(i.id));
  const hidden = items.filter((i) => !shown.has(i.id));
  return (
    <div className="ml-toolbar" role="toolbar" aria-label="Toolbar" data-testid="toolbar">
      <div className="ml-toolbar-main" ref={rowRef}>
        {renderRow(visible, nodes)}
        {hidden.length > 0 && (
          <>
            <button
              ref={moreRef}
              type="button"
              className={cx('ml-tool', moreOpen && 'is-active')}
              aria-label="Overflow items"
              aria-haspopup="true"
              aria-expanded={moreOpen}
              data-tip="More tools"
              data-testid="tb-more"
              onMouseDown={keepFocus}
              onClick={() => setMoreOpen((o) => !o)}
            >
              <EllipsisVertical size={18} />
            </button>
            <Popover anchor={moreRef.current} open={moreOpen} onClose={closeMore} title="More tools">
              <div className="ml-overflow" role="group" aria-label="More tools" data-testid="tb-overflow">{renderRow(hidden, nodes)}</div>
            </Popover>
          </>
        )}
      </div>
      <div className="ml-toolbar-side">
        <SearchTool />
        <DocumentModeTool />
      </div>
    </div>
  );
}
