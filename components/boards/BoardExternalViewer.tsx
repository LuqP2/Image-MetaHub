import { useEffect, useRef } from 'react';
import ImageModal from '../ImageModal';
import type { IndexedImage } from '../../types';

/** External Canvas files have no entry in the library's id-only viewer sessions. */
export default function BoardExternalViewer({ image, directoryPath, close }: { image: IndexedImage; directoryPath: string; close(): void }) {
  const restoreFocus = useRef(document.activeElement as HTMLElement | null);
  useEffect(() => () => { restoreFocus.current?.focus({ preventScroll: true }); }, []);
  return <ImageModal image={image} directoryPath={directoryPath} onClose={close} isActive zIndex={160} />;
}
