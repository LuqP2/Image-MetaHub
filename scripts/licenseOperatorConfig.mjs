import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const operatorConfigPath = path.join(rootDirectory, '.license-operator.env');

export function loadOperatorLicenseConfig() {
  if (!fs.existsSync(operatorConfigPath)) return {};

  return Object.fromEntries(
    fs.readFileSync(operatorConfigPath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const separator = line.indexOf('=');
        return separator < 0 ? [] : [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
      })
      .filter(([key]) => key),
  );
}
