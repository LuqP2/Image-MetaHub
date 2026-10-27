import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { BoardError, applyBoardReferenceRemaps, mergeReferenceRemaps, normalizeBoardDocument, summarizeBoard, validateBoardId } from '../services/boards/document.mjs';

/** Single writer for user documents. The directory must never be treated as a cache. */
export class BoardRepository {
  constructor({ directory, fileSystem = fs, now = () => Date.now() }) {
    this.directory = directory;
    this.fs = fileSystem;
    this.now = now;
    this.queue = Promise.resolve();
    this.pendingOperations = 0;
  }

  #enqueue(operation) {
    this.pendingOperations += 1;
    const next = this.queue.then(operation).finally(() => { this.pendingOperations -= 1; });
    this.queue = next.catch(() => {});
    return next;
  }

  #file(id) { return path.join(this.directory, `${validateBoardId(id)}.json`); }

  async #atomicWrite(file, data) {
    await this.fs.mkdir(this.directory, { recursive: true });
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    try {
      await this.fs.writeFile(temporary, JSON.stringify(data), { encoding: 'utf8', flag: 'wx' });
      await this.fs.rename(temporary, file);
    } finally {
      await this.fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }

  async #read(id) {
    let value;
    try { value = JSON.parse(await this.fs.readFile(this.#file(id), 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') throw new BoardError('BOARD_NOT_FOUND', 'Board was not found.');
      throw error;
    }
    const document = normalizeBoardDocument(value);
    if (document.id !== id) throw new BoardError('BOARD_INVALID_DOCUMENT', 'Board ID does not match its filename.');
    return document;
  }

  async #remaps() {
    try {
      const data = JSON.parse(await this.fs.readFile(path.join(this.directory, 'reference-remaps.json'), 'utf8'));
      if (!Array.isArray(data)) throw new BoardError('BOARD_INVALID_REMAPS', 'Board reference journal is invalid.');
      return mergeReferenceRemaps([], data);
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error; // A damaged journal must never be replaced with an empty journal.
    }
  }

  list() {
    return this.#enqueue(async () => {
      let files;
      try { files = await this.fs.readdir(this.directory); }
      catch (error) { if (error.code === 'ENOENT') return []; throw error; }
      const summaries = [];
      for (const file of files) {
        if (!file.endsWith('.json') || file === 'reference-remaps.json') continue;
        const id = file.slice(0, -5);
        try { validateBoardId(id); } catch { continue; }
        try { summaries.push(summarizeBoard(await this.#read(id))); }
        catch (error) { summaries.push({ id, name: 'Unreadable board', revision: 0, createdAt: 0, updatedAt: 0, objectCount: 0, error: error.message }); }
      }
      return summaries.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
    });
  }

  load(id) { return this.#enqueue(async () => applyBoardReferenceRemaps(await this.#read(id), await this.#remaps())); }

  save(input, expectedRevision) {
    // Validate and detach caller-owned data before entering the asynchronous queue.
    let document;
    try { document = normalizeBoardDocument(input); } catch (error) { return Promise.reject(error); }
    return this.#enqueue(async () => {
      let current = null;
      try { current = await this.#read(document.id); } catch (error) { if (error.code !== 'BOARD_NOT_FOUND') throw error; }
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || (current?.revision ?? 0) !== expectedRevision || document.revision !== expectedRevision) {
        throw new BoardError('BOARD_REVISION_CONFLICT', 'The saved board changed. Reload it or save your work as a new board.');
      }
      const next = applyBoardReferenceRemaps({ ...document, createdAt: current?.createdAt ?? document.createdAt, updatedAt: this.now(), revision: expectedRevision + 1 }, await this.#remaps());
      await this.#atomicWrite(this.#file(next.id), next);
      return next;
    });
  }

  remove(id, expectedRevision) {
    return this.#enqueue(async () => {
      const current = await this.#read(id);
      if (current.revision !== expectedRevision) throw new BoardError('BOARD_REVISION_CONFLICT', 'The saved board changed. Reload it before deleting.');
      await this.fs.unlink(this.#file(id));
    });
  }

  remapReferences(inputs) {
    let additions;
    try { additions = mergeReferenceRemaps([], inputs); } catch (error) { return Promise.reject(error); }
    return this.#enqueue(async () => {
      if (!additions.length) return;
      const existing = await this.#remaps();
      const next = mergeReferenceRemaps(existing, additions);
      if (next.length !== existing.length) await this.#atomicWrite(path.join(this.directory, 'reference-remaps.json'), next);
    });
  }

  flush() { return this.queue; }
  referenceBaseline() { return this.#enqueue(async () => (await this.#remaps()).map(remap => remap.operationId)); }
  isBusy() { return this.pendingOperations > 0; }
}
