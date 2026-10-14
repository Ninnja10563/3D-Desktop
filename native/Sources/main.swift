import AppKit
import ApplicationServices
import ScreenCaptureKit
import Carbon

final class AppDelegate: NSObject, NSApplicationDelegate {
    var status: NSStatusItem!
    var window: NSWindow!
    var information: NSTextField!
    var picker: NSPopUpButton!
    var routeToggle: NSButton!
    var pointerToggle: NSButton!
    var candidates: [SCWindow] = []
    var session: ProofSession?
    var hotkey: EventHotKeyRef?
    var eventHandler: EventHandlerRef?
    var observers: [NSObjectProtocol] = []
    var signals: [DispatchSourceSignal] = []
    var logFile: FileHandle?
    var starting = false
    var startGeneration: UInt64 = 0

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        let logs = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("3D Desktop Native Experiments", isDirectory: true)
        try? FileManager.default.createDirectory(at: logs, withIntermediateDirectories: true)
        let path = logs.appendingPathComponent("latest.jsonl")
        FileManager.default.createFile(atPath: path.path, contents: nil)
        logFile = try? FileHandle(forWritingTo: path)
        log(["event":"launch", "os":ProcessInfo.processInfo.operatingSystemVersionString, "version":"0.1.0-experimental"])
        status = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        status.button?.title = "3D"
        let menu = NSMenu()
        menu.addItem(withTitle: "3D Desktop — Experimental Proof", action: #selector(showControls), keyEquivalent: "")
        menu.addItem(withTitle: "Restore Desktop Now", action: #selector(restore), keyEquivalent: "")
        menu.addItem(NSMenuItem.separator())
        for (index, title) in ["Tilt left", "Tilt right", "Tilt up", "Tilt down", "Nearer", "Farther", "Reset view"].enumerated() {
            let item = NSMenuItem(title: title, action: #selector(adjustView(_:)), keyEquivalent: "")
            item.tag = index; menu.addItem(item)
        }
        menu.addItem(NSMenuItem.separator())
        menu.addItem(withTitle: "Quit 3D Desktop", action: #selector(quit), keyEquivalent: "q")
        for item in menu.items { item.target = self }
        status.menu = menu
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        let handlerResult = InstallEventHandler(GetApplicationEventTarget(), { _, _, context in
            guard let context else { return OSStatus(eventNotHandledErr) }
            Unmanaged<AppDelegate>.fromOpaque(context).takeUnretainedValue().stopProof(reason: "emergency shortcut")
            return noErr
        }, 1, &spec, Unmanaged.passUnretained(self).toOpaque(), &eventHandler)
        let result = RegisterEventHotKey(UInt32(kVK_ANSI_0), UInt32(controlKey | optionKey | cmdKey),
                                        EventHotKeyID(signature: 0x33444450, id: 1), GetApplicationEventTarget(), 0, &hotkey)
        if handlerResult != noErr || result != noErr {
            if let hotkey { UnregisterEventHotKey(hotkey) }; hotkey = nil
        }
        log(["event":"emergencyShortcut", "result":result, "handlerResult":handlerResult])
        buildControls()
        for name in [NSWorkspace.activeSpaceDidChangeNotification, NSWorkspace.willSleepNotification] {
            observers.append(NSWorkspace.shared.notificationCenter.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in self?.stopProof(reason: name == NSWorkspace.willSleepNotification ? "system sleep" : "Space changed") })
        }
        observers.append(NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object:nil, queue:.main) { [weak self] _ in self?.stopProof(reason: "display configuration changed") })
        for sig in [SIGTERM, SIGINT] {
            signal(sig, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: sig, queue: .main)
            source.setEventHandler { [weak self] in self?.quit() }
            source.resume(); signals.append(source)
        }
        showControls()
        if let i = CommandLine.arguments.firstIndex(of:"--proof-bundle-id"), CommandLine.arguments.indices.contains(i+1) {
            let bundleID = CommandLine.arguments[i+1]
            Task { @MainActor in
                guard let targetApp = NSRunningApplication.runningApplications(withBundleIdentifier:bundleID).first else { return }
                targetApp.activate(options: [.activateAllWindows])
                try? await Task.sleep(nanoseconds: 800_000_000)
                await discover()
                if let index = candidates.firstIndex(where: { $0.owningApplication?.bundleIdentifier == bundleID }) {
                    picker.selectItem(at:index)
                    startProof()
                }
            }
        }
    }
    func log(_ item: [String:Any]) {
        var record = item; record["timestamp"] = ISO8601DateFormatter().string(from: Date())
        if let data = try? JSONSerialization.data(withJSONObject: record, options: [.sortedKeys]),
           var line = String(data: data, encoding: .utf8) {
            line += "\n"; logFile?.write(line.data(using:.utf8)!)
        }
    }
    func buildControls() {
        window = NSWindow(contentRect: NSRect(x:250,y:250,width:650,height:455), styleMask:[.titled,.closable], backing:.buffered, defer:false)
        window.title = "3D Desktop — Experimental Proof"
        window.collectionBehavior = [.moveToActiveSpace]
        window.isReleasedWhenClosed = false
        let stack = NSStackView(); stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        window.contentView!.addSubview(stack)
        NSLayoutConstraint.activate([stack.leadingAnchor.constraint(equalTo:window.contentView!.leadingAnchor,constant:22),
                                     stack.trailingAnchor.constraint(equalTo:window.contentView!.trailingAnchor,constant:-22),
                                     stack.topAnchor.constraint(equalTo:window.contentView!.topAnchor,constant:20)])
        let text = NSTextField(wrappingLabelWithString:"Experimental native compositor proof, not a finished window manager.\nChoose a disposable window. Perspective stays active during interaction.\nOption-drag: move · Option–Shift-drag: tilt · Option-scroll: depth.\nRestore: Control–Option–Command–0. Auto-stop after 3 minutes.")
        stack.addArrangedSubview(text)
        information = NSTextField(wrappingLabelWithString: "")
        stack.addArrangedSubview(information)
        let permissions = NSStackView(); permissions.orientation = .horizontal
        for (name, action) in [("Request Accessibility", #selector(requestAccessibility)), ("Request Screen Recording", #selector(requestCapture)), ("Refresh", #selector(refresh))] {
            permissions.addArrangedSubview(NSButton(title:name,target:self,action:action))
        }
        stack.addArrangedSubview(permissions)
        picker = NSPopUpButton(); picker.addItem(withTitle:"Grant permissions, then Refresh")
        stack.addArrangedSubview(picker)
        routeToggle = NSButton(checkboxWithTitle: "Test late mouse routing (experimental; normal cursor)", target: nil, action: nil)
        stack.addArrangedSubview(routeToggle)
        pointerToggle = NSButton(checkboxWithTitle: "Test system-pointer mapping (30 seconds; two visible cursors)", target: nil, action: nil)
        stack.addArrangedSubview(pointerToggle)
        let actions = NSStackView()
        actions.addArrangedSubview(NSButton(title:"Start Interaction Proof",target:self,action:#selector(startProof)))
        actions.addArrangedSubview(NSButton(title:"Restore Desktop",target:self,action:#selector(restore)))
        stack.addArrangedSubview(actions)
        stack.addArrangedSubview(NSTextField(wrappingLabelWithString:"Original windows remain untouched. Live desktop patch replaces dark surround. No audio or network.\nCaptured window and desktop patch remain in memory. Local log records pointer coordinates, never keystrokes."))
        updatePermissions()
    }
    func updatePermissions() {
        information.stringValue = "Accessibility: \(AXIsProcessTrusted() ? "allowed" : "needed") · Screen Recording: \(CGPreflightScreenCaptureAccess() ? "allowed" : "needed") · Emergency shortcut: \(hotkey != nil ? "ready" : "FAILED — proof disabled")"
    }
    @objc func showControls() { updatePermissions(); window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps:true) }
    @objc func requestAccessibility() {
        _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String:true] as CFDictionary)
        updatePermissions()
    }
    @objc func requestCapture() { _ = CGRequestScreenCaptureAccess(); updatePermissions() }
    @objc func refresh() {
        updatePermissions()
        guard CGPreflightScreenCaptureAccess() else { return }
        Task { @MainActor in await discover() }
    }
    @MainActor func discover() async {
            do {
                let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly:false)
                candidates = content.windows.filter { $0.windowLayer == 0 && $0.frame.width > 150 && $0.frame.height > 100 && $0.owningApplication?.processID != getpid() }
                picker.removeAllItems()
                for candidate in candidates { picker.addItem(withTitle:"\(candidate.owningApplication?.applicationName ?? "App") — \(candidate.title ?? "Window") [\(candidate.windowID)]") }
                if let index = candidates.firstIndex(where: { $0.owningApplication?.bundleIdentifier == "com.apple.TextEdit" && !($0.title ?? "").isEmpty }) { picker.selectItem(at:index) }
                if candidates.isEmpty { picker.addItem(withTitle:"No eligible windows on current Space") }
            } catch { information.stringValue = error.localizedDescription }
    }
    @objc func startProof() {
        guard hotkey != nil, !starting, candidates.indices.contains(picker.indexOfSelectedItem), AXIsProcessTrusted(), CGPreflightScreenCaptureAccess() else { updatePermissions(); return }
        restore()
        let target = candidates[picker.indexOfSelectedItem]
        let proof = ProofSession(target:target, annotatedRouting:routeToggle.state == .on, systemPointerRouting:pointerToggle.state == .on,
                                 log:{ [weak self] in self?.log($0) }, ended:{ [weak self] reason in self?.information.stringValue = "Restored: \(reason)" })
        starting = true
        let generation = startGeneration
        Task { @MainActor in
            defer { if startGeneration == generation { starting = false } }
            // Let any Space/focus transition settle before adding overlays or a tap.
            // The emergency action invalidates this pending start as well.
            proof.focusTarget()
            try? await Task.sleep(nanoseconds: 350_000_000)
            guard startGeneration == generation else { return }
            session = proof
            do { try await proof.start(); if !proof.stopped { window.orderOut(nil) } }
            catch { proof.stop(error.localizedDescription); showControls(); information.stringValue = error.localizedDescription }
        }
    }
    @objc func adjustView(_ sender: NSMenuItem) {
        guard let session, !session.stopped else { return }
        switch sender.tag {
        case 0: session.adjust(yaw: -5)
        case 1: session.adjust(yaw: 5)
        case 2: session.adjust(pitch: -5)
        case 3: session.adjust(pitch: 5)
        case 4: session.adjust(depth: -50)
        case 5: session.adjust(depth: 50)
        default:
            session.resetView()
        }
    }
    func stopProof(reason: String) { startGeneration &+= 1; starting = false; session?.stop(reason); session = nil }
    @objc func restore() { stopProof(reason: "restore control") }
    @objc func quit() { stopProof(reason: "utility quit or termination signal"); NSApp.terminate(nil) }
    func applicationWillTerminate(_ notification: Notification) { restore(); if let hotkey { UnregisterEventHotKey(hotkey) }; try? logFile?.close() }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { showControls(); return true }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
