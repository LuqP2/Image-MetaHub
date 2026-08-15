import { describe, expect, it } from 'vitest';
import App from '../App';
import DetachedImageModalApp from '../components/DetachedImageModalApp';

describe('image viewer entrypoints', () => {
  it('exposes both main and detached renderer roots', () => {
    expect(typeof App).toBe('function');
    expect(typeof DetachedImageModalApp).toBe('function');
  });
});
