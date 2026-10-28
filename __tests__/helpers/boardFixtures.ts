import { createBoardDocument } from '../../services/boards/document.mjs';
import { addAssets, addText } from '../../services/boards/operations';
import type { BoardAssetLocator, BoardReferenceRemap } from '../../services/boards/types';

export const boardLocator = (name: string): BoardAssetLocator => ({ imageId: `library::${name}`, directoryPath: 'C:/synthetic-library', relativePath: name });
export const boardRemap = (from: string, to: string, operationId = `${from}->${to}`): BoardReferenceRemap => ({ operationId, oldLocator: boardLocator(from), newLocator: boardLocator(to) });
export const boardWithAsset = () => addAssets(createBoardDocument('Synthetic board'), [{ reference: { kind: 'path', locator: boardLocator('a.png') }, name: 'a.png', mediaType: 'image', width: 512, height: 512 }], { x: 100, y: 200 });
export const boardWithTexts = () => addText(addText(createBoardDocument('Synthetic board'), { x: 0, y: 0 }), { x: 400, y: 0 });
