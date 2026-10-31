import type { Directory, BaseMetadata } from '../types';
import type { ImageModalImageDTO } from './imageViewerContracts';
import type { ComparisonUIState } from '../store/useComparisonUIStore';
export interface ComparisonSnapshot { sessionId: string; images: ImageModalImageDTO[]; directories: Omit<Directory, 'handle'>[]; ui: ComparisonUIState }
export interface ComparisonGenerateRequest { imageId: string; metadata: Partial<BaseMetadata>; numberOfImages?: number }
export type ComparisonCommand = { type: 'generate'; request: ComparisonGenerateRequest } | { type: 'ui'; ui: ComparisonUIState } | { type: 'swap' } | { type: 'remove'; index: number };
export type ComparisonEvent = { sessionId: string } & ({ type: 'command'; command: ComparisonCommand } | { type: 'closed' | 'returned' | 'failed'; error?: string });
export const selectInlineComparisonOpen = (state: { isComparisonModalOpen: boolean; isComparisonDetached: boolean }) => state.isComparisonModalOpen && !state.isComparisonDetached;
export interface ComparisonBridge {
  open(snapshot: ComparisonSnapshot): Promise<{ success: boolean; error?: string }>;
  update(snapshot: ComparisonSnapshot): Promise<{ success: boolean }>;
  ready(sessionId: string, applied?: boolean): Promise<ComparisonSnapshot | null>;
  command(sessionId: string, command: ComparisonCommand): Promise<{ success: boolean }>;
  close(sessionId: string, returning?: boolean): Promise<{ success: boolean }>;
  onSnapshot(callback: (snapshot: ComparisonSnapshot) => void): () => void;
  onEvent(callback: (event: ComparisonEvent) => void): () => void;
}
