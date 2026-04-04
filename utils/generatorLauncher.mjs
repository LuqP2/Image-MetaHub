import path from 'path';

export function normalizeLauncherCommand(command) {
  if (typeof command !== 'string') {
    return '';
  }

  return command.trim();
}

export function normalizeLauncherWorkingDirectory(workingDirectory) {
  if (typeof workingDirectory !== 'string') {
    return '';
  }

  return workingDirectory.trim();
}

function stripMatchingQuotes(value) {
  if (!value || value.length < 2) {
    return value;
  }

  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' && last === '"') || (first === '\'' && last === '\'')) {
    return value.slice(1, -1);
  }

  return value;
}

function truncateShellOperators(value) {
  return value.split(/\s*(?:&&|\|\||;)\s*/)[0]?.trim() || '';
}

function extractDirectoryChangeTarget(line, platform) {
  const normalizedLine = line.trim();
  const windowsPattern = /^(?:cd(?:\s+\/d)?|pushd)\s+(.+)$/i;
  const posixPattern = /^(?:cd|pushd)\s+(.+)$/i;
  const match = normalizedLine.match(platform === 'win32' ? windowsPattern : posixPattern);

  if (!match) {
    return '';
  }

  const candidate = stripMatchingQuotes(truncateShellOperators(match[1].trim()));
  return candidate;
}

function tokenizeCommandLine(line) {
  const tokens = [];
  let current = '';
  let quote = null;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === '\'') {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

function isAbsolutePathToken(token, platform) {
  if (!token) {
    return false;
  }

  if (platform === 'win32') {
    return /^[a-zA-Z]:[\\/]/.test(token) || /^\\\\/.test(token);
  }

  return token.startsWith('/');
}

function looksLikeScriptPath(token, platform) {
  if (!token) {
    return false;
  }

  const parsed = platform === 'win32' ? path.win32.parse(token) : path.posix.parse(token);
  if (parsed.ext) {
    return true;
  }

  const normalized = token.toLowerCase();
  return normalized.endsWith('/python') || normalized.endsWith('\\python');
}

function dirnameForPlatform(targetPath, platform) {
  return platform === 'win32' ? path.win32.dirname(targetPath) : path.posix.dirname(targetPath);
}

export function inferLauncherWorkingDirectory(command, platform = process.platform) {
  const normalizedCommand = normalizeLauncherCommand(command);
  if (!normalizedCommand) {
    return '';
  }

  const lines = normalizedCommand
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const cdTarget = extractDirectoryChangeTarget(line, platform);
    if (cdTarget) {
      return cdTarget;
    }

    const tokens = tokenizeCommandLine(line);
    for (const token of tokens) {
      if (!isAbsolutePathToken(token, platform) || !looksLikeScriptPath(token, platform)) {
        continue;
      }

      return dirnameForPlatform(token, platform);
    }
  }

  return '';
}

export function resolveLauncherWorkingDirectory({
  command,
  workingDirectory,
  platform = process.platform,
}) {
  const normalizedWorkingDirectory = normalizeLauncherWorkingDirectory(workingDirectory);
  if (normalizedWorkingDirectory) {
    return normalizedWorkingDirectory;
  }

  return inferLauncherWorkingDirectory(command, platform);
}

export function buildLauncherScriptContent(command, platform = process.platform) {
  const normalizedCommand = normalizeLauncherCommand(command);
  if (platform === 'win32') {
    return normalizedCommand.replace(/\r?\n/g, '\r\n');
  }

  return `#!/usr/bin/env bash\n${normalizedCommand}\n`;
}
