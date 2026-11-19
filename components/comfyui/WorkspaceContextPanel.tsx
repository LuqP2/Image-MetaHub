import { useTranslation } from '../../i18n/useTranslation';
import React, { useId, useState } from 'react';
import { Bookmark, Box, ChevronLeft, Images } from 'lucide-react';
import WorkspacePrompts, { type WorkspaceCompositionRequest } from './WorkspacePrompts';
import WorkspaceModels from './WorkspaceModels';
import { useFeatureAccess } from '../../hooks/useFeatureAccess';

const tabLabels = { library: 'settings.navigation.library', prompt: 'promptLibrary.promptType', models: 'modelLibrary.models' } as const;
const tabs = [
  { id: 'library', Icon: Images },
  { id: 'prompt', Icon: Bookmark },
  { id: 'models', Icon: Box },
] as const;
type Tab = typeof tabs[number]['id'];

export default function WorkspaceContextPanel({ collapsed, onToggle, active, libraryPanel, onOpenLibrary, onViewSource }: {
  collapsed: boolean;
  onToggle: () => void;
  active: boolean;
  libraryPanel: (visible: boolean) => React.ReactNode;
  onOpenLibrary: () => void;
  onViewSource: (path: string) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [tab, setTab] = useState<Tab>('library');
  const [visited, setVisited] = useState(new Set<Tab>(['library']));
  const [composition, setComposition] = useState<WorkspaceCompositionRequest | null>(null);
  const { canUseAdvancedPromptLibrary, showProModal } = useFeatureAccess();

  const select = (value: Tab) => {
    setTab(value);
    setVisited(current => current.has(value) ? current : new Set([...current, value]));
  };

  const add = (text: string, channel: 'positive' | 'negative') => {
    if (!canUseAdvancedPromptLibrary) {
      showProModal('prompt_library_advanced');
      return;
    }
    setComposition({ id: crypto.randomUUID(), text, channel });
    select('prompt');
    requestAnimationFrame(() => document.getElementById(`${id}-tab-prompt`)?.focus());
  };

  return <div className="flex h-full min-h-0 flex-col">
    <div className={`flex shrink-0 border-b border-gray-800 ${collapsed ? 'flex-col p-1' : 'items-center gap-1 px-2'}`}>
      <div role="tablist" aria-label={t('integrations.workspaceTools')} aria-orientation={collapsed ? 'vertical' : 'horizontal'} className={`flex flex-1 ${collapsed ? 'flex-col' : 'min-w-0 items-center'}`}>
        {tabs.map(({ id: value, Icon }, index) => (
          <button key={value} type="button" id={`${id}-tab-${value}`} role="tab" aria-label={t(tabLabels[value])}
            aria-selected={tab === value} aria-controls={`${id}-panel-${value}`}
            tabIndex={tab === value ? 0 : -1} title={t(tabLabels[value])}
            className={`flex h-8 items-center justify-center gap-1.5 px-2 text-xs focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-accent hover:bg-gray-800 ${collapsed ? 'border-l-2' : 'flex-1 border-b-2'} ${tab === value ? 'border-accent text-gray-100' : 'border-transparent text-gray-400'}`}
            onClick={() => { select(value); if (collapsed) onToggle(); }}
            onKeyDown={event => {
              const previous = collapsed ? 'ArrowUp' : 'ArrowLeft';
              const next = collapsed ? 'ArrowDown' : 'ArrowRight';
              const target = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 :
                event.key === previous ? (index + tabs.length - 1) % tabs.length :
                event.key === next ? (index + 1) % tabs.length : null;
              if (target === null) return;
              event.preventDefault();
              const nextTab = tabs[target].id;
              select(nextTab);
              document.getElementById(`${id}-tab-${nextTab}`)?.focus();
            }}
          >
            <Icon size={14} className="shrink-0" />
            {!collapsed && t(tabLabels[value])}
          </button>
        ))}
      </div>
      {!collapsed && <button type="button" className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-800 focus-visible:outline focus-visible:outline-accent" title={t('integrations.collapseSidebar')} aria-label={t('integrations.collapseSidebar')} onClick={() => {
        onToggle();
        document.getElementById(`${id}-tab-${tab}`)?.focus();
      }}><ChevronLeft size={14} /></button>}
    </div>
    {tabs.map(({ id: value }) => {
      const visible = !collapsed && tab === value;
      return <div key={value} id={`${id}-panel-${value}`} role="tabpanel" aria-labelledby={`${id}-tab-${value}`}
        hidden={!visible} className={visible ? 'min-h-0 flex-1' : 'hidden'}>
        {value === 'library' ? libraryPanel(visible) : visited.has(value) && (value === 'prompt' ?
          <WorkspacePrompts active={active && visible} visiblePanel={visible} request={composition} onOpenLibrary={onOpenLibrary} onViewSource={onViewSource} /> :
          <WorkspaceModels active={active && visible} visiblePanel={visible} onAddText={add} />)}
      </div>;
    })}
  </div>;
}
