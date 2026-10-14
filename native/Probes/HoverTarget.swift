import AppKit
import CoreGraphics

// A separate, ordinary application for diagnosing compositor input mapping.
// It never captures the screen, posts input, or requests permissions.
private final class EventLog {
    private var file: FileHandle?

    init() {
        do {
            let directory = FileManager.default.urls(for: .applicationSupportDirectory,
                                                       in: .userDomainMask)[0]
                .appendingPathComponent("3D Desktop Native Experiments", isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let url = directory.appendingPathComponent("hover-target.jsonl")
            // Each diagnostic run starts a new log. No typed text is recorded.
            try Data().write(to: url, options: .atomic)
            file = try FileHandle(forWritingTo: url)
            write(["type": "launch", "pid": ProcessInfo.processInfo.processIdentifier,
                   "coordinateConventions": "AppKit window: bottom-left; local view: top-left; CG global: top-left"])
        } catch {
            FileHandle.standardError.write(Data("Hover target log unavailable: \(error)\n".utf8))
        }
    }

    func write(_ fields: [String: Any]) {
        var record = fields
        record["timestamp"] = Date().timeIntervalSince1970
        guard let bytes = try? JSONSerialization.data(withJSONObject: record, options: .sortedKeys) else { return }
        do {
            try file?.write(contentsOf: bytes + Data([0x0a]))
        } catch {
            file = nil
        }
    }

    deinit { try? file?.close() }
}

private final class HoverView: NSView {
    private let log = EventLog()
    private let names = ["A — TOP LEFT", "B — TOP RIGHT", "C — BOTTOM LEFT", "D — BOTTOM RIGHT"]
    private let colors: [NSColor] = [
        NSColor(calibratedRed: 0.20, green: 0.43, blue: 0.70, alpha: 1),
        NSColor(calibratedRed: 0.47, green: 0.30, blue: 0.66, alpha: 1),
        NSColor(calibratedRed: 0.16, green: 0.47, blue: 0.38, alpha: 1),
        NSColor(calibratedRed: 0.65, green: 0.32, blue: 0.18, alpha: 1)
    ]
    private var ownedTrackingAreas: [NSTrackingArea] = []
    private var clicks = [0, 0, 0, 0]
    private var enters = [0, 0, 0, 0]
    private var exits = [0, 0, 0, 0]
    private var moves = [0, 0, 0, 0]
    private var enteredRegion: Int?
    private var eventRegion: Int?
    private var systemRegion: Int?
    private var lastLocalPoint: NSPoint?
    private var sequence = 0
    private var readout = [
        "Move pointer into a colored area. Click to increment its counter.",
        "Event window: —   local: —",
        "CG global: —   system window: —",
        "Event area: —   system area: —   tracking enter: —"
    ]
    private let resetButton = NSButton(title: "Reset counters", target: nil, action: nil)

    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { true }
    override var mouseDownCanMoveWindow: Bool { false }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        resetButton.target = self
        resetButton.action = #selector(resetCounters)
        resetButton.bezelStyle = .rounded
        resetButton.setAccessibilityIdentifier("hover-target-reset")
        addSubview(resetButton)
        setAccessibilityRole(.group)
        setAccessibilityLabel("Pointer coordinate diagnostic with four colored target areas")
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func layout() {
        super.layout()
        resetButton.frame = NSRect(x: bounds.width - 150, y: bounds.height - 40,
                                  width: 134, height: 28)
    }

    private var regions: [NSRect] {
        let gap: CGFloat = 14
        let width = (bounds.width - 32 - gap) / 2
        let height = (bounds.height - 210 - gap) / 2
        return [
            NSRect(x: 16, y: 160, width: width, height: height),
            NSRect(x: 16 + width + gap, y: 160, width: width, height: height),
            NSRect(x: 16, y: 160 + height + gap, width: width, height: height),
            NSRect(x: 16 + width + gap, y: 160 + height + gap, width: width, height: height)
        ]
    }

    override func updateTrackingAreas() {
        for area in ownedTrackingAreas { removeTrackingArea(area) }
        ownedTrackingAreas.removeAll()
        super.updateTrackingAreas()
        let wholeView = NSTrackingArea(rect: bounds,
                                      options: [.mouseMoved, .mouseEnteredAndExited, .activeAlways, .inVisibleRect],
                                      owner: self, userInfo: nil)
        addTrackingArea(wholeView)
        ownedTrackingAreas.append(wholeView)
        for (index, rect) in regions.enumerated() {
            let area = NSTrackingArea(rect: rect, options: [.mouseEnteredAndExited, .activeAlways],
                                      owner: self, userInfo: ["region": index])
            addTrackingArea(area)
            ownedTrackingAreas.append(area)
        }
    }

    private func region(at point: NSPoint) -> Int? { regions.firstIndex { $0.contains(point) } }
    private func name(_ index: Int?) -> String { index.map { String("ABCD"[String.Index(utf16Offset: $0, in: "ABCD")]) } ?? "outside" }
    private func xy(_ point: NSPoint) -> String { String(format: "(%.1f, %.1f)", point.x, point.y) }
    private func coordinates(_ point: NSPoint) -> [String: Double] { ["x": point.x, "y": point.y] }

