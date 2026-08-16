import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readJson(root, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

export function verifyAppVersionConsistency(root = repositoryRoot) {
  const packageJson = readJson(root, 'package.json');
  const packageLock = readJson(root, 'package-lock.json');
  const version = String(packageJson.version || '').trim();
  const [major, minor] = version.split('.');

  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Invalid application version in package.json: ${version || '(empty)'}`);
  }

  const errors = [];
  if (packageLock.version !== version) {
    errors.push(`package-lock.json version is ${packageLock.version}, expected ${version}`);
  }
  if (packageLock.packages?.['']?.version !== version) {
    errors.push(`package-lock.json root package version is ${packageLock.packages?.['']?.version}, expected ${version}`);
  }

  const expectedMarkers = [
    ['ARCHITECTURE.md', `**Version:** ${version}`],
    ['cli.ts', `.version('${version}')`],
    ['components/FolderSelector.tsx', `Welcome to Image MetaHub v${major}.${minor}`],
    ['components/FolderSelector.tsx', `>v${version}</p>`],
    ['components/Sidebar.tsx', `>v${version}</span>`],
    ['electron.mjs', `Image MetaHub v${version}`],
    ['index.html', `<title>Image MetaHub v${version}</title>`],
  ];

  for (const [relativePath, marker] of expectedMarkers) {
    const contents = fs.readFileSync(path.join(root, relativePath), 'utf8');
    if (!contents.includes(marker)) {
      errors.push(`${relativePath} is missing expected version marker: ${marker}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Application version consistency check failed:\n- ${errors.join('\n- ')}`);
  }

  return { version, checkedMarkers: expectedMarkers.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = verifyAppVersionConsistency();
  console.log(`Application version consistency passed: ${result.version} (${result.checkedMarkers} markers).`);
}
