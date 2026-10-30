import Foundation
import AppKit
import ApplicationServices
import Carbon
import Combine

// MARK: - SkyLight / CGS Dynamic Bridge (Observed in Lattix binary)

public struct SpaceInfoSnapshot: Equatable {
    public var currentSpaceID: UInt64
    public var currentSpaceOrdinal: Int
    public var totalRegularSpaces: Int
    public var spaceIDsByOrdinal: [Int: UInt64]
    public var spaceCountsByDisplay: [Int: Int]
}

public final class SkyLightBridge {
    public static let shared = SkyLightBridge()

    private typealias MainConnectionIDFunc = @convention(c) () -> Int32
    private typealias GetActiveSpaceFunc = @convention(c) (Int32) -> UInt64
    private typealias CopyManagedDisplaySpacesFunc = @convention(c) (Int32) -> CFArray?
    private typealias CopySpacesForWindowsFunc = @convention(c) (Int32, Int32, CFArray) -> CFArray?
    private typealias MoveWindowsToManagedSpaceFunc = @convention(c) (Int32, CFArray, UInt64) -> Void

    private var handle: UnsafeMutableRawPointer?
    private var mainConnectionID: MainConnectionIDFunc?
    private var getActiveSpace: GetActiveSpaceFunc?
    private var copyManagedDisplaySpaces: CopyManagedDisplaySpacesFunc?
    private var copySpacesForWindows: CopySpacesForWindowsFunc?
    private var moveWindowsToManagedSpace: MoveWindowsToManagedSpaceFunc?

    private init() {
        let path = "/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight"
        if let h = dlopen(path, RTLD_LAZY) {
            self.handle = h
            if let sym = dlsym(h, "SLSMainConnectionID") ?? dlsym(h, "CGSMainConnectionID") {
                mainConnectionID = unsafeBitCast(sym, to: MainConnectionIDFunc.self)
            }
            if let sym = dlsym(h, "CGSGetActiveSpace") {
                getActiveSpace = unsafeBitCast(sym, to: GetActiveSpaceFunc.self)
            }
            if let sym = dlsym(h, "SLSCopyManagedDisplaySpaces") ?? dlsym(h, "CGSCopyManagedDisplaySpaces") {
                copyManagedDisplaySpaces = unsafeBitCast(sym, to: CopyManagedDisplaySpacesFunc.self)
            }
            if let sym = dlsym(h, "SLSCopySpacesForWindows") {
                copySpacesForWindows = unsafeBitCast(sym, to: CopySpacesForWindowsFunc.self)
            }
            if let sym = dlsym(h, "SLSMoveWindowsToManagedSpace") {
                moveWindowsToManagedSpace = unsafeBitCast(sym, to: MoveWindowsToManagedSpaceFunc.self)
            }
        }
    }

    public func readSpaceSnapshot() -> SpaceInfoSnapshot {
        guard let cidFunc = mainConnectionID,
              let copySpaces = copyManagedDisplaySpaces else {
            return SpaceInfoSnapshot(
                currentSpaceID: 1,
                currentSpaceOrdinal: 1,
                totalRegularSpaces: 1,
                spaceIDsByOrdinal: [1: 1],
                spaceCountsByDisplay: [1: 1]
            )
        }
        let cid = cidFunc()
        guard cid != 0, let displaysArray = copySpaces(cid) as? [[String: Any]] else {
            return SpaceInfoSnapshot(
                currentSpaceID: 1,
                currentSpaceOrdinal: 1,
                totalRegularSpaces: 1,
                spaceIDsByOrdinal: [1: 1],
                spaceCountsByDisplay: [1: 1]
            )
        }

        let activeSpace = getActiveSpace?(cid) ?? 0
        var currentOrdinal = 1
        var totalRegular = 0
        var idsByOrdinal: [Int: UInt64] = [:]
        var countsByDisplay: [Int: Int] = [:]

        for (dIdx, displayDict) in displaysArray.enumerated() {
            let displayNumber = dIdx + 1
            let spaces = displayDict["Spaces"] as? [[String: Any]] ?? []
            var displayRegularCount = 0
            for sp in spaces {
                let typeVal = (sp["type"] as? Int) ?? 0
                // type == 0 is regular user Desktop space
                if typeVal == 0 {
                    totalRegular += 1
                    displayRegularCount += 1
                    let sid = (sp["id64"] as? UInt64) ?? UInt64((sp["ManagedSpaceID"] as? Int) ?? totalRegular)
                    idsByOrdinal[totalRegular] = sid
                    if sid == activeSpace {
                        currentOrdinal = totalRegular
                    }
                }
            }
            countsByDisplay[displayNumber] = max(1, displayRegularCount)
        }

        if totalRegular == 0 {
            totalRegular = 1
            idsByOrdinal[1] = activeSpace
        }

        return SpaceInfoSnapshot(
            currentSpaceID: activeSpace,
            currentSpaceOrdinal: currentOrdinal,
            totalRegularSpaces: totalRegular,
            spaceIDsByOrdinal: idsByOrdinal,
            spaceCountsByDisplay: countsByDisplay
        )
    }

