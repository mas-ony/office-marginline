import { cx, focusFirstMenuItem, keepFocus, menuKeyDown, placePopover, trackPopover, trapFocus } from '@marginline/core/views';
import { Check, X } from 'lucide-react';
import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useUI } from './context';

export { cx, keepFocus };

// -----------------------------------------------------------------------------------------------
// Popover

interface PopoverProps {
  anchor: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  align?: 'start' | 'end';
  /** Render as a bottom sheet on small screens. */
  sheetOnMobile?: boolean;
  title?: string;
}

export function Popover({ anchor, open, onClose, children, className, align = 'start', sheetOnMobile = true, title }: PopoverProps) {
  const { layer, mobile: isMobile } = useUI();
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' });
  const mobile = isMobile && sheetOnMobile;

  useLayoutEffect(() => {
    if (!open || mobile || !anchor || !ref.current) return;
    const place = () => setStyle(placePopover(anchor, ref.current!, align));
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, anchor, mobile, align, children]);

  // onClose may be a new function on every render; the latest one is used.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    return trackPopover(ref.current, () => anchor, () => closeRef.current());
  }, [open, anchor]);

  if (!open) return null;
  if (mobile) {
    return createPortal(
      <div ref={ref} className="ml-ui-sheet-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
        <div className={cx('ml-ui-sheet', className)} role="dialog" aria-label={title}>
          <div className="ml-ui-sheet-grip" />
          {title && (
            <div className="ml-ui-sheet-title">
              <span>{title}</span>
              <button type="button" className="ml-ui-btn" aria-label="Close" onClick={onClose}><X size={18} /></button>
            </div>
          )}
          <div className="ml-ui-sheet-body">{children}</div>
        </div>
      </div>,
      layer,
    );
  }
  return createPortal(
    <div ref={ref} className={cx('ml-ui-popover', className)} style={{ position: 'fixed', ...style }} role="dialog" aria-label={title}>
      {children}
    </div>,
    layer,
  );
}

// -----------------------------------------------------------------------------------------------
// Menus

export function Menu({ children, label }: { children: ReactNode; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => focusFirstMenuItem(ref.current), []);
  return (
    <div ref={ref} className="ml-ui-menu" role="menu" aria-label={label} onKeyDown={(e) => menuKeyDown(ref.current, e.nativeEvent)}>
      {children}
    </div>
  );
}

export function MenuItem({ icon, label, description, onSelect, checked, toggle, disabled, shortcut, testId, style }: {
  icon?: ReactNode;
  label: ReactNode;
  description?: string;
  onSelect: () => void;
  checked?: boolean;
  /** With `checked`: an on/off setting (a menuitemcheckbox) rather than one of several choices. */
  toggle?: boolean;
  disabled?: boolean;
  shortcut?: string;
  testId?: string;
  style?: CSSProperties;
}) {
  return (
    <button
      type="button"
      className={cx('ml-ui-menuitem', checked && 'is-checked')}
      role={checked === undefined ? 'menuitem' : toggle ? 'menuitemcheckbox' : 'menuitemradio'}
      aria-checked={checked}
      disabled={disabled}
      data-testid={testId}
      onMouseDown={keepFocus}
      onClick={onSelect}
    >
      <span className="ml-ui-menuitem-icon">{checked ? <Check size={16} /> : icon}</span>
      <span className="ml-ui-menuitem-text">
        <span className="ml-ui-menuitem-label" style={style}>{label}</span>
        {description && <span className="ml-ui-menuitem-desc">{description}</span>}
      </span>
      {shortcut && <span className="ml-ui-menuitem-shortcut">{shortcut}</span>}
    </button>
  );
}

export function MenuSeparator() {
  return <div className="ml-ui-menu-sep" role="separator" />;
}

// -----------------------------------------------------------------------------------------------
// Dialogs

export function Modal({ title, open, onClose, children, footer, testId, wide }: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  testId?: string;
  wide?: boolean;
}) {
  const { layer } = useUI();
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    return trapFocus(ref.current, () => closeRef.current());
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div className="ml-ui-modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={cx('ml-ui-modal', wide && 'is-wide')} role="dialog" aria-modal="true" aria-label={title} data-testid={testId}>
        <div className="ml-ui-modal-head">
          <h2>{title}</h2>
          <button type="button" className="ml-ui-btn ml-ui-modal-close" aria-label="Close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="ml-ui-modal-body">{children}</div>
        {footer && <div className="ml-ui-modal-foot">{footer}</div>}
      </div>
    </div>,
    layer,
  );
}

export function Field({ label, children, htmlFor }: { label: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="ml-ui-field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}

export function Toast({ message }: { message: string }) {
  const { layer } = useUI();
  return createPortal(<div className="ml-ui-toast" role="status">{message}</div>, layer);
}
