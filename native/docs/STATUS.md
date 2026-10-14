# Verification status — 2026-10-14

This is an **incomplete experimental branch**, not the requested finished 3D window manager.

Host inspected directly: MacBook Air Mac15,12, Apple M3 (8 CPU / 10 GPU cores), 16 GB RAM, macOS 26.6.2 (25G83). One built-in display, hardware resolution 2560 × 1664; logical desktop dimensions observed through window APIs were 1470 × 956. Existing custom SIP configuration was recorded but not changed. No Dock injection or scripting addition was attempted.

## Established on the first interactive build

Binary SHA-256: `bcb7c11849dfbd66b3ba7a4eac8c8fc273c6e845c9a8976f7c329e9785bd292c`.

- Native arm64 build, ad-hoc signature verification, and 17,424 independent projection/CALayer/inverse samples passed.
- TextEdit remained visibly projected for 158.87 seconds, delivering 9,092 complete frames (57.23 frames/s). This is capture delivery, not end-to-end latency.
- Clicking the projected Bold button enabled and disabled actual TextEdit formatting; dragging across the projected first line visibly selected text.
- The user explicitly confirmed typing, cursor placement, and scrolling worked through the tilted TextEdit window.
- A style popup opened. Selecting Bold through it did not consistently work; the user also reported dropdown alignment failures.
- During a 30-second capture run with live text edits, 59 `ps` samples averaged 6.39% CPU and peaked at 94.89 MiB RSS. This excludes WindowServer/GPU work, power, and input latency. It does not apply to the newer two-stream compositor.
- SIGTERM ended the utility process. Initial stop logs shared a generic reason and could not distinguish shortcut, controls, and Space changes.

Machine-readable evidence: `native/evidence/transformed-textedit-m3.json` and `native/evidence/active-textedit-m3.json`. No desktop images or typed text are published.

## Two-stream rendering and manipulation trials

The measurements below belong to binary SHA-256 `3a5be4863b91c3d6584b8bb4a760f0100fe093f03b79e49e19d2a27016c44e0d`. The prior two-stream build was `c8d9e7223a9da05543be4856e8a64d39fd318874ab99014cfc86d35ae611e89e`. They do not validate later builds.

- Added Option-drag movement, Option–Shift-drag rotation, Option-scroll depth, and 3D menu controls.
- Added mouse-move forwarding, projected cursor feedback, and same-process popup-window routing. Menu success still needs verification.
- Replaced the black surround with a live desktop-background patch excluding the original target and utility windows. Transparent capture and rounded clipping remove the prior opaque corner pixels by construction; the combined on-screen appearance still needs confirmation.
- Original windows remain unchanged. Movement changes only the presentation panel.
- Emergency handler installation is checked as well as hotkey registration. Stop reasons now distinguish Space, display, sleep, controls, and termination.
- A first two-stream build crashed in `SCStreamConfiguration.copyWithZone` / `CGColorCreateCopy`: its `backgroundColor` property uses assign semantics. The color now has session lifetime. TextEdit remained accessible after that crash.
- The corrected two-stream build started successfully: 1,193 target frames and 607 background frames over 20.67 seconds, then stopped on an observed **Space change**. Automation selected the background patch window instead of the interactive panel; full manipulation regression is pending.
- A user screenshot of the prior two-stream build established a projected font menu and cyan cursor, but its highlighted item did not line up with the cursor. This is a failed menu acceptance case.
- Mouse events are now constructed at the mapped destination instead of copying private source-window coordinates. Scroll events retain their existing phase/momentum data. Capture-geometry and popup-route diagnostics were added; menu correction is not yet confirmed.
- This build delivered 4,036 target frames and 2,054 background frames over 70.27 seconds (57.43 target frames/s). It received 1,519 transform updates during manual manipulation. Capture geometry remained 586 × 488 points at scale 2 with content scale 1.
- Its two-stream 30-second sample: 59 samples, mean reported CPU 13.10%, peak RSS 59.09 MiB. Excludes WindowServer/GPU, power, and input latency. RSS differences across runs are not a memory optimization claim.
- The run stopped on a Space change. A subsequent screenshot verified the original TextEdit window was flat and accessible with its contents intact.
- Both privacy grants were renewed and observed as allowed. No SIP or other security setting was changed.

