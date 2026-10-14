import AppKit
import QuartzCore

private final class DiagnosticCursorPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }

    // Keep the hotspot exact at screen edges; clipping the arrow is preferable
    // to AppKit shifting the window away from the requested pointer position.
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect {
        frameRect
    }
}

private final class DiagnosticCursorView: NSView {
    override var isFlipped: Bool { true }
}

/// A visual diagnostic marker, independent of the compositor's window level.
/// Call on the main thread. This class never changes or hides the system cursor.
/// Screen capture must exclude the utility application, including this panel.
final class DiagnosticCursorOverlay {
    private let panel: DiagnosticCursorPanel
    private let arrowLayer = CAShapeLayer()
    private static let size = CGSize(width: 28, height: 34)
    private static let hotspot = CGPoint(x: 3, y: 3)
    private var closed = false

    init() {
        let frame = NSRect(origin: .zero, size: DiagnosticCursorOverlay.size)
        panel = DiagnosticCursorPanel(contentRect: frame,
                                      styleMask: [.borderless, .nonactivatingPanel],
                                      backing: .buffered, defer: false)
        let view = DiagnosticCursorView(frame: frame)
        view.wantsLayer = true
        view.layer?.backgroundColor = NSColor.clear.cgColor
        view.setAccessibilityElement(false)

        let path = CGMutablePath()
        let points = [CGPoint.zero, CGPoint(x: 0, y: 22), CGPoint(x: 6, y: 16),
                      CGPoint(x: 10, y: 25), CGPoint(x: 14, y: 23),
                      CGPoint(x: 10, y: 14), CGPoint(x: 18, y: 14)]
        for (index, point) in points.enumerated() {
            let padded = CGPoint(x: point.x + Self.hotspot.x, y: point.y + Self.hotspot.y)
            if index == 0 { path.move(to: padded) } else { path.addLine(to: padded) }
        }
        path.closeSubpath()
        arrowLayer.frame = view.bounds
        arrowLayer.path = path
        arrowLayer.fillColor = NSColor.systemTeal.cgColor
        arrowLayer.strokeColor = NSColor.white.cgColor
        arrowLayer.lineWidth = 1.5
        view.layer?.addSublayer(arrowLayer)

        panel.contentView = view
        panel.title = "3D Desktop diagnostic cursor"
        panel.setAccessibilityElement(false)
        panel.isReleasedWhenClosed = false
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.ignoresMouseEvents = true
        panel.acceptsMouseMovedEvents = false
        panel.hidesOnDeactivate = false
        panel.isExcludedFromWindowsMenu = true
        // Raise only the small marker, never the composited application surface.
        // Actual menu ordering still requires a live test on the target OS.
        panel.level = NSWindow.Level(rawValue: NSWindow.Level.popUpMenu.rawValue + 1)
        panel.collectionBehavior = [.transient, .ignoresCycle]
    }

    /// Position the arrow tip at a global Quartz point (top-left origin).
    func show(at point: CGPoint, primaryHeight: CGFloat) {
        guard !closed else { return }
        guard point.x.isFinite, point.y.isFinite, primaryHeight.isFinite else {
            hide()
            return
        }
        let origin = CGPoint(x: point.x - Self.hotspot.x,
                             y: primaryHeight - point.y - Self.size.height + Self.hotspot.y)
        guard origin.x.isFinite, origin.y.isFinite else {
            hide()
            return
        }
        panel.setFrameOrigin(origin)
        arrowLayer.contentsScale = panel.screen?.backingScaleFactor ?? 2
        if !panel.isVisible { panel.orderFrontRegardless() }
    }

    func hide() {
        panel.orderOut(nil)
    }

    /// Remove the diagnostic window during restoration or a failed proof start.
    func cleanup() {
        guard !closed else { return }
        closed = true
        hide()
        panel.close()
    }
}
