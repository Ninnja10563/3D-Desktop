# Verification status — 2026-10-14

This is an **incomplete experimental branch**, not the requested finished 3D window manager.

Host inspected directly: MacBook Air Mac15,12, Apple M3 (8 CPU / 10 GPU cores), 16 GB RAM, macOS 26.6.2 (25G83). One built-in display, hardware resolution 2560 × 1664; logical desktop dimensions observed through window APIs were 1470 × 956. Existing custom SIP configuration was recorded but not changed. No Dock injection or scripting addition was attempted.

## Established

- Native source compiles as arm64 using the host's Apple Command Line Tools / Swift 6.3.3.
- Local ad-hoc bundle signature verification passes.
- The native menu-bar utility launches; emergency shortcut registration returns `noErr`.
- An owned-window affine transform changes and reads back correctly. The original matrix is restored.
- The same operation on a disposable TextEdit window returns `kCGErrorSuccess` but the matrix remains unchanged after run-loop flushing and again before restoration. API success is therefore insufficient evidence.
- The private warp symbols are present; calls return 0. This does **not** establish a visible warp or working input on a foreign window.
- Independent projection/CALayer/inverse-coordinate tests pass for 17,424 points.
- Accessibility and Screen Recording permissions were successfully granted and observed after restarting a native build. A subsequent ad-hoc rebuild required new grants.
- A real TextEdit ScreenCaptureKit stream delivered 15 complete frames before the initial safety monitor stopped the proof after 0.258 seconds. This proves only that initial capture worked on that build. It does not establish sustained rendering or interaction.
- App launch, permission gating, current-window discovery, source compilation, and packaging were exercised on this Mac.

An idle, permissions-gated run was sampled for 30 seconds (58 `ps` samples at approximately 0.5-second intervals): mean reported CPU **0.326%**, peak RSS **50.25 MiB**. This measures the inactive utility with its control window, **not active capture/compositing**, WindowServer/GPU cost, or input latency. Active performance remains unproven.

## Still unproven

Persistent visible perspective plus working mapped clicks, keyboard focus, scrolling, dragging, popup menus, dialogs, overlapping target windows, Finder/Safari/Terminal behavior, emergency shortcut effectiveness during captured interaction, forced-termination cleanup during active capture, sustained M3 performance, full-screen transitions, and multi-display handling.

The first input experiment was stopped by its source-state safety check before interactive actions could be tested. The monitor was instrumented and its numeric decoding corrected; treating an occluded window as automatically gone was removed. Window discovery now includes other-Space windows for investigation. Those changes still need a full interactive test.

## Current immediate blocker

The latest development binary needs renewed TCC grants. During renewal, System Settings entered a modal flow that repeatedly timed out through the computer-use tool, including visual and accessibility inspection. The user was asked to finish/dismiss that inaccessible dialog and re-enable the same two already-authorized permissions, then restart the app. No new SIP change is proposed.

This is an **access/testing blocker**, not proof of a fundamental macOS impossibility. The capture-and-input route remains an experiment. The next action is to complete the transformed-input gate in `EXPERIMENTS.md`, fix failures, and only then expand into a multiwindow manager. Do not substitute the captured image for a working result.

## Preservation

Development starts from `a649aee91b21586da02ca8610d0e1653ebfd211b` on `native/compositor-proof`. The original checkout was not modified; a fresh clone was created under `Desktop/Desktop/3D-Desktop`. Existing Electron sources remain intact, the `v1.0.0` tag/release is not replaced, and `~/Library/Application Support/Depth` is not touched by this implementation.
