import SwiftUI
import AppKit

// MARK: - Onboarding View (Observed in Lattix binary & Assets.car)

public struct OnboardingView: View {
    @Binding var isPresented: Bool
    @ObservedObject private var store = WorkspaceStore.shared
    @ObservedObject private var wm = WindowManagerService.shared
    @ViewState private var currentStep: Int = 0

    public init(isPresented: Binding<Bool>) {
        self._isPresented = isPresented
    }

    public var body: some View {
        VStack(spacing: 0) {
            // Step content
            Group {
                switch currentStep {
                case 0:
                    welcomeStep
                case 1:
                    permissionsStep
                case 2:
                    preferencesStep
                default:
                    firstWorkspaceStep
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(28)

            Divider()

            // Footer Navigation
            HStack {
                HStack(spacing: 6) {
                    ForEach(0..<4, id: \.self) { step in
                        Capsule()
                            .fill(step == currentStep ? Color.accentColor : Color.primary.opacity(0.18))
                            .frame(width: step == currentStep ? 22 : 8, height: 8)
                    }
                }

                Spacer()

                if currentStep > 0 {
                    Button("Back") {
                        withAnimation { currentStep -= 1 }
                    }
                }

                if currentStep < 3 {
                    Button("Continue") {
                        refreshPermissions()
                        withAnimation { currentStep += 1 }
                    }
                    .buttonStyle(.borderedProminent)
                } else {
                    Button("Get Started") {
                        store.onboardingCompletedVersion = "2.1.0"
                        isPresented = false
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 16)
            .background(Color.primary.opacity(0.03))
        }
        .frame(width: 620, height: 460)
        .onAppear {
            refreshPermissions()
        }
    }

    private func refreshPermissions() {
        wm.refreshPermissionsNow()
    }

    // Step 0: Welcome
    private var welcomeStep: some View {
        VStack(spacing: 18) {
            Spacer()
            ZStack {
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .fill(LinearGradient(colors: [.blue, .indigo], startPoint: .topLeading, endPoint: .bottomTrailing))
                    .frame(width: 84, height: 84)
                    .shadow(color: .blue.opacity(0.35), radius: 14, y: 6)
                Image(systemName: "rectangle.3.group.fill")
                    .font(.system(size: 38, weight: .bold))
                    .foregroundStyle(.white)
            }

            Text("Welcome to Latcraft")
                .font(.largeTitle.bold())

            Text("Save your apps, windows across Spaces, and displays as one workspace. Bring it all back in a click.")
                .font(.title3)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 480)

            HStack(spacing: 18) {
                featureBadge(icon: "plus.square.on.square", title: "1-Click Capture", subtitle: "Save open windows across Spaces")
                featureBadge(icon: "uiwindow.split.2x1", title: "Smart Tiling", subtitle: "Halves, Thirds, Quarters & Sixths")
                featureBadge(icon: "globe", title: "Browsers & Terminals", subtitle: "Profiles, URLs & startup scripts")
            }
            .padding(.top, 8)
            Spacer()
        }
    }

    private func featureBadge(icon: String, title: String, subtitle: String) -> some View {
        VStack(spacing: 6) {
            Image(systemName: icon)
                .font(.title2)
                .foregroundStyle(.blue)
            Text(title)
                .font(.subheadline.weight(.semibold))
            Text(subtitle)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(12)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 12))
    }

    // Step 1: Permissions
    private var permissionsStep: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Give Latcraft access.")
                .font(.title.bold())
            Text("Latcraft needs two macOS permissions to capture and restore a complete workspace. Both permissions are required to capture and restore complete workspaces. You can revoke them later in System Settings.")
                .font(.subheadline)
                .foregroundStyle(.secondary)

            VStack(spacing: 12) {
                permissionRow(
                    icon: "hand.raised.fill",
                    title: "Accessibility Permission",
                    subtitle: "Capture and position application windows, and use workspace hotkeys.",
                    isGranted: wm.axTrusted,
                    actionTitle: "Grant Accessibility"
                ) {
                    if wm.axTrusted {
                        wm.openAccessibilitySettings()
                    } else {
                        // Reset any stale ad-hoc CDHash entry from earlier builds and prompt cleanly
                        wm.resetAndPromptAccessibilityPermission()
                    }
                }

                permissionRow(
                    icon: "gearshape.2.fill",
                    title: "Automation (System Events)",
                    subtitle: "Create and restore Desktop Spaces through Mission Control, and automate Terminal/iTerm2.",
                    isGranted: wm.automationTrusted,
                    actionTitle: "Grant Automation"
                ) {
                    if wm.automationTrusted {
                        wm.openAutomationSettings()
                    } else {
                        wm.requestSystemEventsAutomationPermission { granted in
                            if !granted {
                                wm.resetAndPromptAutomationPermission { _ in }
                            }
                        }
                    }
                }
            }

            HStack(spacing: 16) {
                Button("Refresh Permission Status") {
                    refreshPermissions()
                }
                .buttonStyle(.link)

                if !wm.axTrusted || !wm.automationTrusted {
                    Button("Reset Stale Build Permissions (권한 재동기화)") {
                        if !wm.axTrusted {
                            wm.resetAndPromptAccessibilityPermission()
                        }
                        if !wm.automationTrusted {
                            wm.resetAndPromptAutomationPermission { _ in }
                        }
                    }
                    .buttonStyle(.link)
                }
            }
            Spacer()
        }
    }

