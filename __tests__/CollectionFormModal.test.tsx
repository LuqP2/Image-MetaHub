import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CollectionFormModal, { type CollectionFormValues } from '../components/CollectionFormModal';
import hotkeyManager from '../services/hotkeyManager';

vi.mock('../services/hotkeyManager', () => ({
  default: {
    pauseHotkeys: vi.fn(),
    resumeHotkeys: vi.fn(),
  },
}));

const emptyValues = (): CollectionFormValues => ({
  name: '',
  description: '',
  sourceTag: '',
  autoUpdate: false,
  includeTargetImages: false,
});

const renderModal = (initialValues: CollectionFormValues = emptyValues()) =>
  render(
    <CollectionFormModal
      isOpen
      title="Save as Collection"
      submitLabel="Save Collection"
      initialValues={initialValues}
      onClose={vi.fn()}
      onSubmit={vi.fn()}
    />,
  );

describe('CollectionFormModal', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('keeps typed values when the parent rerenders with equivalent initial values', () => {
    const { rerender } = renderModal(emptyValues());

    const titleInput = screen.getByLabelText('Title') as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: 'Filtered keepers' } });

    rerender(
      <CollectionFormModal
        isOpen
        title="Save as Collection"
        submitLabel="Save Collection"
        initialValues={emptyValues()}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Filtered keepers');
  });

  it('resets when the actual initial values change while open', () => {
    const { rerender } = renderModal(emptyValues());

    const titleInput = screen.getByLabelText('Title') as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: 'Draft title' } });

    rerender(
      <CollectionFormModal
        isOpen
        title="Collection Settings"
        submitLabel="Save Changes"
        initialValues={{
          ...emptyValues(),
          name: 'Existing collection',
          description: 'Saved notes',
        }}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Existing collection');
    expect((screen.getByLabelText('Description') as HTMLTextAreaElement).value).toBe('Saved notes');
  });

  it('pauses global hotkeys while open', () => {
    const { unmount } = renderModal(emptyValues());

    expect(hotkeyManager.pauseHotkeys).toHaveBeenCalledTimes(1);

    unmount();

    expect(hotkeyManager.resumeHotkeys).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape without relying on global hotkeys', () => {
    const onClose = vi.fn();
    render(
      <CollectionFormModal
        isOpen
        title="Save as Collection"
        submitLabel="Save Collection"
        initialValues={emptyValues()}
        onClose={onClose}
        onSubmit={vi.fn()}
      />,
    );

    fireEvent.keyDown(screen.getByLabelText('Title'), { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
