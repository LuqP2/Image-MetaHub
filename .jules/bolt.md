## 2026-05-02 - IndexedDB Transaction Overhead
**Learning:** Sequential `Promise.all` with individual IndexedDB transactions causes significant overhead. This codebase heavily uses IndexedDB for persistence.
**Action:** Always look for opportunities to replace `Promise.all(items.map(saveItem))` with a single `bulkSave` operation using a single transaction when interacting with IndexedDB.
