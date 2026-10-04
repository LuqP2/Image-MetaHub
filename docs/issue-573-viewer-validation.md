# Issue #573: external viewer validation

Expected behavior: different images open independent native windows. The last viewer
opened, focused, or navigated updates the library preview and keyboard focus. Closing
that viewer keeps its last valid preview and returns focus to the library. Bulk
selection and each viewer's navigation scope remain independent.

## Automated regression coverage

Run the focused suites:

```powershell
npx vitest run __tests__/viewerWindowLifecycle.test.ts __tests__/useImageViewerFocus.test.tsx __tests__/DetachedImageModalApp.readiness.test.tsx __tests__/ImageModal.slideshow.test.tsx __tests__/detachedViewerHotfix.test.ts __tests__/imageViewerContracts.test.ts --maxWorkers 2
```

The tests cover shared pending opens, independent sessions, initial paint plus
applied-snapshot acknowledgment, rejection/retry, timeout, close during loading,
late completion without stealing focus, focus notifications without native IPC
feedback, pre-registration opening intent, preview/focus synchronization, bulk
selection preservation, out-of-scope focus, and navigation button boundaries.

The existing packaged smoke remains useful for native loading and session rebinding.
It opens windows directly in the main process, so it does not prove the complete
library-to-viewer interaction below.

## Required manual packaged macOS acceptance

Use synthetic images A, B, and C and an isolated test library/profile. Do not use
personal libraries, caches, metadata examples, or screenshots as regression fixtures.

1. Record the exact commit, app version, macOS version, and CPU architecture.
2. Double-click A, B, and C without closing previous viewers. All three windows must
   display their requested image; the most recent request must retain focus even if
   an earlier window takes longer to load.
3. Double-click an image already shown in an open viewer. Restore/focus that viewer
   without creating a duplicate window. Repeat after minimizing it.
4. Navigate in the last viewer using both keyboard arrows and visible buttons.
   Verify the library preview and highlighted card follow its current image, while
   the other viewers retain their images. Check the first/last and one-image limits.
5. Focus a different viewer. Its current image must become the library preview.
6. Close the active viewer using Esc, native close, and the footer on separate runs.
   Its last image must remain in the library preview; closing must not choose the
   image of another viewer automatically. Use a remaining viewer to resume tracking.
7. Repeat close/reopen, focus changes, and minimize/restore for at least ten cycles.
   Include an attempt to close a viewer while it is opening.
8. Repeat navigation within a filtered list and a cluster. Check that bulk selection
   remains intact. If an open image leaves the displayed scope, filters must remain
   unchanged and no unrelated card may receive a fabricated focus index.

Accept arrow appearance manually. Do not use screenshots or browser/computer control
for automated visual acceptance. Record arm64 and x64 results separately; a pass on
one architecture is not a pass on the other. The reporter's architecture must pass
before treating the macOS report as resolved.

## Failure diagnostics

`[image-viewer-lifecycle]` records a transient numeric window identifier and stages
such as create/reuse, loaded, native-ready, snapshot-applied, focus, and load failure.
`did-fail-load` includes its numeric error code. It does not log image identifiers,
file paths, library content, or metadata. Correlate the failed opening's stages before
changing Electron versions or expanding the fix.

## Issue #575 recovery

Initial opening and macOS reuse now resend the current snapshot every 500 ms until
the renderer acknowledges its applied revision. Duplicate delivery re-acknowledges
only a committed snapshot; obsolete revisions never acknowledge the current image.
All retry timers stop on completion, failure, or cancellation.

If the document has loaded and the image has committed but hidden painting never
emits `ready-to-show`, the window is presented without activation after one second.
Its native `show` event supplies the visibility signal. Activation still follows
the most recent explicit open/focus request, including a return to the library.

A failed opening gets one fresh-renderer attempt before the inline fallback. A
failed parked macOS renderer is discarded rather than reused on that attempt.
Cancellation never starts another window. Persistent failures still fall back.

Lifecycle stages and fixed failure reasons are also written to `process-events.log`
with a transient numeric window ID, without session IDs or image/library data.
The release workflow now runs the existing packaged macOS smoke before uploading
its assets. It covers first open, three rebindings, and concurrent windows on the
runner's native architecture; the complete manual acceptance above is still needed.

No packaged macOS manual acceptance was performed from the Windows development host.

## Automated packaged macOS results: 2026-10-04

Tested code commit: `f681324627d8c29b210f58d7677df58504d1e0f4`.
Run: https://github.com/LuqP2/Image-MetaHub/actions/runs/37227906124

| Native runner | macOS | Build | Packaged smoke |
| --- | --- | --- | --- |
| arm64 / Apple Silicon | 15.7.9 (24G830) | Passed | Passed |
| x64 / Intel | 15.7.9 (24G830) | Passed | Passed |

Both jobs opened the initial viewer, rebound its renderer three times, opened a
second independent viewer, and verified the idle renderer pool stayed bounded.
Only a synthetic PNG was used on the isolated GitHub-hosted machines.

The arm64 log records `loaded` and `snapshot-applied` for window 2, followed by
`native-show-recovery` rather than `native-ready` before presentation. The new
recovery path was therefore exercised by the actual packaged app. Intel completed
through normal native readiness. Neither log records a fresh-renderer retry.

This validates the smoke's native opening/rebinding cases. It does not establish
the reporter's root cause or replace the complete library-to-viewer manual flow.

Control comparison: the same workflow and native runner matrix also compiled tag
`v0.20.1` at `7f7754cd21541d5a7d89951d3492668c1e3baf2c`.
Run: https://github.com/LuqP2/Image-MetaHub/actions/runs/37228310294
Both architectures passed there too, through normal native readiness. The
reporter's failure was not consistently reproduced by this synthetic smoke.
The corrected arm64 run's recovery is evidence that the recovery path works in
the packaged macOS app, not proof of the reporter's exact failure mechanism.
