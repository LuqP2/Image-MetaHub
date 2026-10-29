import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BoardQueryFilterEditor from '../components/boards/BoardQueryFilterEditor';
import BoardLocalSizer from '../components/boards/BoardLocalSizer';
import { normalizeLibraryQueryCriteria } from '../services/libraryQuery/criteria';

vi.mock('../components/AdvancedFilters', () => ({ default: () => null }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('Canvas assisted filtering and local sizing', () => {
  it('keeps comma-containing values intact, switches inclusion/exclusion and removes missing selections', () => {
    function Fixture() {
      const [value, setValue] = useState(normalizeLibraryQueryCriteria({ selectedModels: ['Missing'] }));
      return <><BoardQueryFilterEditor value={value} onChange={setValue} disabled={false} facets={{ availableModels: ['Model, with comma'], availableLoras: [], availableSamplers: [], availableSchedulers: [], availableGenerators: [], availableGpuDevices: [], availableDimensions: [], modelFacetCounts: [], loraFacetCounts: [], samplerFacetCounts: [], schedulerFacetCounts: [], sourceCounts: { Models: [['Model, with comma', 7]] } }} /><output>{JSON.stringify(value)}</output></>;
    }
    render(<Fixture />);
    fireEvent.click(screen.getByRole('button', { name: /^Checkpoints/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Include Checkpoints: Model, with comma' }));
    expect(screen.getByRole('status').textContent).toContain('"selectedModels":["Missing","Model, with comma"]');
    fireEvent.click(screen.getByRole('button', { name: 'Exclude Checkpoints: Model, with comma' }));
    expect(screen.getByRole('status').textContent).toContain('"selectedModels":["Missing"]');
    expect(screen.getByRole('status').textContent).toContain('"excludedModels":["Model, with comma"]');
    fireEvent.click(screen.getByRole('button', { name: 'Remove Checkpoints: Missing' }));
    expect(screen.getByRole('status').textContent).toContain('"selectedModels":[]');
    expect(screen.getByText('7 in source')).toBeTruthy();
  });
  it.each([0.5, 0.7, 1, 1.5])('measures local dimensions independently of transform %s and observes resize', zoom => {
    let width = 640, height = 320, notify: (() => void) | undefined;
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => height);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: width * zoom, height: height * zoom } as DOMRect);
    vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { notify = callback; } observe() {} disconnect() {} });
    render(<BoardLocalSizer>{size => <output>{size.width}×{size.height}</output>}</BoardLocalSizer>);
    expect(screen.getByRole('status').textContent).toBe('640×320');
    width = 820; height = 480;
    act(() => notify?.());
    expect(screen.getByRole('status').textContent).toBe('820×480');
  });
});
