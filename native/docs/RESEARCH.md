# API evidence and approach selection

Research checked 2026-10-15; observations are specific to the actual host, macOS 26.6.2 (25G83), Apple M3. Source availability is not a runtime guarantee.

| Mechanism | Classification | What it establishes |
| --- | --- | --- |
| [AXUIElement](https://developer.apple.com/documentation/applicationservices/axuielement) | Public Accessibility API, user permission required | Read exposed UI attributes, focus/raise, conventional position/size management. No public arbitrary perspective-transform property was found. |
| [ScreenCaptureKit](https://developer.apple.com/documentation/screencapturekit/capturing-screen-content-in-macos) and [desktop-independent window filter](https://developer.apple.com/documentation/screencapturekit/sccontentfilter/init(desktopindependentwindow:)) | Public capture APIs | Stream existing window content. This alone does not make a window interactive. |
| [CALayer.transform](https://developer.apple.com/documentation/quartzcore/calayer/transform) | Public rendering API | Project the utility's own captured surface. Does not transform a different application's WindowServer window. |
| [CGEvent.postToPid](https://developer.apple.com/documentation/coregraphics/cgevent/posttopid(_:)) | Public event-posting API, subject to TCC | Submit events to another process. No guarantee that arbitrary overlay coordinates reach the intended control or menu. |
| [Annotated-session event tap](https://developer.apple.com/documentation/coregraphics/cgeventtaplocation/cgannotatedsessioneventtap) | Public mouse-event routing stage, permission required | Apple's installed `CGEvent.h` describes this tap plus process-specific posting as a routing pattern. It does not establish that cursor state or menu tracking follows remapped coordinates. |
| [CGWarpMouseCursorPosition](https://developer.apple.com/documentation/coregraphics/cgwarpmousecursorposition(_:)) and [CGEventTimestamp](https://developer.apple.com/documentation/coregraphics/cgeventtimestamp) | Public cursor and event APIs | Move the actual cursor without generating an event; read an event's uptime timestamp. Neither API guarantees atomic pairing of a live cursor sample with a queued event or with a warp. |
| Event fields 51 and 58 | Undocumented/private routing fields | WindowPin's implementation uses them for addressing a window. Actual behavior must be tested on this host, with no portability guarantee. |
| `SLSGetWindowTransform`, `SLSSetWindowTransform`, `SLSSetWindowWarp` | Private SkyLight APIs | Symbols exist here. Own-window affine mutation reads back correctly; cross-process mutation returned success but read back unchanged in the ordinary untrusted probe. |

Relevant implementation sources:

- [yabai's scripting-addition payload](https://github.com/asmvik/yabai/blob/master/src/osax/payload.m) invokes private transforms from the Dock process. [Its SIP guidance](https://github.com/asmvik/yabai/wiki/Disabling-System-Integrity-Protection) concerns prerequisites for that injection strategy; it is not proof that arbitrary perspective, hit testing, popup menus, and crash recovery work. No scripting addition is installed or loaded for this project.
- [Chromium's native constrained-window animation](https://chromium.googlesource.com/chromium/src/+/main/ui/base/cocoa/constrained_window/constrained_window_animation.mm) gives a float32 warp-mesh ABI and applies temporary warps to windows it owns. This informed the probe declaration. It does not prove persistent third-party interaction.
- [NUIKit/CGSInternal](https://github.com/NUIKit/CGSInternal/blob/master/CGSWindow.h) documents historical ownership restrictions. Its `CGPoint` warp layout conflicts with Chromium's float32 declaration on 64-bit systems. The probe follows Chromium; private ABI uncertainty is explicitly retained.
- [WindowPin](https://github.com/PerpetualBeta/WindowPin) and its [EventForwarder](https://github.com/PerpetualBeta/WindowPin/blob/main/Sources/EventForwarder.swift) demonstrate the capture/forwarding direction. Its published behavior has different keyboard/focus goals and is not the requested compositor. The project is [Unlicense/public domain](https://github.com/PerpetualBeta/WindowPin/blob/main/LICENSE); this code uses the same routing-field convention, with independent projection and lifecycle code.
- [AeroSpace](https://github.com/nikitabobko/AeroSpace) manages actual application windows and implements its own workspace behavior. That is relevant architecture research, not evidence of perspective compositing.

## Hover investigation

Current upstream [Gecko `nsCocoaUtils::ScreenLocationForEvent`](https://github.com/mozilla-firefox/firefox/blob/main/widget/cocoa/nsCocoaUtils.mm) reads `NSEvent.mouseLocation` for mouse-move events instead of using the injected event position. Its [Cocoa window tracker](https://github.com/mozilla-firefox/firefox/blob/main/widget/cocoa/nsCocoaWindow.mm) uses that position in hit testing. This is a concrete mechanism consistent with working mapped clicks but offset hover. Installed Zen metadata reports 1.23.2b / Gecko 157.0.1; the exact installed patchset has not been verified against this upstream source. Do not describe this inference as a debugger-confirmed cause in that binary.

[Apple documents cursor warping](https://developer.apple.com/documentation/coregraphics/cgwarpmousecursorposition(_:)) without event generation. A separate 30-second experiment therefore moves the actual pointer to the mapped source location while drawing a cyan diagnostic pointer at the projected position. The normal cursor stays visible and mouse/cursor association stays enabled. This is an experiment, not a verified fix: queued motion, tracking-area delivery, and cleanup must be measured. It is disabled by default.

The first implementation subtracted the latest warp destination from every incoming absolute event location. A queued event generated before that warp can therefore produce an artificial jump. An immediate post-warp sample is also not an atomic acknowledgment: physical movement between the call and the sample can exceed a small readback tolerance. These are mechanisms consistent with the recorded early stops; the logs do not establish that every mismatch had the same cause.

Primary implementations confirm that cursor warping can contaminate subsequent movement deltas:

- [SDL's Cocoa mouse implementation](https://github.com/libsdl-org/SDL/blob/main/src/video/cocoa/SDL_cocoamouse.m) compensates movement using its saved warp and cursor positions. Simply switching to `CGEvent` or `NSEvent` deltas is therefore not a demonstrated solution.
- [GLFW's Cocoa implementation](https://github.com/glfw/glfw/blob/master/src/cocoa_window.m) accumulates warp displacement and subtracts it from the next relative mouse movement.
- [Chromium's Cocoa view](https://chromium.googlesource.com/chromium/src.git/+/HEAD/content/app_shim_remote_cocoa/render_widget_host_view_cocoa.mm) suppresses the initial recenter artifact when entering pointer lock. Its pointer-lock path also disables mouse/cursor association; this proof does not adopt that global state change.

The new `PointerMotion` model keeps an ordered history of warp start/end timestamps and requested displacement from a live pre-warp sample. It subtracts only warps that fall between the previous motion sample and the new event. Events inside a warp bracket suppress movement and require a clean baseline; button and scroll events keep the last virtual point. The model rejects invalid values, time regressions, corrected movement over 120 points, and history overflow. Readback is retained as diagnostic evidence instead of a four-point abort condition. The system-pointer route posts its mapped event before returning from the callback, using cached popup routing and no AX focus calls there; target-process delivery remains asynchronous.

This timestamp-ledger strategy is an experimental inference, not an implementation known to be correct from those upstream sources. It assumes event positions describe their timestamps, the timestamp and warp-bracket clocks align, and the live pre-warp sample is close enough to the actual position changed by the warp. Movement during sampling and the call remains a source of uncertainty. The 163 pure-model result assertions verify bookkeeping under supplied inputs, not these macOS assumptions. No new private API is used by the ledger; the existing undocumented event-routing fields remain a separate dependency.

The cyan arrow now occupies a small, nonactivating, click-through native panel at `NSWindow.Level.popUpMenu + 1`, separate from the capture canvas. This addresses the observed layering mechanism but does not prove correct visibility over every native popup, fullscreen surface, or Space. Two visible cursors are intentional during diagnosis. Sustained physical hover and exact native menu selection with this revision remain unverified; none of the investigated implementations establishes a known-safe full-desktop compositor.

The local hover target also showed that automation's coordinate click can deliver a mapped event without moving the physical pointer. This makes that automation useful for click outcomes but insufficient to certify physical hover alignment. See `native/evidence/hover-target-baseline-m3.json`.

## Host security state

`csrutil status` reported an existing **custom configuration**, including disabled Debugging Restrictions; other listed protections remained enabled. This project did not change it. No experiment can therefore claim validation on a stock fully enabled SIP configuration. There was no installed scripting addition in `/Library/ScriptingAdditions` during inspection. `yabai` 7.1.17 exists on disk but was not running. It was not started or modified.

An ordinary SkyLight connection and a privileged Dock connection are different capabilities. Disabling SIP would not itself supply a compositor, event remapping, a verified private ABI, or recovery behavior. No request to change SIP is justified by the experiments so far.

## Decision gate

The capture path is a candidate only if the visibly transformed target accepts real clicks, text input, scrolling, dragging, and menus. A failure in one route does not prove macOS makes the product impossible. A product-level blocker must identify the failed operation, a positive control, exact host/security state, and the routes still unproven. Expansion into a polished multiwindow utility is gated on this test.
