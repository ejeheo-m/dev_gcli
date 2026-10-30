import Foundation
import AppKit
import SwiftUI
import ServiceManagement

@MainActor
public final class WorkspaceStore: ObservableObject {
    public static let shared = WorkspaceStore()

    @Published public var workspaces: [Workspace] = [] {
        didSet { saveWorkspaces() }
    }
    @Published public var selectedWorkspaceID: UUID? {
        didSet {
            if let id = selectedWorkspaceID {
                UserDefaults.standard.set(id.uuidString, forKey: "selectedWorkspaceId")
            }
        }
    }
    @Published public var activeWorkspaceID: UUID? {
        didSet {
            UserDefaults.standard.set(activeWorkspaceID?.uuidString, forKey: "activeWorkspaceId")
        }
    }

    // Status / Toast banner
    @Published public var statusMessage: String?
    @Published public var isBusy: Bool = false
    @Published public var currentSpaceOrdinal: Int = 1
    @Published public var totalSpacesCount: Int = 1

    // Settings (matching Lattix UserDefaults keys discovered via REA)
    @AppStorage("showInDock") public var showInDock: Bool = true {
        didSet { applyDockVisibility() }
    }
    @AppStorage("launchAtLogin") public var launchAtLogin: Bool = false {
        didSet { updateLaunchAtLogin() }
    }
    @AppStorage("spaceHopArrowKeysEnabled") public var spaceHopArrowKeysEnabled: Bool = true
    @AppStorage("spaceHopMouseEnabled") public var spaceHopMouseEnabled: Bool = false
    @AppStorage("spaceHopModifier") public var spaceHopModifierRaw: String = SpaceHopModifier.controlOption.rawValue
    @AppStorage("spaceHopMouseSensitivity") public var spaceHopMouseSensitivity: Double = 60.0
    @AppStorage("com.latcraft.onboarding.completedVersion") public var onboardingCompletedVersion: String = ""

    @Published public var restoreActiveShortcut: ShortcutCombo? = ShortcutCombo(key: "R", command: true, option: true, control: true, shift: false) {
        didSet { saveGlobalShortcuts() }
    }
    @Published public var stopActiveShortcut: ShortcutCombo? = ShortcutCombo(key: "S", command: true, option: true, control: true, shift: false) {
        didSet { saveGlobalShortcuts() }
    }

    public var diagnosticLogs: [String] = []

    private let storageURL: URL
    private var spaceObserver: NSObjectProtocol?

    private init() {
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let dir = appSupport.appendingPathComponent("com.latcraft.app", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        self.storageURL = dir.appendingPathComponent("workspaces.json")

        loadWorkspaces()
        loadGlobalShortcuts()
        refreshSpaceState()

        if let savedSel = UserDefaults.standard.string(forKey: "selectedWorkspaceId"),
           let uuid = UUID(uuidString: savedSel),
           workspaces.contains(where: { $0.id == uuid }) {
            selectedWorkspaceID = uuid
        } else {
            selectedWorkspaceID = workspaces.first?.id
        }

        if let savedAct = UserDefaults.standard.string(forKey: "activeWorkspaceId"),
           let uuid = UUID(uuidString: savedAct),
           workspaces.contains(where: { $0.id == uuid }) {
            activeWorkspaceID = uuid
        }

        spaceObserver = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.activeSpaceDidChangeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.refreshSpaceState()
            }
        }

