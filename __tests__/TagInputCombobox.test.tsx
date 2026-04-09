import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TagInputCombobox from '../components/TagInputCombobox';

const renderHarness = (props: Partial<React.ComponentProps<typeof TagInputCombobox>> = {}) => {
  const submitSpy = vi.fn();
  const escapeSpy = vi.fn();
  const { value: initialValue, ...restProps } = props;

  const Harness = () => {
    const [value, setValue] = useState(initialValue ?? '');

    return (
      <TagInputCombobox
        value={value}
        onValueChange={setValue}
        onSubmit={(nextValue) => submitSpy(nextValue)}
        onEscape={escapeSpy}
        recentTags={['portrait', 'landscape', 'macro']}
        availableTags={[
          { name: 'portrait', count: 8 },
          { name: 'landscape', count: 4 },
          { name: 'macro', count: 2 },
        ]}
        suggestionLimit={10}
        placeholder="Add tag..."
        inputClassName="w-full"
        {...restProps}
      />
    );
  };

  render(<Harness />);

  return {
    submitSpy,
    escapeSpy,
    input: screen.getByPlaceholderText('Add tag...'),
  };
};

describe('TagInputCombobox', () => {
  afterEach(() => {
    cleanup();
  });

  it('supports arrow-key navigation and enter-to-select', () => {
    const { input, submitSpy } = renderHarness();

    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(submitSpy).toHaveBeenCalledWith('landscape');
  });

  it('closes the open list on escape before delegating to the caller', () => {
    const { input, escapeSpy } = renderHarness({ value: 'por' });

    fireEvent.focus(input);
    expect(screen.getByRole('listbox')).toBeTruthy();

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(escapeSpy).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(escapeSpy).toHaveBeenCalledTimes(1);
  });

  it('applies mouse-selected suggestions without losing the action', () => {
    const { input, submitSpy } = renderHarness({ value: 'mac' });

    fireEvent.focus(input);
    const option = screen.getByRole('option', { name: /macro/i });
    fireEvent.pointerDown(option);
    fireEvent.click(option);

    expect(submitSpy).toHaveBeenCalledWith('macro');
  });

  it('replaces the last CSV token instead of submitting immediately in csv mode', async () => {
    const { input, submitSpy } = renderHarness({
      mode: 'csv',
    });

    fireEvent.change(input, { target: { value: 'macro, por' } });
    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeTruthy();
    });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect((input as HTMLInputElement).value).toBe('macro, portrait, ');
    });
    expect(submitSpy).not.toHaveBeenCalled();
  });
});
