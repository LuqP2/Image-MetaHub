import { describe, expect, it } from 'vitest';
import { detectGeneratorFromLaunchCommand } from '../utils/detectGeneratorLaunch';

describe('detectGeneratorFromLaunchCommand', () => {
  it('detects ComfyUI from a main.py launch command', () => {
    const detected = detectGeneratorFromLaunchCommand('cd /d K:\\ComfyUI\npython main.py');
    expect(detected.id).toBe('comfyui');
    expect(detected.displayName).toBe('ComfyUI');
  });

  it('detects A1111 from webui-user.bat', () => {
    const detected = detectGeneratorFromLaunchCommand('webui-user.bat --api');
    expect(detected.id).toBe('a1111');
    expect(detected.displayName).toBe('A1111');
  });

  it('detects Forge before generic webui matches', () => {
    const detected = detectGeneratorFromLaunchCommand('D:\\stable-diffusion-webui-forge\\run.bat');
    expect(detected.id).toBe('forge');
  });

  it('falls back to Generator when the command is custom or unknown', () => {
    const detected = detectGeneratorFromLaunchCommand('start-my-custom-server.bat');
    expect(detected.id).toBe('unknown');
    expect(detected.displayName).toBe('Generator');
  });
});
