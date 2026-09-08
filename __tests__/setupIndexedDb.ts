import { installFakeIndexedDb } from './helpers/fakeIndexedDb';

if (typeof globalThis.indexedDB === 'undefined') installFakeIndexedDb();
