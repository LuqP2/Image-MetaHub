import { describe, expect, it } from 'vitest';
import {
  getComfyUIViewAllowedOrigin,
  isComfyUIViewUrlAllowed,
  normalizeComfyUIViewUrl,
} from '../utils/comfyUIViewSecurity.mjs';

describe('ComfyUI embedded view URL security', () => {
  it('allows the configured origin and paths under it', () => {
    expect(isComfyUIViewUrlAllowed('http://127.0.0.1:8188/', 'http://127.0.0.1:8188')).toBe(true);
    expect(isComfyUIViewUrlAllowed('http://127.0.0.1:8188/?foo=bar', 'http://127.0.0.1:8188')).toBe(true);
  });

  it('allows equivalent loopback hostnames on the same protocol and port', () => {
    expect(isComfyUIViewUrlAllowed('http://localhost:8188/', 'http://127.0.0.1:8188')).toBe(true);
    expect(isComfyUIViewUrlAllowed('http://127.0.0.1:8188/', 'http://localhost:8188')).toBe(true);
  });

  it('rejects different ports, protocols, and non-loopback hosts', () => {
    expect(isComfyUIViewUrlAllowed('http://127.0.0.1:8189/', 'http://127.0.0.1:8188')).toBe(false);
    expect(isComfyUIViewUrlAllowed('https://127.0.0.1:8188/', 'http://127.0.0.1:8188')).toBe(false);
    expect(isComfyUIViewUrlAllowed('http://example.com:8188/', 'http://127.0.0.1:8188')).toBe(false);
  });

  it('rejects unsupported or malformed URLs', () => {
    expect(normalizeComfyUIViewUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeComfyUIViewUrl('not a url')).toBeNull();
    expect(isComfyUIViewUrlAllowed('file:///tmp/index.html', 'http://127.0.0.1:8188')).toBe(false);
  });

  it('reports the normalized allowed origin', () => {
    expect(getComfyUIViewAllowedOrigin('http://127.0.0.1:8188/foo')).toBe('http://127.0.0.1:8188');
    expect(getComfyUIViewAllowedOrigin('nope')).toBeNull();
  });
});
