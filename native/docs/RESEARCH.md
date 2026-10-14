# API evidence and approach selection

Research checked 2026-10-14; observations are specific to the actual host, macOS 26.6.2 (25G83), Apple M3. Source availability is not a runtime guarantee.

| Mechanism | Classification | What it establishes |
| --- | --- | --- |
| [AXUIElement](https://developer.apple.com/documentation/applicationservices/axuielement) | Public Accessibility API, user permission required | Read exposed UI attributes, focus/raise, conventional position/size management. No public arbitrary perspective-transform property was found. |
| [ScreenCaptureKit](https://developer.apple.com/documentation/screencapturekit/capturing-screen-content-in-macos) and [desktop-independent window filter](https://developer.apple.com/documentation/screencapturekit/sccontentfilter/init(desktopindependentwindow:)) | Public capture APIs | Stream existing window content. This alone does not make a window interactive. |
| [CALayer.transform](https://developer.apple.com/documentation/quartzcore/calayer/transform) | Public rendering API | Project the utility's own captured surface. Does not transform a different application's WindowServer window. |
| [CGEvent.postToPid](https://developer.apple.com/documentation/coregraphics/cgevent/posttopid(_:)) | Public event-posting API, subject to TCC | Submit events to another process. No guarantee that arbitrary overlay coordinates reach the intended control or menu. |
| [Annotated-session event tap](https://developer.apple.com/documentation/coregraphics/cgeventtaplocation/cgannotatedsessioneventtap) | Public mouse-event routing stage, permission required | Apple's installed `CGEvent.h` describes this tap plus process-specific posting as a routing pattern. It does not establish that cursor state or menu tracking follows remapped coordinates. |
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

The local hover target also showed that automation's coordinate click can deliver a mapped event without moving the physical pointer. This makes that automation useful for click outcomes but insufficient to certify physical hover alignment. See `native/evidence/hover-target-baseline-m3.json`.

## Host security state

`csrutil status` reported an existing **custom configuration**, including disabled Debugging Restrictions; other listed protections remained enabled. This project did not change it. No experiment can therefore claim validation on a stock fully enabled SIP configuration. There was no installed scripting addition in `/Library/ScriptingAdditions` during inspection. `yabai` 7.1.17 exists on disk but was not running. It was not started or modified.

An ordinary SkyLight connection and a privileged Dock connection are different capabilities. Disabling SIP would not itself supply a compositor, event remapping, a verified private ABI, or recovery behavior. No request to change SIP is justified by the experiments so far.

## Decision gate

The capture path is a candidate only if the visibly transformed target accepts real clicks, text input, scrolling, dragging, and menus. A failure in one route does not prove macOS makes the product impossible. A product-level blocker must identify the failed operation, a positive control, exact host/security state, and the routes still unproven. Expansion into a polished multiwindow utility is gated on this test.
