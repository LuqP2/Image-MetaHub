// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isPublicPreviewAddress, previewMetadata, readPreviewResource } from '../electron/boardLinkPreview.mjs';
describe('explicit link previews', () => {
  it.each(['127.0.0.1', '10.2.3.4', '172.16.0.1', '192.168.0.1', '169.254.1.1', '100.64.0.1', '::1', '::ffff:127.0.0.1', 'fe80::1'])('rejects private address %s', address => expect(isPublicPreviewAddress(address)).toBe(false));
  it('rejects local URLs before making a request', async () => {
    await expect(readPreviewResource('http://127.0.0.1/test', 1024)).rejects.toThrow('private');
    await expect(readPreviewResource('file:///test', 1024)).rejects.toThrow('HTTP');
  });
  it('extracts text and relative Open Graph images without executing HTML', () => {
    expect(previewMetadata('<meta content="Title &amp; text" property="og:title"><meta property="og:image" content="/preview.png"><script>bad()</script>', 'https://example.com/page')).toEqual({ title: 'Title & text', image: 'https://example.com/preview.png' });
    expect(previewMetadata('<title>Fallback</title>', 'https://example.com/')).toEqual({ title: 'Fallback', image: undefined });
  });
});
