# 3D Desktop — native compositor experiment

**Experimental, incomplete, not a release of the requested window manager.** This branch investigates the real desktop requirement. Passing mathematical tests or capturing frames is not proof that transformed application windows are fully usable.

See [measured results and current blockers](docs/STATUS.md) before running the experiment.

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

Ad-hoc rebuilds can invalidate TCC permissions despite an enabled toggle. Quit the native app, remove only its stale entry from each privacy list, add the exact rebuilt app, and restart. Do not disable SIP, Gatekeeper, or other system protections to work around this. Distribution signing and notarization remain unfinished.

## Run the interaction proof

Create a disposable document in TextEdit or a disposable browser test page. Keep it on the current desktop Space. In 3D Desktop choose **Refresh**, select that exact window, then **Start Interaction Proof**. This tests one window for at most three minutes.

The selected window is streamed with ScreenCaptureKit into a nonactivating native panel at its original location. Core Animation applies a persistent projective transform. Pointer locations are mapped through the exact inverse projection and sent to the target process. The real application is activated for native keyboard input; there is no keyboard recorder or remote service. Undocumented event routing fields 51 and 58 are experimental dependencies, isolated in `ProofSession.forward`.

The dark rectangular surround is test instrumentation that masks the flat original during the proof. It is not the final desktop composition or arrangement design. This is not yet a multiwindow manager. Clicking the surround is not a desktop click-through feature.

**Emergency restore: Control–Option–Command–0.** The experiment refuses to start if it cannot register this shortcut. Restore is also available in the 3D menu and control window. Quitting removes the overlays. The originals are never hidden, minimized, moved, reparented, or made transparent by the capture proof. Ordinary app behavior can still move a window when its own title bar receives a drag.

The proof stops when the source closes or changes geometry, when capture fails, when permissions are revoked, and on observed Space/display/sleep changes. Those are conservative restoration paths, not evidence of full Spaces or fullscreen support. Current code intentionally stops rather than promising seamless behavior there.

Local logs: `~/Library/Application Support/3D Desktop Native Experiments/latest.jsonl`. Logs contain window IDs, geometry, mouse-event coordinates, and capture timing; never typed text or captured pixels. `latest.jsonl` is replaced at launch. Copy it before another run if needed. Frames remain in RAM.

## Verify, do not infer success

Read [the experiment protocol](docs/EXPERIMENTS.md) and [API research](docs/RESEARCH.md). Complete-frame delivery metrics are not input latency or GPU performance. A successful `CGEvent.postToPid` call has no delivery acknowledgment; visible target-side outcomes are required.

Projection tests independently compare 17,424 samples with pinhole 3D projection, CALayer coefficients, and inverse input mapping. They do not validate macOS event routing.

## Uninstall

Restore/quit through the 3D menu first. Move `~/Applications/3D Desktop Native Experiments/` (or the development app copy you used) to Trash. Remove this native app's Accessibility and Screen Recording entries in System Settings if desired. Optional: move `~/Library/Application Support/3D Desktop Native Experiments/` to Trash to remove its diagnostic log. No background service or login item is installed. Leave the original `3D Desktop.app` and `~/Library/Application Support/Depth` intact.
