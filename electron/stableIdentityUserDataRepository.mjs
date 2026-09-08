import crypto from 'node:crypto';

const DOMAINS = new Set(['annotation', 'shadow']);
const MAX_BATCH_SIZE = 200;
const MAX_PAYLOAD_BYTES = 256 * 1024;
const SHADOW_FIELDS = new Set([
  'prompt', 'negativePrompt', 'model', 'seed', 'steps', 'cfg_scale', 'clip_skip',
  'sampler', 'scheduler', 'generator', 'version', 'module', 'width', 'height',
  'duration', 'resources', 'tags', 'notes', 'updatedAt',
]);
const ANNOTATION_FIELDS = new Set([
  'isFavorite', 'tags', 'rating', 'addedAt', 'updatedAt', 'suppressedMetadataTags',
]);

class UserDataRepositoryError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'UserDataRepositoryError';
    this.code = code;
    this.details = details;
  }
}

function runTransaction(database, operation) {
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    try { database.exec('ROLLBACK'); } catch { /* preserve original failure */ }
    throw error;
  }
}

function assertDomain(domain) {
  if (!DOMAINS.has(domain)) {
    throw new UserDataRepositoryError('USER_DATA_INVALID_INPUT', `Unsupported user-data domain: ${domain}.`);
  }
  return domain;
}

function assertNonBlank(value, name, maxLength = 4096) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new UserDataRepositoryError('USER_DATA_INVALID_INPUT', `${name} must be a non-empty bounded string.`);
  }
  return value;
}

function assertUuid(value, name) {
  const normalized = assertNonBlank(value, name, 64).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)) {
    throw new UserDataRepositoryError('USER_DATA_INVALID_INPUT', `${name} must be a UUID.`);
  }
  return normalized;
}

function safeInteger(value, name, minimum = 0) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum) {
    throw new UserDataRepositoryError('USER_DATA_INVALID_INPUT', `${name} must be a safe integer >= ${minimum}.`);
  }
  return number;
}

function parseJson(value, fallback) {
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function payloadFingerprint(payload, tombstone) {
  return crypto.createHash('sha256').update(tombstone ? '<deleted>' : canonicalJson(payload)).digest('hex');
}

function assertStringArray(value, name, maxItems = 1_000) {
  if (!Array.isArray(value) || value.length > maxItems || value.some((entry) => typeof entry !== 'string' || entry.length > 1024)) {
    throw new UserDataRepositoryError('USER_DATA_INVALID_INPUT', `${name} must be a bounded string array.`);
  }
  return [...value];
}

function assertTimestamp(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new UserDataRepositoryError('USER_DATA_INVALID_INPUT', `${name} must be a non-negative finite timestamp.`);
  }
  return Math.trunc(number);
}

function normalizeAnnotationPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new UserDataRepositoryError('USER_DATA_INVALID_INPUT', 'Annotation payload must be an object.');
  }
  const result = {};
  for (const key of Object.keys(payload)) {
    if (!ANNOTATION_FIELDS.has(key)) {
      throw new UserDataRepositoryError('USER_DATA_INVALID_INPUT', `Unsupported annotation field: ${key}.`);
    }
  }
  if (typeof payload.isFavorite !== 'boolean') {
    throw new UserDataRepositoryError('USER_DATA_INVALID_INPUT', 'Annotation isFavorite must be boolean.');
  }
  result.isFavorite = payload.isFavorite;
  result.tags = assertStringArray(payload.tags, 'Annotation tags');
  if (Object.prototype.hasOwnProperty.call(payload, 'rating')) {
    if (payload.rating !== undefined && ![1, 2, 3, 4, 5].includes(payload.rating)) {
      throw new UserDataRepositoryError('USER_DATA_INVALID_INPUT', 'Annotation rating must be absent or between 1 and 5.');
    }
    if (payload.rating !== undefined) result.rating = payload.rating;
  }
  result.addedAt = assertTimestamp(payload.addedAt, 'Annotation addedAt');
  result.updatedAt = assertTimestamp(payload.updatedAt, 'Annotation updatedAt');
  if (Object.prototype.hasOwnProperty.call(payload, 'suppressedMetadataTags')) {
    result.suppressedMetadataTags = assertStringArray(payload.suppressedMetadataTags, 'Suppressed metadata tags');
  }
  return result;
}

function normalizeShadowPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new UserDataRepositoryError('USER_DATA_INVALID_INPUT', 'Shadow metadata payload must be an object.');
  }
  const result = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!SHADOW_FIELDS.has(key)) {
      throw new UserDataRepositoryError('USER_DATA_INVALID_INPUT', `Unsupported shadow metadata field: ${key}.`);
    }
    if (key === 'tags') {
      result.tags = assertStringArray(value, 'Shadow metadata tags');
    } else if (key === 'resources') {
      if (!Array.isArray(value) || value.length > 1_000) {
        throw new UserDataRepositoryError('USER_DATA_INVALID_INPUT', 'Shadow metadata resources must be a bounded array.');
      }
      result.resources = structuredClone(value);
    } else if (key === 'updatedAt') {
      result.updatedAt = assertTimestamp(value, 'Shadow metadata updatedAt');
    } else if (['seed', 'steps', 'cfg_scale', 'clip_skip', 'width', 'height', 'duration'].includes(key)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new UserDataRepositoryError('USER_DATA_INVALID_INPUT', `Shadow metadata ${key} must be finite.`);
      }
      result[key] = value;
    } else if (typeof value !== 'string') {
      throw new UserDataRepositoryError('USER_DATA_INVALID_INPUT', `Shadow metadata ${key} must be a string.`);
    } else {
      result[key] = value;
    }
  }
  if (!Object.prototype.hasOwnProperty.call(result, 'updatedAt')) {
    throw new UserDataRepositoryError('USER_DATA_INVALID_INPUT', 'Shadow metadata updatedAt is required.');
  }
  return result;
}

