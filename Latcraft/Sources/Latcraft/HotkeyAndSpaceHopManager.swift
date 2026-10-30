import Foundation
import AppKit
import SwiftUI

@MainActor
public final class HotkeyAndSpaceHopManager {
    public static let shared = HotkeyAndSpaceHopManager()

    private var globalKeyMonitor: Any?
    private var localKeyMonitor: Any?
    private var globalMouseMonitor: Any?
    private var accumulatedMouseDeltaX: CGFloat = 0
    private var lastSpaceHopTimestamp: TimeInterval = 0
    private var hudPanel: NSPanel?
    private var hudDismissWorkItem: DispatchWorkItem?

    private init() {}

    public func startMonitoring() {
        stopMonitoring()

        globalKeyMonitor = NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { [weak self] event in
            Task { @MainActor in
                _ = self?.handleKeyEvent(event)
            }
        }

        localKeyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self = self else { return event }
            if self.handleKeyEvent(event) {
                return nil
            }
            return event
        }

        globalMouseMonitor = NSEvent.addGlobalMonitorForEvents(matching: .mouseMoved) { [weak self] event in
            Task { @MainActor in
                self?.handleMouseMoved(event)
            }
        }
    }

    public func stopMonitoring() {
        if let m = globalKeyMonitor { NSEvent.removeMonitor(m); globalKeyMonitor = nil }
        if let m = localKeyMonitor { NSEvent.removeMonitor(m); localKeyMonitor = nil }
        if let m = globalMouseMonitor { NSEvent.removeMonitor(m); globalMouseMonitor = nil }
    }

    private func handleKeyEvent(_ event: NSEvent) -> Bool {
        let store = WorkspaceStore.shared
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)

        // Check Space Hop with Arrow Keys (123 = Left, 124 = Right)
        if store.spaceHopArrowKeysEnabled && (event.keyCode == 123 || event.keyCode == 124) {
            if matchesSpaceHopModifier(flags, rawModifier: store.spaceHopModifierRaw) {
                let isLeft = (event.keyCode == 123)
                WindowManagerService.shared.switchSpace(directionLeft: isLeft)
                showSpaceSwitcherHUD(directionLeft: isLeft)
                return true
            }
        }

        guard let chars = event.charactersIgnoringModifiers?.uppercased(), !chars.isEmpty else {
            return false
        }

        let combo = ShortcutCombo(
            key: chars,
            command: flags.contains(.command),
            option: flags.contains(.option),
            control: flags.contains(.control),
            shift: flags.contains(.shift)
        )
        guard combo.hasModifier else { return false }

        if let restoreSC = store.restoreActiveShortcut, restoreSC == combo {
            store.restoreActiveWorkspace()
            return true
        }

        if let stopSC = store.stopActiveShortcut, stopSC == combo {
            store.stopActiveWorkspace()
            return true
        }

        for ws in store.workspaces {
            if let sc = ws.hotkey, sc == combo {
                if store.activeWorkspaceID == ws.id {
                    store.launchOrRestoreWorkspace(ws.id)
                } else {
                    store.launchOrRestoreWorkspace(ws.id)
                }
                return true
            }
        }

        return false
    }

    private func handleMouseMoved(_ event: NSEvent) {
        let store = WorkspaceStore.shared
        guard store.spaceHopMouseEnabled else { return }

        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        guard matchesSpaceHopModifier(flags, rawModifier: store.spaceHopModifierRaw) else {
            accumulatedMouseDeltaX = 0
            return
        }

        let now = ProcessInfo.processInfo.systemUptime
        guard now - lastSpaceHopTimestamp > 0.45 else { return }

        accumulatedMouseDeltaX += event.deltaX
        let threshold = CGFloat(max(20.0, 120.0 - store.spaceHopMouseSensitivity))

        if abs(accumulatedMouseDeltaX) >= threshold {
            let directionLeft = accumulatedMouseDeltaX < 0
            accumulatedMouseDeltaX = 0
            lastSpaceHopTimestamp = now
            WindowManagerService.shared.switchSpace(directionLeft: directionLeft)
            showSpaceSwitcherHUD(directionLeft: directionLeft)
        }
    }

    private func matchesSpaceHopModifier(_ flags: NSEvent.ModifierFlags, rawModifier: String) -> Bool {
        let mod = SpaceHopModifier(rawValue: rawModifier) ?? .controlOption
        switch mod {
        case .controlOption:
            return flags.contains([.control, .option]) && !flags.contains(.command)
        case .commandOption:
            return flags.contains([.command, .option]) && !flags.contains(.control)
        case .controlCommand:
            return flags.contains([.control, .command]) && !flags.contains(.option)
        case .commandShift:
            return flags.contains([.command, .shift]) && !flags.contains(.control)
        }
    }

    // MARK: Space Switcher Overlay HUD

    public func showSpaceSwitcherHUD(directionLeft: Bool) {
        let store = WorkspaceStore.shared
        store.refreshSpaceState()
        let nextSpace = directionLeft
            ? max(1, store.currentSpaceOrdinal - 1)
            : min(max(1, store.totalSpacesCount), store.currentSpaceOrdinal + 1)

        let activeWS = store.workspaces.first(where: { $0.id == store.activeWorkspaceID })
        let customSpaceName = activeWS?.spaceNames[nextSpace]
        let title = (customSpaceName?.isEmpty == false) ? customSpaceName! : "Desktop \(nextSpace)"

        if hudPanel == nil {
            let panel = NSPanel(
                contentRect: NSRect(x: 0, y: 0, width: 260, height: 68),
                styleMask: [.borderless, .nonactivatingPanel],
                backing: .buffered,
                defer: false
            )
            panel.isFloatingPanel = true
            panel.level = .statusBar
            panel.backgroundColor = .clear
            panel.isOpaque = false
            panel.hasShadow = true
            panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
            hudPanel = panel
        }

        guard let panel = hudPanel else { return }
        let hudView = NSHostingView(rootView: SpaceSwitcherHUDView(
            title: title,
            subtitle: activeWS?.name ?? "Space Hop",
            directionLeft: directionLeft
        ))
        panel.contentView = hudView

        if let screen = NSScreen.main {
            let x = screen.frame.midX - 130
            let y = screen.frame.minY + 120
            panel.setFrameOrigin(NSPoint(x: x, y: y))
        }

        panel.orderFrontRegardless()
        hudDismissWorkItem?.cancel()
        let work = DispatchWorkItem { [weak self] in
            Task { @MainActor in
                self?.hudPanel?.orderOut(nil)
            }
        }
        hudDismissWorkItem = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.1, execute: work)
    }
}

private struct SpaceSwitcherHUDView: View {
    let title: String
    let subtitle: String
    let directionLeft: Bool

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: directionLeft ? "arrow.left.circle.fill" : "arrow.right.circle.fill")
                .font(.system(size: 24, weight: .semibold))
                .foregroundStyle(.blue)

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 15, weight: .bold, design: .rounded))
                    .foregroundStyle(.primary)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 12)
        .frame(width: 260, height: 68)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(Color.primary.opacity(0.14), lineWidth: 1)
        )
    }
}
