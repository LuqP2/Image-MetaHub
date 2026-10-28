import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const executable = process.argv[2];
const nodeRuntime = process.argv[3] === '--node-runtime';
if (!executable) throw new Error('Usage: node scripts/runPackagedCanvasSmoke.mjs <packaged executable>');
const resolved = path.resolve(executable);
await fs.access(resolved);
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'imh-canvas-smoke-'));
const profile = path.join(root, 'Perfil sintético ç');
const resultPath = path.join(root, 'result.json');
async function removeSmokeRoot() {
  const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(root));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(root).startsWith('imh-canvas-smoke-')) throw new Error('Refusing to remove an unexpected smoke path.');
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
try {
  await fs.mkdir(profile, { recursive: true });
  const runtimeScript = path.join(root, 'runtime-smoke.cjs');
  if (nodeRuntime) await fs.writeFile(runtimeScript, `
    const path = require('node:path'), fs = require('node:fs/promises'), { pathToFileURL } = require('node:url');
    (async () => {
      const resources = path.join(path.dirname(process.execPath), 'resources');
      const archive = require('node:fs').existsSync(path.join(resources, 'app.asar')) ? path.join(resources, 'app.asar') : path.join(resources, 'app');
      const load = relative => import(pathToFileURL(path.join(archive, relative)));
      const { BoardRepository } = await load('electron/boardRepository.mjs');
      const { createBoardDocument } = await load('services/boards/document.mjs');
      const { resetUserDataContents } = await load('electron/cacheReset.mjs');
      const profile = process.env.IMH_CANVAS_SMOKE_PROFILE;
      const directory = path.join(profile, 'boards');
      let repo = new BoardRepository({ directory });
      const locator = name => ({ imageId: 'synthetic::' + name, directoryPath: path.join(profile, 'synthetic-library'), relativePath: name });
      const document = createBoardDocument('Packaged runtime board');
      document.objects.push({ id: 'asset', type: 'asset', x: 0, y: 0, width: 280, height: 242, zIndex: 1, frameId: null, reference: { kind: 'path', locator: locator('b.png') }, name: 'b.png', mediaType: 'image', visibleFields: [] });
      let saved = await repo.save(document, 0);
      await repo.remapReferences([['a.png','temp.png'],['b.png','a.png'],['temp.png','b.png']].map(([from,to],index) => ({ operationId: 'synthetic-' + index, oldLocator: locator(from), newLocator: locator(to) })));
      for (let index = 0; index < 3; index++) {
        repo = new BoardRepository({ directory });
        saved = await repo.load(saved.id);
        if (saved.objects[0].reference.locator.relativePath !== 'a.png') throw new Error('Reference changed after reopen');
        saved = await repo.save(saved, saved.revision);
      }
      let conflict = false;
      try { await repo.save(saved, 0); } catch (error) { conflict = error.code === 'BOARD_REVISION_CONFLICT'; }
      if (!conflict) throw new Error('Revision conflict was not enforced');
      await fs.writeFile(path.join(profile, 'discardable-cache.json'), '{}');
      await resetUserDataContents({ userDataDir: profile });
      await new BoardRepository({ directory }).load(saved.id);
      await fs.writeFile(process.env.IMH_PACKAGED_CANVAS_SMOKE_RESULT, JSON.stringify({ success: true, coverage: 'packaged-node-runtime-and-board-storage', repeatedSaves: 3, reopened: true, revisionConflict: true, resetPreserved: true }));
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `, 'utf8');
  await new Promise((resolve, reject) => {
    const env = {
      ...process.env, IMH_PACKAGED_CANVAS_SMOKE: '1', IMH_PACKAGED_CANVAS_SMOKE_ROOT: root, IMH_PACKAGED_CANVAS_SMOKE_RESULT: resultPath,
      IMH_CANVAS_SMOKE_PROFILE: profile,
      IMH_DISABLE_GPU: '1',
      ...(process.platform === 'win32' ? { PORTABLE_EXECUTABLE_DIR: profile, PORTABLE_EXECUTABLE_FILE: resolved } : {}),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    if (nodeRuntime) env.ELECTRON_RUN_AS_NODE = '1';
    const child = spawn(resolved, nodeRuntime ? [runtimeScript] : [`--user-data-dir=${profile}`], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env });
    let diagnostic = '';
    child.stdout.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-12000); });
    child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-12000); });
    const timeout = setTimeout(() => { child.kill(); reject(new Error(`Canvas smoke timed out. ${diagnostic}`)); }, 120000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { clearTimeout(timeout); if (code === 0) resolve(); else reject(new Error(`Canvas smoke exited with ${code}. ${diagnostic}`)); });
  });
  const result = JSON.parse(await fs.readFile(resultPath, 'utf8'));
  if (!result.success) throw new Error(JSON.stringify(result));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await removeSmokeRoot();
}
