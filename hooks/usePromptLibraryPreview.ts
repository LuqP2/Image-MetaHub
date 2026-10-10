import { useEffect, useState } from 'react';
import type { PromptLibraryItem } from '../types';
import { sessionPreviewFile } from '../services/promptLibrary/sessionPreviews';
export { linkSessionPreview } from '../services/promptLibrary/sessionPreviews';
export function usePromptLibraryPreview(item: PromptLibraryItem | null, active = true) {
  const [url, setUrl] = useState<string | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [status, setStatus] = useState('No preview');
  const key = item ? `${item.id}:${item.revision || 1}:${JSON.stringify(item.editor?.preview)}` : '';
  useEffect(() => {
    setUrl(null);
    setPath(null);
    let canceled = false;
    let objectUrl: string | null = null;
    if(!item || !active || item.editor?.preview === 'hidden') {
      setStatus('No preview');
      return;
    }
    setStatus('Loading preview…');
    void (async () => {
      try {
        if(!window.electronAPI) {
          const file = sessionPreviewFile(item.id);
          if(file) {
            objectUrl = URL.createObjectURL(file);
            if(!canceled) {
              setUrl(objectUrl);
              setStatus('');
            }
          }
          else if(!canceled)
            setStatus(item.editor?.preview ? 'Relink image' : 'No preview');
          return;
        }
        const api = window.electronAPI;
        const response = await api.promptLibraryResolvePreview('text' in item ? 'block' : 'prompt', item.id);
        if(canceled)
          return;
        if(!response.success || response.data.status !== 'available') {
          setStatus('Preview unavailable — relink image');
          return;
        }
        setPath(response.data.absolutePath);
        const thumbnail = await api.generateThumbnailFromPath({ filePath: response.data.absolutePath, maxEdge: 420, quality: 82 });
        if(canceled)
          return;
        if(thumbnail.success && thumbnail.data) {
          objectUrl = URL.createObjectURL(new Blob([new Uint8Array(thumbnail.data)], { type: thumbnail.mimeType || 'image/webp' }));
          setUrl(objectUrl);
          setStatus(response.data.sourceChanged ? 'Source has changed' : '');
        }
        else
          setStatus('Preview unavailable');
      }
      catch {
        if(!canceled)
          setStatus('Preview unavailable');
      }
    })();
    return () => {
      canceled = true; if(objectUrl)
        URL.revokeObjectURL(objectUrl);
    };
  }, [key, active]);
  return { url, path, status };
}
