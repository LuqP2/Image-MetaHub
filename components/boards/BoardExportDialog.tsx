import { useTranslation } from '../../i18n/useTranslation';
import { useEffect, useRef } from 'react';

export default function BoardExportDialog({ close, exportDocument, exportPng }: { close(): void; exportDocument(): void; exportPng(): void }) {
  const { t } = useTranslation();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; root.current?.querySelector('button')?.focus(); return () => { if (previous?.isConnected) previous.focus(); }; }, []);
  return <div ref={root} role="dialog" aria-modal="true" aria-label={t('canvas.export')} className="board-export-backdrop" onKeyDown={event => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'Tab') { const buttons = [...event.currentTarget.querySelectorAll('button')]; if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1)?.focus(); } else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0]?.focus(); } }
  }}><div className="board-export-dialog"><h2>{t('canvas.export')}</h2><button className="board-export-choice" aria-label={t('canvas.png')} onClick={exportPng}><strong>{t('canvas.png')}</strong><span>{t('canvas.pngHelp')}</span></button><button className="board-export-choice" aria-label={t('canvas.editableBoard')} onClick={exportDocument}><strong>{t('canvas.editableBoard')}</strong><span>{t('canvas.editableHelp')}</span></button><button className="board-button" onClick={close}>{t('libraryFolders.cancel')}</button></div></div>;
}
