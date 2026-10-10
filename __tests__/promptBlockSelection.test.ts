import { afterEach, describe, expect, it } from 'vitest';
import { selectedPromptText } from '../hooks/usePromptBlockExtraction';
afterEach(() => { document.body.innerHTML = ''; window.getSelection()?.removeAllRanges(); });
describe('scoped prompt selection', () => {
  it('preserves literal text and refuses selections spanning fields or unrelated metadata', () => {
    document.body.innerHTML = '<pre data-prompt-text>  soft light  </pre><pre data-prompt-text>negative</pre><p>metadata</p>';
    const elements = document.body.children; const range = document.createRange(); const selection = window.getSelection()!;
    range.selectNodeContents(elements[0]); selection.addRange(range); expect(selectedPromptText()).toBe('  soft light  ');
    range.setEnd(elements[1].firstChild!, 3); expect(selectedPromptText()).toBeNull(); selection.removeAllRanges(); range.selectNodeContents(elements[2]); selection.addRange(range); expect(selectedPromptText()).toBeNull();
  });
});
