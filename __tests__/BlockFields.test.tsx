import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { PromptBlock, PromptLibrarySnapshot, PromptVariable } from '../types';
import PromptEditor from '../components/promptLibrary/PromptEditor';
import PromptBlockEditor from '../components/promptLibrary/PromptBlockEditor';
import { useSavedPromptStore } from '../store/useSavedPromptStore';
import { applyMutation, emptyEditor } from '../services/promptLibrary/core.mjs';
import { compileBlockForUse } from '../services/promptLibrary/blockFields';
import { clearDraft, getDraft } from '../services/promptLibrary/sessionDraft';

const mocks = vi.hoisted(() => ({ mutate: vi.fn(), copy: vi.fn(), advanced: true, gate: vi.fn() }));
vi.mock('../services/savedPromptService', () => ({ listSavedPrompts: vi.fn(), listPromptLibrary: vi.fn(), mutatePromptLibrary: mocks.mutate, subscribeSavedPromptChanges: vi.fn() }));
vi.mock('../utils/imageUtils', () => ({ copyTextToClipboard: mocks.copy }));
vi.mock('../hooks/useFeatureAccess', () => ({ useFeatureAccess: () => ({ canUseAdvancedPromptLibrary: mocks.advanced, showProModal: mocks.gate }) }));
vi.mock('../hooks/usePromptLibraryPreview', () => ({ usePromptLibraryPreview: () => ({ url: null, status: 'No preview' }), linkSessionPreview: vi.fn() }));

let data: PromptLibrarySnapshot;
const props = { kind: 'block' as const, onSaved: vi.fn(), onClose: vi.fn(), onDirty: vi.fn(), onViewSource: vi.fn() };
const initial = () => ({ text: '', editor: emptyEditor() });
const preview = () => screen.getByRole('region', { name: 'Block preview' });
const text = () => screen.getByRole('textbox', { name: 'Block text' }) as HTMLTextAreaElement;
const template = 'She has {{color}} hair and is wearing {{clothes}}';
const variable = (name: string, options: string[] = []): PromptVariable => ({ name, label: name, type: 'text', required: true, defaultValue: '', options });
const savedBlock = (variables: PromptVariable[], text = template): PromptBlock => ({ id: 'synthetic', text, revision: 1, createdAt: 1, editor: { ...emptyEditor(), variables } });

beforeEach(() => {
  clearDraft(); clearDraft('comfyui-block'); mocks.advanced = true;
  data = { prompts: [], blocks: [] };
  mocks.mutate.mockReset().mockImplementation(async command => { data = applyMutation(data, command); return data; });
  mocks.copy.mockReset().mockResolvedValue({ success: true }); mocks.gate.mockReset();
  useSavedPromptStore.setState({ prompts: [], blocks: [], error: null, isLoading: false });
});
afterEach(() => { cleanup(); clearDraft(); clearDraft('comfyui-block'); vi.restoreAllMocks(); });

