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

## Failed mouse interception experiment (2026-10-14)

Evidence: `native/evidence/mouse-tap-failure-m3.json`. Binary SHA-256 `4a762c0bd74565d66f39ccb58943022044a30f98428bde809915b0639864538f`.

The experiment installed a session event tap for mouse events only. Inside the projected window, it suppressed the original event and posted a freshly mapped, tagged event to the real target process. It also replaced the overlay arrow with a custom native cursor. No keyboard events were intercepted. On the real Mac, the user reported that the cursor disappeared and hover stopped tracking inside the transformed floating window. This route failed despite successful tap creation; the utility was terminated.

The code is retained behind `ProofSession.experimentalMouseTapEnabled = false` solely for reproduction. To reproduce, set it to true, rebuild, renew the same app's two privacy grants, and start a disposable-window proof. Compare with false as the positive control for ordinary hardware pointer behavior. Keep the 3D menu Restore action and three-minute timeout available. Do not use the failed route for ordinary work.

The result does not isolate whether cursor updates, menu tracking, or event-routing state caused the failure. It does not establish a fundamental macOS impossibility. The default build now leaves the system cursor and ordinary pointer delivery intact; popup selection remains inconsistent and fails the product acceptance gate.

## Late-routing comparison

Use the same disposable TextEdit window, font/style control, fixed transform, and screen coordinates for each run. Keep the source on the active Space; a Space change restores the desktop and invalidates the comparison.

1. Leave **Test late mouse routing** off. Start the proof, verify pointer visibility, open the style dropdown, and select a specified item by its projected coordinates. Check the actual TextEdit style value afterward.
2. Restore. Enable the checkbox and repeat the same actions. This route uses `cgAnnotatedSessionEventTap`, not the earlier session-stage tap. It does not set or hide a custom cursor.
3. Repeat after moving the presentation and changing its angle, with geometry fixed during each selection. Record exact chosen versus applied items; a menu dismissing is not a successful selection.
4. Test the emergency shortcut while TextEdit has focus, then verify the original document is accessible and no overlay remains.

The tap copies accepted events and schedules focus, popup discovery, event posting, and logging outside its callback. Queued events check that the session is still active before posting. Logs distinguish `tapInput` (raw event position and sampled system cursor) from `inputPosted` (mapped destination and routed window). Neither event is a target-side delivery acknowledgment. The original failed build remains identified by its evidence hash; later callback changes mean recompiling the legacy flag is only a comparison, not byte-for-byte reproduction.

## Timestamp-ledger system-pointer probe (2026-10-15)

Binary SHA-256: `0a211bf5e308b40c248366bdac230b2862883110c402837ede64fdfb089b6b30`. This revision changes motion bookkeeping and cyan-cursor layering. Sustained physical hover, accurate native menu selection, and full-desktop behavior are not established by the revision or its build success. See [the timing assumptions and primary implementations](RESEARCH.md#hover-investigation).

The probe keeps mouse/cursor association enabled and never hides the macOS cursor. Two cursors are intentional: the cyan arrow marks the projected interaction point, while the actual macOS cursor is moved to the corresponding point in the original application. The cyan arrow uses a small, separate click-through panel at `NSWindow.Level.popUpMenu + 1`, rather than a layer under the application's native popup windows. Its popup visibility must be observed; its configured level alone is not a pass.

The pure motion model associates warp displacement with event timestamps. Queued events older than a warp do not consume that warp's correction. Movement inside a warp's timestamp bracket is suppressed, and the next unambiguous movement establishes a new baseline without inventing motion across the gap. Button/scroll events hold the virtual point still; if correct routing requires a warp before rebaselining is complete, the session stops and releases buttons it posted. A corrected movement greater than 120 points, invalid timing, history overflow, loss of target focus, or exiting the projected surface also stops the probe. Readback differences are logged rather than treated as a four-point failure.

The 30-second deadline remains in force. On timeout, exit, or another normal stop, the controls reopen with a visible reason and the system-pointer checkbox turns off. A disappearing tilted surface before 30 seconds is an early restoration, not evidence of a completed test. Original windows are not hidden or displaced by the capture mechanism. Forced termination during active pointer mapping and held-button gestures still needs its own verification.

1. Run `bash native/scripts/test.sh`. Record the existing 3,509,000 projection samples and 580,000 translated-corner checks, plus 163 pointer-motion result assertions. These are mathematical/model checks, not macOS input delivery or timing tests.
2. Use the four-region hover fixture first. Choose it, enable **Test system-pointer mapping**, and press **Start Interaction Proof**. Keep geometry fixed. Move the physical mouse slowly across A/B/C/D, including pauses; compare the yellow tracking border and white received-event dot with the cyan arrow. Automation clicks cannot substitute for physical hover here.
3. Record whether all regions track for a sustained interval, including stationary periods. Do not infer success from a brief alignment before a stop. If the probe restores early, copy its exact visible stop reason and `latest.jsonl` before restarting the utility.
4. Repeat on a disposable TextEdit window at a fixed angle. Open **Regular**, move slowly over distinct styles, choose **Bold**, then reopen and choose **Regular**. Record whether the highlighted item is beneath the cyan arrow, whether cyan stays above the menu, and whether each exact chosen style applies. Menu dismissal alone is insufficient.
5. Separately test button down/up, drag selection, scrolling, and pointer exit. Exiting the projected surface should end this bounded probe, restore ordinary pointer control, remove both utility overlays, and display the stop reason. Check that no posted button remains down.
6. Test **Control–Option–Command–0** while the target owns keyboard focus. Verify the original application remains accessible and pointer movement is ordinary. Keep failed and successful runs distinct; the emergency shortcut is not proven by its successful registration.

Inspect `pointerWarp` records for event time, warp start/end, pre-warp sample, requested destination, post-warp sample, raw event position, and virtual point. `pointerMotionSuppressed` records identify ambiguous timing. Diagnostic records are bounded and contain coordinates, not typed text or captured pixels. Compare target-side outcomes with these logs; neither a posted event nor a plausible ledger trace proves that macOS associates positions and timestamps as the model assumes.

Do not promote this probe to ordinary desktop use based on fixture success. Real application menus, dialogs, focus, overlap, Spaces/fullscreen, available displays, failure restoration, and measured performance remain separate acceptance gates. No implementation in this repository is a known-safe full-desktop window manager.
