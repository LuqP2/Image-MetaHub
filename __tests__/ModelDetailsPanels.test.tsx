import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModelInspectorItem } from '../services/modelLibrary/types';

vi.mock('../services/modelLibrary/manager', () => ({ useModelManager: () => ({ catalog: { locations: [] }, watches: {}, hfWatches: {} }) }));
vi.mock('../services/modelLibrary/huggingFaceTracking', () => ({ modelUpdateCounts: () => ({ 'location:one': 2 }) }));
vi.mock('../components/ModelManagerPanels', () => ({
  ModelQuickActions: () => <p>Quick actions</p>, ModelFilesPanel: () => <p>File actions</p>, ModelLocalEditor: () => <p>Metadata editor</p>, ModelMediaPanel: () => <p>Media actions</p>,
  ModelActionsPanel: ({ grouped }: { grouped: boolean }) => <p>Civitai {grouped ? 'grouped' : 'ungrouped'}</p>,
}));
vi.mock('../components/HuggingFaceModelPanel', () => ({ HuggingFaceModelPanel: () => <p>HF controls</p> }));
vi.mock('../components/ModelUsagePanel', () => ({ default: () => <p>Simple usage count</p> }));
import ModelDetailsPanels from '../components/ModelDetailsPanels';
const item = (id: string) => ({ location: { id } }) as ModelInspectorItem;
afterEach(cleanup);
describe('shared detail panel organization', () => {
  it('starts collapsed, retains section expansion while changing models, and reveals provider updates on request', async () => {
    const view = render(<ModelDetailsPanels item={item('one')} />);
    const connections = screen.getByText('Connections & updates · 2 new').closest('details')!;
    const files = screen.getByText('Files', { exact: true }).closest('details')!;
    const media = screen.getByText('Cover & examples', { exact: true }).closest('details')!;
    expect(connections.open).toBe(false); expect(files.open).toBe(false); expect(media.open).toBe(false);
    files.open = true; fireEvent(files, new Event('toggle'));
    view.rerender(<ModelDetailsPanels item={item('two')} />);
    expect(screen.getByText('Files', { exact: true }).closest('details')!.open).toBe(true);
    view.rerender(<ModelDetailsPanels item={item('two')} revealUpdates={1} />);
    await waitFor(() => expect(screen.getByText('Connections & updates').closest('details')!.open).toBe(true));
    expect(screen.getByText('Civitai grouped')).toBeTruthy(); expect(screen.getByText('HF controls')).toBeTruthy();
    expect(screen.getByText('Simple usage count')).toBeTruthy(); expect(screen.getAllByText('Quick actions')).toHaveLength(1);
  });
});
