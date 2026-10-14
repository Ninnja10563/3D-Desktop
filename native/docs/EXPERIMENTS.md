# Reproducible experiments

Use disposable windows and local fixtures. Keep unrelated content out of screenshots. Do not publish local desktop captures or unredacted window lists.

## Direct WindowServer mutation

```sh
bash native/scripts/build-probe.sh
native/build/WindowServerProbe list
native/build/WindowServerProbe self 0 2 affine
native/build/WindowServerProbe window WINDOW_ID 2 affine
native/build/WindowServerProbe window WINDOW_ID 12
```

The probe obtains the original affine matrix, requests a changed matrix or trapezoidal warp, pumps the AppKit run loop, logs readback, and restores the original matrix and clears its warp. Use only a fresh disposable target with no existing warp. Affine mode is selected by the final `affine` argument. Return code 0 is API success, not visual success. The probe exits with 5 if the warp API rejects the call; inspect the JSON even when exit code is zero.

`self` is the ownership positive control. `window` targets a real other-process window. The probe handles SIGINT/SIGTERM and times out after at most 60 seconds. Do not run a foreign-window mutation on a system where that mutation is effective without an independent tested restoration process: SIGKILL bypasses normal cleanup. Current cross-process affine calls on this host have been measured as no-ops.

Observed affine result on 26.6.2, before Accessibility was granted to the standalone probe:

| Case | Request | Return | Readback after run-loop flush and at end |
| --- | --- | --- | --- |
| Owned control | scale 1.25, translated | 0 | changed matrix persisted, restored successfully |
| TextEdit | scale 1.25, translated | 0 | unchanged original matrix |

Warp calls returned 0 for both cases. Visual cross-process perspective was not established by those return values. Readback of an affine matrix is not a readback of the warp mesh.

## Transformed input gate

For each target, record build hash, window dimensions, display scale, foreground process, original frame, visible transform, and target-side outcome. Use **screen-coordinate pointer actions through the overlay**, not AXPress on the target control; AXPress bypasses the mapping being tested.

1. Capture an untransformed baseline, then start the proof. Verify perspective remains visible for at least 30 seconds.
2. Click a control at its visibly projected location. Verify actual control state changes.
3. Click an editable field. Type unique harmless text with the real application's keyboard focus. Verify contents and that perspective remains.
4. Scroll a long document, including trackpad momentum if available. Verify its scroll position changes.
5. Drag-select text and drag a native title bar. Log whether geometry following or conservative restore occurs; those are distinct outcomes.
6. Open a popup/select menu, a context menu, a menu-bar menu, and a modal sheet. Verify positioning, focus, click selection, dismissal, and overlap.
7. Repeat with Finder, Safari, Terminal or another non-Apple application. A synthetic test app does not replace this requirement.

## Lifecycle and environment

Test emergency shortcut while the target has keyboard focus; normal quit; SIGTERM; forced termination; target closure; target minimize; target resize; permission revocation; sleep/wake; switching Spaces; entering/leaving fullscreen; display detach. Compare original geometry before/after and verify no orphaned overlay remains. Mark unavailable hardware cases **not tested**. This Mac has one built-in display, so multi-display behavior cannot be certified here.

## Performance

Run one static document and one continuously changing document, each for at least 30 seconds. Capture app PID with Activity Monitor or `pgrep`, then:

```sh
python3 native/scripts/measure.py PID --seconds 30 > native/evidence/local/performance.json
```

The app logs complete frames delivered, elapsed wall time, delivered FPS, and p50/p95 capture presentation-time-to-callback age. ScreenCaptureKit may omit unchanged frames; a static document's low FPS is not a rendering failure. `ps` CPU is an OS rolling estimate and RSS is resident memory, not total allocation. These measurements exclude WindowServer/GPU work and input-to-photon latency. Do not advertise an FPS, latency, or power claim from a synthetic projection test or a subsecond sample.