    private func record(_ event: NSEvent, handler: String) {
        sequence += 1
        let local = convert(event.locationInWindow, from: nil)
        let nativeWindow = window?.mouseLocationOutsideOfEventStream ?? .zero
        let nativeLocal = convert(nativeWindow, from: nil)
        eventRegion = region(at: local)
        systemRegion = region(at: nativeLocal)
        lastLocalPoint = local
        let cgPoint = event.cgEvent?.location
        readout = [
            "#\(sequence) \(handler)",
            "Event window: \(xy(event.locationInWindow))   local: \(xy(local))",
            "CG global: \(cgPoint.map(xy) ?? "unavailable")   system window: \(xy(nativeWindow))",
            "Event area: \(name(eventRegion))   system area: \(name(systemRegion))   tracking enter: \(name(enteredRegion))"
        ]
        var fields: [String: Any] = [
            "type": handler, "sequence": sequence,
            "eventWindow": coordinates(event.locationInWindow),
            "eventLocal": coordinates(local), "systemWindow": coordinates(nativeWindow),
            "systemLocal": coordinates(nativeLocal),
            "eventRegion": name(eventRegion), "systemRegion": name(systemRegion),
            "trackingRegion": name(enteredRegion),
            "clicks": clicks, "enters": enters, "exits": exits, "moves": moves
        ]
        if let cgPoint { fields["cgGlobal"] = coordinates(cgPoint) }
        log.write(fields)
        setAccessibilityValue(readout.joined(separator: ". "))
        needsDisplay = true
    }

    override func mouseEntered(with event: NSEvent) {
        if let index = event.trackingArea?.userInfo?["region"] as? Int {
            enteredRegion = index
            enters[index] += 1
        }
        record(event, handler: "mouseEntered")
    }

    override func mouseExited(with event: NSEvent) {
        if let index = event.trackingArea?.userInfo?["region"] as? Int {
            exits[index] += 1
            if enteredRegion == index { enteredRegion = nil }
        } else {
            enteredRegion = nil
        }
        record(event, handler: "mouseExited")
    }

    override func mouseMoved(with event: NSEvent) {
        if let index = region(at: convert(event.locationInWindow, from: nil)) { moves[index] += 1 }
        record(event, handler: "mouseMoved")
    }

    override func mouseDown(with event: NSEvent) {
        if let index = region(at: convert(event.locationInWindow, from: nil)) { clicks[index] += 1 }
        record(event, handler: "mouseDown")
    }

    override func mouseUp(with event: NSEvent) { record(event, handler: "mouseUp") }
    override func mouseDragged(with event: NSEvent) { record(event, handler: "mouseDragged") }
    override func scrollWheel(with event: NSEvent) { record(event, handler: "scrollWheel") }

    @objc private func resetCounters() {
        clicks = [0, 0, 0, 0]
        enters = [0, 0, 0, 0]
        exits = [0, 0, 0, 0]
        moves = [0, 0, 0, 0]
        log.write(["type": "resetCounters"])
        needsDisplay = true
    }

    private func text(_ value: String, at point: NSPoint, font: NSFont, color: NSColor = .white) {
        (value as NSString).draw(at: point, withAttributes: [.font: font, .foregroundColor: color])
    }

    override func draw(_ dirtyRect: NSRect) {
        NSColor(calibratedWhite: 0.10, alpha: 1).setFill()
        bounds.fill()
        text("3D Desktop — Hover Target", at: NSPoint(x: 16, y: 13), font: .boldSystemFont(ofSize: 20))
        text("Yellow border = tracking enter. White dot = received event position.",
             at: NSPoint(x: 16, y: 43), font: .systemFont(ofSize: 12))
        let mono = NSFont.monospacedSystemFont(ofSize: 11, weight: .regular)
        for (index, line) in readout.enumerated() {
            text(line, at: NSPoint(x: 16, y: 70 + CGFloat(index) * 19), font: mono)
        }
        for (index, rect) in regions.enumerated() {
            colors[index].setFill()
            NSBezierPath(roundedRect: rect, xRadius: 8, yRadius: 8).fill()
            if enteredRegion == index {
                NSColor.yellow.setStroke()
                let border = NSBezierPath(roundedRect: rect.insetBy(dx: 3, dy: 3), xRadius: 6, yRadius: 6)
                border.lineWidth = 5
                border.stroke()
            }
            text(names[index], at: NSPoint(x: rect.minX + 14, y: rect.minY + 14), font: .boldSystemFont(ofSize: 17))
            text("Clicks: \(clicks[index])   Moves: \(moves[index])",
                 at: NSPoint(x: rect.minX + 14, y: rect.minY + 44), font: .monospacedSystemFont(ofSize: 14, weight: .medium))
            text("Entered: \(enters[index])   Exited: \(exits[index])",
                 at: NSPoint(x: rect.minX + 14, y: rect.minY + 68), font: mono)
        }
        if let point = lastLocalPoint, region(at: point) != nil {
            NSColor.white.setFill()
            NSBezierPath(ovalIn: NSRect(x: point.x - 4, y: point.y - 4, width: 8, height: 8)).fill()
        }
        text("Coordinate log only. No screen/input permissions required.",
             at: NSPoint(x: 16, y: bounds.height - 29), font: .systemFont(ofSize: 11))
    }
}

private final class HoverTargetDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 640, height: 450),
                              styleMask: [.titled, .closable, .miniaturizable],
                              backing: .buffered, defer: false)
        window.title = "3D Desktop Hover Target"
        window.isReleasedWhenClosed = false
        window.acceptsMouseMovedEvents = true
        window.contentView = HoverView(frame: NSRect(x: 0, y: 0, width: 640, height: 450))
        window.center()
        window.makeKeyAndOrderFront(nil)
        window.makeFirstResponder(window.contentView)
        self.window = window

        let menu = NSMenu()
        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Quit 3D Desktop Hover Target", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        menu.addItem(appItem)
        NSApp.mainMenu = menu
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

@main
private enum HoverTargetMain {
    static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.regular)
        let delegate = HoverTargetDelegate()
        app.delegate = delegate
        withExtendedLifetime(delegate) { app.run() }
    }
}
