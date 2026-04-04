import { describe, expect, it } from 'vitest';
import {
  buildLauncherScriptContent,
  inferLauncherWorkingDirectory,
  resolveLauncherWorkingDirectory,
} from '../utils/generatorLauncher.mjs';

describe('generator launcher utils', () => {
  it('infers a Windows working directory from an explicit cd command', () => {
    expect(inferLauncherWorkingDirectory('cd /d D:\\ComfyUI\npython main.py', 'win32')).toBe('D:\\ComfyUI');
  });

  it('infers a working directory from an absolute launcher path', () => {
    expect(
      inferLauncherWorkingDirectory('"D:\\stable-diffusion-webui\\webui-user.bat" --api', 'win32')
    ).toBe('D:\\stable-diffusion-webui');
  });

  it('prefers an explicit working directory over inferred values', () => {
    expect(
      resolveLauncherWorkingDirectory({
        command: 'cd /d D:\\ComfyUI\npython main.py',
        workingDirectory: 'E:\\AltComfyUI',
        platform: 'win32',
      })
    ).toBe('E:\\AltComfyUI');
  });

  it('uses a bash shebang for Unix launcher scripts', () => {
    expect(buildLauncherScriptContent('./webui.sh --listen', 'linux')).toBe('#!/usr/bin/env bash\n./webui.sh --listen\n');
  });
});
