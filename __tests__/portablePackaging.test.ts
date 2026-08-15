import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('Windows portable packaging', () => {
  it('builds distinct Setup and Portable executables without the old ZIP target', () => {
    const config = JSON.parse(
      readFileSync(path.join(process.cwd(), 'electron-builder.json'), 'utf8'),
    );

    expect(config.win.target).toEqual(['nsis', 'portable']);
    expect(config.nsis.artifactName).toBe('ImageMetaHub-Setup-${version}.${ext}');
    expect(config.portable.artifactName).toBe(
      'ImageMetaHub-Portable-${version}-${arch}.${ext}',
    );
  });

  it('publishes the Portable executable but not Windows ZIP artifacts', () => {
    const workflow = readFileSync(
      path.join(process.cwd(), '.github', 'workflows', 'publish.yml'),
      'utf8',
    );
    const windowsUploadBlock = workflow.slice(
      workflow.indexOf('- name: Upload Windows assets'),
      workflow.indexOf('- name: Publish Release'),
    );

    expect(windowsUploadBlock).toContain('*"Portable"*".exe"');
    expect(windowsUploadBlock).not.toContain('*".zip"');
  });
});
