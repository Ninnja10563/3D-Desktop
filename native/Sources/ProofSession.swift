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
    override var isFlipped: Bool { true }
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

    init(target: SCWindow, log: @escaping ([String:Any])->Void, ended: @escaping (String)->Void) {
        self.target = target; self.log = log; self.ended = ended
        projection = Projection(width: target.frame.width, height: target.frame.height, yaw: 25, pitch: -8, depth: 80)
        let primaryHeight = NSScreen.screens.first?.frame.height ?? 0
        let frame = NSRect(x: target.frame.minX, y: primaryHeight-target.frame.maxY, width: target.frame.width, height: target.frame.height)
        panel = ProofPanel(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        view = ProofView(frame: NSRect(origin: .zero, size: frame.size))
        super.init()
        view.session = self; view.wantsLayer = true
        view.layer?.backgroundColor = NSColor(calibratedWhite: 0.06, alpha: 1).cgColor
        surfaceLayer.anchorPoint = .zero
        surfaceLayer.bounds = CGRect(origin: .zero, size: frame.size)
        surfaceLayer.position = .zero
        surfaceLayer.contentsGravity = .resize
        surfaceLayer.transform = projection.layerTransform
        view.layer?.addSublayer(surfaceLayer)
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
        panel.isOpaque = true
        panel.hasShadow = false
        panel.collectionBehavior = [.stationary, .ignoresCycle]
    }

    @MainActor func start() async throws {
        guard AXIsProcessTrusted(), CGPreflightScreenCaptureAccess(), CGPreflightPostEventAccess() else {
            throw NSError(domain: "3DDesktop", code: 1, userInfo: [NSLocalizedDescriptionKey: "Accessibility and Screen Recording permissions are required."])
        }
        let filter = SCContentFilter(desktopIndependentWindow: target)
        let config = SCStreamConfiguration()
        let scale = panel.screen?.backingScaleFactor ?? 2
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
        timer = Timer.scheduledTimer(withTimeInterval: 180, repeats: false) { [weak self] _ in self?.stop("three-minute proof timeout") }
        monitor = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in self?.checkTarget() }
        log(["event":"started", "window":target.windowID, "pid":target.owningApplication?.processID ?? 0,
             "width":config.width, "height":config.height, "fpsLimit":60, "yaw":25, "pitch":-8, "depth":80])
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of outputType: SCStreamOutputType) {
        guard outputType == .screen, sampleBuffer.isValid,
              let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo:Any]],
              let status = attachments.first?[.status] as? Int, status == SCFrameStatus.complete.rawValue,
              let buffer = sampleBuffer.imageBuffer,
              let unmanaged = CVPixelBufferGetIOSurface(buffer) else { return }
        lock.lock()
        if pending { lock.unlock(); return }
        pending = true; lock.unlock()
        let surface = unmanaged.takeUnretainedValue() as IOSurface
        let timestamp = sampleBuffer.presentationTimeStamp.seconds
        let age = CMClockGetTime(CMClockGetHostTimeClock()).seconds - timestamp
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            defer { self.lock.lock(); self.pending = false; self.lock.unlock() }
            guard !self.stopped else { return }
            self.frameCount += 1
            if age.isFinite && age >= 0 && age < 10 { self.frameAges.append(age * 1000) }
            self.latestSurface = surface
            CATransaction.begin(); CATransaction.setDisableActions(true)
            self.surfaceLayer.contents = surface
            CATransaction.commit()
            if !self.panel.isVisible { self.panel.orderFrontRegardless() }
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
        let app = AXUIElementCreateApplication(pid)
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
        panel.orderFrontRegardless()
    }

    func forward(_ event: NSEvent) {
        guard !stopped, let pid = target.owningApplication?.processID, CGPreflightPostEventAccess() else { return }
        let local = view.convert(event.locationInWindow, from: nil)
        let point = projection.unproject(local)
        let down = [.leftMouseDown, .rightMouseDown, .otherMouseDown].contains(event.type)
        let up = [.leftMouseUp, .rightMouseUp, .otherMouseUp].contains(event.type)
        guard dragging || CGRect(origin: .zero, size: target.frame.size).contains(point) else { return }
        if down { focusTarget(); dragging = true }
        defer { if up { dragging = false } }
        // Preserve scroll phase, momentum, pressure, modifiers, click count and button state.
        guard let cg = event.cgEvent?.copy() else { return }
        cg.location = CGPoint(x: target.frame.minX + point.x, y: target.frame.minY + point.y)
        cg.setIntegerValueField(.eventTargetUnixProcessID, value: Int64(pid))
        cg.setIntegerValueField(.mouseEventWindowUnderMousePointer, value: Int64(target.windowID))
        cg.setIntegerValueField(.mouseEventWindowUnderMousePointerThatCanHandleThisEvent, value: Int64(target.windowID))
        // Undocumented routing fields: isolated experimental dependency, not a public API guarantee.
        if let f = CGEventField(rawValue: 51) { cg.setIntegerValueField(f, value: Int64(target.windowID)) }
        if let f = CGEventField(rawValue: 58) { cg.setIntegerValueField(f, value: 1) }
        cg.postToPid(pid)
        if down || up || event.type == .scrollWheel {
            log(["event":"inputPosted", "type":event.type.rawValue, "local":[point.x,point.y], "window":target.windowID])
        }
    }

    func stop(_ reason: String) {
        guard !stopped else { return }
        stopped = true
        timer?.invalidate(); monitor?.invalidate()
        panel.orderOut(nil)
        surfaceLayer.contents = nil; latestSurface = nil
        let elapsed = Date().timeIntervalSince(started)
        let sorted = frameAges.sorted()
        log(["event":"stopped", "reason":reason, "seconds":elapsed, "completeFrames":frameCount,
             "deliveredFPS":Double(frameCount)/max(0.001,elapsed),
             "captureDeliveryAgeP50ms": sorted.isEmpty ? -1 : sorted[sorted.count/2],
             "captureDeliveryAgeP95ms": sorted.isEmpty ? -1 : sorted[min(sorted.count-1,Int(Double(sorted.count)*0.95))]])
        let old = stream; stream = nil
        Task { try? await old?.stopCapture() }
        ended(reason)
    }
}
