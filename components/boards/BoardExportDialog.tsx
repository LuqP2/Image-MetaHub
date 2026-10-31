import { useEffect, useRef } from 'react';

export default function BoardExportDialog({ close, exportDocument, exportPng }: { close(): void; exportDocument(): void; exportPng(): void }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; root.current?.querySelector('button')?.focus(); return () => { if (previous?.isConnected) previous.focus(); }; }, []);
  return <div ref={root} role="dialog" aria-modal="true" aria-label="Export board" className="board-export-backdrop" onKeyDown={event => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'Tab') { const buttons = [...event.currentTarget.querySelectorAll('button')]; if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1)?.focus(); } else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0]?.focus(); } }
  }}><div className="board-export-dialog"><h2>Export board</h2><button className="board-export-choice" aria-label="PNG image" onClick={exportPng}><strong>PNG image</strong><span>Export the board or selection as an image.</span></button><button className="board-export-choice" aria-label="Editable board (.imhboard.json)" onClick={exportDocument}><strong>Editable board (.imhboard.json)</strong><span>Keep objects, references and live queries editable.</span></button><button className="board-button" onClick={close}>Cancel</button></div></div>;
}
