import { formatMessage } from './messages.mjs';
import type { Translate } from './useTranslation';

const statusKeys = [
  'promptLibrary.placeholderCopied', 'promptLibrary.placeholderFailed', 'promptLibrary.copied', 'promptLibrary.copyFailed', 'promptLibrary.fillRequired',
  'promptLibrary.alreadySaved', 'promptLibrary.saveFailed', 'promptLibrary.bringChanged',
  'promptLibrary.bringFailed', 'promptLibrary.sourceMissing', 'canvas.addPromptFailed',
  'promptLibrary.pendingSuggestions',
  'promptLibrary.changesFailed',
  'promptLibrary.fillCopy',
  'promptLibrary.copyFailedShort',
  'promptLibrary.itemMissing',
  'promptLibrary.openFailed',
  'promptLibrary.fillFind',
  'promptLibrary.fillFindValue',
  'promptLibrary.findFailed',
  'promptLibrary.operationFailed',
  'promptLibrary.blockMissing',
  'promptLibrary.addBlockFailed',
  'promptLibrary.favoriteFailed',
  'promptLibrary.promptMissing',
  'promptLibrary.exportFailed',
  'promptLibrary.importFailed',
  'promptLibrary.csvTrailingText',
  'promptLibrary.csvUnclosedQuote',
  'promptLibrary.unsupportedJson',
  'promptLibrary.invalidJsonFolders',
  'promptLibrary.unknownImportFolder',
  'promptLibrary.csvHeaders',
  'promptLibrary.extraVariables',
  'promptLibrary.waitSave',
  'promptLibrary.imageLinkFailed',
  'promptLibrary.previewSaveFailed',
  'promptLibrary.sourceUnavailable',
  'promptLibrary.copiedBare',
  'promptLibrary.copyFailedBare',
  'promptLibrary.saveValueFailed',
  'promptLibrary.saveBlockFailed',
  'promptLibrary.suggestionsFailed',
  'promptLibrary.fieldChanged',
  'promptLibrary.conflictingVariables',
  'promptLibrary.saveFailedBare',
  'promptLibrary.selectImageFirst',
  'promptLibrary.chooseImagePreview',
  'promptLibrary.linkFileInstead',
  'promptLibrary.linkFailed',
  'promptLibrary.conflictingBlocks',
  'promptLibrary.fieldCreateFailed',
  'promptLibrary.addSelectedFailed',
  'promptLibrary.promptEmptyAdd', 'promptLibrary.selectedAddFailed',
  'promptLibrary.blockRequired',
  'promptLibrary.invalidImport',
  'promptLibrary.invalidImportedFolder',
  'promptLibrary.unknownKind',
  'promptLibrary.selectedMissing',
  'promptLibrary.revisionChanged',
  'promptLibrary.unknownOperation',
  'promptLibrary.storageUnavailable',
  'promptLibrary.loadLibraryFailed',
  'promptLibrary.loadSavedFailed',
  'promptLibrary.folderFailed', 'promptLibrary.folderNameInvalid', 'promptLibrary.folderExists', 'promptLibrary.folderMissing',
  'promptLibrary.variableNames', 'promptLibrary.unknownVariableType', 'promptLibrary.unsupportedDocument',
  'promptLibrary.partsList', 'promptLibrary.invalidPart', 'promptLibrary.unsupportedEditor', 'promptLibrary.promptRequired',
] as const;

/** Keep stored errors and external details intact; translate known presentation messages. */
export function translatePromptMessage(message: string, t: Translate): string {
  const detail = message.startsWith('Error: ') ? message.slice(7) : message;
  for (const key of statusKeys) {
    if (detail === key || detail === formatMessage('en', key)) return t(key);
  }
  const patterns = [
    [/^CSV row (\d+) has the wrong number of columns\.$/, 'promptLibrary.csvRowColumns', 'row'],
    [/^([\s\S]+): fill template fields before exporting resolved text\.$/, 'promptLibrary.fillExportFields', 'title'],
    [/^Define variable ([\s\S]+)\.$/, 'promptLibrary.defineVariable', 'variable'],
    [/^Fill ([\s\S]+)\.$/, 'promptLibrary.fillField', 'field'],
    [/^Conflicting definitions for ([\s\S]+)\. Rename the variable before inserting this block\.$/, 'promptLibrary.conflictingVariable', 'variable'],
  ] as const;
  for (const [pattern, key, argument] of patterns) {
    const match = pattern.exec(detail);
    if (match) return t(key, { [argument]: match[1] });
  }
  return message;
}
