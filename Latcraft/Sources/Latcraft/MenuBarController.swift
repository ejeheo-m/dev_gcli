import Foundation
import AppKit
import Combine

@MainActor
public final class MenuBarController: NSObject {
    public static let shared = MenuBarController()

    private var statusItem: NSStatusItem?
    private var cancellables = Set<AnyCancellable>()
    public var onOpenMainWindow: (() -> Void)?
    public var onOpenSettings: (() -> Void)?
    public var onOpenOnboarding: (() -> Void)?

    private override init() {
        super.init()
    }

    public func setupStatusBar() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = item.button {
            let img = NSImage(systemSymbolName: "rectangle.3.group.fill", accessibilityDescription: "Latcraft")
            img?.isTemplate = true
            button.image = img
            button.toolTip = "Latcraft — Workspace & Window Layout Manager"
        }
        self.statusItem = item
        rebuildMenu()

        let store = WorkspaceStore.shared
        store.$workspaces
            .combineLatest(store.$activeWorkspaceID, store.$currentSpaceOrdinal)
            .receive(on: RunLoop.main)
            .sink { [weak self] _, _, _ in
                self?.rebuildMenu()
            }
            .store(in: &cancellables)
    }

    public func rebuildMenu() {
        let store = WorkspaceStore.shared
        let menu = NSMenu()

        // Header item: Space & Active Workspace status
        let spaceText = "Desktop \(store.currentSpaceOrdinal) of \(store.totalSpacesCount)"
        let activeWS = store.workspaces.first(where: { $0.id == store.activeWorkspaceID })
        let headerTitle = activeWS != nil ? "Active: \(activeWS!.name) (\(spaceText))" : "Latcraft • \(spaceText)"
        let headerItem = NSMenuItem(title: headerTitle, action: nil, keyEquivalent: "")
        headerItem.isEnabled = false
        menu.addItem(headerItem)
        menu.addItem(.separator())

        // Save Current Layout in one click
        let saveItem = NSMenuItem(
            title: "Save Current Layout as Workspace…",
            action: #selector(saveAllSpacesLayout),
            keyEquivalent: "s"
        )
        saveItem.keyEquivalentModifierMask = [.command, .shift]
        saveItem.target = self
        saveItem.image = NSImage(systemSymbolName: "plus.Viewfinder", accessibilityDescription: nil) ?? NSImage(systemSymbolName: "plus.square.on.square", accessibilityDescription: nil)
        menu.addItem(saveItem)

        menu.addItem(.separator())

        // Workspaces list
        let wsHeader = NSMenuItem(title: "Workspaces", action: nil, keyEquivalent: "")
        wsHeader.isEnabled = false
        menu.addItem(wsHeader)

        if store.workspaces.isEmpty {
            let emptyItem = NSMenuItem(title: "No workspaces found", action: nil, keyEquivalent: "")
            emptyItem.isEnabled = false
            menu.addItem(emptyItem)
        } else {
            for ws in store.workspaces {
                let wsItem = NSMenuItem(
                    title: ws.name,
                    action: #selector(handleWorkspaceClick(_:)),
                    keyEquivalent: ""
                )
                wsItem.target = self
                wsItem.representedObject = ws.id
                let symbolName = (store.activeWorkspaceID == ws.id) ? "checkmark.circle.fill" : ws.iconName
                wsItem.image = NSImage(systemSymbolName: symbolName, accessibilityDescription: ws.name)

                // Submenu for Restore / Update Layout / Stop
                let sub = NSMenu(title: ws.name)

                let launchSub = NSMenuItem(title: "Launch & Restore Workspace", action: #selector(restoreWorkspace(_:)), keyEquivalent: "")
                launchSub.target = self
                launchSub.representedObject = ws.id
                launchSub.image = NSImage(systemSymbolName: "play.circle.fill", accessibilityDescription: nil)
                sub.addItem(launchSub)

                let updateSub = NSMenuItem(title: "Update Layout from Open Windows", action: #selector(updateWorkspaceLayout(_:)), keyEquivalent: "")
                updateSub.target = self
                updateSub.representedObject = ws.id
                updateSub.image = NSImage(systemSymbolName: "arrow.clockwise.circle.fill", accessibilityDescription: nil)
                sub.addItem(updateSub)

                let stopSub = NSMenuItem(title: "Stop Workspace (\(ws.stopBehavior.rawValue))", action: #selector(stopWorkspace(_:)), keyEquivalent: "")
                stopSub.target = self
                stopSub.representedObject = ws.id
                stopSub.image = NSImage(systemSymbolName: "stop.circle.fill", accessibilityDescription: nil)
                sub.addItem(stopSub)

                wsItem.submenu = sub
                menu.addItem(wsItem)
            }
        }

        menu.addItem(.separator())

        // Quick Snap Focused Window Submenu
        let snapMenu = NSMenu(title: "Snap Focused Window")
        let snapItem = NSMenuItem(title: "Snap Focused Window", action: nil, keyEquivalent: "")
        snapItem.image = NSImage(systemSymbolName: "uiwindow.split.2x1", accessibilityDescription: nil)
        for preset in WindowLayoutPreset.allCases where preset != .custom {
            let pItem = NSMenuItem(title: preset.rawValue, action: #selector(snapWindowAction(_:)), keyEquivalent: "")
            pItem.target = self
            pItem.representedObject = preset.rawValue
            pItem.image = NSImage(systemSymbolName: preset.systemImage, accessibilityDescription: nil)
            snapMenu.addItem(pItem)
        }
        snapItem.submenu = snapMenu
        menu.addItem(snapItem)

        menu.addItem(.separator())

        let openAppItem = NSMenuItem(title: "Open Latcraft Editor…", action: #selector(openMainApp), keyEquivalent: "o")
        openAppItem.target = self
        openAppItem.image = NSImage(systemSymbolName: "macwindow", accessibilityDescription: nil)
        menu.addItem(openAppItem)

        let settingsItem = NSMenuItem(title: "Settings…", action: #selector(openSettings), keyEquivalent: ",")
        settingsItem.target = self
        settingsItem.image = NSImage(systemSymbolName: "gearshape", accessibilityDescription: nil)
        menu.addItem(settingsItem)

        let aboutItem = NSMenuItem(title: "About Latcraft", action: #selector(showAbout), keyEquivalent: "")
        aboutItem.target = self
        menu.addItem(aboutItem)

        menu.addItem(.separator())

        let quitItem = NSMenuItem(title: "Quit Latcraft", action: #selector(quitApp), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)

        statusItem?.menu = menu
    }

    // MARK: Objc Selectors matching Lattix binary

    @objc public func handleWorkspaceClick(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? UUID else { return }
        WorkspaceStore.shared.launchOrRestoreWorkspace(id)
    }

    @objc public func restoreWorkspace(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? UUID else { return }
        WorkspaceStore.shared.launchOrRestoreWorkspace(id)
    }

    @objc public func updateWorkspaceLayout(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? UUID else { return }
        WorkspaceStore.shared.updateWorkspaceLayoutFromCurrentWindows(id)
    }

    @objc public func stopWorkspace(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? UUID else { return }
        WorkspaceStore.shared.stopWorkspace(id)
    }

    @objc public func saveAllSpacesLayout() {
        WorkspaceStore.shared.captureNewWorkspaceFromCurrentLayout()
        openMainApp()
    }

    @objc public func snapWindowAction(_ sender: NSMenuItem) {
        guard let raw = sender.representedObject as? String,
              let preset = WindowLayoutPreset(rawValue: raw) else { return }
        _ = WindowManagerService.shared.snapFocusedWindow(to: preset)
    }

    @objc public func openMainApp() {
        NSApp.activate(ignoringOtherApps: true)
        onOpenMainWindow?()
    }

    @objc public func openSettings() {
        NSApp.activate(ignoringOtherApps: true)
        onOpenSettings?()
    }

    @objc public func showAbout() {
        NSApp.activate(ignoringOtherApps: true)
        NSApp.orderFrontStandardAboutPanel(options: [
            .applicationName: "Latcraft",
            .applicationVersion: "2.1.0",
            .credits: NSAttributedString(
                string: "Save your apps, windows across Spaces, and displays as one workspace. Bring it all back in a click."
            )
        ])
    }

    @objc public func quitApp() {
        NSApp.terminate(nil)
    }
}
