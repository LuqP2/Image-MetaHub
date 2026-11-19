import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GenerationQueueSidebar from '../components/GenerationQueueSidebar';
import { useGenerationQueueStore, type GenerationQueueItem } from '../store/useGenerationQueueStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { formatMessage, languages } from '../i18n/messages.mjs';

vi.mock('../hooks/useGenerateWithA1111', () => ({ useGenerateWithA1111: () => ({ generateWithA1111: vi.fn() }) }));
vi.mock('../hooks/useGenerateWithComfyUI', () => ({ useGenerateWithComfyUI: () => ({ generateWithComfyUI: vi.fn() }) }));
vi.mock('../contexts/A1111ProgressContext', () => ({ useA1111ProgressContext: () => ({ stopPolling: vi.fn() }) }));
vi.mock('../contexts/ComfyUIProgressContext', () => ({ useComfyUIProgressContext: () => ({ stopTracking: vi.fn() }) }));

describe('generation queue localization', () => {
  beforeEach(() => {
    useSettingsStore.getState().resetState();
    useGenerationQueueStore.setState({ items: [], activeJobs: { a1111: null, comfyui: null } });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it.each(languages)('preserves jobs and technical values while switching to %s', (language) => {
    const item: GenerationQueueItem = {
      id: 'synthetic-job', provider: 'comfyui', origin: 'metahub',
      imageName: 'fixture {name} 海.png', prompt: 'original {prompt} 海',
      status: 'processing', progress: 0.5, currentNode: 'KSamplerAdvanced',
      createdAt: 1234, updatedAt: 1234, currentStep: 10, totalSteps: 20,
    };
    useGenerationQueueStore.setState({ items: [item] });
    const close = vi.fn();
    render(<GenerationQueueSidebar onClose={close} width={320} isResizing={false} onResizeStart={() => {}} />);
    act(() => useSettingsStore.setState({ language }));
    expect(screen.getByText(formatMessage(language, 'generationQueue.processing'))).toBeTruthy();
    expect(screen.getByText(item.imageName)).toBeTruthy();
    expect(screen.getByText(item.prompt!)).toBeTruthy();
    expect(screen.getByText(formatMessage(language, 'generationQueue.currentNode', { node: item.currentNode! }))).toBeTruthy();
    expect(useGenerationQueueStore.getState().items).toEqual([item]);
    fireEvent.click(screen.getByRole('button', { name: formatMessage(language, 'generationQueue.remove') }));
    expect(useGenerationQueueStore.getState().items).toEqual([]);
    expect(screen.getByText(formatMessage(language, 'generationQueue.empty'))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: formatMessage(language, 'generationQueue.close') }));
    expect(close).toHaveBeenCalledOnce();
  });

  it('translates an existing workflow success message without submitting it again', async () => {
    const run = vi.fn().mockResolvedValue({ success: true });
    const previous = window.electronAPI;
    window.electronAPI = { ...previous, comfyUIViewRunWorkflow: run } as typeof window.electronAPI;
    try {
      useSettingsStore.setState({ comfyUIEnabled: true });
      render(<GenerationQueueSidebar onClose={() => {}} width={320} isResizing={false} onResizeStart={() => {}} />);
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Run current ComfyUI workflow' })));
      expect(screen.getByText('Workflow queued in ComfyUI.')).toBeTruthy();
      act(() => useSettingsStore.setState({ language: 'ja' }));
      expect(screen.getByText(formatMessage('ja', 'generationQueue.queued'))).toBeTruthy();
      expect(run).toHaveBeenCalledOnce();
    } finally { window.electronAPI = previous; }
  });
});