## Private API experiments retained

Owned-window affine transformation changed, persisted, and restored. The same foreign TextEdit operation returned success but read back unchanged after run-loop flushing. Private warp symbols returned 0 without a verified visible foreign warp. These were ordinary probe-context observations, not a proof that all privileged/native approaches are impossible. No Dock injection was attempted.

## Mouse-interception regression

A later build (`4a762c0bd74565d66f39ccb58943022044a30f98428bde809915b0639864538f`) successfully installed a mouse-only session event tap and targeted an existing Zen window. It suppressed raw pointer events inside the projected surface, posted mapped events, and used a custom native cursor. The user reported **cursor disappearance and broken hover inside the transformed floating window**. The utility was stopped. This is a failed experiment, not an input fix.

`ProofSession.experimentalMouseTapEnabled` is now false. The normal system cursor and ordinary event delivery remain enabled by default. The failed route is retained only for the reproducible comparison in `EXPERIMENTS.md`. Popup consistency remains unresolved; visual perspective and manipulation do not satisfy that requirement.

The user confirmed normal cursor visibility and responsiveness after stopping the failed build. An intermediate fallback (`c9700c8e07ae500dc479aaf45eca1c733ebfd1f19e0f4605a7c64ee514470332`) compiled and passed local signature verification but was superseded before interaction testing. See [whole-desktop scene direction](DESKTOP-SCENE.md) for the clarified requirement and verification gates.

## Latest source and hover investigation

Previous binary: `8603b24d8d59042768818b721b56653368b5bd9b1f048bdef48fe88f1d55040c`. It consolidates the renderer into one canvas, includes projected-corner bounds at extreme tilts, snapshots queued input mapping, and sends releases for tracked posted buttons during normal restoration. It also restores on pointer-probe tap failure/readback mismatch and uses common-mode timeout timers. Build/signature checks pass. Expanded tests cover 3,509,000 projection points and 580,000 translated corners. These code checks do not establish live emergency-drag or crash behavior.

The preceding annotated-mouse build (`af52faf6f2742fb9b5bbd64dcfa5c4444abfb360140252148f4a4b56e73fe462`) was tested manually. The user's final clarification: cursor visible, no projected duplicate; hover/alignment wrong, other actions working. This supersedes the initial broader description of cursor failure for that build. 180 tap records put the sampled system pointer within 1.18 points of the original hardware event (mean 0.012), while input was remapped elsewhere. Exact menu-item acceptance was not recorded. Evidence: `native/evidence/annotated-hover-m3.json`.

A separate 30-second system-pointer mapping probe is available, disabled by default. It uses two visible cursors and no cursor disassociation. In the preceding build (`ff26649c46a3bc01306a43a97aa22eeeb3adef76e6eba02fd9b1a12938874304`), it started capture and restored at 30.002 seconds. No physical input was observed during that trial, so it establishes timeout behavior only. The diagnostic target separately confirmed automation can post clicks without moving the actual pointer; physical-mouse hover testing remains necessary.

On that binary, the user subsequently reported that the diagnostic hover border and white event dot followed the cyan pointer. The target recorded mouse-enter/move events and region A tracking during the approximate session interval. This is a **partial fixture pass**: the compositor stopped after 2.4025 seconds because pointer readback differed from the requested position by about 8 points, exceeding its 4-point guard. It does not establish sustained mapping, all four regions, or real-application dropdown behavior. The discrepancy's cause remains unisolated; hardware motion between warp and readback is one hypothesis. Evidence: `native/evidence/physical-hover-fixture-m3.json`. Subsequent TextEdit trials failed; see below.

The preceding build was also forcibly terminated with SIGKILL during ordinary two-stream capture, with no button held. Its original diagnostic window remained flat and accessible; a subsequent click incremented the intended D counter. This does not validate termination while pointer mapping or a drag is active. Evidence: `native/evidence/pointer-probe-lifecycle-m3.json`.

## Remaining acceptance gaps

