import SwiftUI
import AppKit

@main
struct LatcraftApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @StateObject private var store = WorkspaceStore.shared

    var body: some Scene {
        WindowGroup("Latcraft", id: "main") {
            MainWorkspaceView(store: store)
                .frame(minWidth: 920, minHeight: 600)
                .onOpenURL { url in
                    store.handleURL(url)
                }
        }
        .commands {
            CommandGroup(after: .newItem) {
                Button("New Workspace") {
                    _ = store.createEmptyWorkspace()
                }
                .keyboardShortcut("n", modifiers: [.command])

                Button("Save Current Layout as Workspace") {
                    store.captureNewWorkspaceFromCurrentLayout()
                }
                .keyboardShortcut("s", modifiers: [.command, .shift])

                Divider()

                Button("Restore Active Workspace") {
                    store.restoreActiveWorkspace()
                }
                .keyboardShortcut("r", modifiers: [.command, .shift])

                Button("Stop Active Workspace") {
                    store.stopActiveWorkspace()
                }
                .keyboardShortcut(".", modifiers: [.command, .shift])
            }
        }

        Settings {
            SettingsView()
        }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var settingsWindow: NSWindow?

    func applicationDidFinishLaunching(_ notification: Notification) {
        WorkspaceStore.shared.applyDockVisibility()

        MenuBarController.shared.setupStatusBar()
        MenuBarController.shared.onOpenMainWindow = {
            NSApp.activate(ignoringOtherApps: true)
            for window in NSApp.windows where window.title.contains("Latcraft") || window.contentView != nil {
                if window.canBecomeMain {
                    window.makeKeyAndOrderFront(nil)
                    return
                }
            }
        }
        MenuBarController.shared.onOpenSettings = { [weak self] in
            self?.openSettingsWindow()
        }

        HotkeyAndSpaceHopManager.shared.startMonitoring()
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls {
            WorkspaceStore.shared.handleURL(url)
        }
    }

    private func openSettingsWindow() {
        if let win = settingsWindow {
            win.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            return
        }
        let win = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 540, height: 520),
            styleMask: [.titled, .closable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        win.title = "Latcraft Settings"
        win.center()
        win.contentView = NSHostingView(rootView: SettingsView())
        win.isReleasedWhenClosed = false
        self.settingsWindow = win
        win.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
}
