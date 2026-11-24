import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveExportDestination, validateExportExtension } from '../electron/exportDestination.mjs';

const files = [{ directoryPath: path.resolve('synthetic-input'), relativePath: 'source.png' }];
describe('native export destinations', () => {
  it('honors a custom single-file name and directory', () => {
    const destFilePath = path.resolve('synthetic-output/custom.png');
    expect(resolveExportDestination({ files, destFilePath })).toEqual({ filePath: destFilePath, directory: path.dirname(destFilePath) });
  });
  it('preserves folder mode for batch exports', () => {
    const destDir = path.resolve('synthetic-output');
    expect(resolveExportDestination({ files: [...files, ...files], destDir })).toEqual({ directory: destDir, filePath: null });
  });
  it('rejects batch file targets, relative paths, missing extensions, and the source path', () => {
    expect(() => resolveExportDestination({ files: [...files, ...files], destFilePath: path.resolve('out.png') })).toThrow('one file');
    expect(() => resolveExportDestination({ files, destFilePath: 'out.png' })).toThrow('absolute');
    expect(() => resolveExportDestination({ files, destFilePath: path.resolve('no-extension') })).toThrow('extension');
    expect(() => resolveExportDestination({ files, destFilePath: path.join(files[0].directoryPath, files[0].relativePath) })).toThrow('original');
  });
  it('rejects a filename extension inconsistent with the encoded artifact', () => {
    expect(() => validateExportExtension('chosen.jpg', 'converted.png')).toThrow('.png');
    expect(() => validateExportExtension('chosen.PNG', 'converted.png')).not.toThrow();
  });
});
