import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Runs packaged services in Electron's Node runtime with synthetic profiles only.
// Covers ASAR imports, SQLite, resource notifications and cross-process publication;
// it does not launch the renderer or access an existing Image MetaHub profile.
const executable = process.argv[2];
if (!executable) throw new Error('Usage: node scripts/runPackagedTeamsSmoke.mjs <packaged-executable>');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'imh-teams-packaged-'));
const runtime = path.join(root, 'smoke.cjs');
await fs.writeFile(runtime, String.raw`
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const root = process.env.IMH_TEAMS_SMOKE_ROOT;
const shared = path.join(root, 'shared');
const delay = () => new Promise(resolve => setTimeout(resolve, 20));
async function waitFile(file) {
  const deadline = Date.now() + 20000;
  while (true) {
    try { await fs.access(file); return; } catch {}
    if (Date.now() > deadline) throw new Error('Timed out waiting for ' + file);
    await delay();
  }
}
function child(role) {
  return new Promise((resolve, reject) => {
    const process = spawn(global.process.execPath, [__filename, role], {
      env: global.process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    process.stdout.on('data', data => { output += data; });
    process.stderr.on('data', data => { output += data; });
    const timer = setTimeout(() => { process.kill(); reject(new Error('Child timed out: ' + role)); }, 30000);
    process.once('error', error => { clearTimeout(timer); reject(error); });
    process.once('exit', code => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(role + ': ' + output));
    });
  });
}
(async () => {
  const archive = path.join(path.dirname(process.execPath), 'resources', 'app.asar');
  const { TeamWorkspaceService } = await import(pathToFileURL(path.join(archive, 'electron/teamWorkspaceService.mjs')));
  const role = process.argv[2];
  if (role) {
    const service = new TeamWorkspaceService({ userDataPath: path.join(root, role), enableWatcher: false, reconcileIntervalMs: 0 });
    try {
      const { manifest } = await service.openWorkspace(shared);
      await fs.writeFile(path.join(root, role + '.ready'), '');
      await waitFile(path.join(root, 'start'));
      const result = await service.saveTeamBoard(manifest.workspaceId, {
        boardId: 'race', name: 'Synthetic board', expectedRevision: 1, document: { editor: role },
      });
      await fs.writeFile(path.join(root, role + '.json'), JSON.stringify(result));
    } finally { await service.dispose(); }
    return;
  }
  let notifications = 0;
  const a = new TeamWorkspaceService({ userDataPath: path.join(root, 'a'), enableWatcher: false, reconcileIntervalMs: 0, onWorkspaceUpdated: () => { notifications++; } });
  const b = new TeamWorkspaceService({ userDataPath: path.join(root, 'b'), enableWatcher: false, reconcileIntervalMs: 0 });
  try {
    const { manifest } = await a.initWorkspace(shared, { name: 'Synthetic studio' });
    const id = manifest.workspaceId;
    await b.openWorkspace(shared);
    await a.reconcileWorkspace(id);
    notifications = 0;
    await b.saveTeamPrompt(id, { id: 'prompt', positivePrompt: 'synthetic prompt' });
    await a.reconcileWorkspace(id);
    assert.equal(notifications, 1);
    assert.equal((await a.listTeamPrompts(id))[0].positivePrompt, 'synthetic prompt');
    notifications = 0;
    await b.deleteTeamPrompt(id, 'prompt');
    await a.reconcileWorkspace(id);
    assert.equal(notifications, 1);
    assert.deepEqual(await a.listTeamPrompts(id), []);
    await a.saveTeamBoard(id, { boardId: 'race', name: 'Synthetic board', document: { original: true } });
    const children = Promise.all([child('writer-a'), child('writer-b')]);
    await Promise.all(['writer-a', 'writer-b'].map(role => waitFile(path.join(root, role + '.ready'))));
    await fs.writeFile(path.join(root, 'start'), '');
    await children;
    const results = await Promise.all(['writer-a', 'writer-b'].map(async role => JSON.parse(await fs.readFile(path.join(root, role + '.json'), 'utf8'))));
    const saved = results.filter(result => result.saved);
    const conflicts = results.filter(result => result.conflict);
    assert.equal(saved.length, 1);
    assert.equal(conflicts.length, 1);
    assert.equal(saved[0].envelope.revision, 2);
    assert.deepEqual(conflicts[0].remote, saved[0].envelope);
    assert.deepEqual(await a.loadTeamBoard(id, 'race'), saved[0].envelope);
    console.log(JSON.stringify({ success: true, coverage: 'packaged-node-runtime', sqlite: true, resourceNotifications: true, crossProcessPublication: true }));
  } finally { await a.dispose(); await b.dispose(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
`, 'utf8');
try {
  await new Promise((resolve, reject) => {
    const child = spawn(path.resolve(executable), [runtime], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', IMH_TEAMS_SMOKE_ROOT: root },
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (data) => process.stdout.write(data));
    child.stderr.on('data', (data) => process.stderr.write(data));
    const timer = setTimeout(() => { child.kill(); reject(new Error('Packaged Teams smoke timed out.')); }, 90000);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Packaged Teams smoke exited with ${code}.`));
    });
  });
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
