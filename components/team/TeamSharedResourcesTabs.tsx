import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileText,
  Layers,
  Package,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import { useTeamWorkspaceStore } from '../../store/useTeamWorkspaceStore';
import { useImageStore } from '../../store/useImageStore';
import { useBoardStore } from '../../store/useBoardStore';
import { useFeatureAccess } from '../../hooks/useFeatureAccess';
import { normalizeBoardDocument } from '../../services/boards/document.mjs';
import {
  compareLocalModelsAgainstManifest,
  normalizeBoardPathsForTeam,
  resolveTeamBoardPaths,
} from '../../services/team/teamModelsManifest';
import type {
  TeamBoardEnvelope,
  TeamExpectedModelEntry,
} from '../../services/team/teamWorkspaceTypes';

interface TeamSharedResourcesTabsProps {
  workspaceId: string;
  onBoardOpened?: () => void;
}

type ResourceTab = 'prompts' | 'boards' | 'models';

export const TeamSharedResourcesTabs: React.FC<TeamSharedResourcesTabsProps> = ({
  workspaceId,
  onBoardOpened,
}) => {
  const { canUseTeams } = useFeatureAccess();
  const workspace = useTeamWorkspaceStore((state) => state.workspacesById[workspaceId] ?? null);
  const teamPrompts = useTeamWorkspaceStore((state) => state.teamPromptsByWorkspace[workspaceId] ?? []);
  const teamBoards = useTeamWorkspaceStore((state) => state.teamBoardsByWorkspace[workspaceId] ?? []);
  const modelsManifest = useTeamWorkspaceStore((state) => state.modelsManifestByWorkspace[workspaceId] ?? null);
  const linkedBoardsByLocalId = useTeamWorkspaceStore((state) => state.linkedBoardsByLocalId);
  const saveTeamPrompt = useTeamWorkspaceStore((state) => state.saveTeamPrompt);
  const deleteTeamPrompt = useTeamWorkspaceStore((state) => state.deleteTeamPrompt);
  const loadTeamBoard = useTeamWorkspaceStore((state) => state.loadTeamBoard);
  const saveTeamBoard = useTeamWorkspaceStore((state) => state.saveTeamBoard);
  const deleteTeamBoard = useTeamWorkspaceStore((state) => state.deleteTeamBoard);
  const setLinkedBoardMeta = useTeamWorkspaceStore((state) => state.setLinkedBoardMeta);
  const writeModelsManifest = useTeamWorkspaceStore((state) => state.writeModelsManifest);

  const availableModels = useImageStore((state) => state.availableModels);
  const availableLoras = useImageStore((state) => state.availableLoras);

  const activeBoardId = useBoardStore((state) => state.activeBoardId);
  const activeBoardSession = useBoardStore((state) => (
    state.activeBoardId ? state.sessions[state.activeBoardId] ?? null : null
  ));
  const adoptBoard = useBoardStore((state) => state.adoptBoard);

  const [tab, setTab] = useState<ResourceTab>('prompts');
  const [promptTitle, setPromptTitle] = useState('');
  const [positivePrompt, setPositivePrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [boardNotice, setBoardNotice] = useState<string | null>(null);
  const [boardConflict, setBoardConflict] = useState<{
    teamBoardId: string;
    remote: TeamBoardEnvelope;
  } | null>(null);

  const [modelName, setModelName] = useState('');
  const [modelType, setModelType] = useState('checkpoint');
  const [busy, setBusy] = useState(false);

  const activeBoardLink = activeBoardId ? linkedBoardsByLocalId[activeBoardId] ?? null : null;
  const activeBoardBelongsToWorkspace = Boolean(activeBoardLink && activeBoardLink.workspaceId === workspaceId);

  const modelReferences = useMemo(() => {
    const localRefs = [
      ...availableModels.map((name) => ({ name })),
      ...availableLoras.map((name) => ({ name })),
    ];
    const comparison = compareLocalModelsAgainstManifest(modelsManifest, localRefs);
    return { referenced: comparison.installed, unreferenced: comparison.missing };
  }, [modelsManifest, availableModels, availableLoras]);

  const handleAddPrompt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canUseTeams || !positivePrompt.trim() || busy) return;
    setBusy(true);
    try {
      await saveTeamPrompt(workspaceId, {
        title: promptTitle.trim() || 'Team Prompt',
        positivePrompt: positivePrompt.trim(),
        negativePrompt: negativePrompt.trim(),
      });
      setPromptTitle('');
      setPositivePrompt('');
      setNegativePrompt('');
    } finally {
      setBusy(false);
    }
  };

  const handleCopyPrompt = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 1500);
    } catch {
      // Ignore clipboard failure in headless contexts.
    }
  };

  const openEnvelopeInCanvas = (envelope: TeamBoardEnvelope) => {
    if (!workspace) return;
    const resolvedDoc = resolveTeamBoardPaths(envelope.document, workspace.rootPath);
    const normalized = normalizeBoardDocument({
      ...resolvedDoc,
      id: typeof (resolvedDoc as { id?: unknown }).id === 'string'
        ? (resolvedDoc as { id: string }).id
        : `team-${envelope.boardId}`,
      name: envelope.name,
    });
    adoptBoard(normalized);
    setLinkedBoardMeta(normalized.id, {
      workspaceId,
      boardId: envelope.boardId,
      revision: envelope.revision,
      contentHash: envelope.contentHash,
    });
    setBoardConflict(null);
    window.dispatchEvent(new CustomEvent('imh:open-canvas'));
    onBoardOpened?.();
  };

  const handleOpenTeamBoard = async (boardId: string) => {
    if (busy) return;
    setBusy(true);
    setBoardNotice(null);
    try {
      const envelope = await loadTeamBoard(workspaceId, boardId);
      if (!envelope) {
        setBoardNotice('Could not load shared board from disk.');
        return;
      }
      openEnvelopeInCanvas(envelope);
    } finally {
      setBusy(false);
    }
  };

  const handlePushActiveBoard = async (options: { asCopy?: boolean; forceOverwrite?: boolean } = {}) => {
    if (!canUseTeams || !workspace || !activeBoardSession || busy) return;
    setBusy(true);
    setBoardNotice(null);
    try {
      const doc = activeBoardSession.document;
      const portableDoc = normalizeBoardPathsForTeam(doc, workspace.rootPath) as unknown as Record<string, unknown>;
      const targetBoardId = options.asCopy
        ? `${activeBoardLink?.boardId || doc.id}-copy-${Date.now().toString(36)}`
        : (activeBoardBelongsToWorkspace && activeBoardLink ? activeBoardLink.boardId : doc.id);
      const targetName = options.asCopy ? `${doc.name} (Copy)` : doc.name;

      const result = await saveTeamBoard({
        workspaceId,
        boardId: targetBoardId,
        name: targetName,
        document: portableDoc,
        expectedRevision: options.asCopy ? 0 : (activeBoardBelongsToWorkspace ? (activeBoardLink?.revision ?? 0) : 0),
        expectedHash: options.asCopy ? null : (activeBoardBelongsToWorkspace ? (activeBoardLink?.contentHash ?? null) : null),
        forceOverwrite: Boolean(options.forceOverwrite),
      });

      if (!result) return;
      if (result.saved) {
        setBoardConflict(null);
        setLinkedBoardMeta(doc.id, {
          workspaceId,
          boardId: result.envelope.boardId,
          revision: result.envelope.revision,
          contentHash: result.envelope.contentHash,
        });
        setBoardNotice(`Saved "${result.envelope.name}" (rev ${result.envelope.revision}).`);
      } else if (result.conflict) {
        setBoardConflict({
          teamBoardId: targetBoardId,
          remote: result.remote,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleAddModel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canUseTeams || !modelName.trim() || busy) return;
    setBusy(true);
    try {
      const existing: TeamExpectedModelEntry[] = modelsManifest?.models ?? [];
      await writeModelsManifest(workspaceId, [
        ...existing,
        { name: modelName.trim(), type: modelType },
      ]);
      setModelName('');
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveModel = async (nameToRemove: string) => {
    if (!canUseTeams) return;
    setBusy(true);
    try {
      const existing: TeamExpectedModelEntry[] = modelsManifest?.models ?? [];
      await writeModelsManifest(
        workspaceId,
        existing.filter((m) => m.name !== nameToRemove),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 border-t border-gray-800 pt-3">
      <div className="flex items-center gap-1 rounded-lg bg-gray-950/70 p-1">
        <button
          type="button"
          onClick={() => setTab('prompts')}
          className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
            tab === 'prompts' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <FileText className="h-3.5 w-3.5" />
          Prompts ({teamPrompts.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('boards')}
          className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
            tab === 'boards' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <Layers className="h-3.5 w-3.5" />
          Boards ({teamBoards.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('models')}
          className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
            tab === 'models' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <Package className="h-3.5 w-3.5" />
          Models ({modelsManifest?.models.length ?? 0})
        </button>
      </div>

      {tab === 'prompts' && (
        <div className="space-y-3">
          {canUseTeams && (
            <form onSubmit={handleAddPrompt} className="space-y-2 rounded-lg border border-gray-800 bg-gray-950/40 p-2.5">
              <input
                type="text"
                value={promptTitle}
                onChange={(e) => setPromptTitle(e.target.value)}
                placeholder="Prompt title"
                className="w-full rounded border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-xs text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
              />
              <textarea
                rows={2}
                value={positivePrompt}
                onChange={(e) => setPositivePrompt(e.target.value)}
                placeholder="Positive prompt..."
                className="w-full rounded border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-xs text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
              />
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={negativePrompt}
                  onChange={(e) => setNegativePrompt(e.target.value)}
                  placeholder="Negative prompt (optional)"
                  className="min-w-0 flex-1 rounded border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-xs text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={busy || !positivePrompt.trim()}
                  className="inline-flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Save
                </button>
              </div>
            </form>
          )}

          <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
            {teamPrompts.length === 0 ? (
              <div className="py-4 text-center text-xs text-gray-500">No shared prompts yet.</div>
            ) : (
              teamPrompts.map((prompt) => (
                <div key={prompt.id} className="rounded-lg border border-gray-800 bg-gray-800/40 p-2.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium text-gray-200">{prompt.title}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[10px] text-gray-400">by {prompt.updatedByName}</span>
                      <button
                        type="button"
                        onClick={() => void handleCopyPrompt(prompt.id, prompt.positivePrompt)}
                        className="rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-gray-100"
                        title="Copy positive prompt"
                      >
                        <Copy className={`h-3.5 w-3.5 ${copiedId === prompt.id ? 'text-emerald-400' : ''}`} />
                      </button>
                      {canUseTeams && (
                        <button
                          type="button"
                          onClick={() => void deleteTeamPrompt(workspaceId, prompt.id)}
                          className="rounded p-1 text-gray-500 hover:bg-gray-700 hover:text-red-400"
                          title="Delete team prompt"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[11px] text-gray-300">{prompt.positivePrompt}</p>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {tab === 'boards' && (
        <div className="space-y-3">
          {canUseTeams && activeBoardSession && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-gray-800 bg-gray-950/50 px-3 py-2 text-xs">
              <div className="min-w-0">
                <div className="truncate font-medium text-gray-200">
                  Active Canvas: {activeBoardSession.document.name}
                </div>
                <div className="text-[11px] text-gray-400">
                  {activeBoardBelongsToWorkspace && activeBoardLink
                    ? `Linked to Team (rev ${activeBoardLink.revision})`
                    : 'Not yet shared to this Team Workspace'}
                </div>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handlePushActiveBoard()}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                <Upload className="h-3.5 w-3.5" />
                {activeBoardBelongsToWorkspace ? 'Push to Team' : 'Share to Team'}
              </button>
            </div>
          )}

          {boardConflict && (
            <div className="space-y-2 rounded-lg border border-rose-600/70 bg-rose-950/50 p-2.5 text-xs text-rose-100">
              <div className="flex items-center gap-1.5 font-semibold text-rose-200">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span>
                  Board updated remotely by {boardConflict.remote.updatedByName} (rev {boardConflict.remote.revision})
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => openEnvelopeInCanvas(boardConflict.remote)}
                  className="rounded border border-rose-400/60 bg-rose-900/70 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-rose-800"
                >
                  Reload remote
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handlePushActiveBoard({ asCopy: true })}
                  className="rounded border border-gray-600 bg-gray-800 px-2.5 py-1 text-[11px] font-medium text-gray-100 hover:bg-gray-700"
                >
                  Save as copy
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handlePushActiveBoard({ forceOverwrite: true })}
                  className="rounded border border-amber-500/70 bg-amber-900/60 px-2.5 py-1 text-[11px] font-medium text-amber-100 hover:bg-amber-800"
                >
                  Overwrite
                </button>
              </div>
            </div>
          )}

          {boardNotice && (
            <div className="rounded-md border border-blue-800/60 bg-blue-950/40 px-2.5 py-1.5 text-xs text-blue-200">
              {boardNotice}
            </div>
          )}

          <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
            {teamBoards.length === 0 ? (
              <div className="py-6 text-center text-xs text-gray-500">
                No shared boards in <code className="text-gray-400">.imh-team/boards/</code> yet.
              </div>
            ) : (
              teamBoards.map((board) => (
                <div
                  key={board.boardId}
                  className="flex items-center justify-between gap-2 rounded-lg border border-gray-800 bg-gray-800/40 px-3 py-2 text-xs"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-gray-200">{board.name}</div>
                    <div className="text-[11px] text-gray-400">
                      rev {board.revision} · {board.updatedByName}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleOpenTeamBoard(board.boardId)}
                      className="inline-flex items-center gap-1 rounded border border-gray-700 bg-gray-800 px-2 py-1 text-[11px] font-medium text-gray-200 hover:bg-gray-700"
                      title="Open in Canvas"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Open
                    </button>
                    {canUseTeams && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void deleteTeamBoard(workspaceId, board.boardId)}
                        className="rounded p-1 text-gray-500 hover:bg-gray-700 hover:text-red-400"
                        title="Delete shared board"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {tab === 'models' && (
        <div className="space-y-3">
          <p className="text-xs text-gray-400">References in indexed images. Model installation is unverified.</p>
          {canUseTeams && (
            <form onSubmit={handleAddModel} className="flex items-center gap-2">
              <select
                value={modelType}
                onChange={(e) => setModelType(e.target.value)}
                className="rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-gray-200 focus:border-blue-500 focus:outline-none"
              >
                <option value="checkpoint">Checkpoint</option>
                <option value="lora">LoRA</option>
                <option value="vae">VAE</option>
                <option value="controlnet">ControlNet</option>
              </select>
              <input
                type="text"
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                placeholder="Expected model filename or name..."
                className="min-w-0 flex-1 rounded border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-xs text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={busy || !modelName.trim()}
                className="inline-flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" />
                Add
              </button>
            </form>
          )}

          <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
            {(modelsManifest?.models.length ?? 0) === 0 ? (
              <div className="py-4 text-center text-xs text-gray-500">No project models listed yet.</div>
            ) : (
              <>
                {modelReferences.unreferenced.map((model) => (
                  <div
                    key={`missing-${model.name}`}
                    className="flex items-center justify-between gap-2 rounded-lg border border-amber-800/60 bg-amber-950/30 px-2.5 py-1.5 text-xs"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                      <span className="truncate text-amber-100">{model.name}</span>
                      <span className="rounded bg-amber-900/60 px-1.5 py-0.5 text-[10px] text-amber-200">
                        No reference · {model.type}
                      </span>
                    </div>
                    {canUseTeams && (
                      <button
                        type="button"
                        onClick={() => void handleRemoveModel(model.name)}
                        className="rounded p-1 text-gray-400 hover:text-red-400"
                        title="Remove from manifest"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
                {modelReferences.referenced.map((model) => (
                  <div
                    key={`installed-${model.name}`}
                    className="flex items-center justify-between gap-2 rounded-lg border border-emerald-800/50 bg-emerald-950/20 px-2.5 py-1.5 text-xs"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                      <span className="truncate text-gray-200">{model.name}</span>
                      <span className="rounded bg-emerald-900/50 px-1.5 py-0.5 text-[10px] text-emerald-200">
                        Referenced · {model.type}
                      </span>
                    </div>
                    {canUseTeams && (
                      <button
                        type="button"
                        onClick={() => void handleRemoveModel(model.name)}
                        className="rounded p-1 text-gray-500 hover:text-red-400"
                        title="Remove from manifest"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