function normalizePayload(domain, payload, tombstone = false) {
  if (tombstone) return null;
  const normalized = domain === 'annotation'
    ? normalizeAnnotationPayload(payload)
    : normalizeShadowPayload(payload);
  if (Buffer.byteLength(JSON.stringify(normalized), 'utf8') > MAX_PAYLOAD_BYTES) {
    throw new UserDataRepositoryError('USER_DATA_PAYLOAD_TOO_LARGE', 'User-data payload exceeds the storage limit.');
  }
  return normalized;
}

function normalizePatch(domain, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new UserDataRepositoryError('USER_DATA_INVALID_INPUT', 'User-data patch must be an object.');
  }
  const allowedFields = domain === 'annotation' ? ANNOTATION_FIELDS : SHADOW_FIELDS;
  const set = patch.set && typeof patch.set === 'object' && !Array.isArray(patch.set) ? { ...patch.set } : {};
  const remove = Array.isArray(patch.remove) ? [...new Set(patch.remove)] : [];
  for (const key of [...Object.keys(set), ...remove]) {
    if (!allowedFields.has(key)) {
      throw new UserDataRepositoryError('USER_DATA_INVALID_INPUT', `Unsupported ${domain} patch field: ${key}.`);
    }
  }
  if (domain === 'annotation') {
    if (Object.prototype.hasOwnProperty.call(set, 'isFavorite') && typeof set.isFavorite !== 'boolean') {
      throw new UserDataRepositoryError('USER_DATA_INVALID_INPUT', 'Annotation isFavorite must be boolean.');
    }
    if (Object.prototype.hasOwnProperty.call(set, 'tags')) set.tags = assertStringArray(set.tags, 'Annotation tags');
    if (Object.prototype.hasOwnProperty.call(set, 'suppressedMetadataTags')) {
      set.suppressedMetadataTags = assertStringArray(set.suppressedMetadataTags, 'Suppressed metadata tags');
    }
    if (Object.prototype.hasOwnProperty.call(set, 'rating') && ![1, 2, 3, 4, 5].includes(set.rating)) {
      throw new UserDataRepositoryError('USER_DATA_INVALID_INPUT', 'Annotation rating must be between 1 and 5.');
    }
    for (const key of ['addedAt', 'updatedAt']) {
      if (Object.prototype.hasOwnProperty.call(set, key)) set[key] = assertTimestamp(set[key], `Annotation ${key}`);
    }
  } else {
    const hasUpdatedAt = Object.prototype.hasOwnProperty.call(set, 'updatedAt');
    const candidate = { ...set, updatedAt: hasUpdatedAt ? set.updatedAt : 0 };
    const normalizedCandidate = normalizeShadowPayload(candidate);
    delete normalizedCandidate.updatedAt;
    if (hasUpdatedAt) set.updatedAt = candidate.updatedAt;
    for (const key of Object.keys(normalizedCandidate)) set[key] = normalizedCandidate[key];
  }
  const normalized = {
    set,
    remove,
    deleteRecord: patch.deleteRecord === true,
    addTags: domain === 'annotation' && Array.isArray(patch.addTags) ? assertStringArray(patch.addTags, 'Tags to add') : [],
    removeTags: domain === 'annotation' && Array.isArray(patch.removeTags) ? assertStringArray(patch.removeTags, 'Tags to remove') : [],
    suppressTags: domain === 'annotation' && Array.isArray(patch.suppressTags) ? assertStringArray(patch.suppressTags, 'Tags to suppress') : [],
    unsuppressTags: domain === 'annotation' && Array.isArray(patch.unsuppressTags) ? assertStringArray(patch.unsuppressTags, 'Tags to unsuppress') : [],
    importTags: domain === 'annotation' && Array.isArray(patch.importTags) ? assertStringArray(patch.importTags, 'Metadata tags') : [],
  };
  if (Buffer.byteLength(JSON.stringify(normalized), 'utf8') > MAX_PAYLOAD_BYTES) {
    throw new UserDataRepositoryError('USER_DATA_PAYLOAD_TOO_LARGE', 'User-data patch exceeds the storage limit.');
  }
  return normalized;
}

function serializeRow(row) {
  if (!row) return null;
  return {
    assetId: row.asset_id,
    domain: row.domain,
    payload: row.tombstone ? null : parseJson(row.payload_json, {}),
    tombstone: Boolean(row.tombstone),
    version: Number(row.record_version),
    authority: row.authority,
    legacySourceVersion: Number(row.legacy_source_version),
    migratedAt: row.migrated_at,
    updatedAt: row.updated_at,
  };
}