        log("Latcraft initialized with \(workspaces.count) workspaces.")
    }

    public func log(_ message: String) {
        let formatter = ISO8601DateFormatter()
        let line = "[\(formatter.string(from: Date()))] \(message)"
        diagnosticLogs.append(line)
        if diagnosticLogs.count > 500 {
            diagnosticLogs.removeFirst(diagnosticLogs.count - 500)
        }
    }

    public func showBanner(_ text: String, duration: TimeInterval = 3.0) {
        statusMessage = text
        log(text)
        Task {
            try? await Task.sleep(nanoseconds: UInt64(duration * 1_000_000_000))
            if self.statusMessage == text {
                self.statusMessage = nil
            }
        }
    }

    public func refreshSpaceState() {
        let snap = SkyLightBridge.shared.readSpaceSnapshot()
        currentSpaceOrdinal = snap.currentSpaceOrdinal
        totalSpacesCount = snap.totalRegularSpaces
    }

    // MARK: Persistence

    private func loadWorkspaces() {
        if let data = try? Data(contentsOf: storageURL),
           let decoded = try? JSONDecoder().decode([Workspace].self, from: data),
           !decoded.isEmpty {
            self.workspaces = decoded
            return
        }

        // Default starter workspaces
        let codingWorkspace = Workspace(
            name: "Coding & Dev",
            iconName: "hammer.fill",
            accentColorName: "blue",
            items: [
                WorkspaceItem(
                    name: "Terminal",
                    kind: .terminal,
                    bundleIdentifier: "com.apple.Terminal",
                    layoutPreset: .leftThird,
                    displayIndex: 1,
                    spaceIndex: 1,
                    terminalType: .appleTerminal,
                    terminalCommands: ["echo 'Workspace Ready'"]
                ),
                WorkspaceItem(
                    name: "Safari",
                    kind: .browser,
                    bundleIdentifier: "com.apple.Safari",
                    layoutPreset: .rightTwoThirds,
                    displayIndex: 1,
                    spaceIndex: 1,
                    browserType: .safari,
                    urls: ["https://developer.apple.com", "https://github.com"]
                )
            ],
            hotkey: ShortcutCombo(key: "1", command: true, option: true),
            stopBehavior: .minimizeWindows
        )

        let focusWriting = Workspace(
            name: "Research & Notes",
            iconName: "book.pages.fill",
            accentColorName: "purple",
            items: [
                WorkspaceItem(
                    name: "Notes",
                    kind: .application,
                    bundleIdentifier: "com.apple.Notes",
                    layoutPreset: .leftHalf,
                    displayIndex: 1,
                    spaceIndex: 1
                ),
                WorkspaceItem(
                    name: "Safari",
                    kind: .browser,
                    bundleIdentifier: "com.apple.Safari",
                    layoutPreset: .rightHalf,
                    displayIndex: 1,
                    spaceIndex: 1,
                    browserType: .safari,
                    urls: ["https://news.ycombinator.com"]
                )
            ],
            hotkey: ShortcutCombo(key: "2", command: true, option: true),
            stopBehavior: .minimizeWindows
        )

        self.workspaces = [codingWorkspace, focusWriting]
    }

    private func saveWorkspaces() {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        if let data = try? encoder.encode(workspaces) {
            try? data.write(to: storageURL, options: .atomic)
        }
    }

    private func loadGlobalShortcuts() {
        if let data = UserDefaults.standard.data(forKey: "restoreActiveWorkspace"),
           let sc = try? JSONDecoder().decode(ShortcutCombo.self, from: data) {
            restoreActiveShortcut = sc
        }
        if let data = UserDefaults.standard.data(forKey: "stopActiveWorkspace"),
           let sc = try? JSONDecoder().decode(ShortcutCombo.self, from: data) {
            stopActiveShortcut = sc
        }
    }

    private func saveGlobalShortcuts() {
        if let sc = restoreActiveShortcut, let data = try? JSONEncoder().encode(sc) {
            UserDefaults.standard.set(data, forKey: "restoreActiveWorkspace")
        }
        if let sc = stopActiveShortcut, let data = try? JSONEncoder().encode(sc) {
            UserDefaults.standard.set(data, forKey: "stopActiveWorkspace")
        }
    }

    // MARK: Workspace CRUD & Operations

    public func createEmptyWorkspace(name: String = "New Workspace") -> Workspace {
        let ws = Workspace(name: name, iconName: "rectangle.3.group", accentColorName: "blue")
        workspaces.append(ws)
        selectedWorkspaceID = ws.id
        showBanner("Created workspace \"\(ws.name)\"")
        return ws
    }

    public func captureNewWorkspaceFromCurrentLayout(customName: String? = nil) {
        let result = WindowManagerService.shared.captureCurrentWorkspaceItems(workspaceName: customName ?? "Captured Layout")
        guard !result.items.isEmpty else {
            showBanner("No active windows were found across Spaces.")
            return
        }
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        let name = customName ?? "Saved Layout (\(formatter.string(from: Date())))"
        let ws = Workspace(
            name: name,
            iconName: "macwindow.on.rectangle",
            accentColorName: "teal",
            items: result.items,
            capturedSpaceCountsByScreen: result.spaceCounts
        )
        workspaces.append(ws)
        selectedWorkspaceID = ws.id
        activeWorkspaceID = ws.id
        showBanner("Captured \(result.items.count) windows into \"\(ws.name)\"")
    }

    public func updateWorkspaceLayoutFromCurrentWindows(_ workspaceID: UUID) {
        guard let idx = workspaces.firstIndex(where: { $0.id == workspaceID }) else { return }
        let result = WindowManagerService.shared.captureCurrentWorkspaceItems(workspaceName: workspaces[idx].name)
        guard !result.items.isEmpty else {
            showBanner("No active windows were found across Spaces. The saved layout was not changed.")
            return
        }
        workspaces[idx].items = result.items
        workspaces[idx].capturedSpaceCountsByScreen = result.spaceCounts
        workspaces[idx].updatedAt = Date()
        showBanner("Updated layout for \"\(workspaces[idx].name)\" (\(result.items.count) windows)")
    }

    public func deleteWorkspace(_ id: UUID) {
        guard let idx = workspaces.firstIndex(where: { $0.id == id }) else { return }
        let name = workspaces[idx].name
        workspaces.remove(at: idx)
        if selectedWorkspaceID == id {
            selectedWorkspaceID = workspaces.first?.id
        }
        if activeWorkspaceID == id {
            activeWorkspaceID = nil
        }
        showBanner("Deleted workspace \"\(name)\"")
    }

    public func launchOrRestoreWorkspace(_ id: UUID) {
        guard !isBusy else {
            showBanner("Another workspace operation is in progress. Try again when it finishes.")
            return
        }
        guard let ws = workspaces.first(where: { $0.id == id }) else {
            showBanner("The workspace could not be found.")
            return
        }
        isBusy = true
        activeWorkspaceID = ws.id

        Task {
            let outcome = await WindowManagerService.shared.launchAndRestore(workspace: ws) { [weak self] progress in
                Task { @MainActor in
                    self?.statusMessage = progress
                }
            }
            self.isBusy = false
            if let firstWarning = outcome.warnings.first {
                self.showBanner("Launched \(ws.name): \(firstWarning)", duration: 4.5)
            } else {
                self.showBanner("Restored \"\(ws.name)\" (\(outcome.restored) windows positioned, \(outcome.launched) launched)")
            }
        }
    }

    public func stopWorkspace(_ id: UUID) {
        guard let ws = workspaces.first(where: { $0.id == id }) else { return }
        statusMessage = "Stopping workspace…"
        let count = WindowManagerService.shared.stopWorkspace(ws)
        if activeWorkspaceID == id {
            activeWorkspaceID = nil
        }
        showBanner("Stopped \"\(ws.name)\" (\(count) windows affected)")
    }

    public func restoreActiveWorkspace() {
        if let id = activeWorkspaceID ?? selectedWorkspaceID ?? workspaces.first?.id {
            launchOrRestoreWorkspace(id)
        }
    }

    public func stopActiveWorkspace() {
        if let id = activeWorkspaceID ?? selectedWorkspaceID {
            stopWorkspace(id)
        }
    }

    // MARK: URL Scheme Handler (latcraft://)

    public func handleURL(_ url: URL) {
        let scheme = url.scheme?.lowercased() ?? ""
        guard scheme == "latcraft" || scheme == "lattix" else { return }
        let host = url.host?.lowercased() ?? ""
        let comps = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let nameParam = comps?.queryItems?.first(where: { $0.name == "name" || $0.name == "workspace" })?.value
        let idParam = comps?.queryItems?.first(where: { $0.name == "id" })?.value

        let targetWorkspace: Workspace? = {
            if let idStr = idParam, let uuid = UUID(uuidString: idStr) {
                return workspaces.first(where: { $0.id == uuid })
            }
            if let name = nameParam {
                return workspaces.first(where: { $0.name.caseInsensitiveCompare(name) == .orderedSame })
            }
            return nil
        }()

        switch host {
        case "launch", "restore", "open", "start":
            if let ws = targetWorkspace {
                launchOrRestoreWorkspace(ws.id)
            } else {
                restoreActiveWorkspace()
            }
        case "stop", "close":
            if let ws = targetWorkspace {
                stopWorkspace(ws.id)
            } else {
                stopActiveWorkspace()
            }
        case "capture", "save":
            captureNewWorkspaceFromCurrentLayout(customName: nameParam)
        default:
            break
        }
    }

    // MARK: Dock & Login Item Settings

    public func applyDockVisibility() {
        let policy: NSApplication.ActivationPolicy = showInDock ? .regular : .accessory
        NSApp?.setActivationPolicy(policy)
        if showInDock {
            NSApp?.activate(ignoringOtherApps: true)
        }
    }

    private func updateLaunchAtLogin() {
        do {
            if launchAtLogin {
                try SMAppService.mainApp.register()
            } else {
                try SMAppService.mainApp.unregister()
            }
        } catch {
            log("Launch at login update failed: \(error.localizedDescription)")
        }
    }

    // MARK: Diagnostic Log Report (Observed in Lattix binary)

    public func exportDiagnosticReport() {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "2.1.0"
        let header = """
        Latcraft Diagnostic Report
        Latcraft version: \(version)
        Generated: \(ISO8601DateFormatter().string(from: Date()))
        Accessibility Trusted: \(WindowManagerService.shared.isAccessibilityTrusted())
        System Events Automation: \(WindowManagerService.shared.checkSystemEventsAutomationPermission())
        Spaces Detected: \(totalSpacesCount) (Current: Desktop \(currentSpaceOrdinal))
        Workspaces Count: \(workspaces.count)
        ----------------------------------------
        """
        let body = diagnosticLogs.isEmpty
            ? "No Latcraft log entries were available for this period."
            : diagnosticLogs.joined(separator: "\n")

        let report = header + "\n" + body

        let panel = NSSavePanel()
        panel.title = "Save Latcraft Diagnostic Logs"
        panel.nameFieldStringValue = "Latcraft-Diagnostics-\(Int(Date().timeIntervalSince1970)).txt"
        panel.allowedContentTypes = [.plainText]
        if panel.runModal() == .OK, let url = panel.url {
            try? report.write(to: url, atomically: true, encoding: .utf8)
            showBanner("Saved diagnostic report to \(url.lastPathComponent)")
        }
    }
}
