import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import ActiveFilters from '../components/ActiveFilters';
import Footer from '../components/Footer';
import SearchBar from '../components/SearchBar';
import { useImageStore } from '../store/useImageStore';
import { useSettingsStore } from '../store/useSettingsStore';

const noop = () => {};

function LibraryControls() {
  const mode = useSettingsStore(state => state.viewMode);
  const toggle = useSettingsStore(state => state.toggleViewMode);
  const query = useImageStore(state => state.searchQuery);
  const setQuery = useImageStore(state => state.setSearchQuery);
  return <>
    <SearchBar value={query} onChange={setQuery} />
    <ActiveFilters />
    <Footer
      currentPage={1}
      totalPages={1}
      onPageChange={noop}
      itemsPerPage={50}
      onItemsPerPageChange={noop}
      viewMode={mode}
      onViewModeChange={toggle}
    />
  </>;
}

afterEach(() => {
  cleanup();
  useImageStore.setState({ searchQuery: '', advancedFilters: {}, selectedImages: new Set() });
  useSettingsStore.getState().resetState();
});

it('localizes search and view actions while keeping the search, filters and selection', () => {
  const searchQuery = 'Model {fixture} 海';
  const advancedFilters = { dimension: '512x512' };
  const selectedImages = new Set(['fixture.png']);
  useImageStore.setState({ searchQuery, advancedFilters, selectedImages });
  useSettingsStore.setState({ viewMode: 'grid', language: 'en' });
  render(<LibraryControls />);

  act(() => useSettingsStore.getState().setLanguage('pt-BR'));
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Buscar' }).value).toBe(searchQuery);
  expect(screen.getByRole('button', { name: 'Remover filtro de dimensões' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Alternar para a visualização em lista' }));
  expect(useSettingsStore.getState().viewMode).toBe('list');
  expect(screen.getByRole('button', { name: 'Alternar para a visualização em grade' })).toBeTruthy();
  expect(useImageStore.getState()).toMatchObject({ searchQuery, advancedFilters, selectedImages });
});
