import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock IndexedDB for Node environment
const mockDB = {
  transaction: vi.fn(),
  close: vi.fn(),
  objectStoreNames: {
    contains: vi.fn(() => false),
  },
  createObjectStore: vi.fn(() => ({
    createIndex: vi.fn(),
  })),
};

const mockRequest = {
  onerror: null as any,
  onsuccess: null as any,
  onupgradeneeded: null as any,
  result: mockDB,
  error: null,
};

global.indexedDB = {
  open: vi.fn(() => mockRequest),
  deleteDatabase: vi.fn(),
} as any;

describe('CacheManager basePath tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should use consistent default DB name when basePath is undefined', async () => {
    // Import after mocking
    const { cacheManager } = await import('../services/cacheManager');
    
    // Trigger onsuccess to complete initialization
    setTimeout(() => {
      if (mockRequest.onupgradeneeded) {
        mockRequest.onupgradeneeded({ target: { result: mockDB } } as any);
      }
      if (mockRequest.onsuccess) {
        mockRequest.onsuccess();
      }
    }, 0);

    await cacheManager.init(undefined);
    
    // Check that indexedDB.open was called with backward-compatible default name
    expect(global.indexedDB.open).toHaveBeenCalledWith('invokeai-browser-cache', expect.any(Number));
  });

  it('should use custom DB name when basePath is provided', async () => {
    const { cacheManager } = await import('../services/cacheManager');
    
    // Reset the cache manager state
    vi.clearAllMocks();
    
    // Trigger onsuccess to complete initialization
    setTimeout(() => {
      if (mockRequest.onupgradeneeded) {
        mockRequest.onupgradeneeded({ target: { result: mockDB } } as any);
      }
      if (mockRequest.onsuccess) {
        mockRequest.onsuccess();
      }
    }, 0);

    const customPath = '/custom/cache/path';
    await cacheManager.init(customPath);
    
    // Check that indexedDB.open was called with sanitized custom path
    const expectedDbName = `image-metahub-cache-${customPath.replace(/[^a-zA-Z0-9]/g, '_')}`;
    expect(global.indexedDB.open).toHaveBeenCalledWith(expectedDbName, expect.any(Number));
  });

  it('should reinitialize when basePath changes', async () => {
    const { cacheManager } = await import('../services/cacheManager');
    
    vi.clearAllMocks();
    
    // First initialization with undefined
    setTimeout(() => {
      if (mockRequest.onsuccess) mockRequest.onsuccess();
    }, 0);
    await cacheManager.init(undefined);
    
    const firstCallCount = (global.indexedDB.open as any).mock.calls.length;
    
    // Second initialization with a different basePath
    vi.clearAllMocks();
    setTimeout(() => {
      if (mockRequest.onsuccess) mockRequest.onsuccess();
    }, 0);
    await cacheManager.init('/different/path');
    
    // Should have been called again with new path
    expect(global.indexedDB.open).toHaveBeenCalled();
    expect(mockDB.close).toHaveBeenCalled(); // Should close previous DB
  });

  it('should not reinitialize when basePath is the same', async () => {
    const { cacheManager } = await import('../services/cacheManager');
    
    vi.clearAllMocks();
    
    // First initialization
    setTimeout(() => {
      if (mockRequest.onsuccess) mockRequest.onsuccess();
    }, 0);
    await cacheManager.init('/same/path');
    
    vi.clearAllMocks();
    
    // Second initialization with same path
    await cacheManager.init('/same/path');
    
    // Should not have been called again
    expect(global.indexedDB.open).not.toHaveBeenCalled();
  });
});
