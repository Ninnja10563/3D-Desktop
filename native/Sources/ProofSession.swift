import AppKit
import ApplicationServices
import ScreenCaptureKit
import CoreMedia
import IOSurface

final class ProofPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

final class ProofView: NSView {
    weak var session: ProofSession?
    private var tracking: NSTrackingArea?
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let tracking { removeTrackingArea(tracking) }
        let next = NSTrackingArea(rect: .zero, options: [.activeAlways, .inVisibleRect, .mouseMoved, .mouseEnteredAndExited], owner: self)
        addTrackingArea(next); tracking = next
    }
    override func mouseMoved(with event: NSEvent) { session?.forward(event) }
    override func mouseExited(with event: NSEvent) { NSCursor.arrow.set() }
    override var isFlipped: Bool { true }
    override var mouseDownCanMoveWindow: Bool { false }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseDown(with event: NSEvent) { session?.forward(event) }
    override func mouseUp(with event: NSEvent) { session?.forward(event) }
    override func mouseDragged(with event: NSEvent) { session?.forward(event) }
    override func rightMouseDown(with event: NSEvent) { session?.forward(event) }
    override func rightMouseUp(with event: NSEvent) { session?.forward(event) }
    override func rightMouseDragged(with event: NSEvent) { session?.forward(event) }
    override func otherMouseDown(with event: NSEvent) { session?.forward(event) }
    override func otherMouseUp(with event: NSEvent) { session?.forward(event) }
    override func otherMouseDragged(with event: NSEvent) { session?.forward(event) }
    override func scrollWheel(with event: NSEvent) { session?.forward(event) }
}

