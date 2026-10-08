import React, { useEffect, useRef, useState } from 'react';
import { useModelManager } from '../services/modelLibrary/manager';
import { huggingFaceFileUrl, parseHuggingFaceLink } from '../services/modelLibrary/huggingFaceLink.mjs';
import type { HuggingFaceLookup, ModelInspectorItem, ModelManagerCommand } from '../services/modelLibrary/types';
import { executeModelCommand, modelButton, modelInput } from './ModelManagerPanels';

export function HuggingFaceModelPanel({ item }: { item: ModelInspectorItem }) {
  const manager = useModelManager();
  const copies = item.location.sha256 ? manager.catalog.locations.filter((location) => location.sha256?.toLowerCase() === item.location.sha256?.toLowerCase()) : [item.location];
  const [copyId, setCopyId] = useState(item.location.id);
  const location = copies.find((copy) => copy.id === copyId) ?? item.location;
  const binding = location.huggingFace;
  const differentCopyLinks = binding && copies.some((copy) => copy.huggingFace && (copy.huggingFace.repoId !== binding.repoId || copy.huggingFace.filePath !== binding.filePath || copy.huggingFace.linkedRevision !== binding.linkedRevision));
  const [url, setUrl] = useState('');
  const [target, setTarget] = useState({ repoId: '', revision: 'main', filePath: '' });
  const [lookup, setLookup] = useState<HuggingFaceLookup>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const selectedId = useRef(location.id); selectedId.current = location.id;
  useEffect(() => { setCopyId(item.location.id); }, [item.location.id]);
  useEffect(() => {
    setUrl(''); setLookup(undefined); setError('');
    setTarget({ repoId: '', revision: 'main', filePath: '' });
  }, [location.id]);
  const execute = async (command: ModelManagerCommand) => {
    const id = location.id;
    setError(''); setBusy(true);
    try {
      const result = await executeModelCommand(command);
      if (selectedId.current === id && command.type === 'lookupHF' && result) {
        setLookup(result);
        setTarget((previous) => ({ ...previous, filePath: result.files.some((file) => file.path === previous.filePath) ? previous.filePath : result.files[0].path }));
      }
    } catch (failure) { if (selectedId.current === id) setError((failure as Error).message); }
    finally { setBusy(false); }
  };
  const file = lookup?.files.find((entry) => entry.path === target.filePath);
  const blocked = busy || manager.loading || Boolean(manager.progress);
  const edit = (patch: Partial<typeof target>) => { setTarget({ ...target, ...patch }); setLookup(undefined); };
  return <section className="space-y-3 rounded-lg border border-gray-800 p-3" aria-label="Hugging Face binding">
    <h3 className="font-medium">Hugging Face</h3>
    {copies.length > 1 && <label className="block text-xs text-gray-400">File location<select className={modelInput} value={location.id} onChange={(event) => setCopyId(event.target.value)}>{copies.map((copy) => <option key={copy.id} value={copy.id}>{copy.sourceName} / {copy.relativePath}{copy.huggingFace ? ` · ${copy.huggingFace.repoId}` : ' · unlinked'}</option>)}</select></label>}
    {binding ? <>
      <p className="break-all text-sm">{binding.repoId}</p>
      <p className="break-all text-xs text-gray-300">{binding.filePath} · {binding.linkedRevision}</p>
      <p className="text-xs text-gray-400">{binding.verification === 'sha256' ? 'SHA-256 file match verified' : 'Manual link · file match not verified'}</p>
      <p className="text-xs text-gray-500">Remote file: {binding.size.toLocaleString()} bytes · Checked {new Date(binding.fetchedAt).toLocaleString()} · Commit {binding.resolvedCommit.slice(0, 12)}</p>
      <div className="flex flex-wrap gap-2">
        <button className={modelButton} onClick={() => void window.electronAPI?.openExternalUrl(huggingFaceFileUrl(binding))}>Open file on Hugging Face</button>
        <button className={modelButton} disabled={blocked} onClick={() => void execute({ type: 'verifyHF', locationId: location.id })}>Verify file match</button>
        <button className={modelButton} onClick={() => void execute({ type: 'unbindHF', locationId: location.id })}>Remove Hugging Face link</button>
      </div>
      {binding.verification === 'sha256' && copies.length > 1 && <p className="text-xs text-gray-500">Verified links are shared with identical copies. Removing this link also unlinks copies sharing this verified link. Different copy links are preserved.</p>}
      {differentCopyLinks && <p className="text-xs text-amber-400">Other copies have different Hugging Face links. Choose a file location to review its link.</p>}
    </> : <p className="text-xs text-gray-400">Link a public repository file to this model.</p>}
    <details key={location.id} open={!binding || undefined}>
      <summary className="cursor-pointer text-xs text-gray-400">{binding ? 'Change Hugging Face link' : 'Link a public Hugging Face file'}</summary>
      <form className="mt-3 space-y-3" onSubmit={(event) => {
        event.preventDefault();
        try {
          const parsed = target.repoId ? target : parseHuggingFaceLink(url);
          void execute({ type: 'lookupHF', locationId: location.id, ...parsed });
        } catch (failure) { setError((failure as Error).message); }
      }}>
        <label className="block text-xs text-gray-400">Repository or file URL<input disabled={blocked} className={modelInput} value={url} placeholder="https://huggingface.co/owner/repository" onChange={(event) => {
          setUrl(event.target.value); setLookup(undefined);
          try { setTarget(parseHuggingFaceLink(event.target.value)); }
          catch { setTarget({ repoId: '', revision: 'main', filePath: '' }); }
        }} /></label>
        <label className="block text-xs text-gray-400">Repository<input disabled={blocked} className={modelInput} value={target.repoId} placeholder="owner/repository" onChange={(event) => { setUrl(''); edit({ repoId: event.target.value }); }} /></label>
        <label className="block text-xs text-gray-400">Revision<input disabled={blocked} className={modelInput} value={target.revision} onChange={(event) => edit({ revision: event.target.value })} /></label>
        <label className="block text-xs text-gray-400">File path (leave empty to browse)<input disabled={blocked} className={modelInput} value={target.filePath} placeholder="folder/model.safetensors" onChange={(event) => edit({ filePath: event.target.value })} /></label>
        <p className="text-xs text-gray-500">For branch names containing /, check the revision and file path separately before looking up the file.</p>
        <button className={modelButton} disabled={blocked}>Look up public files</button>
      </form>
      {lookup && <div className="mt-3 space-y-3">
        <label className="block text-xs text-gray-400">Choose a .safetensors file<select className={modelInput} value={target.filePath} onChange={(event) => setTarget({ ...target, filePath: event.target.value })}>{lookup.files.map((entry) => <option key={entry.path} value={entry.path}>{entry.path}</option>)}</select></label>
        {file && <><p className="break-all text-xs text-gray-400">{lookup.repoId} · {lookup.revision} · {file.size.toLocaleString()} bytes · Commit {lookup.resolvedCommit.slice(0, 12)}</p><p className="text-xs text-gray-500">{file.lfsSha256 ? 'LFS SHA-256 available for an explicit file match check.' : 'No LFS SHA-256 available; this file can be linked manually.'}</p><button className={modelButton} disabled={blocked} onClick={() => void execute({ type: 'bindHF', locationId: location.id, repoId: lookup.repoId, revision: lookup.revision, filePath: file.path, fingerprint: file.fingerprint })}>{binding ? 'Replace Hugging Face link' : 'Confirm manual link'}</button></>}
      </div>}
    </details>
    <p className="text-xs text-gray-500">Public metadata only. Verification calculates your local file's SHA-256 on request.</p>
    {manager.progress?.kind === 'huggingFace' && <button className={modelButton} onClick={() => void execute({ type: 'cancel' })}>Cancel Hugging Face operation</button>}
    {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
  </section>;
}
