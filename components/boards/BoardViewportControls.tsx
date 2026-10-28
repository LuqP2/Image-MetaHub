import { useEffect, useRef, useState } from 'react';
import { useReactFlow, useViewport } from '@xyflow/react';
import { Minus, Plus, MoreHorizontal } from 'lucide-react';
import { useBoardStore } from '../../store/useBoardStore';
import { useBoardUIStore } from '../../store/useBoardUIStore';
import BoardMiniMap from './BoardMiniMap';
export default function BoardViewportControls({boardId,onFitAll}: {boardId:string;onFitAll():void}) {
 const flow=useReactFlow(); const {zoom}=useViewport(); const session=useBoardStore(s=>s.sessions[boardId]); const ui=useBoardUIStore();
 const [open,setOpen]=useState(false); const root=useRef<HTMLDivElement>(null); const trigger=useRef<HTMLButtonElement>(null);
 useEffect(()=>{ if(!open)return; const pointer=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);}; const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setOpen(false);trigger.current?.focus();}}; document.addEventListener('pointerdown',pointer);document.addEventListener('keydown',key,true);return()=>{document.removeEventListener('pointerdown',pointer);document.removeEventListener('keydown',key,true);};},[open]);
 return <div ref={root} className="board-viewport-controls nodrag nopan nowheel">{ui.minimapOpen && <BoardMiniMap objects={session.document.objects}/>}
 {open && <div className="board-popover"><button className="board-button" onClick={()=>{onFitAll();setOpen(false);}}>Fit all</button><button className="board-button" disabled={!session.selectedObjectIds.length} onClick={()=>{void flow.fitView({nodes:session.selectedObjectIds.map(id=>({id})),padding:0.12,maxZoom:1});setOpen(false);}}>Fit selection</button><button className="board-button" onClick={()=>{ui.setMinimapOpen(!ui.minimapOpen);setOpen(false);}}>{ui.minimapOpen?'Hide minimap':'Show minimap'}</button></div>}
 <div className="board-zoom-row"><button className="board-icon-button" aria-label="Zoom out" onClick={()=>void flow.zoomOut()}><Minus size={15}/></button><span>{Math.round(zoom*100)}%</span><button className="board-icon-button" aria-label="Zoom in" onClick={()=>void flow.zoomIn()}><Plus size={15}/></button><button ref={trigger} className="board-icon-button" aria-label="Viewport options" aria-expanded={open} onClick={()=>setOpen(!open)}><MoreHorizontal size={16}/></button></div></div>;
}
