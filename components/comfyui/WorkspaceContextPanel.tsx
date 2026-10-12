import React, { useEffect, useState } from 'react';
import { Bookmark, Box, ChevronRight, ImageIcon } from 'lucide-react';
import WorkspacePrompts, { type WorkspaceCompositionRequest } from './WorkspacePrompts';
import WorkspaceModels from './WorkspaceModels';
import { useFeatureAccess } from '../../hooks/useFeatureAccess';
const tabs = ['image', 'prompts', 'models'] as const;
type Tab = typeof tabs[number];
const icons = { image: ImageIcon, prompts: Bookmark, models: Box };
const key = 'image-metahub-comfyui-context-tab';
export default function WorkspaceContextPanel({ collapsed, onToggle, active, imagePanel, request, onOpenLibrary, onViewSource }: {
  collapsed: boolean; onToggle: () => void; active: boolean; imagePanel: React.ReactNode;
  request: WorkspaceCompositionRequest | null; onOpenLibrary: () => void; onViewSource: (path: string) => void | Promise<void>;
}) {
  const [tab, setTab] = useState<Tab>(() => { const saved = localStorage.getItem(key); return tabs.includes(saved as Tab) ? saved as Tab : 'image'; });
  const [visited, setVisited] = useState(new Set<Tab>([tab, 'image']));
  const [composition, setComposition] = useState(request);
  const { canUseAdvancedPromptLibrary, showProModal } = useFeatureAccess();
  const select = (value: Tab) => { setTab(value); setVisited(current => new Set([...current, value])); localStorage.setItem(key, value); };
  useEffect(() => { if (request) { setComposition(request); select('prompts'); } }, [request?.id]);
  const add = (text: string, channel: 'positive' | 'negative') => {
    if (!canUseAdvancedPromptLibrary) { showProModal('prompt_library_advanced'); return; }
    setComposition({ id: Date.now(), text, channel }); select('prompts');
  };
  return <div className="flex h-full min-h-0 flex-col">
    <div role="tablist" aria-label="Workspace context" className={collapsed ? 'flex flex-col gap-2 p-1 pt-3' : 'flex shrink-0 items-center gap-1 border-b border-gray-800 p-2'}>
      {tabs.map(value => { const Icon = icons[value]; return <button key={value} type="button" id={`workspace-tab-${value}`} role="tab" aria-selected={tab === value} aria-controls={`workspace-panel-${value}`} title={value === 'image' ? 'Image' : value === 'prompts' ? 'Prompts' : 'Models'} className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs ${tab === value ? 'bg-accent/15 text-accent' : 'text-gray-400 hover:bg-gray-800'}`} onClick={() => { select(value); if (collapsed) onToggle(); }} onKeyDown={event => {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
          event.preventDefault(); const next = tabs[(tabs.indexOf(value) + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? 2 : 1)) % 3]; select(next); document.getElementById(`workspace-tab-${next}`)?.focus();
        }
      }}><Icon size={16} />{!collapsed && (value === 'image' ? 'Image' : value === 'prompts' ? 'Prompts' : 'Models')}</button>; })}
      {!collapsed && <button type="button" className="ml-auto rounded p-1 text-gray-400 hover:bg-gray-800" aria-label="Collapse context panel" onClick={onToggle}><ChevronRight size={16} /></button>}
    </div>
    {tabs.map(value => <div key={value} id={`workspace-panel-${value}`} role="tabpanel" aria-labelledby={`workspace-tab-${value}`} hidden={collapsed || tab !== value} className={collapsed || tab !== value ? 'hidden' : 'min-h-0 flex-1'}>
      {value === 'image' ? imagePanel : visited.has(value) && (value === 'prompts' ?
        <WorkspacePrompts active={active && !collapsed && tab === value} request={composition} onOpenLibrary={onOpenLibrary} onViewSource={onViewSource} /> :
        <WorkspaceModels active={active && !collapsed && tab === value} onAddText={add} />)}
    </div>)}
  </div>;
}