    public func moveWindow(_ windowNumber: Int, toSpaceOrdinal ordinal: Int) -> Bool {
        let snapshot = readSpaceSnapshot()
        guard let targetSpaceID = snapshot.spaceIDsByOrdinal[ordinal],
              let cidFunc = mainConnectionID,
              let moveFunc = moveWindowsToManagedSpace else {
            return false
        }
        let cid = cidFunc()
        guard cid != 0 else { return false }
        let arr = [NSNumber(value: windowNumber)] as CFArray
        moveFunc(cid, arr, targetSpaceID)
        return true
    }
}

// MARK: - Window Manager Service

@MainActor
public final class WindowManagerService: ObservableObject {
    public static let shared = WindowManagerService()
    private let automationQueue = DispatchQueue(label: "com.latcraft.space-automation.applescript", qos: .userInitiated)

    @Published public var axTrusted: Bool = AXIsProcessTrusted()
    @Published public var automationTrusted: Bool = false
    private var permissionTimer: Timer?

    private init() {
        refreshPermissionsNow()
        permissionTimer = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.refreshPermissionsNow()
            }
        }
        NotificationCenter.default.addObserver(
            forName: NSApplication.didBecomeActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.refreshPermissionsNow()
            }
        }
    }

    // MARK: Permissions

    public func refreshPermissionsNow() {
        let currentAX = AXIsProcessTrusted()
        if axTrusted != currentAX {
            axTrusted = currentAX
        }
        refreshSystemEventsPermissionAsync()
    }

    public func isAccessibilityTrusted(promptIfNeeded: Bool = false) -> Bool {
        if promptIfNeeded {
            let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
            let trusted = AXIsProcessTrustedWithOptions(options)
            axTrusted = trusted
            return trusted
        }
        let trusted = AXIsProcessTrusted()
        axTrusted = trusted
        return trusted
    }

    /// Resets stale TCC entries from previous ad-hoc builds so macOS registers the current binary's CDHash.
    public func resetAndPromptAccessibilityPermission() {
        let bundleID = Bundle.main.bundleIdentifier ?? "com.latcraft.app"
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/usr/bin/tccutil")
        proc.arguments = ["reset", "Accessibility", bundleID]
        try? proc.run()
        proc.waitUntilExit()

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            _ = self.isAccessibilityTrusted(promptIfNeeded: true)
            self.openAccessibilitySettings()
        }
    }

    public func resetAndPromptAutomationPermission(completion: @escaping @MainActor (Bool) -> Void) {
        let bundleID = Bundle.main.bundleIdentifier ?? "com.latcraft.app"
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/usr/bin/tccutil")
        proc.arguments = ["reset", "AppleEvents", bundleID]
        try? proc.run()
        proc.waitUntilExit()

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            self.requestSystemEventsAutomationPermission(completion: completion)
        }
    }

    public func checkSystemEventsAutomationPermission(askUserIfNeeded: Bool = false) -> Bool {
        let targetDesc = NSAppleEventDescriptor(bundleIdentifier: "com.apple.systemevents")
        if let aeDesc = targetDesc.aeDesc {
            let status = AEDeterminePermissionToAutomateTarget(
                aeDesc,
                typeWildCard,
                typeWildCard,
                false
            )
            if status == noErr {
                automationTrusted = true
                return true
            }
            if status == OSStatus(errAEEventNotPermitted) {
                automationTrusted = false
            }
        }

        if askUserIfNeeded {
            requestSystemEventsAutomationPermission { _ in }
        }
        return automationTrusted
    }

    /// Runs the actual AppleScript consent query ("tell application \"System Events\" to get count of processes")
    /// on a background queue so macOS TCC launches System Events, displays the native consent dialog,
    /// and registers Latcraft under System Settings -> Privacy & Security -> Automation.
    public func requestSystemEventsAutomationPermission(completion: @escaping @MainActor (Bool) -> Void) {
        NSApp.activate(ignoringOtherApps: true)
        automationQueue.async {
            // 1. Run AppleScript to ensure System Events is launched and receives a real AppleEvent from Latcraft
            var errorDict: NSDictionary?
            let script = NSAppleScript(source: "tell application \"System Events\" to get count of processes")
            let descriptor = script?.executeAndReturnError(&errorDict)
            let scriptSucceeded = (descriptor != nil && errorDict == nil)

            // 2. Also query AEDeterminePermissionToAutomateTarget off the main thread
            var aeGranted = false
            let targetDesc = NSAppleEventDescriptor(bundleIdentifier: "com.apple.systemevents")
            if let aeDesc = targetDesc.aeDesc {
                let status = AEDeterminePermissionToAutomateTarget(
                    aeDesc,
                    typeWildCard,
                    typeWildCard,
                    true
                )
                aeGranted = (status == noErr)
            }

            let granted = scriptSucceeded || aeGranted
            let errorCode = (errorDict?[NSAppleScript.errorNumber] as? Int) ?? 0

            Task { @MainActor in
                self.automationTrusted = granted
                if !granted && errorCode == -1743 {
                    // Permission was previously denied in TCC; Latcraft is now listed in System Settings -> Automation
                    self.openAutomationSettings()
                }
                completion(granted)
            }
        }
    }

    private func refreshSystemEventsPermissionAsync() {
        automationQueue.async {
            let targetDesc = NSAppleEventDescriptor(bundleIdentifier: "com.apple.systemevents")
            guard let aeDesc = targetDesc.aeDesc else { return }
            var status = AEDeterminePermissionToAutomateTarget(
                aeDesc,
                typeWildCard,
                typeWildCard,
                false
            )
            // If System Events.app is not running yet (-600 procNotFound), launch it silently in background
            // so AEDeterminePermissionToAutomateTarget can check TCC without prompting.
            if status == -600 {
                let sysEventsURL = URL(fileURLWithPath: "/System/Library/CoreServices/System Events.app")
                let config = NSWorkspace.OpenConfiguration()
                config.activates = false
                config.addsToRecentItems = false
                config.hides = true
                let sem = DispatchSemaphore(value: 0)
                NSWorkspace.shared.openApplication(at: sysEventsURL, configuration: config) { _, _ in
                    sem.signal()
                }
                _ = sem.wait(timeout: .now() + 1.5)
                status = AEDeterminePermissionToAutomateTarget(
                    aeDesc,
                    typeWildCard,
                    typeWildCard,
                    false
                )
            }
            let isGranted = (status == noErr)
            Task { @MainActor in
                if self.automationTrusted != isGranted {
                    self.automationTrusted = isGranted
                }
            }
        }
    }

    public func openAccessibilitySettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") {
            NSWorkspace.shared.open(url)
        }
    }

    public func openAutomationSettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation") {
            NSWorkspace.shared.open(url)
        }
    }

    // MARK: Capture Current Layout

    public func captureCurrentWorkspaceItems(workspaceName: String) -> (items: [WorkspaceItem], spaceCounts: [Int: Int]) {
        let spaceSnapshot = SkyLightBridge.shared.readSpaceSnapshot()
        let currentSpaceOrdinal = spaceSnapshot.currentSpaceOrdinal

        let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
        guard let windowInfos = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
            return ([], spaceSnapshot.spaceCountsByDisplay)
        }

        let runningAppsByPID: [pid_t: NSRunningApplication] = Dictionary(
            uniqueKeysWithValues: NSWorkspace.shared.runningApplications.map { ($0.processIdentifier, $0) }
        )
        let myPID = ProcessInfo.processInfo.processIdentifier
        let screens = NSScreen.screens

        var capturedItems: [WorkspaceItem] = []
        var seenBundleAndRect = Set<String>()

        for info in windowInfos {
            guard let layer = info[kCGWindowLayer as String] as? Int, layer == 0,
                  let ownerPID = info[kCGWindowOwnerPID as String] as? pid_t,
                  ownerPID != myPID,
                  let app = runningAppsByPID[ownerPID],
                  app.activationPolicy == .regular,
                  let bundleID = app.bundleIdentifier,
                  bundleID != "com.apple.finder" || (info[kCGWindowName as String] as? String)?.isEmpty == false,
                  let boundsDict = info[kCGWindowBounds as String] as? [String: Any],
                  let cgRect = CGRect(dictionaryRepresentation: boundsDict as CFDictionary) else {
                continue
            }

            if cgRect.width < 120 || cgRect.height < 90 {
                continue
            }

            let appName = app.localizedName ?? (info[kCGWindowOwnerName as String] as? String) ?? bundleID
            let windowTitle = info[kCGWindowName as String] as? String

            // Determine which display contains the window center
            let centerPoint = CGPoint(x: cgRect.midX, y: cgRect.midY)
            var matchedDisplayIndex = 1
            var referenceFrame = CGRect(x: 0, y: 0, width: 1440, height: 900)

            if let primaryHeight = screens.first?.frame.height {
                for (idx, screen) in screens.enumerated() {
                    // Convert NSScreen frame (bottom-left origin) to CG coordinates (top-left origin)
                    let cgScreenRect = CGRect(
                        x: screen.frame.origin.x,
                        y: primaryHeight - screen.frame.maxY,
                        width: screen.frame.width,
                        height: screen.frame.height
                    )
                    let cgVisibleRect = CGRect(
                        x: screen.visibleFrame.origin.x,
                        y: primaryHeight - screen.visibleFrame.maxY,
                        width: screen.visibleFrame.width,
                        height: screen.visibleFrame.height
                    )
                    if cgScreenRect.contains(centerPoint) || idx == 0 {
                        matchedDisplayIndex = idx + 1
                        referenceFrame = cgVisibleRect
                        if cgScreenRect.contains(centerPoint) {
                            break
                        }
                    }
                }
            }

            let normX = max(0.0, min(0.95, Double((cgRect.minX - referenceFrame.minX) / max(1, referenceFrame.width))))
            let normY = max(0.0, min(0.95, Double((cgRect.minY - referenceFrame.minY) / max(1, referenceFrame.height))))
            let normW = max(0.1, min(1.0 - normX, Double(cgRect.width / max(1, referenceFrame.width))))
            let normH = max(0.1, min(1.0 - normY, Double(cgRect.height / max(1, referenceFrame.height))))

            let normalized = NormalizedRect(x: normX, y: normY, width: normW, height: normH)
            let preset = WindowLayoutPreset.closestPreset(for: normalized)

            let dedupKey = "\(bundleID)|\(Int(normX * 20))|\(Int(normY * 20))|\(Int(normW * 20))|\(Int(normH * 20))"
            guard !seenBundleAndRect.contains(dedupKey) else { continue }
            seenBundleAndRect.insert(dedupKey)

            let browserType = BrowserType.from(bundleIdentifier: bundleID)
            let terminalType = TerminalType.from(bundleIdentifier: bundleID)

            let kind: WorkspaceItemKind
            if browserType != nil {
                kind = .browser
            } else if terminalType != nil {
                kind = .terminal
            } else {
                kind = .application
            }

            let item = WorkspaceItem(
                name: appName,
                kind: kind,
                bundleIdentifier: bundleID,
                appPath: app.bundleURL?.path,
                windowTitleHint: windowTitle,
                layoutPreset: preset,
                customRect: normalized,
                displayIndex: matchedDisplayIndex,
                spaceIndex: currentSpaceOrdinal,
                browserType: browserType,
                browserProfileDirectory: "Default",
                urls: [],
                terminalType: terminalType,
                terminalCommands: []
            )
            capturedItems.append(item)
        }

        return (capturedItems, spaceSnapshot.spaceCountsByDisplay)
    }

    // MARK: Launch & Restore Workspace

    public func launchAndRestore(workspace: Workspace, onProgress: @escaping (String) -> Void) async -> (restored: Int, launched: Int, warnings: [String]) {
        var restoredCount = 0
        var launchedCount = 0
        var warnings: [String] = []

        let enabledItems = workspace.items.filter(\.isEnabled)
        guard !enabledItems.isEmpty else {
            return (0, 0, ["No enabled items in workspace."])
        }

        onProgress("Preparing workspace…")

        for item in enabledItems {
            onProgress("Opening \(item.name)…")
            let didLaunch = await openItemIfNeeded(item)
            if didLaunch {
                launchedCount += 1
            }
        }

        // Wait briefly for windows to appear
        try? await Task.sleep(nanoseconds: 650_000_000)

        onProgress("Restoring windows…")
        for item in enabledItems {
            let positioned = positionWindows(for: item)
            if positioned {
                restoredCount += 1
            } else if !isAccessibilityTrusted(promptIfNeeded: false) {
                warnings.append("Accessibility permission is required to position \(item.name).")
            }
        }

        return (restoredCount, launchedCount, warnings)
    }

    private func openItemIfNeeded(_ item: WorkspaceItem) async -> Bool {
        switch item.kind {
        case .fileOrFolder:
            if let path = item.filePath, !path.isEmpty {
                let url = URL(fileURLWithPath: (path as NSString).expandingTildeInPath)
                NSWorkspace.shared.open(url)
                return true
            }
            return false

        case .browser:
            let bType = item.browserType ?? BrowserType.from(bundleIdentifier: item.bundleIdentifier) ?? .chrome
            let validURLs = item.urls
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
                .map { urlStr -> String in
                    if urlStr.hasPrefix("http://") || urlStr.hasPrefix("https://") || urlStr.hasPrefix("file://") {
                        return urlStr
                    }
                    return "https://\(urlStr)"
                }

            if bType != .safari,
               let appURL = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bType.bundleIdentifier) {
                var args: [String] = []
                if let profileDir = item.browserProfileDirectory, !profileDir.isEmpty {
                    args.append("--profile-directory=\(profileDir)")
                }
                args.append(contentsOf: validURLs)
                if !args.isEmpty {
                    let config = NSWorkspace.OpenConfiguration()
                    config.arguments = args
                    config.activates = true
                    _ = try? await NSWorkspace.shared.openApplication(at: appURL, configuration: config)
                    return true
                }
            }

            if !validURLs.isEmpty {
                for u in validURLs {
                    if let url = URL(string: u) {
                        NSWorkspace.shared.open(url)
                    }
                }
                return true
            }
            return await launchBundleOrPath(bundleID: item.bundleIdentifier, appPath: item.appPath)

        case .terminal:
            let tType = item.terminalType ?? TerminalType.from(bundleIdentifier: item.bundleIdentifier) ?? .appleTerminal
            let cmds = item.terminalCommands.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
            if !cmds.isEmpty {
                let combined = cmds.joined(separator: " && ")
                runTerminalCommand(combined, terminalType: tType)
                return true
            }
            return await launchBundleOrPath(bundleID: item.bundleIdentifier, appPath: item.appPath)

        case .application:
            return await launchBundleOrPath(bundleID: item.bundleIdentifier, appPath: item.appPath)
        }
    }

    private func launchBundleOrPath(bundleID: String, appPath: String?) async -> Bool {
        if let running = NSWorkspace.shared.runningApplications.first(where: { $0.bundleIdentifier == bundleID }) {
            running.unhide()
            running.activate()
            return false
        }
        if let appURL = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID) {
            let config = NSWorkspace.OpenConfiguration()
            config.activates = true
            _ = try? await NSWorkspace.shared.openApplication(at: appURL, configuration: config)
            return true
        }
        if let path = appPath {
            let url = URL(fileURLWithPath: path)
            let config = NSWorkspace.OpenConfiguration()
            config.activates = true
            _ = try? await NSWorkspace.shared.openApplication(at: url, configuration: config)
            return true
        }
        return false
    }

    public func runTerminalCommand(_ command: String, terminalType: TerminalType) {
        let escaped = command
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
        let scriptSource: String
        switch terminalType {
        case .appleTerminal:
            scriptSource = """
            tell application "Terminal"
                activate
                do script "\(escaped)"
            end tell
            """
        case .iTerm2:
            scriptSource = """
            tell application "iTerm2"
                activate
                tell current window
                    create tab with default profile
                    tell current session of current tab
                        write text "\(escaped)"
                    end tell
                end tell
            end tell
            """
        }
        if let script = NSAppleScript(source: scriptSource) {
            var errorDict: NSDictionary?
            script.executeAndReturnError(&errorDict)
        }
    }

    // MARK: AX Window Positioning

    public func positionWindows(for item: WorkspaceItem) -> Bool {
        guard isAccessibilityTrusted(promptIfNeeded: false) else { return false }
        let apps = NSWorkspace.shared.runningApplications.filter { $0.bundleIdentifier == item.bundleIdentifier }
        guard let app = apps.first else { return false }

        let axApp = AXUIElementCreateApplication(app.processIdentifier)
        var windowsRef: CFTypeRef?
        let result = AXUIElementCopyAttributeValue(axApp, kAXWindowsAttribute as CFString, &windowsRef)
        guard result == .success, let windows = windowsRef as? [AXUIElement], let targetWindow = windows.first else {
            return false
        }

        // Unminimize if minimized
        var minRef: CFTypeRef?
        if AXUIElementCopyAttributeValue(targetWindow, kAXMinimizedAttribute as CFString, &minRef) == .success,
           let isMin = minRef as? Bool, isMin {
            AXUIElementSetAttributeValue(targetWindow, kAXMinimizedAttribute as CFString, kCFBooleanFalse)
        }

        let targetFrame = screenCGFrame(for: item.effectiveRect, displayIndex: item.displayIndex)
        return setAXWindowFrame(targetWindow, frame: targetFrame)
    }

    /// Snap the currently focused frontmost window to any layout preset
    public func snapFocusedWindow(to preset: WindowLayoutPreset) -> Bool {
        guard isAccessibilityTrusted(promptIfNeeded: true) else { return false }
        guard let frontApp = NSWorkspace.shared.frontmostApplication else { return false }

        let axApp = AXUIElementCreateApplication(frontApp.processIdentifier)
        var focusedWindowRef: CFTypeRef?
        var status = AXUIElementCopyAttributeValue(axApp, kAXFocusedWindowAttribute as CFString, &focusedWindowRef)
        if status != .success || focusedWindowRef == nil {
            var windowsRef: CFTypeRef?
            status = AXUIElementCopyAttributeValue(axApp, kAXWindowsAttribute as CFString, &windowsRef)
            if let arr = windowsRef as? [AXUIElement], let first = arr.first {
                focusedWindowRef = first
            }
        }
        guard let windowObj = focusedWindowRef else { return false }
        let axWindow = windowObj as! AXUIElement

        let targetFrame = screenCGFrame(for: preset.normalizedRect, displayIndex: 1)
        return setAXWindowFrame(axWindow, frame: targetFrame)
    }

    private func screenCGFrame(for normalized: NormalizedRect, displayIndex: Int) -> CGRect {
        let screens = NSScreen.screens
        guard !screens.isEmpty else {
            return CGRect(x: 0, y: 25, width: 1440, height: 875)
        }
        let primaryHeight = screens[0].frame.height
        let idx = min(max(0, displayIndex - 1), screens.count - 1)
        let screen = screens[idx]
        let visible = screen.visibleFrame

        // Convert AppKit bottom-left origin to CoreGraphics / AX top-left origin
        let cgOriginX = visible.origin.x
        let cgOriginY = primaryHeight - visible.maxY

        let x = cgOriginX + CGFloat(normalized.x) * visible.width
        let y = cgOriginY + CGFloat(normalized.y) * visible.height
        let w = CGFloat(normalized.width) * visible.width
        let h = CGFloat(normalized.height) * visible.height
        return CGRect(x: x.rounded(), y: y.rounded(), width: w.rounded(), height: h.rounded())
    }

    private func setAXWindowFrame(_ axWindow: AXUIElement, frame: CGRect) -> Bool {
        var pos = CGPoint(x: frame.origin.x, y: frame.origin.y)
        var size = CGSize(width: frame.size.width, height: frame.size.height)

        guard let posVal = AXValueCreate(.cgPoint, &pos),
              let sizeVal = AXValueCreate(.cgSize, &size) else {
            return false
        }

        // Set size -> position -> size for cross-display reliability
        _ = AXUIElementSetAttributeValue(axWindow, kAXSizeAttribute as CFString, sizeVal)
        let posErr = AXUIElementSetAttributeValue(axWindow, kAXPositionAttribute as CFString, posVal)
        let sizeErr = AXUIElementSetAttributeValue(axWindow, kAXSizeAttribute as CFString, sizeVal)
        return posErr == .success || sizeErr == .success
    }

    // MARK: Stop Workspace

    public func stopWorkspace(_ workspace: Workspace) -> Int {
        var affected = 0
        for item in workspace.items where item.isEnabled {
            let apps = NSWorkspace.shared.runningApplications.filter { $0.bundleIdentifier == item.bundleIdentifier }
            for app in apps {
                switch workspace.stopBehavior {
                case .hideApplications:
                    if app.hide() { affected += 1 }
                case .minimizeWindows, .closeWindows:
                    let axApp = AXUIElementCreateApplication(app.processIdentifier)
                    var windowsRef: CFTypeRef?
                    if AXUIElementCopyAttributeValue(axApp, kAXWindowsAttribute as CFString, &windowsRef) == .success,
                       let windows = windowsRef as? [AXUIElement] {
                        for win in windows {
                            if workspace.stopBehavior == .minimizeWindows {
                                if AXUIElementSetAttributeValue(win, kAXMinimizedAttribute as CFString, kCFBooleanTrue) == .success {
                                    affected += 1
                                }
                            } else {
                                var closeBtnRef: CFTypeRef?
                                if AXUIElementCopyAttributeValue(win, kAXCloseButtonAttribute as CFString, &closeBtnRef) == .success,
                                   let closeBtn = closeBtnRef {
                                    if AXUIElementPerformAction(closeBtn as! AXUIElement, kAXPressAction as CFString) == .success {
                                        affected += 1
                                    }
                                }
                            }
                        }
                    } else if app.hide() {
                        affected += 1
                    }
                }
            }
        }
        return affected
    }

    // MARK: Space Hop / Mission Control Switching

    public func switchSpace(directionLeft: Bool) {
        // Post Control + Left Arrow (123) or Control + Right Arrow (124) to switch Desktop Space
        let keyCode: CGKeyCode = directionLeft ? 123 : 124
        guard let src = CGEventSource(stateID: .hidSystemState),
              let keyDown = CGEvent(keyboardEventSource: src, virtualKey: keyCode, keyDown: true),
              let keyUp = CGEvent(keyboardEventSource: src, virtualKey: keyCode, keyDown: false) else {
            return
        }
        keyDown.flags = .maskControl
        keyUp.flags = .maskControl
        keyDown.post(tap: .cghidEventTap)
        keyUp.post(tap: .cghidEventTap)
    }

    public func openMissionControl() {
        let script = NSAppleScript(source: "tell application \"Mission Control\" to launch")
        var err: NSDictionary?
        script?.executeAndReturnError(&err)
    }

    // MARK: Browser Profile Discovery (Observed in Lattix binary)

    public func discoverProfiles(for browser: BrowserType) -> [BrowserProfile] {
        guard let subpath = browser.appSupportSubpath else {
            return [BrowserProfile(directoryName: "Default", displayName: "Default")]
        }
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
        guard let browserDir = appSupport?.appendingPathComponent(subpath),
              let contents = try? FileManager.default.contentsOfDirectory(atPath: browserDir.path) else {
            return [BrowserProfile(directoryName: "Default", displayName: "Default")]
        }

        let matchingDirs = contents.filter { name in
            name == "Default" || name.hasPrefix("Profile ")
        }.sorted()

        if matchingDirs.isEmpty {
            return [BrowserProfile(directoryName: "Default", displayName: "Default")]
        }

        var profiles: [BrowserProfile] = []
        for dir in matchingDirs {
            let prefsURL = browserDir.appendingPathComponent(dir).appendingPathComponent("Preferences")
            var displayName = dir
            if let data = try? Data(contentsOf: prefsURL),
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let profileDict = json["profile"] as? [String: Any],
               let name = profileDict["name"] as? String,
               !name.isEmpty {
                displayName = "\(name) (\(dir))"
            }
            profiles.append(BrowserProfile(directoryName: dir, displayName: displayName))
        }
        return profiles
    }
}
