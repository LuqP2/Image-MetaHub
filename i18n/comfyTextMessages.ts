import type { ComfyUITextResult } from '../types';
import type { MessageKey, Translate } from './useTranslation';

const runtimeMessages: Record<string, MessageKey> = {
  "Select a text node in ComfyUI.": 'integrations.selectTextNode',
  "ComfyUI navigated away from the configured server.": 'integrations.textRuntime.navigatedAway',
  "ComfyUI is not ready. Copy text instead.": 'integrations.textRuntime.notReady',
  "Select text inside a node field.": 'integrations.textRuntime.selectTextInField',
  "The text selection changed.": 'integrations.textRuntime.selectionChanged',
  "This frontend does not expose supported undoable text editing. Copy text instead.": 'integrations.textRuntime.undoUnsupported',
  "Invalid drop position.": 'integrations.textRuntime.invalidDrop',
  "Drop onto an editable text field or text node.": 'integrations.textRuntime.dropTarget',
  "The destination changed. Drag the text again.": 'integrations.textRuntime.destinationChangedDrag',
  "Select just one node.": 'integrations.textRuntime.selectOneNode',
  "The selected node has no editable text field. Copy text instead.": 'integrations.textRuntime.noEditableField',
  "This node has multiple text fields. Drop directly onto the destination field.": 'integrations.textRuntime.multipleFields',
  "Invalid text operation.": 'integrations.textRuntime.invalidOperation',
  "The destination changed. Review the selected field and try again.": 'integrations.textRuntime.destinationChangedReview',
  "The text selection changed. Select the fragment again.": 'integrations.textRuntime.selectionChangedAgain',
  "The field already contains this text.": 'integrations.textRuntime.alreadyContains',
  "The widget could not be updated. Copy text instead.": 'integrations.textRuntime.widgetUpdateFailed',
};

/** Only static IMH runtime messages are translated; node titles and field values remain original. */
export function comfyTextMessage(result: Pick<ComfyUITextResult, 'message' | 'targets'>, t: Translate): string {
  const message = result.message || '';
  const key = runtimeMessages[message];
  if (key) return t(key);
  const target = result.targets[0];
  if (target && message === 'Updated ' + target.nodeTitle + ' · ' + target.field) {
    return t('integrations.textRuntime.updatedTarget', { nodeTitle: target.nodeTitle, field: target.field });
  }
  return message;
}
