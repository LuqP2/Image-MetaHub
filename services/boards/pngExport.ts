import { selectionClosure } from './clipboard';
import { getBoardBounds } from './layout';
import type { BoardDocument, BoardObject } from './types';

export function pngExportDocument(document: BoardDocument, selectedIds?: string[]): BoardDocument {
  if (!selectedIds) return document;
  const selected = selectionClosure(document, selectedIds);
  return { ...document, objects: document.objects.filter(object => selected.has(object.id)).map(object => ({ ...object, frameId: object.frameId && selected.has(object.frameId) ? object.frameId : null } as BoardObject)),
    connections: document.connections.filter(edge => selected.has(edge.sourceObjectId) && selected.has(edge.targetObjectId)) };
}
export function pngExportSize(document: BoardDocument, scale: number) {
  const bounds = getBoardBounds(document.objects);
  const width = Math.ceil((bounds.width + 64) * scale), height = Math.ceil((bounds.height + 64) * scale);
  return { bounds, width, height, valid: document.objects.length > 0 && [1, 2, 4].includes(scale) && width <= 16384 && height <= 16384 && width * height <= 64000000 };
}
async function imageData(source: string): Promise<string> {
  if (source.startsWith('data:')) return source;
  const response = await fetch(source);
  if (!response.ok) throw new Error('An image could not be loaded for export.');
  const blob = await response.blob();
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob); });
}
/** Freeze computed styles, local images and scroll positions; the isolated renderer needs no app privileges. */
async function freezeElement(root: HTMLElement): Promise<HTMLElement> {
  await document.fonts.ready;
  await Promise.all([...root.querySelectorAll('img')].map(async image => { if (!image.complete) await image.decode(); if (!image.naturalWidth) throw new Error('An image could not be loaded for export.'); }));
  const clone = root.cloneNode(true) as HTMLElement;
  const originals = [root, ...root.querySelectorAll('*')];
  const copies = [clone, ...clone.querySelectorAll('*')];
  await Promise.all(originals.map(async (element, index) => {
    const copy = copies[index] as HTMLElement | SVGElement;
    const computed = getComputedStyle(element);
    for (let index = 0; index < computed.length; index++) { const property = computed[index]; copy.style.setProperty(property, computed.getPropertyValue(property)); }
    for (const attribute of [...copy.attributes]) if (attribute.name.startsWith('on')) copy.removeAttribute(attribute.name);
    if (element instanceof HTMLImageElement) { copy.setAttribute('src', await imageData(element.currentSrc || element.src)); copy.removeAttribute('srcset'); }
    if (element instanceof HTMLTextAreaElement) copy.textContent = element.value;
    if (element.scrollTop || element.scrollLeft) {
      // Preserve the visible portion of scrollable Smart Frame lists.
      const inner = document.createElement('div');
      inner.style.cssText = `transform:translate(${-element.scrollLeft}px,${-element.scrollTop}px);`;
      while (copy.firstChild) inner.append(copy.firstChild);
      copy.append(inner);
    }
  }));
  return clone;
}
export async function serializeExportScene(root: HTMLElement): Promise<string> {
  const clone = await freezeElement(root);
  // Reuse each on-screen Smart Frame's current browse mode and scroll state.
  // Off-screen frames are materialized by the export renderer with the same default presentation.
  for (const node of clone.querySelectorAll<HTMLElement>('.react-flow__node-smart-frame')) {
    const id = node.dataset.id;
    const live = id ? document.querySelector<HTMLElement>(`.board-stage .react-flow__node[data-id="${CSS.escape(id)}"] .board-smart-frame`) : null;
    if (live) node.querySelector('.board-smart-frame')?.replaceWith(await freezeElement(live));
  }
  clone.style.position = 'relative'; clone.style.left = '0'; clone.style.top = '0'; clone.style.opacity = '1';
  clone.querySelectorAll('.react-flow__handle,.react-flow__resize-control,.react-flow__attribution,button:not(.board-result-thumb)').forEach(element => element.remove());
  return clone.outerHTML;
}
