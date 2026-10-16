import { useEffect, useRef } from 'react';
export function usePromptDialogFocus(onClose: () => void, busy = false, modal = true) {
  const ref = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const isBusy = useRef(busy);
  isBusy.current = busy;
  const previous = useRef(document.activeElement as HTMLElement | null);
  useEffect(() => {
    const elements = () => Array.from(ref.current?.querySelectorAll<HTMLElement>(':is(button, input, textarea, select, [tabindex="0"]):not(:disabled)') || [])
      .filter(element => element.tabIndex >= 0 && !element.closest('[hidden], [inert]'));
    elements()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (!modal && (!ref.current?.contains(document.activeElement) || ref.current.closest('[hidden]'))) return;
      if(event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if(!isBusy.current)
          close.current();
      }
      if(event.key === 'Tab' && modal) {
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
  }, [modal]);
  return ref;
}
