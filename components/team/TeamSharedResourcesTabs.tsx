import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  FileText,
  Layers,
  Package,
  Plus,
  Trash2,
  AlertCircle,
} from 'lucide-react';
import { useTeamWorkspaceStore } from '../../store/useTeamWorkspaceStore';
import { useImageStore } from '../../store/useImageStore';
import { compareLocalModelsAgainstManifest } from '../../services/team/teamModelsManifest';
import type { TeamExpectedModelEntry } from '../../services/team/teamWorkspaceTypes';

interface TeamSharedResourcesTabsProps {
  workspaceId: string;
}

type ResourceTab = 'prompts' | 'boards' | 'models';

export const TeamSharedResourcesTabs: React.FC<TeamSharedResourcesTabsProps> = ({ workspaceId }) => {
  const teamPrompts = useTeamWorkspaceStore((state) => state.teamPromptsByWorkspace[workspaceId] ?? []);
  const teamBoards = useTeamWorkspaceStore((state) => state.teamBoardsByWorkspace[workspaceId] ?? []);
  const modelsManifest = useTeamWorkspaceStore((state) => state.modelsManifestByWorkspace[workspaceId] ?? null);
  const saveTeamPrompt = useTeamWorkspaceStore((state) => state.saveTeamPrompt);
  const deleteTeamPrompt = useTeamWorkspaceStore((state) => state.deleteTeamPrompt);
  const deleteTeamBoard = useTeamWorkspaceStore((state) => state.deleteTeamBoard);
  const writeModelsManifest = useTeamWorkspaceStore((state) => state.writeModelsManifest);

  const availableModels = useImageStore((state) => state.availableModels);
  const availableLoras = useImageStore((state) => state.availableLoras);

  const [tab, setTab] = useState<ResourceTab>('prompts');
  const [promptTitle, setPromptTitle] = useState('');
  const [positivePrompt, setPositivePrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [modelName, setModelName] = useState('');
  const [modelType, setModelType] = useState('checkpoint');
  const [busy, setBusy] = useState(false);

  const modelsComparison = useMemo(() => {
    const localRefs = [
      ...availableModels.map((name) => ({ name })),
      ...availableLoras.map((name) => ({ name })),
    ];
    return compareLocalModelsAgainstManifest(modelsManifest, localRefs);
  }, [modelsManifest, availableModels, availableLoras]);

  const handleAddPrompt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!positivePrompt.trim() || busy) return;
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

  const handleAddModel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modelName.trim() || busy) return;
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
          Models ({modelsComparison.installed.length}/{modelsManifest?.models.length ?? 0})
        </button>
      </div>

      {tab === 'prompts' && (
        <div className="space-y-3">
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
                      <button
                        type="button"
                        onClick={() => void deleteTeamPrompt(workspaceId, prompt.id)}
                        className="rounded p-1 text-gray-500 hover:bg-gray-700 hover:text-red-400"
                        title="Delete team prompt"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
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
                <button
                  type="button"
                  onClick={() => void deleteTeamBoard(workspaceId, board.boardId)}
                  className="rounded p-1 text-gray-500 hover:bg-gray-700 hover:text-red-400"
                  title="Delete shared board"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'models' && (
        <div className="space-y-3">
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

          <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
            {(modelsManifest?.models.length ?? 0) === 0 ? (
              <div className="py-4 text-center text-xs text-gray-500">No project models listed yet.</div>
            ) : (
              <>
                {modelsComparison.missing.map((model) => (
                  <div
                    key={`missing-${model.name}`}
                    className="flex items-center justify-between gap-2 rounded-lg border border-amber-800/60 bg-amber-950/30 px-2.5 py-1.5 text-xs"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                      <span className="truncate text-amber-100">{model.name}</span>
                      <span className="rounded bg-amber-900/60 px-1.5 py-0.5 text-[10px] text-amber-200">
                        Missing · {model.type}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleRemoveModel(model.name)}
                      className="rounded p-1 text-gray-400 hover:text-red-400"
                      title="Remove from manifest"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                {modelsComparison.installed.map((model) => (
                  <div
                    key={`installed-${model.name}`}
                    className="flex items-center justify-between gap-2 rounded-lg border border-emerald-800/50 bg-emerald-950/20 px-2.5 py-1.5 text-xs"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                      <span className="truncate text-gray-200">{model.name}</span>
                      <span className="rounded bg-emerald-900/50 px-1.5 py-0.5 text-[10px] text-emerald-200">
                        Installed · {model.type}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleRemoveModel(model.name)}
                      className="rounded p-1 text-gray-500 hover:text-red-400"
                      title="Remove from manifest"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
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
