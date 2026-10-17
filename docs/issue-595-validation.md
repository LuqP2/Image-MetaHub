# Issue #595 validation

The automated tests use synthetic PNG bytes and isolated temporary chunks. They cover
incremental saves, interrupted enrichment and cache diff/resume, cancellation,
atomic replacement failures, and the main window recovery circuit breaker.

## Large-payload regression

`__tests__/enrichmentCheckpoints.large-payload.test.ts` exercises real
`IncrementalCacheWriter` calls with 1,024 synthetic records per chunk, producing
57.6 MB JSON payloads. The IPC stand-in uses `structuredClone` and the real atomic
writer writes only to a test-created temporary directory. The scenarios check
sequential writes, updates arriving during a save, preservation of the previous
chunk after a failed replacement, and resumption of the remaining catalog rows.

The initial local run saved three chunks serially (maximum one in flight), with
173-184 ms per clone-plus-atomic-write operation. Boundary samples of the Node
test process peaked at 471 MiB RSS and 206 MiB heap. These are machine-specific
observations, not performance limits or renderer measurements: the test does not
run Chromium, cross a real Electron IPC boundary, or reproduce the native OOM.
The failure scenario preserved 1,000 enriched entries and resumed the remaining
24. It found no additional persistence failure requiring a cache format change.

## Manual packaged acceptance

Use a separate synthetic library and isolated application profile for these checks.
Do not point a reproduction at a personal library or existing cache.

For a quick development check of the recovery handler, restart the app normally
with `npm run dev:app`, open its regular DevTools console and execute
`await window.electronAPI.testRendererRecovery()`. The window should reload after
2 seconds. This bridge simulates the crash event; it does not crash the process
and does not verify loss/resumption of uncommitted work. It rejects packaged
builds, secondary windows and subframes. No Node inspector is needed.

1. Start enrichment with more than 5,000 synthetic images. Wait for a checkpoint.
2. Trigger a renderer crash with `webContents.forcefullyCrashRenderer()` for the
   main window from an authorized main-process debugging session. Do not kill the
   main process. This API belongs to the main process, not the app page console.
   Record the emitted reason: Electron may report `killed` or `crashed`; only
   `crashed`/`oom` trigger this recovery policy. A `killed` result does not exercise
   the automatic recovery path and must not be counted as a failed crash test.
3. Confirm the same window reloads after approximately 2 seconds. Saved entries
   should be reused; only pending or modified entries should require enrichment.
   Phase B should resume without clicking Update Folder, even with normal startup
   verification disabled. The recovery marker lives in the main process and is
   consumed after cache hydration. Only saved directories with catalog entries
   are refreshed, with the checkpointed writer; ordinary startup is unchanged.
4. Repeat with the window minimized. Confirm recovery does not restore/focus it.
5. Trigger four crashes within 10 minutes. The fourth should offer Reload and
   Close application instead of another automatic reload. Exercise both choices.
6. When available, repeat under Windows/RDP with software rendering.

## Temporary opt-in memory investigation

Launch with `IMH_ENRICHMENT_MEMORY_DIAGNOSTICS=1` in the environment. For example,
in a development PowerShell session, set
`$env:IMH_ENRICHMENT_MEMORY_DIAGNOSTICS = '1'` before `npm run dev:app`.
Remove the environment variable after the investigation.

The existing process diagnostics log receives `enrichment-renderer-memory` records
at start, successful checkpoints, completion/cancellation, and every 60 seconds
while the renderer remains alive. `rendererPid` selects the main window renderer
from Electron's process metrics. `rendererMemoryKB` uses Electron's KB units;
`heapUsedBytes` uses Chromium's byte units and can be unavailable. The enclosing
logger's existing `memoryUsage` still refers to the main process.

Compare the renderer's working set/private memory with heap usage and processed
counts across visible/minimized and hardware/software rendering runs. Continue
sampling after completion to distinguish enrichment-related growth from idle
growth. A periodic record carries the most recently reported progress. Background
timers can be delayed; do not interpret the cadence as a deadline.

No long-running RDP/native-memory reproduction has been performed by the automated
tests. The source of the reported native-memory growth remains unconfirmed.