Correct popup/menu selection, service-owned dialogs, overlapping windows, reliable focus transitions, Finder/Safari/Terminal coverage, hardware-global emergency shortcut, forced termination during mapped pointer/drag input, latest-build performance, full-screen transitions, and multi-display behavior remain unverified. One display is available. Space changes currently restore the ordinary desktop rather than maintaining the transform.

This remains a single-window experimental proof. Its backdrop is a composited rectangle, not a complete desktop hit-testing manager. Clicking exposed patch regions does not correctly address the underlying desktop. No polished multiwindow product is claimed, and no fundamental macOS impossibility has been established.

## Preservation

Development starts from `a649aee91b21586da02ca8610d0e1653ebfd211b` on `native/compositor-proof`. The original checkout was not modified; a fresh clone was created under `Desktop/Desktop/3D-Desktop`. Existing Electron sources remain intact, the `v1.0.0` tag/release is not replaced, and `~/Library/Application Support/Depth` is not touched by this implementation.

## TextEdit pointer probe regression — 2026-10-14

The next TextEdit trial stopped after 2.7319 seconds with `system pointer probe: motion jump exceeded 120 points`. A later trial reached the 30-second timeout (30.0087 seconds), but the user reported involuntary-looking pointer movement, the cyan pointer appearing behind a dropdown, and the normal macOS pointer remaining visible. This is a failed interaction trial, not a menu-selection pass. Two visible pointers are intentional diagnostic behavior in this build; disruptive motion and dropdown occlusion are unresolved defects.

Restore Desktop was invoked and the system-pointer mapping checkbox was observed disabled afterward. No cursor-hiding or security-setting change was applied. Evidence: `native/evidence/textedit-pointer-regression-m3.json`.

That revision's callback subtracts the latest warp destination from incoming absolute event positions. Queued events may precede that warp, so this is a candidate for false motion; causality has not been instrumentally established. In that revision, the cyan pointer is a layer inside the floating proof panel, so it cannot reliably appear above a separate native menu window. Raising that layer alone would not establish correct cross-window ordering. These defects must be resolved before another general desktop interaction trial.

## Timestamp-ledger revision — 2026-10-15 local time

Current binary: `0a211bf5e308b40c248366bdac230b2862883110c402837ede64fdfb089b6b30`. The old binary and its failed trial evidence are retained. This is another experimental proof, not a completed window manager.

The pointer probe now computes movement between timestamped events and subtracts only intervening recorded cursor warps. It preserves queued pre-warp events, skips ambiguous warp-boundary movement, bounds history, and retains the 120-point limit on corrected movement. Readback is recorded as evidence rather than treated as an atomic acknowledgment. Screen-coordinate rounding is explicit. This depends on macOS event timestamps and locations describing the same state; replay tests do not establish that runtime assumption.

The cyan marker now uses a small separate nonactivating, click-through panel above the popup-menu level. The compositor panel remains floating. The normal macOS cursor remains visible intentionally; neither cursor hiding nor mouse disassociation is used. Actual native dropdown ordering still needs physical verification.

System-pointer events are posted before another callback can warp the cursor, with popup discovery moved to a timer and input logging deferred. This avoids the utility's previous queued-post ordering race; the receiving application's asynchronous processing remains unverified. Failure cleanup releases posted buttons before restoring the cursor, suppresses intervening input, and closes both overlays. The pointer probe ends when the pointer leaves the projected surface. Controls reopen with the reason and turn the pointer checkbox off.

Validation: arm64 build and ad-hoc signature verification passed; 163 pointer-motion result assertions passed, plus 3,509,000 projection points and 580,000 moved-canvas corners. The app was launched through the normal app launcher. The same previously approved Accessibility and Screen Recording grants were renewed; both were observed allowed after restart. No SIP or other security setting was changed. Sustained physical hover, exact native menu selection, active-mapping termination, and performance of this revision remain unverified.

The first idle run of this revision completed after 30.00695 seconds and restored its control window with `Restored: proof timeout (30 seconds)` and the pointer checkbox off. It delivered 1,527 complete frames (50.89 frames/s) and 843 backdrop frames. No mapped input was recorded, so this checks timeout/UI restoration only; it does not establish pointer behavior or representative workload performance. Evidence: `native/evidence/pointer-ledger-lifecycle-m3.json`. A physical fixture trial is prepared but not automatically started.
