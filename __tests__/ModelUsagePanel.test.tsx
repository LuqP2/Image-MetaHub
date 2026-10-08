import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModelInspectorItem } from '../services/modelLibrary/types';
import { emptyModelUsage } from '../services/modelLibrary/usage';
const command = vi.hoisted(() => vi.fn<(command: unknown) => Promise<void>>(async () => {}));
vi.mock('../components/ModelManagerPanels', () => ({ executeModelCommand: command, modelButton: '' }));
import ModelUsagePanel from '../components/ModelUsagePanel';
const item = { location: { id: 'synthetic' }, usage: { ...emptyModelUsage('ready'), confirmedCount: 3, nameMatchedCount: 4, totalCount: 7, ambiguousCount: 2, lastUsedAt: 100 } } as ModelInspectorItem;
afterEach(() => { cleanup(); command.mockClear(); });
describe('model usage presentation and commands', () => {
  it('shows only the Library count and opens the principal matching set', () => {
    render(<ModelUsagePanel item={item} />);
    expect(screen.getByText('7 files in Library')).toBeTruthy();
    expect(screen.queryByText(/confirmed by hash|matched by name|additional ambiguous matches/)).toBeNull();
    fireEvent.click(screen.getByText('View in Library'));
    expect(command).toHaveBeenCalledWith({ type: 'viewLibrary', locationId: 'synthetic', mode: 'total' });
  });
  it('distinguishes pending data from a definitive zero', () => {
    const view = render(<ModelUsagePanel item={{ ...item, usage: undefined }} />);
    expect(screen.getByText('Loading Library usage…')).toBeTruthy();
    expect(screen.queryByText('0 files in Library')).toBeNull();
    view.rerender(<ModelUsagePanel item={{ ...item, usage: emptyModelUsage('partial') }} />);
    expect(screen.getByText('0 files in Library · Partial')).toBeTruthy();
  });
  it('shows unavailable categories without a navigation action', () => {
    render(<ModelUsagePanel item={{ ...item, usage: emptyModelUsage('unsupported') }} />);
    expect(screen.getByText('Usage unavailable')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