export class StableIdentityUserDataRepository {
  constructor({ database, now = () => new Date() }) {
    this.database = database;
    this.now = now;
  }

  getAuthority() {
    const row = this.database.prepare('SELECT * FROM user_data_profile_state WHERE singleton_id = 1').get();
    return {
      authority: row?.authority ?? 'legacy',
      activatedAt: row?.activated_at ?? null,
      legacyScanComplete: Boolean(row?.legacy_scan_complete),
      legacyScanCompletedAt: row?.legacy_scan_completed_at ?? null,
      updatedAt: row?.updated_at ?? null,
    };
  }

  activateAuthority() {
    const timestamp = this.now().toISOString();
    this.database.prepare(`
      UPDATE user_data_profile_state
      SET authority = 'sqlite', activated_at = COALESCE(activated_at, ?), updated_at = ?
      WHERE singleton_id = 1
    `).run(timestamp, timestamp);
    return this.getAuthority();
  }

  completeLegacyScan() {
    const timestamp = this.now().toISOString();
    return runTransaction(this.database, () => {
      this.database.prepare(`
        UPDATE user_data_profile_state
        SET legacy_scan_complete = 1,
            legacy_scan_completed_at = COALESCE(legacy_scan_completed_at, ?),
            updated_at = ?
        WHERE singleton_id = 1
      `).run(timestamp, timestamp);
      return this.getAuthority();
    });
  }

  syncLegacyBatch(entries) {
    if (!Array.isArray(entries) || entries.length > MAX_BATCH_SIZE) {
      throw new UserDataRepositoryError('USER_DATA_INVALID_INPUT', `Legacy sync batch must contain at most ${MAX_BATCH_SIZE} records.`);
    }
    return runTransaction(this.database, () => entries.map((entry) => this.#syncLegacyEntry(entry)));
  }

  mutate(input) {
    const domain = assertDomain(input?.domain);
    const legacyImageId = assertNonBlank(input?.legacyImageId, 'legacyImageId');
    const expectedVersion = safeInteger(input?.expectedVersion ?? 0, 'expectedVersion');
    const patch = normalizePatch(domain, input?.patch);
    return runTransaction(this.database, () => {
      const reference = this.#validateReference(input?.reference);
      const binding = this.#bindAlias(domain, legacyImageId, reference);
      if (binding.state === 'bound') this.#applyPendingForBinding(domain, legacyImageId, reference.assetId);
      const sequence = this.#nextSequence();
      return this.#applyPatch({
        domain,
        assetId: reference.assetId,
        patch,
        expectedVersion,
        sequence,
        enforceFieldConflict: true,
        authority: 'sqlite',
      });
    });
  }

  reserveLegacyMutation(input) {
    const mutationId = assertUuid(input?.mutationId, 'mutationId');
    const domain = assertDomain(input?.domain);
    const legacyImageId = assertNonBlank(input?.legacyImageId, 'legacyImageId');
    const patch = normalizePatch(domain, input?.patch);
    return runTransaction(this.database, () => {
      const existing = this.database.prepare('SELECT * FROM user_data_mutation_intents WHERE mutation_id = ?').get(mutationId);
      if (existing) {
        if (existing.domain !== domain || existing.legacy_image_id !== legacyImageId || existing.patch_json !== canonicalJson(patch)) {
          throw new UserDataRepositoryError('USER_DATA_IDEMPOTENCY_CONFLICT', 'Mutation id was already used for different user data.');
        }
        return { mutationId, sequence: Number(existing.sequence), state: existing.state };
      }
      const sequence = this.#nextSequence();
      const timestamp = this.now().toISOString();
      this.database.prepare(`
        INSERT INTO user_data_mutation_intents (
          mutation_id, sequence, domain, legacy_image_id, patch_json, state,
          source_version, source_fingerprint, result_payload_json, result_tombstone,
          applied_asset_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'reserved', NULL, NULL, NULL, NULL, NULL, ?, ?)
      `).run(mutationId, sequence, domain, legacyImageId, canonicalJson(patch), timestamp, timestamp);
      return { mutationId, sequence, state: 'reserved' };
    });
  }

