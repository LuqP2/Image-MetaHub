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

  it('positions the hint as a sibling of the input so peer-focus can hide it', () => {
    // Tailwind's `peer-focus:opacity-0` only matches an element that is a
    // *sibling* of the `.peer` input, not a descendant of one. If the hint
    // (or a wrapper around it) ends up nested inside another sibling div
    // instead, this selector silently stops applying and the hint never
    // fades out on focus.
    render(<SearchBar value="" onChange={() => {}} />);
    const input = screen.getByTestId('search-input');
    const hint = screen.getByText('/');

    // Walk up from the hint until we find the element that is a direct
    // sibling of the input, and assert it carries peer-focus:opacity-0.
    let node: HTMLElement | null = hint;
    while (node && node.parentElement !== input.parentElement) {
      node = node.parentElement;
    }
    expect(node).not.toBeNull();
    expect(node?.className).toMatch(/peer-focus:opacity-0/);
  });

  it('uses a concise visual-query placeholder', () => {
    render(<SearchBar value="" onChange={() => {}} visualMode={true} />);

    expect(screen.getByPlaceholderText('Experimental visual text query')).toBeTruthy();
    expect(screen.queryByPlaceholderText(/press Enter|…/i)).toBeNull();
  });
});
