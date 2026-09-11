import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export class SavedPromptRepositoryError extends Error {
  constructor(code, message, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = 'SavedPromptRepositoryError';
    this.code = code;
  }
}

const isUuid = (value) => (
  typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
);

const optionalStatValue = (value, name) => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new SavedPromptRepositoryError('SAVED_PROMPT_INVALID_SOURCE', `${name} must be null or a non-negative finite number.`);
  }
  return value;
};

function normalizePathSnapshot(value) {
  if (!value || typeof value !== 'object') {
    throw new SavedPromptRepositoryError('SAVED_PROMPT_INVALID_SOURCE', 'A source path snapshot is required.');
  }
  const directoryPath = typeof value.directoryPath === 'string' ? value.directoryPath : '';
  const relativePath = typeof value.relativePath === 'string' ? value.relativePath : '';
  if (!path.isAbsolute(directoryPath) || !relativePath || path.isAbsolute(relativePath)) {
    throw new SavedPromptRepositoryError('SAVED_PROMPT_INVALID_SOURCE', 'The source path locator is invalid.');
  }
  const absolutePath = path.resolve(directoryPath, relativePath);
  const relativeCheck = path.relative(path.resolve(directoryPath), absolutePath);
  if (relativeCheck.startsWith('..') || path.isAbsolute(relativeCheck)) {
    throw new SavedPromptRepositoryError('SAVED_PROMPT_INVALID_SOURCE', 'The source path escapes its directory.');
  }
  return {
    directoryPath,
    relativePath,
    fileSize: optionalStatValue(value.fileSize, 'fileSize'),
    contentModifiedMs: optionalStatValue(value.contentModifiedMs, 'contentModifiedMs'),
  };
}

function serializeRow(row) {
  if (!row) return null;
  let source = null;
  if (typeof row.source_json === 'string') {
    try { source = JSON.parse(row.source_json); } catch { source = null; }
  }
  return {
    id: row.id,
    createdAt: Number(row.created_at),
    positivePrompt: row.positive_prompt,
    negativePrompt: row.negative_prompt,
    textBasis: row.text_basis,
    source,
  };
}

function runTransaction(database, operation) {
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    try { database.exec('ROLLBACK'); } catch { /* keep original error */ }
    throw error;
  }
}

export class SavedPromptRepository {
  constructor({
    database,
    randomUUID = () => crypto.randomUUID(),
    now = () => Date.now(),
    digest = (positivePrompt, negativePrompt) => crypto
      .createHash('sha256')
      .update(positivePrompt, 'utf8')
      .update('\0', 'utf8')
      .update(negativePrompt, 'utf8')
      .digest('hex'),
    statSync = (filePath) => fs.statSync(filePath),
  }) {
    this.database = database;
    this.randomUUID = randomUUID;
    this.now = now;
    this.digest = digest;
    this.statSync = statSync;
  }

  list() {
    return this.database.prepare('SELECT * FROM saved_prompts ORDER BY created_at DESC, id DESC').all().map(serializeRow);
  }