  finalizeLegacyMutation(input) {
    const mutationId = assertUuid(input?.mutationId, 'mutationId');
    const sourceVersion = safeInteger(input?.sourceVersion, 'sourceVersion');
    const tombstone = input?.tombstone === true;
    return runTransaction(this.database, () => {
      const intent = this.database.prepare('SELECT * FROM user_data_mutation_intents WHERE mutation_id = ?').get(mutationId);
      if (!intent) throw new UserDataRepositoryError('USER_DATA_MUTATION_NOT_FOUND', `Mutation ${mutationId} was not reserved.`);
      const payload = normalizePayload(intent.domain, input?.payload, tombstone);
      const fingerprint = payloadFingerprint(payload, tombstone);
      if (intent.state !== 'reserved') {
        if (Number(intent.source_version) !== sourceVersion || intent.source_fingerprint !== fingerprint) {
          throw new UserDataRepositoryError('USER_DATA_IDEMPOTENCY_CONFLICT', 'Finalized mutation result differs from the committed result.');
        }
        return {
          mutationId,
          sequence: Number(intent.sequence),
          state: intent.state,
          record: intent.applied_asset_id ? this.#readRow(intent.applied_asset_id, intent.domain) : null,
        };
      }
      const timestamp = this.now().toISOString();
      this.#stagePending({
        domain: intent.domain,
        legacyImageId: intent.legacy_image_id,
        payload,
        tombstone,
        sourceVersion,
        fingerprint,
        state: 'pending',
        timestamp,
      });
      this.database.prepare(`
        UPDATE user_data_mutation_intents
        SET state = 'finalized', source_version = ?, source_fingerprint = ?,
            result_payload_json = ?, result_tombstone = ?, updated_at = ?
        WHERE mutation_id = ?
      `).run(sourceVersion, fingerprint, tombstone ? null : JSON.stringify(payload), tombstone ? 1 : 0, timestamp, mutationId);
      const alias = this.database.prepare(`
        SELECT asset_id FROM legacy_user_data_aliases
        WHERE domain = ? AND legacy_image_id = ? AND state = 'bound'
      `).get(intent.domain, intent.legacy_image_id);
      if (alias?.asset_id) this.#applyFinalizedIntents(intent.domain, intent.legacy_image_id, alias.asset_id);
      const finalized = this.database.prepare('SELECT state, applied_asset_id FROM user_data_mutation_intents WHERE mutation_id = ?')
        .get(mutationId);
      return {
        mutationId,
        sequence: Number(intent.sequence),
        state: finalized.state,
        record: finalized.applied_asset_id ? this.#readRow(finalized.applied_asset_id, intent.domain) : null,
      };
    });
  }

  mutateAnnotationTagGlobally({ action, sourceTag, targetTag = null, updatedAt }) {
    if (!['rename', 'remove'].includes(action)) {
      throw new UserDataRepositoryError('USER_DATA_INVALID_INPUT', `Unsupported global tag action: ${action}.`);
    }
    const source = assertNonBlank(sourceTag, 'sourceTag', 1024);
    const target = action === 'rename' ? assertNonBlank(targetTag, 'targetTag', 1024) : null;
    const sourceUpdatedAt = assertTimestamp(updatedAt, 'updatedAt');
    return runTransaction(this.database, () => {
      const rows = this.database.prepare(`
        SELECT data.* FROM asset_user_data data
        WHERE data.domain = 'annotation' AND data.tombstone = 0
      `).all();
      const changed = [];
      for (const row of rows) {
        const payload = parseJson(row.payload_json, {});
        if (!Array.isArray(payload.tags) || !payload.tags.includes(source)) continue;
        const patch = action === 'rename'
          ? {
              removeTags: [source],
              addTags: [target],
              suppressTags: [source],
              unsuppressTags: [target],
              set: { updatedAt: sourceUpdatedAt },
            }
          : { removeTags: [source], suppressTags: [source], set: { updatedAt: sourceUpdatedAt } };
        changed.push(this.#applyPatch({
          domain: 'annotation',
          assetId: row.asset_id,
          patch: normalizePatch('annotation', patch),
          expectedVersion: Number(row.record_version),
          sequence: this.#nextSequence(),
          enforceFieldConflict: false,
          authority: 'sqlite',
        }));
      }
      return changed;
    });
  }

  getTagCounts() {
    const rows = this.database.prepare(`
      SELECT data.payload_json FROM asset_user_data data
      WHERE data.domain = 'annotation' AND data.tombstone = 0
        AND EXISTS (
          SELECT 1 FROM asset_locations locations
          WHERE locations.asset_id = data.asset_id AND locations.state = 'present'
        )
    `).all();
    const counts = new Map();
    for (const row of rows) {
      const tags = parseJson(row.payload_json, {})?.tags;
      if (!Array.isArray(tags)) continue;
      for (const tag of tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts.entries()].map(([name, count]) => ({ name, count }));
  }

  captureCopySnapshot(assetId, copiedAt) {
    const normalizedAssetId = assertUuid(assetId, 'assetId');
    const copyTimestamp = assertTimestamp(copiedAt, 'copiedAt');
    return this.database.prepare('SELECT * FROM asset_user_data WHERE asset_id = ? ORDER BY domain').all(normalizedAssetId)
      .map((row) => ({
        domain: row.domain,
        tombstone: Boolean(row.tombstone),
        payload: row.tombstone ? null : parseJson(row.payload_json, {}),
        copiedAt: copyTimestamp,
      }));
  }

  applyCopySnapshot(snapshot, destinationAssetId) {
    if (!Array.isArray(snapshot) || snapshot.length > 2) {
      throw new UserDataRepositoryError('USER_DATA_INVALID_INPUT', 'Copy user-data snapshot is invalid.');
    }
    const assetId = assertUuid(destinationAssetId, 'destinationAssetId');
    const timestamp = this.now().toISOString();
    for (const entry of snapshot) {
      const domain = assertDomain(entry?.domain);
      const tombstone = entry?.tombstone === true;
      let payload = normalizePayload(domain, entry?.payload, tombstone);
      if (payload && Object.prototype.hasOwnProperty.call(payload, 'updatedAt')) {
        payload = { ...payload, updatedAt: assertTimestamp(entry.copiedAt, 'copiedAt') };
      }
      const fieldVersions = Object.fromEntries(Object.keys(payload ?? {}).map((key) => [key, 1]));
      if (tombstone) fieldVersions['*'] = 1;
      const sequence = this.#nextSequence();
      this.database.prepare(`
        INSERT OR IGNORE INTO asset_user_data (
          asset_id, domain, payload_json, tombstone, record_version, field_versions_json, field_sequences_json,
          authority, legacy_source_version, legacy_source_fingerprint,
          last_mutation_sequence, migrated_at, updated_at
        ) VALUES (?, ?, ?, ?, 1, ?, ?, 'sqlite', -1, NULL, ?, NULL, ?)
      `).run(
        assetId,
        domain,
        tombstone ? null : JSON.stringify(payload),
        tombstone ? 1 : 0,
        JSON.stringify(fieldVersions),
        JSON.stringify(Object.fromEntries(Object.keys(fieldVersions).map((key) => [key, 0]))),
        sequence,
        timestamp,
      );
    }
  }

  #syncLegacyEntry(entry) {
    const domain = assertDomain(entry?.domain);
    const legacyImageId = assertNonBlank(entry?.legacyImageId, 'legacyImageId');
    const timestamp = this.now().toISOString();
    let pending = this.database.prepare(`
      SELECT * FROM legacy_user_data_pending WHERE domain = ? AND legacy_image_id = ?
    `).get(domain, legacyImageId);

    if (Object.prototype.hasOwnProperty.call(entry ?? {}, 'sourceVersion')) {
      const sourceVersion = safeInteger(entry.sourceVersion, 'sourceVersion');
      const tombstone = entry.tombstone === true;
      const payload = normalizePayload(domain, entry.payload, tombstone);
      const fingerprint = payloadFingerprint(payload, tombstone);
      this.#stagePending({ domain, legacyImageId, payload, tombstone, sourceVersion, fingerprint, state: 'pending', timestamp });
      pending = this.database.prepare(`
        SELECT * FROM legacy_user_data_pending WHERE domain = ? AND legacy_image_id = ?
      `).get(domain, legacyImageId);
    }

    if (!entry?.reference) {
      return { domain, legacyImageId, status: pending?.state ?? 'unmapped', record: null };
    }

    const reference = this.#validateReference(entry.reference);
    const binding = this.#bindAlias(domain, legacyImageId, reference);
    if (binding.state === 'ambiguous') {
      this.database.prepare(`
        UPDATE legacy_user_data_pending SET state = 'ambiguous', updated_at = ?
        WHERE domain = ? AND legacy_image_id = ?
      `).run(timestamp, domain, legacyImageId);
      return { domain, legacyImageId, status: 'ambiguous', record: this.#readRow(reference.assetId, domain) };
    }

    this.#applyPendingForBinding(domain, legacyImageId, reference.assetId);
    const requiresSourceAck = Boolean(this.database.prepare(`
      SELECT 1 FROM user_data_mutation_intents
      WHERE domain = ? AND legacy_image_id = ? AND state = 'reserved'
      LIMIT 1
    `).get(domain, legacyImageId));
    return {
      domain,
      legacyImageId,
      status: requiresSourceAck ? 'source_ack_required' : 'bound',
      record: this.#readRow(reference.assetId, domain),
    };
  }

  #validateReference(reference) {
    if (!reference || typeof reference !== 'object') {
      throw new UserDataRepositoryError('USER_DATA_MAPPING_REQUIRED', 'A catalog-backed user-data operation requires a stable identity mapping.');
    }
    const assetId = assertUuid(reference.assetId, 'assetId');
    const locationId = assertUuid(reference.locationId, 'locationId');
    const revisionId = assertUuid(reference.revisionId, 'revisionId');
    const row = this.database.prepare(`
      SELECT locations.*, assets.state AS asset_state
      FROM asset_locations locations
      JOIN assets ON assets.asset_id = locations.asset_id
      WHERE locations.location_id = ? AND locations.asset_id = ? AND locations.revision_id = ?
    `).get(locationId, assetId, revisionId);
    if (!row || row.state === 'removed' || row.asset_state === 'deleted') {
      throw new UserDataRepositoryError('USER_DATA_MAPPING_STALE', 'The supplied asset/location/revision mapping is not current.');
    }
    return { assetId, locationId, revisionId };
  }

  #bindAlias(domain, legacyImageId, reference) {
    const timestamp = this.now().toISOString();
    const existing = this.database.prepare(`
      SELECT * FROM legacy_user_data_aliases WHERE domain = ? AND legacy_image_id = ?
    `).get(domain, legacyImageId);
    if (!existing) {
      this.database.prepare(`
        INSERT INTO legacy_user_data_aliases (
          domain, legacy_image_id, asset_id, location_id, revision_id, state, first_bound_at, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, 'bound', ?, ?)
      `).run(domain, legacyImageId, reference.assetId, reference.locationId, reference.revisionId, timestamp, timestamp);
      return { state: 'bound', assetId: reference.assetId };
    }
    if (existing.asset_id !== reference.assetId) {
      this.database.prepare(`
        UPDATE legacy_user_data_aliases SET state = 'ambiguous', last_seen_at = ?
        WHERE domain = ? AND legacy_image_id = ?
      `).run(timestamp, domain, legacyImageId);
      return { state: 'ambiguous', assetId: existing.asset_id };
    }
    this.database.prepare(`
      UPDATE legacy_user_data_aliases
      SET location_id = ?, revision_id = ?, state = 'bound', last_seen_at = ?
      WHERE domain = ? AND legacy_image_id = ?
    `).run(reference.locationId, reference.revisionId, timestamp, domain, legacyImageId);
    return { state: 'bound', assetId: reference.assetId };
  }

  #stagePending({ domain, legacyImageId, payload, tombstone, sourceVersion, fingerprint, state, timestamp }) {
    const existing = this.database.prepare(`
      SELECT * FROM legacy_user_data_pending WHERE domain = ? AND legacy_image_id = ?
    `).get(domain, legacyImageId);
    if (existing) {
      if (Number(existing.source_version) > sourceVersion) return false;
      if (Number(existing.source_version) === sourceVersion) {
        if (existing.source_fingerprint !== fingerprint) {
          this.database.prepare(`
            UPDATE legacy_user_data_pending SET state = 'ambiguous', updated_at = ?
            WHERE domain = ? AND legacy_image_id = ?
          `).run(timestamp, domain, legacyImageId);
        }
        return false;
      }
      this.database.prepare(`
        UPDATE legacy_user_data_pending
        SET payload_json = ?, tombstone = ?, source_version = ?, source_fingerprint = ?,
            state = CASE WHEN state = 'ambiguous' THEN state ELSE ? END, updated_at = ?
        WHERE domain = ? AND legacy_image_id = ?
      `).run(tombstone ? null : JSON.stringify(payload), tombstone ? 1 : 0, sourceVersion, fingerprint, state, timestamp, domain, legacyImageId);
      return true;
    }
    this.database.prepare(`
      INSERT INTO legacy_user_data_pending (
        domain, legacy_image_id, payload_json, tombstone, source_version,
        source_fingerprint, state, updated_at, migrated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(domain, legacyImageId, tombstone ? null : JSON.stringify(payload), tombstone ? 1 : 0, sourceVersion, fingerprint, state, timestamp);
    return true;
  }

  #applyPendingForBinding(domain, legacyImageId, assetId) {
    const pending = this.database.prepare(`
      SELECT * FROM legacy_user_data_pending
      WHERE domain = ? AND legacy_image_id = ? AND state != 'ambiguous'
    `).get(domain, legacyImageId);
    if (pending) {
      const rowBeforeImport = this.#rawRow(assetId, domain);
      this.#applyLegacySnapshot({
        domain,
        assetId,
        payload: pending.tombstone ? null : parseJson(pending.payload_json, {}),
        tombstone: Boolean(pending.tombstone),
        sourceVersion: Number(pending.source_version),
        fingerprint: pending.source_fingerprint,
      });
      const timestamp = this.now().toISOString();
      this.database.prepare(`
        UPDATE legacy_user_data_pending
        SET state = 'imported', migrated_at = COALESCE(migrated_at, ?), updated_at = ?
        WHERE domain = ? AND legacy_image_id = ?
      `).run(timestamp, timestamp, domain, legacyImageId);
      if (!rowBeforeImport || rowBeforeImport.authority !== 'sqlite') {
        this.#adoptFinalizedIntentsCoveredBySnapshot(
          domain,
          legacyImageId,
          assetId,
          Number(pending.source_version),
        );
      }
    }
    this.#applyFinalizedIntents(domain, legacyImageId, assetId);
  }

  #adoptFinalizedIntentsCoveredBySnapshot(domain, legacyImageId, assetId, sourceVersion) {
    const intents = this.database.prepare(`
      SELECT * FROM user_data_mutation_intents
      WHERE domain = ? AND legacy_image_id = ? AND state = 'finalized' AND source_version <= ?
      ORDER BY sequence
    `).all(domain, legacyImageId, sourceVersion);
    if (intents.length === 0) return;
    const row = this.#rawRow(assetId, domain);
    if (!row) return;
    const fieldSequences = parseJson(row.field_sequences_json, {});
    let lastSequence = Number(row.last_mutation_sequence ?? 0);
    for (const intent of intents) {
      const patch = normalizePatch(domain, parseJson(intent.patch_json, {}));
      const touched = new Set([...Object.keys(patch.set), ...patch.remove]);
      if (
        patch.addTags.length || patch.removeTags.length || patch.suppressTags.length
        || patch.unsuppressTags.length || patch.importTags.length
      ) touched.add('tags');
      if (patch.suppressTags.length || patch.unsuppressTags.length || patch.importTags.length) {
        touched.add('suppressedMetadataTags');
      }
      if (patch.deleteRecord) touched.add('*');
      const sequence = Number(intent.sequence);
      for (const field of touched) fieldSequences[field] = Math.max(Number(fieldSequences[field] ?? 0), sequence);
      lastSequence = Math.max(lastSequence, sequence);
      this.database.prepare(`
        UPDATE user_data_mutation_intents
        SET state = 'applied', applied_asset_id = ?, updated_at = ?
        WHERE mutation_id = ?
      `).run(assetId, this.now().toISOString(), intent.mutation_id);
    }
    this.database.prepare(`
      UPDATE asset_user_data
      SET authority = 'sqlite', field_sequences_json = ?, last_mutation_sequence = ?, updated_at = ?
      WHERE asset_id = ? AND domain = ?
    `).run(JSON.stringify(fieldSequences), lastSequence, this.now().toISOString(), assetId, domain);
  }

  #applyLegacySnapshot({ domain, assetId, payload, tombstone, sourceVersion, fingerprint }) {
    const row = this.#rawRow(assetId, domain);
    const timestamp = this.now().toISOString();
    if (row?.authority === 'sqlite') return serializeRow(row);
    if (row && Number(row.legacy_source_version) >= sourceVersion) return serializeRow(row);
    const version = row ? Number(row.record_version) + 1 : 1;
    const fieldVersions = Object.fromEntries(Object.keys(payload ?? {}).map((key) => [key, version]));
    if (tombstone) fieldVersions['*'] = version;
    this.database.prepare(`
      INSERT INTO asset_user_data (
        asset_id, domain, payload_json, tombstone, record_version, field_versions_json, field_sequences_json,
        authority, legacy_source_version, legacy_source_fingerprint,
        last_mutation_sequence, migrated_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'legacy', ?, ?, 0, ?, ?)
      ON CONFLICT(asset_id, domain) DO UPDATE SET
        payload_json = excluded.payload_json,
        tombstone = excluded.tombstone,
        record_version = excluded.record_version,
        field_versions_json = excluded.field_versions_json,
        field_sequences_json = excluded.field_sequences_json,
        legacy_source_version = excluded.legacy_source_version,
        legacy_source_fingerprint = excluded.legacy_source_fingerprint,
        migrated_at = COALESCE(asset_user_data.migrated_at, excluded.migrated_at),
        updated_at = excluded.updated_at
    `).run(
      assetId, domain, tombstone ? null : JSON.stringify(payload), tombstone ? 1 : 0,
      version,
      JSON.stringify(fieldVersions),
      JSON.stringify(Object.fromEntries(Object.keys(fieldVersions).map((key) => [key, 0]))),
      sourceVersion,
      fingerprint,
      timestamp,
      timestamp,
    );
    return this.#readRow(assetId, domain);
  }

  #applyFinalizedIntents(domain, legacyImageId, assetId) {
    const intents = this.database.prepare(`
      SELECT * FROM user_data_mutation_intents
      WHERE domain = ? AND legacy_image_id = ? AND state = 'finalized'
      ORDER BY sequence
    `).all(domain, legacyImageId);
    for (const intent of intents) {
      const row = this.#rawRow(assetId, domain);
      this.#applyPatch({
        domain,
        assetId,
        patch: parseJson(intent.patch_json, {}),
        expectedVersion: row ? Number(row.record_version) : 0,
        sequence: Number(intent.sequence),
        enforceFieldConflict: false,
        enforceSequencePrecedence: true,
        authority: 'sqlite',
      });
      this.database.prepare(`
        UPDATE user_data_mutation_intents SET state = 'applied', applied_asset_id = ?, updated_at = ?
        WHERE mutation_id = ?
      `).run(assetId, this.now().toISOString(), intent.mutation_id);
    }
  }

  #applyPatch({
    domain,
    assetId,
    patch,
    expectedVersion,
    sequence,
    enforceFieldConflict,
    enforceSequencePrecedence = false,
    authority,
  }) {
    const normalizedPatch = normalizePatch(domain, patch);
    const row = this.#rawRow(assetId, domain);
    const currentVersion = row ? Number(row.record_version) : 0;
    const fieldVersions = row ? parseJson(row.field_versions_json, {}) : {};
    const fieldSequences = row ? parseJson(row.field_sequences_json, {}) : {};
    const originalTouchedFields = new Set([...Object.keys(normalizedPatch.set), ...normalizedPatch.remove]);
    if (
      normalizedPatch.addTags.length || normalizedPatch.removeTags.length
      || normalizedPatch.suppressTags.length || normalizedPatch.unsuppressTags.length
      || normalizedPatch.importTags.length
    ) originalTouchedFields.add('tags');
    if (normalizedPatch.suppressTags.length || normalizedPatch.unsuppressTags.length || normalizedPatch.importTags.length) {
      originalTouchedFields.add('suppressedMetadataTags');
    }
    if (normalizedPatch.deleteRecord) originalTouchedFields.add('*');
    if (enforceFieldConflict && currentVersion !== expectedVersion) {
      const conflict = [...originalTouchedFields]
        .filter((field) => field !== 'updatedAt')
        .some((field) => Number(fieldVersions[field] ?? fieldVersions['*'] ?? 0) > expectedVersion);
      if (conflict) {
        throw new UserDataRepositoryError(
          'USER_DATA_CONFLICT',
          `${domain} changed after version ${expectedVersion}; reload before editing the same field.`,
          { current: serializeRow(row) },
        );
      }
    }

    const fieldCanApply = (field) => !enforceSequencePrecedence || (
      Number(fieldSequences[field] ?? 0) <= sequence
      && Number(fieldSequences['*'] ?? 0) <= sequence
    );
    if (enforceSequencePrecedence) {
      for (const key of Object.keys(normalizedPatch.set)) {
        if (!fieldCanApply(key)) delete normalizedPatch.set[key];
      }
      normalizedPatch.remove = normalizedPatch.remove.filter(fieldCanApply);
      if (!fieldCanApply('tags') || !fieldCanApply('suppressedMetadataTags')) {
        normalizedPatch.addTags = [];
        normalizedPatch.removeTags = [];
        normalizedPatch.suppressTags = [];
        normalizedPatch.unsuppressTags = [];
        normalizedPatch.importTags = [];
      }
      if (normalizedPatch.deleteRecord) {
        const newestFieldSequence = Math.max(0, ...Object.values(fieldSequences).map(Number));
        if (newestFieldSequence > sequence) normalizedPatch.deleteRecord = false;
      }
    }
    const touchedFields = new Set([...Object.keys(normalizedPatch.set), ...normalizedPatch.remove]);
    if (
      normalizedPatch.addTags.length || normalizedPatch.removeTags.length
      || normalizedPatch.suppressTags.length || normalizedPatch.unsuppressTags.length
      || normalizedPatch.importTags.length
    ) touchedFields.add('tags');
    if (normalizedPatch.suppressTags.length || normalizedPatch.unsuppressTags.length || normalizedPatch.importTags.length) {
      touchedFields.add('suppressedMetadataTags');
    }
    if (normalizedPatch.deleteRecord) touchedFields.add('*');
    if (touchedFields.size === 0) return serializeRow(row);

    const defaultTimestamp = Number(normalizedPatch.set.updatedAt ?? normalizedPatch.set.addedAt ?? this.now().getTime());
    let payload = row && !row.tombstone ? parseJson(row.payload_json, {}) : (
      domain === 'annotation'
        ? { isFavorite: false, tags: [], addedAt: defaultTimestamp, updatedAt: defaultTimestamp, suppressedMetadataTags: [] }
        : { updatedAt: defaultTimestamp }
    );
    let tombstone = normalizedPatch.deleteRecord;
    if (!tombstone) {
      for (const [key, value] of Object.entries(normalizedPatch.set)) payload[key] = structuredClone(value);
      for (const key of normalizedPatch.remove) delete payload[key];
      if (domain === 'annotation') {
        let tags = Array.isArray(payload.tags) ? [...payload.tags] : [];
        let suppressed = Array.isArray(payload.suppressedMetadataTags) ? [...payload.suppressedMetadataTags] : [];
        const add = new Set(normalizedPatch.addTags);
        const remove = new Set(normalizedPatch.removeTags);
        const suppress = new Set(normalizedPatch.suppressTags);
        const unsuppress = new Set(normalizedPatch.unsuppressTags);
        tags = [...new Set([...tags.filter((tag) => !remove.has(tag)), ...add])];
        suppressed = [...new Set([...suppressed.filter((tag) => !unsuppress.has(tag)), ...suppress])];
        for (const tag of normalizedPatch.importTags) {
          if (!suppressed.includes(tag) && !tags.includes(tag)) tags.push(tag);
        }
        payload.tags = tags;
        payload.suppressedMetadataTags = suppressed;
      }
      payload = normalizePayload(domain, payload, false);
    } else {
      payload = null;
    }

    const nextVersion = currentVersion + 1;
    for (const field of touchedFields) {
      fieldVersions[field] = nextVersion;
      fieldSequences[field] = Math.max(Number(fieldSequences[field] ?? 0), sequence);
    }
    const lastMutationSequence = Math.max(Number(row?.last_mutation_sequence ?? 0), sequence);
    const timestamp = this.now().toISOString();
    this.database.prepare(`
      INSERT INTO asset_user_data (
        asset_id, domain, payload_json, tombstone, record_version, field_versions_json, field_sequences_json,
        authority, legacy_source_version, legacy_source_fingerprint,
        last_mutation_sequence, migrated_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, -1, NULL, ?, NULL, ?)
      ON CONFLICT(asset_id, domain) DO UPDATE SET
        payload_json = excluded.payload_json,
        tombstone = excluded.tombstone,
        record_version = excluded.record_version,
        field_versions_json = excluded.field_versions_json,
        field_sequences_json = excluded.field_sequences_json,
        authority = excluded.authority,
        last_mutation_sequence = excluded.last_mutation_sequence,
        updated_at = excluded.updated_at
    `).run(
      assetId, domain, tombstone ? null : JSON.stringify(payload), tombstone ? 1 : 0,
      nextVersion,
      JSON.stringify(fieldVersions),
      JSON.stringify(fieldSequences),
      authority,
      lastMutationSequence,
      timestamp,
    );
    return this.#readRow(assetId, domain);
  }

  #nextSequence() {
    const row = this.database.prepare(`
      UPDATE user_data_sequence SET next_value = next_value + 1
      WHERE singleton_id = 1 RETURNING next_value - 1 AS sequence
    `).get();
    return Number(row.sequence);
  }

  #rawRow(assetId, domain) {
    return this.database.prepare('SELECT * FROM asset_user_data WHERE asset_id = ? AND domain = ?').get(assetId, domain);
  }

  #readRow(assetId, domain) {
    return serializeRow(this.#rawRow(assetId, domain));
  }
}

export { UserDataRepositoryError };
