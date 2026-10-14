# 3D Desktop — native compositor experiment

**Experimental, incomplete, not a release of the requested window manager.** This branch investigates the real desktop requirement. Passing mathematical tests or capturing frames is not proof that transformed application windows are fully usable.

See [measured results and current blockers](docs/STATUS.md) before running the experiment.

The intended interaction now includes [whole-desktop scene navigation](docs/DESKTOP-SCENE.md): rotating a shared view containing independently placed application windows. This is planned behavior, not a feature of the single-window proof.

The original Electron project and published `v1.0.0` remain available. This native program does not read, migrate, or modify `~/Library/Application Support/Depth`. Its bundle identifier is `studio.depth.desktop.native.experiment`, distinct from the legacy app.

## Build on Apple Silicon

Requirements: Apple Silicon, macOS 14 or later, Apple Command Line Tools. Development was compiled using Swift 6.3.3 in Swift 5 language mode on macOS 26.6.2 (25G83). Compatibility with other OS versions is not established by the deployment target.

From the repository root:

```sh
bash native/scripts/build.sh
bash native/scripts/build-probe.sh
bash native/scripts/test.sh
bash native/scripts/package.sh --skip-build
```

No npm dependencies, package downloads, Xcode project, administrator privileges, entitlements, or changes to SIP are required. The build is arm64-only and ad-hoc signed; it is not Developer ID signed or notarized. `codesign --verify --strict` checks local bundle integrity, not Apple notarization.

Output: `native/build/3D Desktop.app`. ZIP: `release/native/3D-Desktop-0.1.0-experimental-mac-arm64.zip` with SHA-256 sidecar.

## Install without replacing the original app

1. Build locally, or extract the experimental ZIP.
2. In Finder create `~/Applications/3D Desktop Native Experiments/`.
3. Copy this build's `3D Desktop.app` into that folder. If a copy is already there, quit it and move it aside first. Do not overwrite `~/Applications/3D Desktop.app` (the legacy app).
4. Open the new copy. It runs as a menu-bar utility marked **Experimental Proof**, with a small testing control window.
5. Use its buttons to request Accessibility and Screen Recording. Grant them to this exact copy in System Settings → Privacy & Security; restart the app afterward. No audio is captured.

Ad-hoc rebuilds can invalidate TCC permissions despite an enabled toggle. Quit the native app and remove only its stale entry from each privacy list. Reopen the exact rebuilt app, use its permission-request buttons to register the current signature, enable the newly created entries, then restart. The Add chooser sometimes leaves Open disabled; re-requesting from the app was more reliable on this host. Do not disable SIP, Gatekeeper, or other system protections to work around this. Distribution signing and notarization remain unfinished.

## Run the interaction proof

Create a disposable document in TextEdit or a disposable browser test page. Keep it on the current desktop Space. In 3D Desktop choose **Refresh**, select that exact window, then **Start Interaction Proof**. This tests one window for at most three minutes.

The selected window is streamed with ScreenCaptureKit into a nonactivating native panel at its original location. Core Animation applies a persistent projective transform. Pointer locations are mapped through the exact inverse projection and sent to the target process. The real application is activated for native keyboard input; there is no keyboard recorder or remote service. Undocumented event routing fields 51 and 58 are experimental dependencies, isolated in `ProofSession.forward`.

The newer experimental renderer replaces the dark rectangular surround with a live ScreenCaptureKit desktop patch: the original target and this utility are excluded from that patch. One transparent panel draws both that fixed patch and the movable transformed window. The original application window is never displaced or hidden. The patch captures the desktop region behind the original window, not just the selected app; it remains in RAM. This is still a single-window experiment, and the patch and transparent canvas gaps do not yet provide correct click-through to underlying applications.

Manipulation controls (new, see verification status):

- **Option-drag** anywhere inside the projected window to move its representation within the display.
- **Option–Shift-drag** to change yaw and pitch.
- **Option-scroll** to change depth.
- The **3D menu** offers tilt, nearer/farther, and reset controls.

The normal system cursor is retained. The projected overlay cursor and custom-cursor interception trial were removed from the default path after real-device regressions. Mouse movement is forwarded for hover tracking, but native dropdown behavior remains inconsistent. Popup routing now checks same-process elevated windows under the mapped source point and avoids re-raising the target while a popup is present. This is an experimental correction, not a guarantee for service-owned menus, dialogs, or popups outside the capture bounds.

The **Test late mouse routing (experimental; normal cursor)** checkbox selects a separate annotated-session event-tap experiment. It intercepts only mouse events inside the projected surface (and an ongoing drag), retains the normal cursor, and moves expensive focus/routing work outside the tap callback. Leave it off for the baseline comparison. The same binary contains both routes, so switching routes does not require a rebuild or renewed permissions. Successful tap installation or posted-event logs do not prove application acceptance.

The **Test system-pointer mapping** checkbox selects a separate, fixed-geometry, 30-second hover experiment and takes precedence over the late-routing checkbox. It deliberately displays two cursors: cyan at the projected interaction point, normal at the real application's mapped source point. Move slowly during this diagnostic. A motion jump over 120 points aborts it. It never hides the system cursor or disables mouse/cursor association. On normal exit it returns the actual pointer to the cyan location. This mechanism remains unverified; do not use it for ordinary work.

**Emergency restore: Control–Option–Command–0.** The experiment refuses to start if it cannot register this shortcut. Restore is also available in the 3D menu and control window. Quitting removes the overlays. The originals are never hidden, minimized, moved, reparented, or made transparent by the capture proof. Ordinary app behavior can still move a window when its own title bar receives a drag.

The proof stops when the source closes or changes geometry, when capture fails, when permissions are revoked, and on observed Space/display/sleep changes. Those are conservative restoration paths, not evidence of full Spaces or fullscreen support. Current code intentionally stops rather than promising seamless behavior there.

Local logs: `~/Library/Application Support/3D Desktop Native Experiments/latest.jsonl`. Logs contain window IDs, geometry, mouse-event coordinates, and capture timing; never typed text or captured pixels. `latest.jsonl` is replaced at launch. Copy it before another run if needed. Frames remain in RAM.

## Verify, do not infer success

Read [the experiment protocol](docs/EXPERIMENTS.md) and [API research](docs/RESEARCH.md). Complete-frame delivery metrics are not input latency or GPU performance. A successful `CGEvent.postToPid` call has no delivery acknowledgment; visible target-side outcomes are required.

Projection tests independently compare 3,509,000 samples with pinhole 3D projection, CALayer coefficients, inverse input mapping, and bounds across the full allowed angle/depth range. Another 580,000 corner checks cover translated canvases. They do not validate macOS event routing.

For coordinate diagnostics, build `bash native/scripts/build-hover-target.sh` and open `native/build/3D Desktop Hover Target.app`. It is a separate local target with four hover/click regions, no permissions, capture, or input injection. It writes only pointer coordinates and counters to `~/Library/Application Support/3D Desktop Native Experiments/hover-target.jsonl`. Testing this fixture helps isolate defects but does not replace real-application acceptance tests.

## Uninstall

Restore/quit through the 3D menu first. Move `~/Applications/3D Desktop Native Experiments/` (or the development app copy you used) to Trash. Remove this native app's Accessibility and Screen Recording entries in System Settings if desired. Optional: move `~/Library/Application Support/3D Desktop Native Experiments/` to Trash to remove its diagnostic log. No background service or login item is installed. Leave the original `3D Desktop.app` and `~/Library/Application Support/Depth` intact.