/// Experimental interaction proof. Originals are never hidden, moved, minimized, or made transparent.
/// Crashes therefore remove only this process's overlay windows.
final class ProofSession: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
    let target: SCWindow
    let panel: ProofPanel
    let view: ProofView
    let surfaceLayer = CALayer()
    // SCStreamConfiguration.backgroundColor is assign, not retain, in the SDK.
    // Keep this alive while ScreenCaptureKit copies/uses the configuration.
    let captureBackgroundColor = CGColor(gray: 0, alpha: 0)
    var inputTap: CFMachPort?
    var inputTapSource: CFRunLoopSource?
    var lastCursorUpdate = Date.distantPast
    static let routedEventTag: Int64 = 0x33444450
    // Failed experiment retained for reproduction only; never enabled by default.
    static let experimentalMouseTapEnabled = false
    let annotatedRouting: Bool
    let systemPointerRouting: Bool
    var virtualPointer: CGPoint?
    var lastWarpDestination = CGPoint.zero
    var pointerEpoch: UInt64 = 0
    let virtualCursorLayer = CAShapeLayer()
    var tapGesture = false
    var tapEventCount = 0
    var lastTapLog = Date.distantPast
    // Only buttons actually posted to the target need a matching release.
    var postedButtons: [Int: CGEvent] = [:]
    // AppKit screen coordinates, with a bottom-left origin. One canvas covers
    // both rectangles; layer and input coordinates inside it remain top-left.
    let originalFrame: NSRect
    var presentationFrame: NSRect
    let movementBounds: NSRect
    let backdropLayer = CALayer()
    var backdropStream: SCStream?
    var backdropSurface: IOSurface?
    var backdropPending = false
    var backdropFrames = 0
    var lastCaptureGeometry = ""
    var lastHoverLog = Date.distantPast
    var yaw = 25.0, pitch = -8.0, depth = 80.0
    enum Manipulation { case move, rotate }
    var manipulation: Manipulation?
    var gesturePoint = CGPoint.zero
    var gestureOrigin = CGPoint.zero
    var gestureYaw = 0.0, gesturePitch = 0.0
    var lastRouteRefresh = Date.distantPast
    var popupWindows: [(CGWindowID, CGRect)] = []
    var gestureWindow: CGWindowID?
    var projection: Projection
    var stream: SCStream?
    var latestSurface: IOSurface?
    var timer: Timer?
    var monitor: Timer?
    var stopped = false
    var dragging = false
    var frameCount = 0
    var frameAges: [Double] = []
    var started = Date()
    let log: ([String: Any]) -> Void
    let ended: (String) -> Void
    let sampleQueue = DispatchQueue(label: "3d-desktop.capture", qos: .userInteractive)
    // One pending frame: do not let main-thread stalls retain an unbounded queue of IOSurfaces.
    let lock = NSLock()
    var pending = false
    var source = CGEventSource(stateID: .combinedSessionState)

    init(target: SCWindow, annotatedRouting: Bool = false, systemPointerRouting: Bool = false, log: @escaping ([String:Any])->Void, ended: @escaping (String)->Void) {
        self.target = target; self.log = log; self.ended = ended
        self.annotatedRouting = annotatedRouting || systemPointerRouting
        self.systemPointerRouting = systemPointerRouting
        projection = Projection(width: target.frame.width, height: target.frame.height, yaw: 25, pitch: -8, depth: 80)
        let primaryHeight = NSScreen.screens.first?.frame.height ?? 0
        let frame = NSRect(x: target.frame.minX, y: primaryHeight-target.frame.maxY, width: target.frame.width, height: target.frame.height)
        originalFrame = frame
        presentationFrame = frame
        movementBounds = NSScreen.screens.first(where: { $0.frame.contains(frame) })?.visibleFrame ?? frame
        panel = ProofPanel(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        view = ProofView(frame: NSRect(origin: .zero, size: frame.size))
        super.init()
        view.session = self; view.wantsLayer = true
        source?.localEventsSuppressionInterval = 0
        view.layer?.backgroundColor = NSColor.clear.cgColor
        backdropLayer.frame = view.bounds
        backdropLayer.contentsGravity = .resize
        view.layer?.addSublayer(backdropLayer)
        surfaceLayer.anchorPoint = .zero
        surfaceLayer.bounds = CGRect(origin: .zero, size: frame.size)
        surfaceLayer.position = .zero
        surfaceLayer.contentsGravity = .resize
        surfaceLayer.transform = projection.layerTransform
        surfaceLayer.cornerRadius = 12
        surfaceLayer.masksToBounds = true
        view.layer?.addSublayer(surfaceLayer)
        // Diagnostic virtual pointer only. The real system cursor stays visible;
        // no cursor-hide counter or mouse/cursor disassociation is used.
        let arrow = CGMutablePath()
        arrow.move(to: .zero)
        for point in [CGPoint(x:0,y:22), CGPoint(x:6,y:16), CGPoint(x:10,y:25), CGPoint(x:14,y:23), CGPoint(x:10,y:14), CGPoint(x:18,y:14)] { arrow.addLine(to: point) }
        arrow.closeSubpath()
        virtualCursorLayer.path = arrow
        virtualCursorLayer.fillColor = NSColor.systemTeal.cgColor
        virtualCursorLayer.strokeColor = NSColor.white.cgColor
        virtualCursorLayer.lineWidth = 1.5
        virtualCursorLayer.anchorPoint = .zero
        virtualCursorLayer.isHidden = true
        view.layer?.addSublayer(virtualCursorLayer)
        panel.contentView = view
        panel.title = "3D Desktop — experimental interaction proof"
        panel.setAccessibilityRole(.window)
        panel.setAccessibilitySubrole(.standardWindow)
        panel.setAccessibilityLabel("3D Desktop perspective surface")
        view.setAccessibilityElement(true)
        view.setAccessibilityRole(.group)
        view.setAccessibilityLabel("Live transformed application window")
        panel.isReleasedWhenClosed = false
        panel.level = .floating
        panel.hidesOnDeactivate = false
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.acceptsMouseMovedEvents = true
        panel.hasShadow = false
        panel.collectionBehavior = [.stationary, .ignoresCycle]
        layoutCanvas()
    }

    /// The presentation's top-left corner in the canvas's top-left coordinates.
    var presentationOriginInCanvas: CGPoint {
        CGPoint(x: presentationFrame.minX-panel.frame.minX,
                y: panel.frame.maxY-presentationFrame.maxY)
    }

    func unprojectCanvasPoint(_ point: CGPoint) -> CGPoint {
        let origin = presentationOriginInCanvas
        return projection.unproject(CGPoint(x: point.x-origin.x, y: point.y-origin.y))
    }

    func layoutCanvas() {
        // Moving the presentation changes the union, not the original patch's
        // screen position. Use the actual window frame after AppKit lays it out.
        let projected = projection.projectedBounds
        let projectedScreen = CGRect(x: presentationFrame.minX + projected.minX,
                                     y: presentationFrame.maxY - projected.maxY,
                                     width: projected.width, height: projected.height)
        panel.setFrame(originalFrame.union(presentationFrame).union(projectedScreen).integral, display: true)
        view.frame = NSRect(origin: .zero, size: panel.frame.size)
        CATransaction.begin(); CATransaction.setDisableActions(true)
        backdropLayer.frame = CGRect(x: originalFrame.minX-panel.frame.minX,
                                     y: panel.frame.maxY-originalFrame.maxY,
                                     width: originalFrame.width, height: originalFrame.height)
        surfaceLayer.position = presentationOriginInCanvas
        CATransaction.commit()
    }

    func resetView() {
        adjust(yaw: 25-yaw, pitch: -8-pitch, depth: 80-depth)
        presentationFrame = originalFrame
        layoutCanvas()
    }

    @MainActor func start() async throws {
        guard AXIsProcessTrusted(), CGPreflightScreenCaptureAccess(), CGPreflightPostEventAccess() else {
            throw NSError(domain: "3DDesktop", code: 1, userInfo: [NSLocalizedDescriptionKey: "Accessibility and Screen Recording permissions are required."])
        }
        if (annotatedRouting || Self.experimentalMouseTapEnabled) && !installInputTap() {
            throw NSError(domain: "3DDesktop", code: 3, userInfo: [NSLocalizedDescriptionKey: "Mouse routing tap unavailable. Verify Accessibility permission, then restart."])
        }
        let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: false)
        guard let display = content.displays.first(where: { $0.frame.contains(target.frame) }),
              let ownApp = content.applications.first(where: { $0.processID == getpid() }) else {
            throw NSError(domain: "3DDesktop", code: 2, userInfo: [NSLocalizedDescriptionKey: "Proof requires a target fully inside one display."])
        }
        // Exclude all utility windows and the original target. Draw only the desktop
        // rectangle behind the original; the original itself remains untouched.
        let backdropFilter = SCContentFilter(display: display, excludingApplications: [ownApp], exceptingWindows: [target])
        let backgroundConfig = SCStreamConfiguration()
        let scale = panel.screen?.backingScaleFactor ?? 2
        backgroundConfig.sourceRect = target.frame.offsetBy(dx: -display.frame.minX, dy: -display.frame.minY)
        backgroundConfig.width = Int(target.frame.width * scale)
        backgroundConfig.height = Int(target.frame.height * scale)
        backgroundConfig.minimumFrameInterval = CMTime(value: 1, timescale: 30)
        backgroundConfig.queueDepth = 3; backgroundConfig.showsCursor = false
        backgroundConfig.capturesAudio = false
        let backdrop = SCStream(filter: backdropFilter, configuration: backgroundConfig, delegate: self)
        backdropStream = backdrop
        try backdrop.addStreamOutput(self, type: .screen, sampleHandlerQueue: sampleQueue)
        try await backdrop.startCapture()
        if stopped { try? await backdrop.stopCapture(); return }
        let filter = SCContentFilter(desktopIndependentWindow: target)
        let config = SCStreamConfiguration()
        config.backgroundColor = captureBackgroundColor
        config.width = Int(target.frame.width * scale)
        config.height = Int(target.frame.height * scale)
        config.minimumFrameInterval = CMTime(value: 1, timescale: 60)
        config.queueDepth = 3
        config.showsCursor = false
        config.capturesAudio = false
        config.ignoreShadowsSingleWindow = true
        let stream = SCStream(filter: filter, configuration: config, delegate: self)
        self.stream = stream
        try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: sampleQueue)
        try await stream.startCapture()
        if stopped { try? await stream.stopCapture(); return }
        started = Date()
        let timeout: TimeInterval = systemPointerRouting ? 30 : 180
        timer = Timer(timeInterval: timeout, repeats: false) { [weak self] _ in self?.stop("proof timeout (\(Int(timeout)) seconds)") }
        monitor = Timer(timeInterval: 0.25, repeats: true) { [weak self] _ in self?.checkTarget() }
        RunLoop.main.add(timer!, forMode: .common)
        RunLoop.main.add(monitor!, forMode: .common)
        log(["event":"started", "window":target.windowID, "pid":target.owningApplication?.processID ?? 0,
             "width":config.width, "height":config.height, "fpsLimit":60, "yaw":25, "pitch":-8, "depth":80,
             "inputRoute":systemPointerRouting ? "systemPointerProbe" : (annotatedRouting ? "annotatedMouseTap" : (Self.experimentalMouseTapEnabled ? "legacySessionTap" : "appKit"))])
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of outputType: SCStreamOutputType) {
        guard outputType == .screen, sampleBuffer.isValid,
              let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo:Any]],
              let status = attachments.first?[.status] as? Int, status == SCFrameStatus.complete.rawValue,
              let buffer = sampleBuffer.imageBuffer,
              let unmanaged = CVPixelBufferGetIOSurface(buffer) else { return }
        if stream === backdropStream {
            lock.lock()
            if backdropPending { lock.unlock(); return }
            backdropPending = true; lock.unlock()
            let surface = unmanaged.takeUnretainedValue() as IOSurface
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                defer { self.lock.lock(); self.backdropPending = false; self.lock.unlock() }
                guard !self.stopped else { return }
                self.backdropFrames += 1; self.backdropSurface = surface
                CATransaction.begin(); CATransaction.setDisableActions(true)
                self.backdropLayer.contents = surface
                CATransaction.commit()
                if self.latestSurface != nil && !self.panel.isVisible { self.panel.orderFrontRegardless() }
            }
            return
        }
        lock.lock()
        if pending { lock.unlock(); return }
        pending = true; lock.unlock()
        let surface = unmanaged.takeUnretainedValue() as IOSurface
        let metadata = attachments.first ?? [:]
        let geometry = ["contentRect": String(describing: metadata[.contentRect] ?? "missing"),
                        "contentScale": String(describing: metadata[.contentScale] ?? "missing"),
                        "scaleFactor": String(describing: metadata[.scaleFactor] ?? "missing")]
        let geometryKey = geometry.keys.sorted().map { "\($0)=\(geometry[$0]!)" }.joined(separator: ";")
        let timestamp = sampleBuffer.presentationTimeStamp.seconds
        let age = CMClockGetTime(CMClockGetHostTimeClock()).seconds - timestamp
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            defer { self.lock.lock(); self.pending = false; self.lock.unlock() }
            guard !self.stopped else { return }
            if self.lastCaptureGeometry != geometryKey {
                self.lastCaptureGeometry = geometryKey
                self.log(["event":"captureGeometry", "metadata":geometry])
            }
            self.frameCount += 1
            if age.isFinite && age >= 0 && age < 10 { self.frameAges.append(age * 1000) }
            self.latestSurface = surface
            CATransaction.begin(); CATransaction.setDisableActions(true)
            self.surfaceLayer.contents = surface
            CATransaction.commit()
            if self.backdropSurface != nil && !self.panel.isVisible { self.panel.orderFrontRegardless() }
        }
    }
    func stream(_ stream: SCStream, didStopWithError error: Error) {
        DispatchQueue.main.async { [weak self] in self?.stop("capture error: \(error.localizedDescription)") }
    }

    func checkTarget() {
        guard let list = CGWindowListCopyWindowInfo(.optionIncludingWindow, target.windowID) as? [[String:Any]], let window = list.first else {
            stop("target window disappeared"); return
        }
        let pid = (window[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value
        let onScreen = (window[kCGWindowIsOnscreen as String] as? NSNumber)?.boolValue
        let dictionary = window[kCGWindowBounds as String] as? [String:Any] ?? [:]
        let bounds = CGRect(dictionaryRepresentation: dictionary as CFDictionary) ?? .zero
        // An occluded window may be reported off-screen; Space changes are handled separately.
        if pid != target.owningApplication?.processID || bounds != target.frame {
            log(["event":"targetStateChanged", "pid":pid ?? -1, "onScreen":onScreen ?? false,
                 "actualBounds":dictionary, "expectedBounds":NSStringFromRect(target.frame)])
            stop("target closed, moved, resized, minimized, or left current Space"); return
        }
        guard AXIsProcessTrusted(), CGPreflightScreenCaptureAccess() else { stop("permission revoked"); return }
    }

    func focusTarget() {
        guard let pid = target.owningApplication?.processID else { return }
        // Raising an already active window can dismiss its popup tracking session.
        // Keep the original application's menu/focus state intact between clicks.
        if NSRunningApplication(processIdentifier: pid)?.isActive == true { return }
        let app = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(app, 0.25)
        var value: CFTypeRef?
        if AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &value) == .success,
           let windows = value as? [AXUIElement] {
            for window in windows {
                var p: CFTypeRef?, s: CFTypeRef?
                guard AXUIElementCopyAttributeValue(window, kAXPositionAttribute as CFString, &p) == .success,
                      AXUIElementCopyAttributeValue(window, kAXSizeAttribute as CFString, &s) == .success else { continue }
                var point = CGPoint.zero, size = CGSize.zero
                AXValueGetValue(p as! AXValue, .cgPoint, &point); AXValueGetValue(s as! AXValue, .cgSize, &size)
                if abs(point.x-target.frame.minX) < 2 && abs(point.y-target.frame.minY) < 2 && abs(size.width-target.frame.width) < 2 {
                    AXUIElementSetAttributeValue(window, kAXMainAttribute as CFString, kCFBooleanTrue)
                    AXUIElementPerformAction(window, kAXRaiseAction as CFString)
                    break
                }
            }
        }
        NSRunningApplication(processIdentifier: pid)?.activate(options: [])
        if surfaceLayer.contents != nil { panel.orderFrontRegardless() }
    }

    func adjust(yaw deltaYaw: Double = 0, pitch deltaPitch: Double = 0, depth deltaDepth: Double = 0) {
        yaw = min(65, max(-65, yaw + deltaYaw))
        pitch = min(55, max(-55, pitch + deltaPitch))
        depth = min(1500, max(0, depth + deltaDepth))
        projection = Projection(width: target.frame.width, height: target.frame.height, yaw: yaw, pitch: pitch, depth: depth)
        CATransaction.begin(); CATransaction.setDisableActions(true)
        surfaceLayer.transform = projection.layerTransform
        CATransaction.commit()
        layoutCanvas()
        log(["event":"transform", "yaw":yaw, "pitch":pitch, "depth":depth])
    }

    func updatePopupWindows(pid: pid_t) {
        guard Date().timeIntervalSince(lastRouteRefresh) > 0.05 else { return }
        lastRouteRefresh = Date()
        let windows = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String:Any]] ?? []
        let previous = popupWindows.map { $0.0 }
        popupWindows = windows.compactMap { item in
            guard (item[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid,
                  let id = (item[kCGWindowNumber as String] as? NSNumber)?.uint32Value,
                  id != target.windowID,
                  let level = (item[kCGWindowLayer as String] as? NSNumber)?.intValue, level > 0,
                  let dictionary = item[kCGWindowBounds as String] as? [String:Any],
                  let bounds = CGRect(dictionaryRepresentation: dictionary as CFDictionary),
                  bounds.intersects(target.frame), bounds.width > 20, bounds.height > 20 else { return nil }
            return (id, bounds)
        }
        if previous != popupWindows.map({ $0.0 }) {
            log(["event":"popupWindows", "windows":popupWindows.map { ["id":$0.0, "bounds":NSStringFromRect($0.1)] as [String:Any] }])
        }
    }

    func installInputTap() -> Bool {
        let types: [CGEventType] = [.mouseMoved, .leftMouseDown, .leftMouseUp, .leftMouseDragged,
                                   .rightMouseDown, .rightMouseUp, .rightMouseDragged,
                                   .otherMouseDown, .otherMouseUp, .otherMouseDragged, .scrollWheel]
        let mask = types.reduce(CGEventMask(0)) { $0 | (CGEventMask(1) << $1.rawValue) }
        let location: CGEventTapLocation = annotatedRouting ? .cgAnnotatedSessionEventTap : .cgSessionEventTap
        guard let tap = CGEvent.tapCreate(tap: location, place: .headInsertEventTap,
                                         options: .defaultTap, eventsOfInterest: mask, callback: { _, type, event, context in
            guard let context else { return Unmanaged.passUnretained(event) }
            let session = Unmanaged<ProofSession>.fromOpaque(context).takeUnretainedValue()
            if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
                if session.systemPointerRouting {
                    session.restoreSystemPointer()
                    DispatchQueue.main.async { [weak session] in session?.stop("system pointer probe: event tap disabled") }
                    return Unmanaged.passUnretained(event)
                }
                if let tap = session.inputTap { CGEvent.tapEnable(tap: tap, enable: true) }
                session.log(["event":"mouseTapReenabled", "type":type.rawValue])
                return Unmanaged.passUnretained(event)
            }
            if event.getIntegerValueField(.eventSourceUserData) == ProofSession.routedEventTag {
                return Unmanaged.passUnretained(event)
            }
            guard !session.stopped, session.panel.isVisible else { return Unmanaged.passUnretained(event) }
            let primaryHeight = NSScreen.screens.first?.frame.height ?? 0
            var pointer = event.location
            if session.systemPointerRouting, let virtual = session.virtualPointer {
                let dx = event.location.x-session.lastWarpDestination.x
                let dy = event.location.y-session.lastWarpDestination.y
                // The experiment deliberately fails closed on a stale warp anchor
                // or a large jump. It is a slow, fixed-geometry hover test.
                if hypot(dx, dy) > 120 {
                    session.restoreSystemPointer()
                    DispatchQueue.main.async { [weak session] in session?.stop("system pointer probe: motion jump exceeded 120 points") }
                    return nil
                }
                pointer = CGPoint(x: virtual.x + dx, y: virtual.y + dy)
            } else if session.systemPointerRouting && [.leftMouseDragged, .rightMouseDragged, .otherMouseDragged, .leftMouseUp, .rightMouseUp, .otherMouseUp].contains(type) {
                // Never steal a drag whose button-down was delivered elsewhere.
                return Unmanaged.passUnretained(event)
            }
            let global = CGPoint(x: pointer.x, y: primaryHeight-pointer.y)
            let local = CGPoint(x: global.x-session.panel.frame.minX, y: session.panel.frame.maxY-global.y)
            let sourcePoint = session.unprojectCanvasPoint(local)
            guard session.tapGesture || session.dragging || (session.view.bounds.contains(local) && CGRect(origin: .zero, size: session.target.frame.size).contains(sourcePoint)) else {
                if session.systemPointerRouting, session.virtualPointer != nil {
                    session.restoreSystemPointer(at: pointer)
                    // This event was annotated at the old source location. Drop
                    // only the transition event; the next hardware event is native.
                    return nil
                }
                return Unmanaged.passUnretained(event)
            }
            guard let copy = event.copy() else { return Unmanaged.passUnretained(event) }
            if session.systemPointerRouting {
                let destination = CGPoint(x: session.target.frame.minX+sourcePoint.x,
                                          y: session.target.frame.minY+sourcePoint.y)
                guard destination.x.isFinite, destination.y.isFinite else { return nil }
                if session.virtualPointer == nil { session.pointerEpoch &+= 1 }
                session.virtualPointer = pointer
                session.panel.ignoresMouseEvents = true
                let result = CGWarpMouseCursorPosition(destination)
                guard result == .success else {
                    session.restoreSystemPointer(at: pointer)
                    DispatchQueue.main.async { [weak session] in session?.stop("system pointer mapping failed") }
                    return nil
                }
                if let actual = CGEvent(source: nil)?.location, hypot(actual.x-destination.x, actual.y-destination.y) > 4 {
                    session.restoreSystemPointer(at: pointer)
                    DispatchQueue.main.async { [weak session] in
                        session?.log(["event":"pointerReadbackMismatch", "requested":[destination.x,destination.y], "actual":[actual.x,actual.y]])
                        session?.stop("system pointer probe: warp readback mismatch")
                    }
                    return nil
                }
                session.lastWarpDestination = destination
                CATransaction.begin(); CATransaction.setDisableActions(true)
                session.virtualCursorLayer.position = local
                session.virtualCursorLayer.isHidden = false
                CATransaction.commit()
            }
            if [.leftMouseDown, .rightMouseDown, .otherMouseDown].contains(type) { session.tapGesture = true }
            if [.leftMouseUp, .rightMouseUp, .otherMouseUp].contains(type) { session.tapGesture = false }
            session.tapEventCount += 1
            let sample = type != .mouseMoved || Date().timeIntervalSince(session.lastTapLog) > 0.5
            let cursor = sample ? CGEvent(source: nil)?.location : nil
            let epoch = session.pointerEpoch
            if sample { session.lastTapLog = Date() }
            // Return promptly: AX focus, popup discovery, and logging must not block
            // the WindowServer callback. Copies retain event data until processing.
            DispatchQueue.main.async { [weak session] in
                guard let session, !session.stopped, let nsEvent = NSEvent(cgEvent: copy) else { return }
                guard !session.systemPointerRouting || session.pointerEpoch == epoch else { return }
                if sample {
                    session.log(["event":"tapInput", "type":type.rawValue,
                                 "raw":[copy.location.x,copy.location.y],
                                 "sampledCursor":cursor.map { [$0.x,$0.y] } ?? [],
                                 "rawTargetPID":copy.getIntegerValueField(.eventTargetUnixProcessID),
                                 "rawWindow":copy.getIntegerValueField(.mouseEventWindowUnderMousePointer),
                                 "route":session.systemPointerRouting ? "systemPointerProbe" : (session.annotatedRouting ? "annotatedMouseTap" : "legacySessionTap")])
                }
                session.forward(nsEvent, localOverride: local, screenPointOverride: global, sourcePointOverride: sourcePoint)
            }
            // Do not let AppKit menu tracking also receive the unprojected hardware event.
            return nil
        }, userInfo: Unmanaged.passUnretained(self).toOpaque()),
              let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0) else { return false }
        inputTap = tap; inputTapSource = source
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        log(["event":"mouseTapInstalled", "keyboardIntercepted":false, "location":location.rawValue,
             "customCursor":Self.experimentalMouseTapEnabled && !annotatedRouting])
        return true
    }

    func restoreSystemPointer(at point: CGPoint? = nil) {
        pointerEpoch &+= 1
        if let destination = point ?? virtualPointer {
            _ = CGWarpMouseCursorPosition(destination)
        }
        virtualPointer = nil
        panel.ignoresMouseEvents = false
        virtualCursorLayer.isHidden = true
    }

    func updateNativeCursor(at point: CGPoint) {
        guard Date().timeIntervalSince(lastCursorUpdate) > 1.0/30 else { return }
        lastCursorUpdate = Date()
        let offsets: [CGPoint] = [.zero, CGPoint(x:0,y:21), CGPoint(x:5,y:16), CGPoint(x:9,y:25), CGPoint(x:13,y:23), CGPoint(x:9,y:14), CGPoint(x:17,y:14)]
        let origin = projection.project(point)
        let points = offsets.map { offset -> CGPoint in
            let p = projection.project(CGPoint(x: point.x+offset.x, y: point.y+offset.y))
            return CGPoint(x: p.x-origin.x, y: p.y-origin.y)
        }
        let minX = points.map(\.x).min()! - 2, minY = points.map(\.y).min()! - 2
        let size = NSSize(width: ceil(points.map(\.x).max()!-minX+2), height: ceil(points.map(\.y).max()!-minY+2))
        let image = NSImage(size: size, flipped: true) { _ in
            let path = NSBezierPath()
            for (index, p) in points.enumerated() {
                let q = CGPoint(x: p.x-minX, y: p.y-minY)
                if index == 0 { path.move(to:q) } else { path.line(to:q) }
            }
            path.close(); NSColor.white.setFill(); path.fill()
            NSColor.systemTeal.setStroke(); path.lineWidth = 1.25; path.stroke()
            return true
        }
        NSCursor(image: image, hotSpot: CGPoint(x: -minX, y: -minY)).set()
    }

    func forward(_ event: NSEvent, localOverride: CGPoint? = nil, screenPointOverride: CGPoint? = nil, sourcePointOverride: CGPoint? = nil) {
        guard !stopped, let pid = target.owningApplication?.processID, CGPreflightPostEventAccess() else { return }
        if systemPointerRouting && localOverride == nil { return }
        let local = localOverride ?? view.convert(event.locationInWindow, from: nil)
        let point = sourcePointOverride ?? unprojectCanvasPoint(local)
        let down = [.leftMouseDown, .rightMouseDown, .otherMouseDown].contains(event.type)
        let up = [.leftMouseUp, .rightMouseUp, .otherMouseUp].contains(event.type)
        guard dragging || CGRect(origin: .zero, size: target.frame.size).contains(point) else {
            NSCursor.arrow.set(); return
        }
        if event.type == .scrollWheel && event.modifierFlags.contains(.option) {
            adjust(depth: Double(event.scrollingDeltaY) * 5); return
        }
        if down && event.type == .leftMouseDown && event.modifierFlags.contains(.option) {
            manipulation = event.modifierFlags.contains(.shift) ? .rotate : .move
            gesturePoint = screenPointOverride ?? panel.convertPoint(toScreen: event.locationInWindow)
            gestureOrigin = presentationFrame.origin; gestureYaw = yaw; gesturePitch = pitch
            dragging = true; return
        }
        if let manipulation {
            let position = screenPointOverride ?? panel.convertPoint(toScreen: event.locationInWindow)
            let dx = position.x - gesturePoint.x, dy = position.y - gesturePoint.y
            if manipulation == .move {
                let x = min(movementBounds.maxX-presentationFrame.width, max(movementBounds.minX, gestureOrigin.x + dx))
                let y = min(movementBounds.maxY-presentationFrame.height, max(movementBounds.minY, gestureOrigin.y + dy))
                presentationFrame.origin = CGPoint(x: x, y: y)
                layoutCanvas()
            } else {
                adjust(yaw: gestureYaw + Double(dx) * 0.3 - yaw, pitch: gesturePitch - Double(dy) * 0.3 - pitch)
            }
            if up { self.manipulation = nil; dragging = false }
            return
        }
        let destination = CGPoint(x: target.frame.minX + point.x, y: target.frame.minY + point.y)
        updatePopupWindows(pid: pid)
        let popup = popupWindows.first(where: { $0.1.contains(destination) })?.0
        if down {
            if popupWindows.isEmpty { focusTarget() }
            dragging = true; gestureWindow = popup ?? target.windowID
        }
        let routedWindow = gestureWindow ?? popup ?? target.windowID
        defer { if up { dragging = false; gestureWindow = nil } }
        // Copied AppKit mouse events can retain private source-window coordinates.
        // Create mouse events at the mapped destination; retain scroll phase/momentum
        // through a copy only for scrolling.
        let cg: CGEvent
        if event.type == .scrollWheel {
            guard let copy = event.cgEvent?.copy() else { return }
            cg = copy; cg.location = destination
        } else {
            let type: CGEventType
            switch event.type {
            case .leftMouseDown: type = .leftMouseDown
            case .leftMouseUp: type = .leftMouseUp
            case .leftMouseDragged: type = .leftMouseDragged
            case .rightMouseDown: type = .rightMouseDown
            case .rightMouseUp: type = .rightMouseUp
            case .rightMouseDragged: type = .rightMouseDragged
            case .otherMouseDown: type = .otherMouseDown
            case .otherMouseUp: type = .otherMouseUp
            case .otherMouseDragged: type = .otherMouseDragged
            default: type = .mouseMoved
            }
            let button: CGMouseButton = event.buttonNumber == 1 ? .right : (event.buttonNumber == 0 ? .left : .center)
            guard let mouse = CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: destination, mouseButton: button) else { return }
            cg = mouse
            cg.flags = event.cgEvent?.flags ?? []
            cg.setIntegerValueField(.mouseEventClickState, value: Int64(event.clickCount))
            cg.setIntegerValueField(.mouseEventButtonNumber, value: Int64(event.buttonNumber))
            cg.setDoubleValueField(.mouseEventPressure, value: Double(event.pressure))
        }
        cg.setIntegerValueField(.eventTargetUnixProcessID, value: Int64(pid))
        cg.setIntegerValueField(.mouseEventWindowUnderMousePointer, value: Int64(routedWindow))
        cg.setIntegerValueField(.mouseEventWindowUnderMousePointerThatCanHandleThisEvent, value: Int64(routedWindow))
        // Undocumented routing fields: isolated experimental dependency, not a public API guarantee.
        if let f = CGEventField(rawValue: 51) { cg.setIntegerValueField(f, value: Int64(routedWindow)) }
        if let f = CGEventField(rawValue: 58) { cg.setIntegerValueField(f, value: 1) }
        cg.setIntegerValueField(.eventSourceUserData, value: Self.routedEventTag)
        cg.postToPid(pid)
        let mouseDrag = [.leftMouseDragged, .rightMouseDragged, .otherMouseDragged].contains(event.type)
        if down || (mouseDrag && postedButtons[event.buttonNumber] != nil) {
            postedButtons[event.buttonNumber] = cg.copy()
        }
        if up { postedButtons.removeValue(forKey: event.buttonNumber) }
        // Keep the normal hardware cursor. Custom cursor + intercepted motion failed
        // the real-device hover test; neither is enabled in the usable fallback.
        if Self.experimentalMouseTapEnabled && !annotatedRouting { updateNativeCursor(at: point) }
        let logHover = event.type == .mouseMoved && Date().timeIntervalSince(lastHoverLog) > 0.5
        if logHover { lastHoverLog = Date() }
        if down || up || event.type == .scrollWheel || logHover {
            log(["event":"inputPosted", "type":event.type.rawValue, "local":[point.x,point.y],
                 "destination":[destination.x,destination.y], "window":target.windowID, "routedWindow":routedWindow])
        }
    }

    func stop(_ reason: String) {
        guard !stopped else { return }
        stopped = true
        var released = 0
        if let pid = target.owningApplication?.processID, NSRunningApplication(processIdentifier: pid) != nil {
            for (button, previous) in postedButtons {
                guard let release = previous.copy() else { continue }
                release.type = button == 0 ? .leftMouseUp : (button == 1 ? .rightMouseUp : .otherMouseUp)
                release.setDoubleValueField(.mouseEventPressure, value: 0)
                release.postToPid(pid)
                released += 1
            }
        }
        postedButtons.removeAll()
        tapGesture = false; dragging = false; manipulation = nil
        if let inputTap { CGEvent.tapEnable(tap: inputTap, enable: false); CFMachPortInvalidate(inputTap) }
        if let inputTapSource { CFRunLoopRemoveSource(CFRunLoopGetMain(), inputTapSource, .commonModes) }
        inputTap = nil; inputTapSource = nil
        restoreSystemPointer()
        timer?.invalidate(); monitor?.invalidate()
        panel.orderOut(nil); NSCursor.arrow.set()
        surfaceLayer.contents = nil; latestSurface = nil
        backdropLayer.contents = nil; backdropSurface = nil
        let elapsed = Date().timeIntervalSince(started)
        let sorted = frameAges.sorted()
        log(["event":"stopped", "reason":reason, "seconds":elapsed, "completeFrames":frameCount, "backdropFrames":backdropFrames,
             "releasedButtons":released,
             "deliveredFPS":Double(frameCount)/max(0.001,elapsed),
             "captureDeliveryAgeP50ms": sorted.isEmpty ? -1 : sorted[sorted.count/2],
             "captureDeliveryAgeP95ms": sorted.isEmpty ? -1 : sorted[min(sorted.count-1,Int(Double(sorted.count)*0.95))]])
        let old = stream; stream = nil
        let oldBackdrop = backdropStream; backdropStream = nil
        Task { try? await old?.stopCapture(); try? await oldBackdrop?.stopCapture() }
        ended(reason)
    }
}
