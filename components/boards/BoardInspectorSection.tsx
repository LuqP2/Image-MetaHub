import { useBoardUIStore } from '../../store/useBoardUIStore';
import { useId, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
export default function BoardInspectorSection({ title, defaultOpen = false, children, stateKey }: { stateKey?: string; title: string; defaultOpen?: boolean; children: ReactNode }) {
  const [localOpen, setLocalOpen] = useState(defaultOpen); const id = useId();
  const stored = useBoardUIStore(state => stateKey ? state.sections[stateKey] : undefined);
  const open = stored ?? localOpen;
  const setOpen = (value: boolean) => stateKey ? useBoardUIStore.getState().setSection(stateKey, value) : setLocalOpen(value);
  return <section className="board-section"><button className="board-section-trigger" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>{title}{open ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}</button>{open && <div id={id} className="board-section-content">{children}</div>}</section>;
}
