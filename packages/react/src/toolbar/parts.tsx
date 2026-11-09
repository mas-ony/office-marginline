import { colorInputValue, PALETTE } from '@marginline/core/views';
import { ChevronDown } from 'lucide-react';
import { type ReactNode, useCallback, useRef, useState } from 'react';
import { cx, keepFocus, Popover } from '../controls';

/** A toolbar icon button with a tooltip and pressed state. */
export function ToolButton({ icon, label, onClick, active, disabled, testId, shortcut, children }: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  testId?: string;
  shortcut?: string;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cx('ml-tool', active && 'is-active')}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      data-tip={shortcut ? `${label} (${shortcut})` : label}
      disabled={disabled}
      data-testid={testId}
      onMouseDown={keepFocus}
      onClick={onClick}
    >
      {icon}
      {children}
    </button>
  );
}

/** A toolbar button that opens a menu or panel below it. */
export function ToolMenu({ icon, label, text, children, disabled, active, testId, wide, chevron = true, align, title }: {
  icon?: ReactNode;
  label: string;
  text?: ReactNode;
  children: (close: () => void) => ReactNode;
  disabled?: boolean;
  active?: boolean;
  testId?: string;
  wide?: boolean;
  chevron?: boolean;
  align?: 'start' | 'end';
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={cx('ml-tool ml-tool-menu', (active || open) && 'is-active', wide && 'is-wide')}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        data-tip={label}
        disabled={disabled}
        data-testid={testId}
        onMouseDown={keepFocus}
        onClick={() => setOpen((o) => !o)}
      >
        {icon}
        {text !== undefined && <span className="ml-tool-text">{text}</span>}
        {chevron && <ChevronDown size={14} className="ml-chevron" />}
      </button>
      <Popover anchor={ref.current} open={open} onClose={close} title={title ?? label} align={align}>
        {children(close)}
      </Popover>
    </>
  );
}

/** Main action plus a separate arrow for its options (lists). */
export function SplitTool({ icon, label, optionsLabel, onClick, active, disabled, testId, children }: {
  icon: ReactNode;
  label: string;
  optionsLabel: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  testId?: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  return (
    <div ref={ref} className={cx('ml-split', active && 'is-active')}>
      <button type="button" className="ml-tool ml-split-main" aria-label={label} aria-pressed={!!active} data-tip={label} disabled={disabled} data-testid={testId} onMouseDown={keepFocus} onClick={onClick}>
        {icon}
      </button>
      <button
        type="button"
        className={cx('ml-tool ml-split-arrow', open && 'is-active')}
        aria-label={optionsLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        data-tip={optionsLabel}
        disabled={disabled}
        data-testid={testId ? `${testId}-options` : undefined}
        onMouseDown={keepFocus}
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronDown size={12} />
      </button>
      <Popover anchor={ref.current} open={open} onClose={close} title={optionsLabel}>
        {children(close)}
      </Popover>
    </div>
  );
}

/** The colour grid used for text colour, highlight and cell background. */
export function ColorPalette({ value, onPick, none, label }: {
  value: string | null;
  onPick: (hex: string | null) => void;
  /** Label of the "no colour" choice, when there is one. */
  none?: string;
  label: string;
}) {
  const current = value?.replace('#', '').toUpperCase() ?? null;
  return (
    <div className="ml-palette" role="menu" aria-label={label}>
      {none && (
        <button type="button" role="menuitem" className="ml-palette-none" aria-label="Clear color selection" onMouseDown={keepFocus} onClick={() => onPick(null)}>
          <span className="ml-swatch ml-swatch-none" /> {none}
        </button>
      )}
      {PALETTE.map((row, r) => (
        <div key={r} className="ml-palette-row" role="group">
          {row.map((c) => (
            <button
              key={c.hex}
              type="button"
              role="menuitem"
              aria-label={c.name}
              title={c.name}
              className={cx('ml-swatch', current === c.hex && 'is-selected')}
              style={{ background: `#${c.hex}` }}
              onMouseDown={keepFocus}
              onClick={() => onPick(c.hex)}
            />
          ))}
        </div>
      ))}
      <label className="ml-palette-custom">
        <span>Custom color</span>
        <input type="color" value={colorInputValue(value)} onChange={(e) => onPick(e.target.value.slice(1).toUpperCase())} />
      </label>
    </div>
  );
}

export function ToolSeparator() {
  return <span className="ml-tool-sep" role="separator" />;
}
