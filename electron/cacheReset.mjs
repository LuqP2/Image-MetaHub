import fs from 'node:fs/promises';
import path from 'node:path';

export async function resetUserDataContents({ userDataDir, preservedFileNames = new Set() }) {
  try {
    const files = await fs.readdir(userDataDir);
    for (const file of files) {
      if (preservedFileNames.has(file)) continue;
      const filePath = path.join(userDataDir, file);
      const stat = await fs.stat(filePath);
      if (stat.isDirectory()) {
        await fs.rm(filePath, { recursive: true, force: true });
      } else {
        await fs.unlink(filePath);
      }
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}
