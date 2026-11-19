import { useSettingsStore } from '../store/useSettingsStore';
import { formatMessage, languages } from '../i18n/messages.mjs';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModelInspectorItem } from '../services/modelLibrary/types';
import { emptyModelUsage } from '../services/modelLibrary/usage';
const command = vi.hoisted(() => vi.fn<(command: unknown) => Promise<void>>(async () => {}));
vi.mock('../components/ModelManagerPanels', () => ({ executeModelCommand: command, modelButton: '' }));
import ModelUsagePanel from '../components/ModelUsagePanel';
const item = { location: { id: 'synthetic' }, usage: { ...emptyModelUsage('ready'), confirmedCount: 3, nameMatchedCount: 4, totalCount: 7, ambiguousCount: 2, lastUsedAt: 100 } } as ModelInspectorItem;
afterEach(() => { cleanup(); useSettingsStore.setState({ language: 'en' }); command.mockClear(); });
describe('model usage presentation and commands', () => {
  it.each(languages)('shows only the Library count and opens the principal matching set in %s', language => {
    useSettingsStore.setState({ language });
    const t = (key, values?) => formatMessage(language, key, values);
    render(<ModelUsagePanel item={item} />);
    expect(screen.getByText(t('modelLibrary.usageCount', { count: 7 }))).toBeTruthy();
    expect(screen.queryByText(/confirmed by hash|matched by name|additional ambiguous matches/)).toBeNull();
    fireEvent.click(screen.getByText(t('modelLibrary.viewLibrary')));
    expect(command).toHaveBeenCalledWith({ type: 'viewLibrary', locationId: 'synthetic', mode: 'total' });
  });
  it.each(languages)('distinguishes pending data from a definitive zero in %s', language => {
    useSettingsStore.setState({ language });
    const t = (key, values?) => formatMessage(language, key, values);
    const view = render(<ModelUsagePanel item={{ ...item, usage: undefined }} />);
    expect(screen.getByText(t('modelLibrary.loadingUsage'))).toBeTruthy();
    expect(screen.queryByText(t('modelLibrary.usageCount', { count: 0 }))).toBeNull();
    view.rerender(<ModelUsagePanel item={{ ...item, usage: emptyModelUsage('partial') }} />);
    expect(screen.getByText(t('modelLibrary.usagePartial', { count: 0 }))).toBeTruthy();
  });
  it.each(languages)('shows unavailable categories without a navigation action in %s', language => {
    useSettingsStore.setState({ language });
    const t = (key, values?) => formatMessage(language, key, values);
    render(<ModelUsagePanel item={{ ...item, usage: emptyModelUsage('unsupported') }} />);
    expect(screen.getByText(t('modelLibrary.usageUnavailable'))).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
