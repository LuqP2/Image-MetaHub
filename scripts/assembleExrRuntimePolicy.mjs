import fs from 'node:fs/promises';
import path from 'node:path';
import { EXR_RUNTIME_VERSION, EXR_PROTOCOL_VERSION } from '../electron/exrRuntimePolicy.generated.mjs';
import { validateRuntimeFile } from '../electron/exrRuntime.mjs';

const input = path.resolve(process.argv[2]);
const output = path.resolve(process.argv[3]);
const packages = {};
for (const platform of ['win32-x64', 'linux-x64', 'darwin-x64', 'darwin-arm64']) {
  const policy = JSON.parse(await fs.readFile(path.join(input, `exr-policy-${platform}.json`), 'utf8'));
  if (policy.platform !== platform || policy.version !== EXR_RUNTIME_VERSION || policy.protocol !== EXR_PROTOCOL_VERSION) throw new Error('Incompatible EXR package policy');
  for (const file of policy.files) validateRuntimeFile(file);
  if (!policy.files.some(f => f.name === policy.executable)) throw new Error('Missing EXR executable');
  packages[platform] = policy;
}
await fs.writeFile(output, `// Generated from verified native release artifacts. Do not edit hashes manually.\nexport const EXR_RUNTIME_VERSION = ${JSON.stringify(EXR_RUNTIME_VERSION)};\nexport const EXR_PROTOCOL_VERSION = ${EXR_PROTOCOL_VERSION};\nexport const EXR_RUNTIME_PACKAGES = Object.freeze(${JSON.stringify(packages, null, 2)});\n`);
