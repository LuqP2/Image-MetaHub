import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import SearchBar from '../components/SearchBar';
import React from 'react';

describe('SearchBar Shortcut Hint', () => {
  it('renders the keyboard shortcut hint when input is empty', () => {
    render(<SearchBar value="" onChange={() => {}} />);
    const hint = screen.getByText('/');
    expect(hint).toBeDefined();
    // It should have the kbd tag
    expect(hint.tagName).toBe('KBD');
  });

  it('hides the keyboard shortcut hint when input has value', () => {
    render(<SearchBar value="test" onChange={() => {}} />);
    const hint = screen.queryByText('/');
    expect(hint).toBeNull();
  });

  it('calls onChange with empty string when clear button is clicked', () => {
    const onChange = vi.fn();
    render(<SearchBar value="some query" onChange={onChange} />);

    const clearButton = screen.getByLabelText('Clear search');
    fireEvent.click(clearButton);

    expect(onChange).toHaveBeenCalledWith('');
  });
});
