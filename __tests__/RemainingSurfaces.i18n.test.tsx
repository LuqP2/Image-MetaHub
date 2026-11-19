import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CollectionCard from '../components/CollectionCard';
import { buildFileMenuItems } from '../components/contextMenu/ContextMenuPrimitives';
import { comfyTextMessage } from '../i18n/comfyTextMessages';
import { automationFieldLabels, automationOperatorLabels } from '../i18n/automationMessages';
import { formatMessage, languages } from '../i18n/messages.mjs';
import type { Translate } from '../i18n/useTranslation';
import { useSettingsStore } from '../store/useSettingsStore';
import type { ComfyUITextTarget, SmartCollection } from '../types';

vi.mock('../hooks/useHoverScrub', () => ({
  useHoverScrub: () => ({ cardRef: { current: null }, coverUrl: null, progress: 0, hasMultiple: false }),
}));

afterEach(() => {
  cleanup();
  useSettingsStore.setState({ language: 'en' });
});

describe('remaining presentation surfaces', () => {
  it.each(languages)('updates collection labels without changing names or actions in %s', language => {
    useSettingsStore.setState({ language: 'en' });
    const collection: SmartCollection = {
      id: 'collection-1', name: 'Original 海 {name}', sourceTag: 'original_猫', autoUpdate: true,
      kind: 'tag_rule', sortIndex: 0, imageCount: 2, imageIds: [], createdAt: 1, updatedAt: 1,
    };
    const onClick = vi.fn();
    render(<CollectionCard collection={collection} images={[]} imageCount={2} onClick={onClick} />);
    act(() => useSettingsStore.setState({ language }));
    const t: Translate = (key, values) => formatMessage(language, key, values);
    fireEvent.click(screen.getByRole('button', { name: t('collections.openCollection', { name: collection.name }) }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByText(collection.name)).toBeTruthy();
    expect(screen.getByText(t('collections.autoAddTag', { tag: collection.sourceTag! }))).toBeTruthy();
  });

  it.each(languages)('retains file action IDs, callbacks and access gates in %s', language => {
    const t: Translate = (key, values) => formatMessage(language, key, values);
    const onRename = vi.fn(), onBatchExport = vi.fn();
    const items = buildFileMenuItems({
      t, onRename, onBatchExport, onCopyTo: vi.fn(), onMoveTo: vi.fn(), onExport: vi.fn(),
      selectedCount: 3, canUseFileManagement: false, canUseBatchExport: false,
    });
    expect(items.map(item => item.key)).toEqual(['rename', 'copy-to', 'move-to', 'export', 'batch-export']);
    expect(items[0].label).toBe(t('libraryGallery.renameEllipsis'));
    expect(items[0].isPro).toBe(false);
    expect(items[1].isPro).toBe(true);
    expect(items[4].isPro).toBe(true);
    expect(items[4].label).toBe(t('libraryGallery.batchExportSelectedCount', { count: 3 }));
    items[0].onClick();
    items[4].onClick();
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onBatchExport).toHaveBeenCalledTimes(1);
  });

  it.each(languages)('localizes runtime feedback and automation labels while preserving technical values in %s', language => {
    const t: Translate = (key, values) => formatMessage(language, key, values);
    const target: ComfyUITextTarget = { nodeTitle: 'CLIPTextEncode 海 {text}', field: 'custom_text', nodeId: '42', token: 'target-1', preview: '' };
    expect(comfyTextMessage({ message: 'Select just one node.', targets: [] }, t)).toBe(t('integrations.textRuntime.selectOneNode'));
    expect(comfyTextMessage({ message: 'Updated ' + target.nodeTitle + ' · ' + target.field, targets: [target] }, t))
      .toBe(t('integrations.textRuntime.updatedTarget', { nodeTitle: target.nodeTitle, field: target.field }));
    const externalMessage = 'Server detail: CLIPTextEncode 海 {text}';
    expect(comfyTextMessage({ message: externalMessage, targets: [] }, t)).toBe(externalMessage);
    expect(automationFieldLabels(t).model).toBe(t('librarySearch.checkpoint'));
    expect(automationFieldLabels(t).cfg).toBe('CFG');
    expect(automationOperatorLabels(t).not_includes).toBe(t('automation.operator.notIncludes'));
  });
});
