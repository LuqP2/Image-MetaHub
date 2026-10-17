import { describe, expect, it, vi } from 'vitest';
import { createEnrichmentCheckpoints } from '../services/enrichmentCheckpoints';

describe('Phase B persistence checkpoints', () => {
  it.each([4999, 5000, 99000])('saves at 1000 results for a %i-entry library', async total => {
    const write = vi.fn().mockResolvedValue(undefined);
    const saved = vi.fn();
    const checkpoints = createEnrichmentCheckpoints({ total, write, now: () => 0, onSaved: saved });
    for (let i = 0; i < 999; i++) checkpoints.mark(0);
    await checkpoints.flush();
    expect(write).not.toHaveBeenCalled();
    checkpoints.mark(0);
    await checkpoints.flush();
    expect(write).toHaveBeenCalledTimes(1);
    expect(saved).toHaveBeenCalledWith(1000, 1);
    expect(checkpoints.due()).toBe(false);
  });

  it('checks elapsed time on progress without timers and resets it after success', async () => {
    let time = 0;
    const write = vi.fn().mockResolvedValue(undefined);
    const checkpoints = createEnrichmentCheckpoints({ total: 99000, write, now: () => time });
    checkpoints.mark(0);
    time = 59_999;
    await checkpoints.flush();
    expect(write).not.toHaveBeenCalled();
    time++;
    await checkpoints.flush();
    checkpoints.mark(1);
    await checkpoints.flush();
    expect(write.mock.calls).toEqual([[0]]);
    time += 60_000;
    await checkpoints.flush();
    expect(write.mock.calls).toEqual([[0], [1]]);
  });

  it.each([4999, 5000])('retains the 12-chunk trigger only below 5000 (%i)', async total => {
    const write = vi.fn().mockResolvedValue(undefined);
    const checkpoints = createEnrichmentCheckpoints({ total, write });
    for (let i = 0; i < 12; i++) checkpoints.mark(i);
    await checkpoints.flush();
    expect(write).toHaveBeenCalledTimes(total < 5000 ? 12 : 0);
  });

  it('serializes flushes, preserves concurrent changes and confirms only completed writes', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const write = vi.fn().mockImplementationOnce(() => gate).mockResolvedValue(undefined);
    const saved = vi.fn();
    const checkpoints = createEnrichmentCheckpoints({ total: 99000, write, onSaved: saved });
    checkpoints.mark(1);
    checkpoints.mark(2);
    const first = checkpoints.flush(true);
    await Promise.resolve();
    expect(write.mock.calls).toEqual([[1]]);
    checkpoints.mark(1);
    const second = checkpoints.flush(true);
    expect(saved).not.toHaveBeenCalled();
    release();
    await Promise.all([first, second]);
    expect(write.mock.calls).toEqual([[1], [2], [1]]);
    expect(saved.mock.calls).toEqual([[2, 2], [3, 1]]);
    await checkpoints.flush(true);
    expect(write).toHaveBeenCalledTimes(3);
  });

  it('propagates failure without confirming the checkpoint or accepting more progress', async () => {
    const error = new Error('disk full');
    const saved = vi.fn();
    const write = vi.fn().mockRejectedValue(error);
    const checkpoints = createEnrichmentCheckpoints({ total: 99000, write, onSaved: saved });
    checkpoints.mark(0);
    await expect(checkpoints.flush(true)).rejects.toThrow('disk full');
    expect(saved).not.toHaveBeenCalled();
    expect(() => checkpoints.mark(0)).toThrow('disk full');
    await expect(checkpoints.flush(true)).rejects.toThrow('disk full');
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('does nothing without a writer or dirty entries', async () => {
    const write = vi.fn();
    await createEnrichmentCheckpoints({ total: 99000, write }).flush(true);
    const noWriter = createEnrichmentCheckpoints({ total: 99000 });
    for (let i = 0; i < 1001; i++) noWriter.mark(0);
    expect(noWriter.due()).toBe(false);
    await noWriter.flush(true);
    expect(write).not.toHaveBeenCalled();
  });
});
