import { useEffect, useRef } from 'react';
export function usePromptDialogFocus(onClose: () => void, busy = false) {
  const ref = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const isBusy = useRef(busy);
  isBusy.current = busy;
  const previous = useRef(document.activeElement as HTMLElement | null);
  useEffect(() => {
    const elements = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]') || []);
    elements()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if(event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if(!isBusy.current)
          close.current();
      }
      if(event.key === 'Tab') {
        const list = elements();
        const first = list[0];
        const last = list[list.length - 1];
        if(event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        }
        else if(!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener('keydown', keydown, true);
    return () => { window.removeEventListener('keydown', keydown, true); previous.current?.focus(); };
  }, []);
  return ref;
}
