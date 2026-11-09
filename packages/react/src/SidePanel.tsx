import type { SidePanelTab } from '@marginline/core/views';
import { ListChecks, PanelRightClose, TextCursorInput } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from './controls';
import { useUI } from './context';
import { FieldsPanel } from './FieldsPanel';
import { ReviewPanel } from './review/ReviewPanel';

const TABS: { id: SidePanelTab; label: string; icon: ReactNode }[] = [
  { id: 'review', label: 'Review', icon: <ListChecks size={16} /> },
  { id: 'fields', label: 'Fields', icon: <TextCursorInput size={16} /> },
];

/** The right-hand panel with Review (comments and changes) and Fields tabs. */
export function SidePanel({ inSheet }: { inSheet?: boolean }) {
  const { panelTab, setPanelTab, setPanelOpen } = useUI();
  return (
    <aside className={cx('ml-side', inSheet && 'in-sheet')} aria-label="Editor side panel" data-testid="side-panel">
      <div className="ml-side-tabs" role="tablist" aria-label="Side panel">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={panelTab === t.id} className={cx('ml-side-tab', panelTab === t.id && 'is-on')} data-testid={`tab-${t.id}`} onClick={() => setPanelTab(t.id)}>
            {t.icon} {t.label}
          </button>
        ))}
        {!inSheet && (
          <button type="button" className="ml-icon-btn ml-side-close" aria-label="Minimize side panel" title="Minimize side panel" onClick={() => setPanelOpen(false)}>
            <PanelRightClose size={16} />
          </button>
        )}
      </div>
      <div className="ml-side-body" role="tabpanel" aria-label={panelTab === 'review' ? 'Review' : 'Fields'}>
        {panelTab === 'review' ? <ReviewPanel /> : <FieldsPanel />}
      </div>
    </aside>
  );
}
