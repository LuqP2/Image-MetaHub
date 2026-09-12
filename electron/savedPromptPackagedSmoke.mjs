import { PROVENANCE_SCHEMA_VERSION, ProvenanceRepositoryLifecycle } from './provenanceRepository.mjs';

function assertSmoke(condition, message) {
  if (!condition) throw new Error(`Packaged saved-prompt smoke failed: ${message}`);
}

export function runSavedPromptPackagedSmoke({
  userDataPath,
  repositoryLifecycle,
  indexingEnabled,
}) {
  const first = repositoryLifecycle.run((repository) => {
    const saved = repository.savePrompt({
      positivePrompt: '  packaged literal prompt\nsecond line  ',
      negativePrompt: '',
      textBasis: 'effective',
      source: null,
      sourceCreatedAt: 1_700_000_000_000,
    });
    const duplicate = repository.savePrompt({
      positivePrompt: '  packaged literal prompt\nsecond line  ',
      negativePrompt: '',
      textBasis: 'original',
      source: null,
    });
    assertSmoke(saved.status === 'saved', 'initial save did not commit');
    assertSmoke(duplicate.status === 'already-saved', 'literal duplicate was not detected');
    assertSmoke(duplicate.prompt.id === saved.prompt.id, 'duplicate changed prompt identity');
    assertSmoke(duplicate.prompt.textBasis === 'effective', 'duplicate changed the historical text basis');
    return saved.prompt;
  });

  repositoryLifecycle.close();
  const reopenedLifecycle = new ProvenanceRepositoryLifecycle({ userDataPath });
  const reopenedStatus = reopenedLifecycle.initialize();
  const reopened = reopenedLifecycle.run((repository) => repository.listSavedPrompts());
  assertSmoke(reopenedStatus.available, 'catalog was unavailable after reopen');
  assertSmoke(reopenedStatus.schemaVersion === PROVENANCE_SCHEMA_VERSION, 'reopened catalog schema is not current');
  assertSmoke(reopened.length === 1, 'saved prompt did not survive reopen exactly once');
  assertSmoke(reopened[0]?.id === first.id, 'saved prompt identity changed after reopen');
  assertSmoke(reopened[0]?.positivePrompt === first.positivePrompt, 'literal prompt text changed after reopen');
  assertSmoke(reopened[0]?.sourceCreatedAt === first.sourceCreatedAt, 'source creation timestamp changed after reopen');

  const removed = reopenedLifecycle.run((repository) => repository.removeSavedPrompt(first.id));
  const removedAgain = reopenedLifecycle.run((repository) => repository.removeSavedPrompt(first.id));
  const finalPrompts = reopenedLifecycle.run((repository) => repository.listSavedPrompts());
  assertSmoke(removed?.removed === true, 'saved prompt was not removed');
  assertSmoke(removedAgain?.removed === false, 'second removal was not idempotent');
  assertSmoke(finalPrompts.length === 0, 'removed prompt remained in the catalog');
  reopenedLifecycle.close();

  return {
    success: true,
    indexingEnabled,
    schemaVersion: reopenedStatus.schemaVersion,
    authority: 'sqlite',
    reopened: true,
    duplicatePreservedIdentity: true,
    literalTextPreserved: true,
    sourceCreatedAtPreserved: true,
    idempotentRemove: true,
  };
}
