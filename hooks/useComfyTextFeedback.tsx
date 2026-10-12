import React, { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Toast from '../components/Toast';
import type { ComfyUITextResult, ComfyUITextTarget } from '../types';
import { copyTextToClipboard } from '../utils/imageUtils';

type Notice = { message: string; variant: 'success' | 'warning' | 'error'; detail?: string; text?: string };
export function useComfyTextFeedback() {
  const [notice, setNotice] = useState<(Notice & { id: number }) | null>(null);
  const sequence = useRef(0);
  const notify = (next: Notice) => setNotice({ ...next, id: ++sequence.current });
  const dismiss = useCallback(() => setNotice(null), []);
  const report = (result: ComfyUITextResult | undefined, mode: 'append' | 'replace' | 'replaceSelection', text: string, target?: ComfyUITextTarget, lookup = false) => {
    if (result?.success && !lookup) {
      notify({ variant: 'success', message: mode === 'append' ? 'Text added to node' : mode === 'replace' ? 'Node text replaced' : 'Selected text replaced', detail: target ? `${target.nodeTitle} · ${target.field}` : undefined });
    } else {
      const warning = (lookup && !!result && !result.code) || ['selection', 'unsupported', 'conflict', 'invalid'].includes(result?.code || '');
      notify({ variant: warning ? 'warning' : 'error', message: result?.message || 'Could not update node text', text });
    }
  };
  const toast = notice && createPortal(<Toast key={notice.id} prominent message={notice.message} detail={notice.detail} variant={notice.variant} duration={notice.variant === 'success' ? 3000 : 7000} onDismiss={dismiss} action={notice.text ? { label: 'Copy text instead', onClick: () => { void copyTextToClipboard(notice.text!).then(result => notify({ variant: result.success ? 'success' : 'error', message: result.success ? 'Text copied' : result.error || 'Could not copy text' })); } } : undefined} />, document.body);
  return { report, toast };
}
