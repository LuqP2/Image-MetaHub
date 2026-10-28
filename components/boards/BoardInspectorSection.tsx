import { useId, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
export default function BoardInspectorSection({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen); const id = useId();
  return <section className="board-section"><button className="board-section-trigger" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>{title}{open ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}</button>{open && <div id={id} className="board-section-content">{children}</div>}</section>;
}