  save(input) {
    const positivePrompt = typeof input?.positivePrompt === 'string' ? input.positivePrompt : '';
    const negativePrompt = typeof input?.negativePrompt === 'string' ? input.negativePrompt : '';
    if (!positivePrompt.trim()) {
      throw new SavedPromptRepositoryError('SAVED_PROMPT_EMPTY_POSITIVE', 'A non-empty positive prompt is required.');
    }
    const textBasis = input?.textBasis === 'original' ? 'original' : 'effective';
    const promptDigest = this.digest(positivePrompt, negativePrompt);
    return runTransaction(this.database, () => {
      const candidates = this.database.prepare('SELECT * FROM saved_prompts WHERE prompt_digest = ?').all(promptDigest);
      const duplicate = candidates.find((row) => (
        row.positive_prompt === positivePrompt && row.negative_prompt === negativePrompt
      ));
      if (duplicate) return { status: 'already-saved', prompt: serializeRow(duplicate) };

      const prompt = {
        id: this.randomUUID(),
        createdAt: Math.trunc(this.now()),
        positivePrompt,
        negativePrompt,
        textBasis,
        source: this.#normalizeSource(input?.source),
      };
      if (!isUuid(prompt.id)) {
        throw new SavedPromptRepositoryError('SAVED_PROMPT_INVALID_ID', 'The generated prompt id must be a UUID.');
      }
      this.database.prepare(`
        INSERT INTO saved_prompts (
          id, created_at, positive_prompt, negative_prompt, text_basis, source_json, prompt_digest
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        prompt.id.toLowerCase(), prompt.createdAt, prompt.positivePrompt, prompt.negativePrompt,
        prompt.textBasis, prompt.source ? JSON.stringify(prompt.source) : null, promptDigest,
      );
      return { status: 'saved', prompt: { ...prompt, id: prompt.id.toLowerCase() } };
    });
  }

  remove(id) {
    if (!isUuid(id)) {
      throw new SavedPromptRepositoryError('SAVED_PROMPT_INVALID_ID', 'Prompt id must be a UUID.');
    }
    const result = this.database.prepare('DELETE FROM saved_prompts WHERE id = ?').run(id.toLowerCase());
    return { removed: Number(result.changes) > 0, id: id.toLowerCase() };
  }

  resolveSource(id) {
    if (!isUuid(id)) {
      throw new SavedPromptRepositoryError('SAVED_PROMPT_INVALID_ID', 'Prompt id must be a UUID.');
    }
    const prompt = serializeRow(this.database.prepare('SELECT * FROM saved_prompts WHERE id = ?').get(id.toLowerCase()));
    if (!prompt?.source) return { status: 'unavailable', reason: 'no-source' };
    return prompt.source.kind === 'stable'
      ? this.#resolveStableSource(prompt.source)
      : this.#resolvePathSource(prompt.source.pathAtSave);
  }

  #normalizeSource(source) {
    if (!source) return null;
    let pathAtSave;
    try { pathAtSave = normalizePathSnapshot(source.pathAtSave); } catch { return null; }
    if (source.kind !== 'stable') return source.kind === 'path' ? { kind: 'path', pathAtSave } : null;
    const reference = source.reference;
    if (!reference || ![reference.assetId, reference.revisionId, reference.locationId, reference.rootId].every(isUuid)) {
      return { kind: 'path', pathAtSave };
    }
    const valid = this.database.prepare(`
      SELECT 1
      FROM asset_locations l
      JOIN asset_revisions r ON r.revision_id = l.revision_id AND r.asset_id = l.asset_id
      JOIN library_roots root ON root.root_id = ?
      WHERE l.location_id = ? AND l.asset_id = ? AND l.root_id = ? AND l.revision_id = ?
      LIMIT 1
    `).get(
      reference.rootId, reference.locationId, reference.assetId, reference.rootId, reference.revisionId,
    );
    if (!valid) return { kind: 'path', pathAtSave };
    return {
      kind: 'stable',
      reference: {
        assetId: reference.assetId.toLowerCase(),
        revisionId: reference.revisionId.toLowerCase(),
        locationId: reference.locationId.toLowerCase(),
        rootId: reference.rootId.toLowerCase(),
      },
      pathAtSave,
    };
  }

  #resolveStableSource(source) {
    const row = this.database.prepare(`
      SELECT l.revision_id, l.relative_path, l.state AS location_state,
             a.state AS asset_state, root.absolute_path
      FROM asset_locations l
      JOIN assets a ON a.asset_id = l.asset_id
      JOIN library_roots root ON root.root_id = l.root_id
      WHERE l.location_id = ? AND l.asset_id = ? AND l.root_id = ?
      LIMIT 1
    `).get(source.reference.locationId, source.reference.assetId, source.reference.rootId);
    if (!row || row.location_state !== 'present' || row.asset_state !== 'active') {
      return { status: 'unavailable', reason: 'catalog-unavailable' };
    }
    const absolutePath = path.resolve(row.absolute_path, row.relative_path);
    const withinRoot = path.relative(path.resolve(row.absolute_path), absolutePath);
    if (withinRoot.startsWith('..') || path.isAbsolute(withinRoot)) {
      return { status: 'unavailable', reason: 'invalid-location' };
    }
    try {
      const stat = this.statSync(absolutePath);
      if (!stat.isFile()) return { status: 'unavailable', reason: 'not-a-file' };
    } catch {
      return { status: 'unavailable', reason: 'offline-or-missing' };
    }
    return {
      status: 'available',
      absolutePath,
      sourceChanged: row.revision_id !== source.reference.revisionId,
    };
  }

  #resolvePathSource(pathAtSave) {
    const absolutePath = path.resolve(pathAtSave.directoryPath, pathAtSave.relativePath);
    try {
      const stat = this.statSync(absolutePath);
      if (!stat.isFile()) return { status: 'unavailable', reason: 'not-a-file' };
      if (pathAtSave.fileSize !== null && Number(stat.size) !== pathAtSave.fileSize) {
        return { status: 'unavailable', reason: 'source-changed' };
      }
      if (pathAtSave.contentModifiedMs !== null && Number(stat.mtimeMs) !== pathAtSave.contentModifiedMs) {
        return { status: 'unavailable', reason: 'source-changed' };
      }
      return { status: 'available', absolutePath, sourceChanged: false };
    } catch {
      return { status: 'unavailable', reason: 'offline-or-missing' };
    }
  }
}
