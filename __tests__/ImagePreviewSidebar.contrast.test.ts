import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('ImagePreviewSidebar light mode contrast', () => {
  it('uses theme-adaptive dark text for the file name and section headings', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'components', 'ImagePreviewSidebar.tsx'),
      'utf8',
    );

    expect(source).toContain('text-lg font-semibold text-gray-200">Image Preview');
    expect(source).toContain('text-lg font-bold text-gray-100 break-all">{activeImage.name}');
    expect(source.match(/text-base font-semibold text-gray-200/g)).toHaveLength(3);
    expect(source).not.toMatch(/text-gray-(?:700|800|900) dark:text-gray-(?:100|200|300).*?(?:Image Preview|activeImage\.name|Metadata|LoRAs|Generation Parameters)/);
  });
});
