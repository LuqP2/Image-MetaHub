import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PROVENANCE_DIRECTORY_NAME } from './provenancePaths.mjs';

const AUTHORITY_MARKER_NAME = 'user-data-sqlite-authority.json';

export class StableIdentityUserDataService {
  constructor({
    repositoryLifecycle,
    userDataPath,
    migrationEnabled = false,
    publishChanges = () => {},
    fileSystem = fs,
    logger = console,
  }) {
    this.repositoryLifecycle = repositoryLifecycle;
    this.migrationEnabled = migrationEnabled;
    this.publishChanges = publishChanges;
    this.fileSystem = fileSystem;
    this.logger = logger;
    this.markerPath = path.join(userDataPath, PROVENANCE_DIRECTORY_NAME, AUTHORITY_MARKER_NAME);
    this.authorityHint = false;
    this.authority = 'legacy';
    this.legacyScanComplete = false;
    this.legacyScanCompletedAt = null;
    this.initialized = false;
  }

  initialize() {
    this.authorityHint = this.fileSystem.existsSync(this.markerPath);
    const available = Boolean(this.repositoryLifecycle?.getStatus?.().available);
    if (!available) {
      this.authority = this.authorityHint ? 'sqlite' : 'legacy';
      this.initialized = true;
      return this.getStatus();
    }

    const stored = this.repositoryLifecycle.run((repository) => repository.getUserDataAuthority());
    this.authority = stored.authority;
    this.legacyScanComplete = stored.legacyScanComplete;
    this.legacyScanCompletedAt = stored.legacyScanCompletedAt;
    if (this.migrationEnabled && this.authority !== 'sqlite') {
      // The durable external hint is intentionally written first. If activation is
      // interrupted, the safe failure mode is "SQLite unavailable", never stale
      // legacy data silently becoming authoritative again.
      this.#writeAuthorityMarker();
      this.authorityHint = true;
      const activated = this.repositoryLifecycle.run((repository) => repository.activateUserDataAuthority());
      this.authority = activated.authority;
      this.legacyScanComplete = activated.legacyScanComplete;
      this.legacyScanCompletedAt = activated.legacyScanCompletedAt;
    } else if (this.authority === 'sqlite' && !this.authorityHint) {
      this.#writeAuthorityMarker();
      this.authorityHint = true;
    }
    this.initialized = true;
    return this.getStatus();
  }

  getStatus() {
    const catalogAvailable = Boolean(this.repositoryLifecycle?.getStatus?.().available);
    return {
      initialized: this.initialized,
      authority: this.authorityHint || this.authority === 'sqlite' ? 'sqlite' : 'legacy',
      available: (this.authorityHint || this.authority === 'sqlite') ? catalogAvailable : true,
      migrationEnabled: this.migrationEnabled,
      indexingEnabled: this.migrationEnabled,
      legacyScanComplete: this.legacyScanComplete,
      legacyScanCompletedAt: this.legacyScanCompletedAt,
      error: catalogAvailable ? null : this.repositoryLifecycle?.getStatus?.().error ?? null,
    };
  }

  syncLegacyBatch(entries) {
    this.#requireStableAvailable();
    const results = this.repositoryLifecycle.run((repository) => repository.syncLegacyUserDataBatch(entries));
    this.#publishRecords(results.map((result) => result.record).filter(Boolean));
    return results;
  }

  mutate(input) {
    this.#requireStableAvailable();
    const record = this.repositoryLifecycle.run((repository) => repository.mutateAssetUserData(input));
    this.#publishRecords([record]);
    return record;
  }

  reserveLegacyMutation(input) {
    this.#requireStableAvailable();
    return this.repositoryLifecycle.run((repository) => repository.reserveLegacyUserDataMutation(input));
  }

  finalizeLegacyMutation(input) {
    this.#requireStableAvailable();
    const result = this.repositoryLifecycle.run((repository) => repository.finalizeLegacyUserDataMutation(input));
    if (result.record) this.#publishRecords([result.record]);
    return result;
  }

  completeLegacyScan() {
    this.#requireStableAvailable();
    const state = this.repositoryLifecycle.run((repository) => repository.completeLegacyUserDataScan());
    this.legacyScanComplete = state.legacyScanComplete;
    this.legacyScanCompletedAt = state.legacyScanCompletedAt;
    return this.getStatus();
  }

  mutateAnnotationTagGlobally(input) {
    this.#requireStableAvailable();
    const records = this.repositoryLifecycle.run((repository) => repository.mutateAnnotationTagGlobally(input));
    this.#publishRecords(records);
    return records;
  }

  getTagCounts() {
    this.#requireStableAvailable();
    return this.repositoryLifecycle.run((repository) => repository.getUserDataTagCounts());
  }

  #requireStableAvailable() {
    const status = this.getStatus();
    if (status.authority !== 'sqlite') {
      const error = new Error('Stable-identity user-data persistence is not active for this profile.');
      error.code = 'USER_DATA_LEGACY_AUTHORITY';
      throw error;
    }
    if (!status.available) {
      const error = new Error('Stable-identity user-data persistence is unavailable.');
      error.code = 'USER_DATA_UNAVAILABLE';
      throw error;
    }
  }

  #publishRecords(records) {
    if (!records.length) return;
    for (let offset = 0; offset < records.length; offset += 200) {
      this.publishChanges({ records: records.slice(offset, offset + 200) });
    }
  }

  #writeAuthorityMarker() {
    const directory = path.dirname(this.markerPath);
    this.fileSystem.mkdirSync(directory, { recursive: true });
    const temporaryPath = `${this.markerPath}.${crypto.randomUUID()}.tmp`;
    try {
      this.fileSystem.writeFileSync(temporaryPath, JSON.stringify({ authority: 'sqlite', version: 1 }), {
        encoding: 'utf8',
        flag: 'wx',
      });
      this.fileSystem.renameSync(temporaryPath, this.markerPath);
    } catch (error) {
      if (error?.code === 'EEXIST' && this.fileSystem.existsSync(this.markerPath)) return;
      throw error;
    } finally {
      try { this.fileSystem.unlinkSync(temporaryPath); } catch { /* best effort */ }
    }
  }
}

export { AUTHORITY_MARKER_NAME };