    private func permissionRow(icon: String, title: String, subtitle: String, isGranted: Bool, actionTitle: String, action: @escaping () -> Void) -> some View {
        HStack(spacing: 14) {
            Image(systemName: icon)
                .font(.title2)
                .foregroundStyle(isGranted ? .green : .blue)
                .frame(width: 38, height: 38)
                .background((isGranted ? Color.green : Color.blue).opacity(0.14), in: RoundedRectangle(cornerRadius: 10))

            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(title)
                        .font(.headline)
                    if isGranted {
                        Label("Granted", systemImage: "checkmark.circle.fill")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.green)
                    }
                }
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            Button(isGranted ? "Open Settings" : actionTitle, action: action)
                .buttonStyle(.bordered)
        }
        .padding(14)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 12))
    }

    // Step 2: Make Latcraft yours
    private var preferencesStep: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Make Latcraft yours.")
                .font(.title.bold())
            Text("Choose how Latcraft should stay available after setup. You can change these choices anytime in Settings.")
                .font(.subheadline)
                .foregroundStyle(.secondary)

            VStack(spacing: 12) {
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Launch at Login")
                            .font(.headline)
                        Text("Keep workspaces available from the menu bar after you sign in.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Toggle("", isOn: $store.launchAtLogin)
                        .toggleStyle(.switch)
                }
                .padding(14)
                .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 12))

                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Show Latcraft in the Dock")
                            .font(.headline)
                        Text("Leave this off for a menu-bar-first experience.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Toggle("", isOn: $store.showInDock)
                        .toggleStyle(.switch)
                }
                .padding(14)
                .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 12))

                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Space Hop with Shortcut + Arrow Keys")
                            .font(.headline)
                        Text("Hold \(store.spaceHopModifierRaw) + Left/Right Arrow keys to hop between Desktop Spaces.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Toggle("", isOn: $store.spaceHopArrowKeysEnabled)
                        .toggleStyle(.switch)
                }
                .padding(14)
                .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 12))
            }
            Spacer()
        }
    }

    // Step 3: Create your first workspace
    private var firstWorkspaceStep: some View {
        VStack(spacing: 18) {
            Spacer()
            Image(systemName: "macwindow.on.rectangle")
                .font(.system(size: 44))
                .foregroundStyle(.teal)

            Text("Create your first workspace.")
                .font(.title.bold())

            Text("Start with the windows you already have open, or build a workspace from scratch. Once you have your own workspace, you can restore it from the menu bar, the workspace editor, or with its assigned hotkey.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 480)

            HStack(spacing: 16) {
                Button {
                    store.captureNewWorkspaceFromCurrentLayout()
                    store.onboardingCompletedVersion = "2.1.0"
                    isPresented = false
                } label: {
                    VStack(spacing: 6) {
                        Image(systemName: "plus.square.on.square")
                            .font(.title2)
                        Text("Save your current layout")
                            .font(.headline)
                        Text("Captures open windows in 1 click")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .frame(width: 210, height: 100)
                }
                .buttonStyle(.borderedProminent)

                Button {
                    store.onboardingCompletedVersion = "2.1.0"
                    isPresented = false
                } label: {
                    VStack(spacing: 6) {
                        Image(systemName: "slider.horizontal.3")
                            .font(.title2)
                        Text("Build it in the editor")
                            .font(.headline)
                        Text("Add apps, layouts, URLs & scripts")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .frame(width: 210, height: 100)
                }
                .buttonStyle(.bordered)
            }
            Spacer()
        }
    }
}

// MARK: - Settings View (Observed in Lattix binary)

public struct SettingsView: View {
    @ObservedObject var store = WorkspaceStore.shared
    @ObservedObject var wm = WindowManagerService.shared
    @ViewState private var showOnboarding = false

    public var body: some View {
        Form {
            Section("General") {
                Toggle(isOn: $store.launchAtLogin) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Launch at Login")
                        Text("Keep workspaces available from the menu bar after you sign in.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                Toggle(isOn: $store.showInDock) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Show Latcraft in the Dock")
                        Text("Leave this off for a menu-bar-first experience.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            Section("Global Workspace Shortcuts") {
                LabeledContent("Restore active workspace") {
                    ShortcutRecorderView(title: "Shortcut", shortcut: $store.restoreActiveShortcut)
                }
                LabeledContent("Stop active workspace") {
                    ShortcutRecorderView(title: "Shortcut", shortcut: $store.stopActiveShortcut)
                }
                Text("Restore or stop the current active workspace from anywhere. Set a hotkey for any specific workspace from Workspace Settings.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section("Space Hop (Quick Desktop Space Switching)") {
                Picker("Modifier Keys", selection: $store.spaceHopModifierRaw) {
                    ForEach(SpaceHopModifier.allCases) { mod in
                        Text(mod.rawValue).tag(mod.rawValue)
                    }
                }

                Toggle("Enable Modifier + Arrow Keys to hop between spaces", isOn: $store.spaceHopArrowKeysEnabled)
                Toggle("Enable Modifier + Mouse drag to hop between spaces", isOn: $store.spaceHopMouseEnabled)

                if store.spaceHopMouseEnabled {
                    LabeledContent("Mouse Sensitivity") {
                        Slider(value: $store.spaceHopMouseSensitivity, in: 20...100, step: 5)
                            .frame(width: 180)
                    }
                }
            }

            Section("Permissions") {
                LabeledContent("Accessibility") {
                    HStack {
                        Image(systemName: wm.axTrusted ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                            .foregroundStyle(wm.axTrusted ? .green : .orange)
                        Text(wm.axTrusted ? "Granted" : "Required")
                        Button(wm.axTrusted ? "Open Settings…" : "Grant / Reset…") {
                            if wm.axTrusted {
                                wm.openAccessibilitySettings()
                            } else {
                                wm.resetAndPromptAccessibilityPermission()
                            }
                        }
                    }
                }

                LabeledContent("Automation (System Events)") {
                    HStack {
                        Image(systemName: wm.automationTrusted ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                            .foregroundStyle(wm.automationTrusted ? .green : .orange)
                        Text(wm.automationTrusted ? "Granted" : "Required")
                        Button(wm.automationTrusted ? "Open Settings…" : "Grant / Reset…") {
                            if wm.automationTrusted {
                                wm.openAutomationSettings()
                            } else {
                                wm.requestSystemEventsAutomationPermission { granted in
                                    if !granted {
                                        wm.resetAndPromptAutomationPermission { _ in }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            Section("Onboarding & Diagnostics") {
                LabeledContent("Quick Setup & Permissions") {
                    Button("Replay Onboarding…") {
                        showOnboarding = true
                    }
                }

                LabeledContent("Latcraft Diagnostic Report") {
                    Button("Save Latcraft Diagnostic Logs…") {
                        store.exportDiagnosticReport()
                    }
                }
            }
        }
        .formStyle(.grouped)
        .frame(width: 540, height: 520)
        .sheet(isPresented: $showOnboarding) {
            OnboardingView(isPresented: $showOnboarding)
        }
        .onAppear {
            wm.refreshPermissionsNow()
        }
    }
}