it.each([true, false])('shows literal Preview, copies unfilled placeholders and places Save block after the form, compact=%s', async compact => {
  render(<PromptEditor {...props} compact={compact} initial={initial()} />);
  fireEvent.change(text(), { target: { value: template } });
  expect(screen.getAllByLabelText('Suggested values for color')).toHaveLength(1);
  expect(screen.getByLabelText('Suggested values for clothes')).toBeTruthy();
  expect(preview().querySelector('pre')?.textContent).toBe(template);
  expect(within(preview()).queryByRole('textbox')).toBeNull();
  expect(within(preview()).queryByRole('combobox')).toBeNull();
  expect(screen.queryByRole('button', { name: /Randomize|Insert field|Add field/ })).toBeNull();
  const save = screen.getByRole('button', { name: 'Save block' });
  expect(save.closest('header')).toBeNull();
  expect(screen.getByLabelText('Notes').compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Copy block' }));
  await waitFor(() => expect(mocks.copy).toHaveBeenCalledWith(template));
  expect(mocks.mutate).not.toHaveBeenCalled();
});

it('saves suggestions and the literal template without choosing any values', async () => {
  render(<PromptEditor {...props} compact initial={initial()} />);
  fireEvent.change(text(), { target: { value: template } });
  fireEvent.change(screen.getByLabelText('Suggested values for color'), { target: { value: 'red\ngreen\nblue' } });
  fireEvent.change(screen.getByLabelText('Suggested values for clothes'), { target: { value: 'a dress\na jacket' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save block' }));
  await waitFor(() => expect(data.blocks).toHaveLength(1));
  expect(data.blocks[0].text).toBe(template);
  expect(data.blocks[0].editor.variables).toEqual([
    variable('color', ['red', 'green', 'blue']), variable('clothes', ['a dress', 'a jacket']),
  ]);
});

it('permits saving a reusable block before any suggestions or defaults have been entered', async () => {
  render(<PromptEditor {...props} compact initial={initial()} />);
  fireEvent.change(text(), { target: { value: template } });
  fireEvent.click(screen.getByRole('button', { name: 'Save block' }));
  await waitFor(() => expect(data.blocks).toHaveLength(1));
  expect(data.blocks[0].editor.variables.every(field => field.required && !field.defaultValue && !field.options.length)).toBe(true);
});

it('retains field settings through incomplete placeholders and remounts, then drops unused fields on save', async () => {
  const field: PromptVariable = { ...variable('material', ['stone', 'wood']), type: 'select', label: 'Wall material', required: false, defaultValue: 'stone' };
  const start = { text: '{{material}}', editor: { ...emptyEditor(), variables: [field] } };
  let view = render(<PromptEditor {...props} compact initial={start} />);
  fireEvent.change(text(), { target: { value: '{{material}' } });
  expect(screen.queryByLabelText('Suggested values for material')).toBeNull();
  expect(getDraft()?.draft.editor?.variables).toEqual([field]);
  view.unmount(); view = render(<PromptEditor {...props} compact initial={start} />);
  fireEvent.change(text(), { target: { value: '{{material}}' } });
  expect((screen.getByLabelText('Suggested values for material') as HTMLTextAreaElement).value).toBe('stone\nwood');
  expect(preview().querySelector('pre')?.textContent).toBe('{{material}}');
  fireEvent.change(text(), { target: { value: 'plain block' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save block' }));
  await waitFor(() => expect(data.blocks).toHaveLength(1));
  expect(data.blocks[0].editor.variables).toEqual([]);
});

it('preserves legacy labels, defaults and required flags without replacing placeholders in Preview', () => {
  const start = savedBlock([{ ...variable('color', ['red', 'blue']), label: 'Hair color', type: 'select', defaultValue: 'blue', required: false }], '{{color}} hair');
  useSavedPromptStore.setState({ blocks: [start] });
  render(<PromptEditor {...props} compact initial={start} />);
  expect(preview().querySelector('pre')?.textContent).toBe('{{color}} hair');
  fireEvent.click(screen.getByRole('button', { name: 'Field settings for color' }));
  expect((screen.getByLabelText('Default value for color') as HTMLInputElement).value).toBe('blue');
  expect((screen.getByLabelText('Display label for color') as HTMLInputElement).value).toBe('Hair color');
  expect((screen.getByRole('checkbox', { name: /Require color/ }) as HTMLInputElement).checked).toBe(false);
  expect(getDraft()).toBeNull(); expect(mocks.mutate).not.toHaveBeenCalled();
});

it('keeps block authoring read-only on Free while allowing literal copying', async () => {
  mocks.advanced = false;
  render(<PromptEditor {...props} compact initial={{ text: template, editor: emptyEditor() }} />);
  expect(text().readOnly).toBe(true);
  expect(screen.getByLabelText('Suggested values for color').matches(':disabled')).toBe(true);
  expect(screen.getByRole('button', { name: 'Field settings for color' }).matches(':disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Copy block' }));
  await waitFor(() => expect(mocks.copy).toHaveBeenCalledWith(template));
  expect(mocks.mutate).not.toHaveBeenCalled();
});

it('uses literal Preview and a final save action in the selection-as-block dialog too', async () => {
  render(<PromptBlockEditor initial={{ text: template, editor: emptyEditor() }} onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Suggested values for color'), { target: { value: 'red\nblue' } });
  expect(preview().querySelector('pre')?.textContent).toBe(template);
  expect(screen.getByLabelText('Notes').compareDocumentPosition(screen.getByRole('button', { name: 'Save block' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Save block' }));
  await waitFor(() => expect(data.blocks).toHaveLength(1));
  expect(data.blocks[0].editor.variables.find(field => field.name === 'color')).toMatchObject({ defaultValue: '', options: ['red', 'blue'] });
});

it('registers previously undefined placeholders in an old block only on explicit save', async () => {
  const start = savedBlock([], '{{color}} hair');
  data.blocks = [start]; useSavedPromptStore.setState({ blocks: [start] });
  render(<PromptEditor {...props} compact initial={start} />);
  expect(screen.getByLabelText('Suggested values for color')).toBeTruthy();
  expect(mocks.mutate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Save block' }));
  await waitFor(() => expect(mocks.mutate).toHaveBeenCalledTimes(1));
  expect(data.blocks[0].editor.variables[0]).toMatchObject({ name: 'color', required: true, defaultValue: '' });
});

it('resolves each used field once per use, preserving repeated values, whitespace and the original block', () => {
  const block = savedBlock([variable('color', ['red', '', 'green', 'blue', 'red', '  ']), variable('clothes', ['a dress', 'a jacket'])], '  ' + template + '\n{{color}} shoes  ');
  const before = structuredClone(block);
  const random = vi.fn().mockReturnValueOnce(0.5).mockReturnValueOnce(0.99).mockReturnValueOnce(0).mockReturnValueOnce(0);
  expect(compileBlockForUse(block, random)).toEqual({ positivePrompt: '  She has green hair and is wearing a jacket\ngreen shoes  ', negativePrompt: '', errors: [] });
  expect(random).toHaveBeenCalledTimes(2);
  expect(compileBlockForUse(block, random).positivePrompt).toBe('  She has red hair and is wearing a dress\nred shoes  ');
  expect(block).toEqual(before);
});

it('uses defaults when no suggestions exist, allows optional empty text and reports unresolved required fields', () => {
  const block = savedBlock([{ ...variable('color'), defaultValue: 'red' }, { ...variable('clothes'), required: false }]);
  expect(compileBlockForUse(block)).toEqual({ positivePrompt: 'She has red hair and is wearing ', negativePrompt: '', errors: [] });
  block.editor.variables[1].required = true;
  expect(compileBlockForUse(block).errors).toEqual(['Add suggested values or a default for clothes in the block editor.']);
});
