import fs from 'fs';
import path from 'path';

export const PORTABLE_DATA_DIRECTORY_NAME = 'ImageMetaHubData';

export function resolvePortableRuntime({
  platform = process.platform,
  env = process.env,
} = {}) {
  const rawExecutableDirectory = typeof env?.PORTABLE_EXECUTABLE_DIR === 'string'
    ? env.PORTABLE_EXECUTABLE_DIR.trim()
    : '';
  const rawExecutableFile = typeof env?.PORTABLE_EXECUTABLE_FILE === 'string'
    ? env.PORTABLE_EXECUTABLE_FILE.trim()
    : '';
  const isPortable = platform === 'win32' && rawExecutableDirectory.length > 0;

  if (!isPortable) {
    return {
      isPortable: false,
      portableExecutableDir: null,
      portableExecutableFile: null,
      userDataPath: null,
      autoUpdateSupported: true,
    };
  }

  const portableExecutableDir = path.win32.resolve(rawExecutableDirectory);

  return {
    isPortable: true,
    portableExecutableDir,
    portableExecutableFile: rawExecutableFile
      ? path.win32.resolve(rawExecutableFile)
      : null,
    userDataPath: path.win32.join(portableExecutableDir, PORTABLE_DATA_DIRECTORY_NAME),
    autoUpdateSupported: false,
  };
}

export function configurePortableAppPaths(
  app,
  runtime,
  {
    fsApi = fs,
    createProbeName = () => `.write-test-${process.pid}-${Date.now()}`,
  } = {},
) {
  if (!runtime?.isPortable) {
    return runtime;
  }

  const userDataPath = runtime.userDataPath;
  const logsPath = path.win32.join(userDataPath, 'logs');
  const crashDumpsPath = path.win32.join(userDataPath, 'crash-dumps');
  const probePath = path.win32.join(userDataPath, createProbeName());
  let probeDescriptor = null;

  try {
    fsApi.mkdirSync(userDataPath, { recursive: true });
    fsApi.mkdirSync(logsPath, { recursive: true });
    fsApi.mkdirSync(crashDumpsPath, { recursive: true });
    probeDescriptor = fsApi.openSync(probePath, 'wx');
    fsApi.closeSync(probeDescriptor);
    probeDescriptor = null;
    fsApi.unlinkSync(probePath);
  } catch (error) {
    if (probeDescriptor !== null) {
      try {
        fsApi.closeSync(probeDescriptor);
      } catch {
        // Best-effort cleanup before reporting the fatal startup error.
      }
    }
    try {
      fsApi.unlinkSync(probePath);
    } catch {
      // The probe may not have been created.
    }

    throw new Error(
      `Portable profile directory is not writable: ${userDataPath}`,
      { cause: error },
    );
  }

  app.setPath('userData', userDataPath);
  app.setPath('sessionData', userDataPath);
  app.setAppLogsPath(logsPath);
  app.setPath('crashDumps', crashDumpsPath);

  return runtime;
}
