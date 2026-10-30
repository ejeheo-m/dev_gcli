import SwiftUI
import AppKit
import UniformTypeIdentifiers

public typealias ViewState<Value> = SwiftUI.State<Value>

public struct MainWorkspaceView: View {
    @ObservedObject var store: WorkspaceStore
    @ObservedObject private var wm = WindowManagerService.shared
    @ViewState private var searchText: String = ""
    @ViewState private var workspacePendingDelete: Workspace?
    @ViewState private var showOnboardingSheet: Bool = false

    private var filteredWorkspaces: [Workspace] {
        if searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return store.workspaces
        }
        return store.workspaces.filter {
            $0.name.localizedCaseInsensitiveContains(searchText) ||
            $0.items.contains(where: { $0.name.localizedCaseInsensitiveContains(searchText) })
        }
    }

    public var body: some View {
        NavigationSplitView {
            sidebarContent
                .navigationSplitViewColumnWidth(min: 235, ideal: 260, max: 320)
        } detail: {
            if let selectedID = store.selectedWorkspaceID,
               let index = store.workspaces.firstIndex(where: { $0.id == selectedID }) {
                WorkspaceDetailView(
                    workspace: $store.workspaces[index],
                    store: store
                )
            } else {
                emptyDetailView
            }
        }
        .overlay(alignment: .bottom) {
            if let msg = store.statusMessage {
                HStack(spacing: 10) {
                    if store.isBusy {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                    }
                    Text(msg)
                        .font(.system(size: 13, weight: .medium))
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(.ultraThinMaterial, in: Capsule())
                .overlay(Capsule().strokeBorder(Color.primary.opacity(0.12), lineWidth: 1))
                .shadow(color: .black.opacity(0.18), radius: 10, y: 4)
                .padding(.bottom, 16)
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.spring(response: 0.3, dampingFraction: 0.8), value: store.statusMessage)
        .confirmationDialog(
            "Delete Workspace",
            isPresented: Binding(
                get: { workspacePendingDelete != nil },
                set: { if !$0 { workspacePendingDelete = nil } }
            ),
            presenting: workspacePendingDelete
        ) { ws in
            Button("Delete \"\(ws.name)\"", role: .destructive) {
                store.deleteWorkspace(ws.id)
                workspacePendingDelete = nil
            }
            Button("Cancel", role: .cancel) {
                workspacePendingDelete = nil
            }
        } message: { ws in
            Text("Are you sure you want to delete the workspace \"\(ws.name)\"? This action cannot be undone.")
        }
        .sheet(isPresented: $showOnboardingSheet) {
            OnboardingView(isPresented: $showOnboardingSheet)
        }
        .onAppear {
            if store.onboardingCompletedVersion.isEmpty {
                showOnboardingSheet = true
            }
        }
    }

    // MARK: Sidebar

    private var sidebarContent: some View {
        VStack(spacing: 0) {
            // Search filter
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)
                TextField("Filter workspaces...", text: $searchText)
                    .textFieldStyle(.plain)
                if !searchText.isEmpty {
                    Button {
                        searchText = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(8)
            .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 8))
            .padding(.horizontal, 12)
            .padding(.top, 10)
            .padding(.bottom, 6)

            // Active Space & Permission quick pill
            HStack(spacing: 6) {
                Image(systemName: "sparkles.rectangle.stack")
                    .foregroundStyle(.blue)
                Text("Desktop \(store.currentSpaceOrdinal) of \(store.totalSpacesCount)")
                    .font(.caption.weight(.medium))
                Spacer()
                if !wm.axTrusted || !wm.automationTrusted {
                    Button {
                        showOnboardingSheet = true
                    } label: {
                        Label("Permissions", systemImage: "exclamationmark.triangle.fill")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.orange)
                    }
                    .buttonStyle(.plain)
                    .help("Grant Accessibility & Automation permissions")
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 6)

            Divider()

            if filteredWorkspaces.isEmpty {
                VStack(spacing: 8) {
                    Spacer()
                    Image(systemName: "rectangle.3.group")
                        .font(.system(size: 28))
                        .foregroundStyle(.secondary)
                    Text("No workspaces found")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Spacer()
                }
            } else {
                List(selection: $store.selectedWorkspaceID) {
                    Section("Workspaces") {
                        ForEach(filteredWorkspaces) { ws in
                            SidebarWorkspaceRow(
                                workspace: ws,
                                isActive: store.activeWorkspaceID == ws.id,
                                onLaunch: { store.launchOrRestoreWorkspace(ws.id) },
                                onStop: { store.stopWorkspace(ws.id) },
                                onUpdateLayout: { store.updateWorkspaceLayoutFromCurrentWindows(ws.id) },
                                onDelete: { workspacePendingDelete = ws }
                            )
                            .tag(ws.id)
                        }
                    }
                }
                .listStyle(.sidebar)
            }

            Divider()

            // Bottom Action Bar
            VStack(spacing: 8) {
                Button {
                    store.captureNewWorkspaceFromCurrentLayout()
                } label: {
                    Label("Save Current Layout", systemImage: "plus.square.on.square")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.regular)
                .help("Capture all open windows across Spaces into a new workspace in one click")

                HStack(spacing: 8) {
                    Button {
                        _ = store.createEmptyWorkspace()
                    } label: {
                        Label("New Workspace", systemImage: "plus")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)

                    Button {
                        showOnboardingSheet = true
                    } label: {
                        Image(systemName: "questionmark.circle")
                    }
                    .buttonStyle(.bordered)
                    .help("Replay onboarding and review permissions")
                }
            }
            .padding(12)
        }
    }

    private var emptyDetailView: some View {
        VStack(spacing: 14) {
            Image(systemName: "rectangle.3.group.fill")
                .font(.system(size: 48))
                .foregroundStyle(.blue.gradient)
            Text("Select a workspace")
                .font(.title2.bold())
            Text("Choose an existing workspace from the sidebar, or capture your currently open windows in one click.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 380)
            HStack(spacing: 12) {
                Button("Save Current Layout") {
                    store.captureNewWorkspaceFromCurrentLayout()
                }
                .buttonStyle(.borderedProminent)

                Button("New Blank Workspace") {
                    _ = store.createEmptyWorkspace()
                }
                .buttonStyle(.bordered)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Sidebar Row

private struct SidebarWorkspaceRow: View {
    let workspace: Workspace
    let isActive: Bool
    let onLaunch: () -> Void
    let onStop: () -> Void
    let onUpdateLayout: () -> Void
    let onDelete: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            ZStack {
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .fill(workspace.swiftUIColor.opacity(0.18))
                    .frame(width: 28, height: 28)
                Image(systemName: workspace.iconName)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(workspace.swiftUIColor)
            }

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 5) {
                    Text(workspace.name)
                        .font(.system(size: 13, weight: .medium))
                        .lineLimit(1)
                    if isActive {
                        Circle()
                            .fill(Color.green)
                            .frame(width: 7, height: 7)
                            .help("Active Workspace")
                    }
                }
                HStack(spacing: 6) {
                    Text("\(workspace.items.count) items")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    if let sc = workspace.hotkey {
                        Text(sc.displayString)
                            .font(.system(size: 10, weight: .semibold, design: .monospaced))
                            .padding(.horizontal, 4)
                            .padding(.vertical, 1)
                            .background(Color.primary.opacity(0.08), in: RoundedRectangle(cornerRadius: 4))
                    }
                }
            }

            Spacer()

            Button(action: onLaunch) {
                Image(systemName: "play.fill")
                    .font(.system(size: 10))
            }
            .buttonStyle(.borderless)
            .help("Launch all items in this workspace.")
        }
        .padding(.vertical, 3)
        .contextMenu {
            Button("Launch / Restore Workspace", action: onLaunch)
            Button("Update Layout from Open Windows", action: onUpdateLayout)
            Button("Stop Workspace", action: onStop)
            Divider()
            Button("Delete Workspace", role: .destructive, action: onDelete)
        }
    }
}

// MARK: - Workspace Detail View

public struct WorkspaceDetailView: View {
    @Binding var workspace: Workspace
    @ObservedObject var store: WorkspaceStore

    @ViewState private var selectedItemID: UUID?
    @ViewState private var previewSpaceIndex: Int = 1
    @ViewState private var showWorkspaceSettingsPopover: Bool = false
    @ViewState private var showFileImporter: Bool = false
    @ViewState private var showRunningAppPicker: Bool = false

    private var itemsOnSelectedSpace: [WorkspaceItem] {
        workspace.items.filter { $0.spaceIndex == previewSpaceIndex }
    }

    public var body: some View {
        HSplitView {
            // Left / Center Column: Header + Interactive Layout Preview + Items List
            ScrollView(.vertical, showsIndicators: true) {
                VStack(alignment: .leading, spacing: 20) {
                    headerCard
                    layoutPreviewSection
                    itemsListSection
                }
                .padding(20)
            }
            .frame(minWidth: 520, maxWidth: .infinity)

            // Right Column: Selected Item Inspector
            if let selID = selectedItemID,
               let itemIdx = workspace.items.firstIndex(where: { $0.id == selID }) {
                WorkspaceItemInspectorView(
                    item: $workspace.items[itemIdx],
                    maxSpaces: max(4, workspace.requiredSpacesCount + 1),
                    onApplyNow: {
                        _ = WindowManagerService.shared.positionWindows(for: workspace.items[itemIdx])
                        store.showBanner("Positioned \(workspace.items[itemIdx].name) to \(workspace.items[itemIdx].layoutPreset.rawValue)")
                    },
                    onDelete: {
                        workspace.items.remove(at: itemIdx)
                        selectedItemID = workspace.items.first?.id
                    }
                )
                .frame(minWidth: 310, idealWidth: 340, maxWidth: 380)
            } else {
                VStack(spacing: 10) {
                    Image(systemName: "slider.horizontal.below.rectangle")
                        .font(.system(size: 32))
                        .foregroundStyle(.secondary)
                    Text("Select an item to customize")
                        .font(.headline)
                    Text("Click any window in the preview or list to configure its layout preset, Desktop Space, browser URLs & profile, or terminal commands.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 20)
                }
                .frame(minWidth: 290, idealWidth: 320, maxWidth: 360, maxHeight: .infinity)
                .background(Color(nsColor: .windowBackgroundColor))
            }
        }
        .navigationTitle(workspace.name)
        .onAppear {
            if selectedItemID == nil {
                selectedItemID = workspace.items.first?.id
            }
        }
        .onChange(of: workspace.id) { _, _ in
            selectedItemID = workspace.items.first?.id
            previewSpaceIndex = 1
        }
        .fileImporter(
            isPresented: $showFileImporter,
            allowedContentTypes: [.item, .folder, .application],
            allowsMultipleSelection: true
        ) { result in
            if case .success(let urls) = result {
                for url in urls {
                    addFileOrAppURL(url)
                }
            }
        }
    }

    // MARK: Header Card

    private var headerCard: some View {
        HStack(spacing: 14) {
            Menu {
                Section("Icon") {
                    ForEach(["rectangle.3.group", "hammer.fill", "book.pages.fill", "terminal.fill", "globe", "paintbrush.fill", "sparkles", "cpu", "music.note", "video.fill"], id: \.self) { icon in
                        Button {
                            workspace.iconName = icon
                        } label: {
                            Label(icon, systemImage: icon)
                        }
                    }
                }
                Section("Accent Color") {
                    ForEach(["blue", "purple", "teal", "green", "orange", "pink", "indigo", "red"], id: \.self) { colorName in
                        Button(colorName.capitalized) {
                            workspace.accentColorName = colorName
                        }
                    }
                }
            } label: {
                ZStack {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(workspace.swiftUIColor.gradient)
                        .frame(width: 44, height: 44)
                    Image(systemName: workspace.iconName)
                        .font(.system(size: 20, weight: .bold))
                        .foregroundStyle(.white)
                }
            }
            .buttonStyle(.plain)
            .help("Click to change workspace icon & color")

            VStack(alignment: .leading, spacing: 4) {
                TextField("Workspace Name", text: $workspace.name)
                    .font(.title2.bold())
                    .textFieldStyle(.plain)

                HStack(spacing: 12) {
                    ShortcutRecorderView(
                        title: "Hotkey",
                        shortcut: $workspace.hotkey
                    )

                    Text("•")
                        .foregroundStyle(.secondary)

                    Text("Stop: \(workspace.stopBehavior.rawValue)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()

            // Action Buttons
            HStack(spacing: 8) {
                Button {
                    showWorkspaceSettingsPopover.toggle()
                } label: {
                    Label("Settings", systemImage: "slider.horizontal.3")
                }
                .popover(isPresented: $showWorkspaceSettingsPopover) {
                    workspaceSettingsPopover
                }
                .help("Click on Settings to open workspace-specific settings including hotkeys, stop behaviour etc.")

                Button {
                    store.updateWorkspaceLayoutFromCurrentWindows(workspace.id)
                } label: {
                    Label("Capture Open Windows", systemImage: "arrow.triangle.2.circlepath")
                }
                .help("Replace this workspace's layout with your currently open windows")

                if store.activeWorkspaceID == workspace.id {
                    Button(role: .destructive) {
                        store.stopWorkspace(workspace.id)
                    } label: {
                        Label("Stop", systemImage: "stop.fill")
                    }
                }

                Button {
                    store.launchOrRestoreWorkspace(workspace.id)
                } label: {
                    Label(store.activeWorkspaceID == workspace.id ? "Restore" : "Launch Workspace", systemImage: "play.fill")
                }
                .buttonStyle(.borderedProminent)
                .tint(workspace.swiftUIColor)
            }
        }
        .padding(16)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(Color.primary.opacity(0.08), lineWidth: 1)
        )
    }

    private var workspaceSettingsPopover: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Workspace Settings")
                .font(.headline)

            Picker("Window behaviour while stopping workspace", selection: $workspace.stopBehavior) {
                ForEach(StopBehavior.allCases) { behavior in
                    Text(behavior.rawValue).tag(behavior)
                }
            }

            Divider()

            Text("Space Names (Shown in Space Switcher Overlay)")
                .font(.subheadline.weight(.semibold))
            Text("Leave blank to show the space number.")
                .font(.caption)
                .foregroundStyle(.secondary)

            ForEach(1...max(3, workspace.requiredSpacesCount), id: \.self) { spaceIdx in
                HStack {
                    Text("Desktop \(spaceIdx):")
                        .font(.caption)
                        .frame(width: 75, alignment: .leading)
                    TextField("Desktop \(spaceIdx)", text: Binding(
                        get: { workspace.spaceNames[spaceIdx] ?? "" },
                        set: { workspace.spaceNames[spaceIdx] = $0 }
                    ))
                    .textFieldStyle(.roundedBorder)
                }
            }
        }
        .padding(16)
        .frame(width: 340)
    }

    // MARK: Interactive Window Layout Preview

    private var layoutPreviewSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("Window Layout Preview", systemImage: "macwindow.on.rectangle")
                    .font(.headline)

                Spacer()

                // Space Tabs
                HStack(spacing: 6) {
                    ForEach(1...max(2, workspace.requiredSpacesCount), id: \.self) { sp in
                        let countOnSpace = workspace.items.filter { $0.spaceIndex == sp }.count
                        let customName = workspace.spaceNames[sp]
                        let label = (customName?.isEmpty == false) ? customName! : "Desktop \(sp)"
                        Button {
                            previewSpaceIndex = sp
                        } label: {
                            HStack(spacing: 4) {
                                Text(label)
                                    .font(.caption.weight(previewSpaceIndex == sp ? .bold : .regular))
                                if countOnSpace > 0 {
                                    Text("\(countOnSpace)")
                                        .font(.system(size: 10, weight: .bold))
                                        .padding(.horizontal, 5)
                                        .padding(.vertical, 1)
                                        .background(previewSpaceIndex == sp ? Color.white.opacity(0.25) : Color.primary.opacity(0.1), in: Capsule())
                                }
                            }
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(
                                previewSpaceIndex == sp ? workspace.swiftUIColor : Color.primary.opacity(0.07),
                                in: Capsule()
                            )
                            .foregroundStyle(previewSpaceIndex == sp ? .white : .primary)
                        }
                        .buttonStyle(.plain)
                    }

                    Button {
                        let next = max(2, workspace.requiredSpacesCount) + 1
                        if next <= 16 {
                            workspace.capturedSpaceCountsByScreen[1] = next
                            previewSpaceIndex = next
                        }
                    } label: {
                        Image(systemName: "plus.circle.fill")
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                    .help("Add Desktop Space to Workspace (up to 16)")
                }
            }

            Text("If you didn't like the default layouts, click on the preview windows shown with your wallpaper and customize the layout to your preference.")
                .font(.caption)
                .foregroundStyle(.secondary)

            WindowLayoutPreviewCanvas(
                items: $workspace.items,
                spaceIndex: previewSpaceIndex,
                selectedItemID: $selectedItemID,
                accentColor: workspace.swiftUIColor
            )
            .frame(height: 260)
        }
    }

    // MARK: Workspace Items List Section

    private var itemsListSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label("Workspace Items (\(workspace.items.count))", systemImage: "square.stack.3d.up")
                    .font(.headline)

                Spacer()

                // Add Item Menu
                Menu {
                    Button {
                        showRunningAppPicker = true
                    } label: {
                        Label("Add from Open Applications…", systemImage: "macwindow.badge.plus")
                    }

                    Button {
                        let item = WorkspaceItem(
                            name: "Google Chrome",
                            kind: .browser,
                            bundleIdentifier: "com.google.Chrome",
                            layoutPreset: .rightTwoThirds,
                            spaceIndex: previewSpaceIndex,
                            browserType: .chrome,
                            browserProfileDirectory: "Default",
                            urls: ["https://github.com"]
                        )
                        workspace.items.append(item)
                        selectedItemID = item.id
                    } label: {
                        Label("Add Browser (URLs & Profile)", systemImage: "globe")
                    }

                    Button {
                        let item = WorkspaceItem(
                            name: "Terminal",
                            kind: .terminal,
                            bundleIdentifier: "com.apple.Terminal",
                            layoutPreset: .leftThird,
                            spaceIndex: previewSpaceIndex,
                            terminalType: .appleTerminal,
                            terminalCommands: ["npm start"]
                        )
                        workspace.items.append(item)
                        selectedItemID = item.id
                    } label: {
                        Label("Add Terminal (Commands)", systemImage: "terminal")
                    }

                    Button {
                        showFileImporter = true
                    } label: {
                        Label("Add App, File, or Folder…", systemImage: "folder.badge.plus")
                    }
                } label: {
                    Label("Add Item", systemImage: "plus.circle.fill")
                }
                .buttonStyle(.borderedProminent)
                .popover(isPresented: $showRunningAppPicker) {
                    runningApplicationsPickerPopover
                }
            }

            if workspace.items.isEmpty {
                VStack(spacing: 10) {
                    Image(systemName: "plus.rectangle.on.folder")
                        .font(.system(size: 28))
                        .foregroundStyle(.secondary)
                    Text("Click on **Add Item** to add Apps, Browsers, Terminals, or Files, or click **Capture Open Windows** above.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
                .padding(28)
                .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 12))
            } else {
                VStack(spacing: 8) {
                    ForEach($workspace.items) { $item in
                        WorkspaceItemRowView(
                            item: $item,
                            isSelected: selectedItemID == item.id,
                            accentColor: workspace.swiftUIColor,
                            onSelect: {
                                selectedItemID = item.id
                                previewSpaceIndex = item.spaceIndex
                            },
                            onDelete: {
                                workspace.items.removeAll { $0.id == item.id }
                                if selectedItemID == item.id {
                                    selectedItemID = workspace.items.first?.id
                                }
                            }
                        )
                    }
                }
            }
        }
        .onDrop(of: [.fileURL], isTargeted: nil) { providers in
            for provider in providers {
                _ = provider.loadObject(ofClass: URL.self) { url, _ in
                    if let url = url {
                        Task { @MainActor in
                            addFileOrAppURL(url)
                        }
                    }
                }
            }
            return true
        }
    }

    private var runningApplicationsPickerPopover: some View {
        let runningApps = NSWorkspace.shared.runningApplications.filter {
            $0.activationPolicy == .regular && $0.bundleIdentifier != nil
        }
        return VStack(alignment: .leading, spacing: 10) {
            Text("Add Running Application")
                .font(.headline)
            ScrollView {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(runningApps, id: \.processIdentifier) { app in
                        Button {
                            let bID = app.bundleIdentifier ?? ""
                            let name = app.localizedName ?? bID
                            let browserType = BrowserType.from(bundleIdentifier: bID)
                            let terminalType = TerminalType.from(bundleIdentifier: bID)
                            let kind: WorkspaceItemKind = browserType != nil ? .browser : (terminalType != nil ? .terminal : .application)
                            let newItem = WorkspaceItem(
                                name: name,
                                kind: kind,
                                bundleIdentifier: bID,
                                appPath: app.bundleURL?.path,
                                layoutPreset: .leftHalf,
                                spaceIndex: previewSpaceIndex,
                                browserType: browserType,
                                terminalType: terminalType
                            )
                            workspace.items.append(newItem)
                            selectedItemID = newItem.id
                            showRunningAppPicker = false
                        } label: {
                            HStack(spacing: 8) {
                                if let icon = app.icon {
                                    Image(nsImage: icon)
                                        .resizable()
                                        .frame(width: 20, height: 20)
                                }
                                Text(app.localizedName ?? app.bundleIdentifier ?? "App")
                                    .font(.system(size: 13))
                                Spacer()
                            }
                            .padding(.vertical, 4)
                            .padding(.horizontal, 6)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .frame(height: 220)
        }
        .padding(14)
        .frame(width: 260)
    }

    private func addFileOrAppURL(_ url: URL) {
        if url.pathExtension.lowercased() == "app",
           let bundle = Bundle(url: url),
           let bundleID = bundle.bundleIdentifier {
            let name = FileManager.default.displayName(atPath: url.path).replacingOccurrences(of: ".app", with: "")
            let browserType = BrowserType.from(bundleIdentifier: bundleID)
            let terminalType = TerminalType.from(bundleIdentifier: bundleID)
            let kind: WorkspaceItemKind = browserType != nil ? .browser : (terminalType != nil ? .terminal : .application)
            let newItem = WorkspaceItem(
                name: name,
                kind: kind,
                bundleIdentifier: bundleID,
                appPath: url.path,
                layoutPreset: .leftHalf,
                spaceIndex: previewSpaceIndex,
                browserType: browserType,
                terminalType: terminalType
            )
            workspace.items.append(newItem)
            selectedItemID = newItem.id
        } else {
            let newItem = WorkspaceItem(
                name: url.lastPathComponent,
                kind: .fileOrFolder,
                bundleIdentifier: "com.apple.finder",
                filePath: url.path,
                layoutPreset: .center,
                spaceIndex: previewSpaceIndex
            )
            workspace.items.append(newItem)
            selectedItemID = newItem.id
        }
    }
}

// MARK: - Interactive Wallpaper Window Layout Preview Canvas

private struct WindowLayoutPreviewCanvas: View {
    @Binding var items: [WorkspaceItem]
    let spaceIndex: Int
    @Binding var selectedItemID: UUID?
    let accentColor: Color

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                // Wallpaper background
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(
                        LinearGradient(
                            colors: [
                                Color(red: 0.09, green: 0.13, blue: 0.26),
                                Color(red: 0.16, green: 0.11, blue: 0.31),
                                Color(red: 0.08, green: 0.22, blue: 0.34)
                            ],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )

                // Subtle macOS Menu bar in preview
                HStack(spacing: 6) {
                    Image(systemName: "apple.logo")
                        .font(.system(size: 9))
                    Text("Desktop \(spaceIndex)")
                        .font(.system(size: 9, weight: .semibold))
                    Spacer()
                    Image(systemName: "rectangle.3.group.fill")
                        .font(.system(size: 9))
                }
                .foregroundStyle(.white.opacity(0.8))
                .padding(.horizontal, 10)
                .frame(height: 18)
                .background(Color.black.opacity(0.28))

                // Usable desktop area inside preview
                let insetTop: CGFloat = 22
                let insetSide: CGFloat = 8
                let canvasW = max(100, geo.size.width - insetSide * 2)
                let canvasH = max(80, geo.size.height - insetTop - insetSide)

                ForEach($items) { $item in
                    if item.spaceIndex == spaceIndex && item.isEnabled {
                        let rect = item.effectiveRect
                        let winX = insetSide + CGFloat(rect.x) * canvasW
                        let winY = insetTop + CGFloat(rect.y) * canvasH
                        let winW = max(60, CGFloat(rect.width) * canvasW - 3)
                        let winH = max(44, CGFloat(rect.height) * canvasH - 3)
                        let isSelected = (selectedItemID == item.id)

                        PreviewWindowTile(
                            item: item,
                            isSelected: isSelected,
                            accentColor: accentColor
                        )
                        .frame(width: winW, height: winH)
                        .position(x: winX + winW / 2, y: winY + winH / 2)
                        .onTapGesture {
                            selectedItemID = item.id
                        }
                    }
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(Color.primary.opacity(0.15), lineWidth: 1)
            )
        }
    }
}

private struct PreviewWindowTile: View {
    let item: WorkspaceItem
    let isSelected: Bool
    let accentColor: Color

    var body: some View {
        VStack(spacing: 0) {
            // Window Title Bar
            HStack(spacing: 4) {
                Circle().fill(Color.red.opacity(0.85)).frame(width: 6, height: 6)
                Circle().fill(Color.yellow.opacity(0.85)).frame(width: 6, height: 6)
                Circle().fill(Color.green.opacity(0.85)).frame(width: 6, height: 6)
                Text(item.name)
                    .font(.system(size: 10, weight: .semibold))
                    .lineLimit(1)
                    .padding(.leading, 3)
                Spacer()
            }
            .padding(.horizontal, 7)
            .frame(height: 18)
            .background(Color.primary.opacity(0.08))

            // Window Body
            VStack(spacing: 4) {
                Spacer(minLength: 2)
                Image(systemName: item.kind.systemImage)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(isSelected ? accentColor : .secondary)
                Text(item.layoutPreset.rawValue)
                    .font(.system(size: 9, weight: .medium))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Spacer(minLength: 2)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .strokeBorder(isSelected ? accentColor : Color.white.opacity(0.35), lineWidth: isSelected ? 2.5 : 1)
        )
        .shadow(color: .black.opacity(0.25), radius: 5, y: 2)
    }
}

// MARK: - Workspace Item Row

private struct WorkspaceItemRowView: View {
    @Binding var item: WorkspaceItem
    let isSelected: Bool
    let accentColor: Color
    let onSelect: () -> Void
    let onDelete: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Toggle("", isOn: $item.isEnabled)
                .labelsHidden()
                .toggleStyle(.switch)
                .controlSize(.small)

            Image(systemName: item.kind.systemImage)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(accentColor)
                .frame(width: 28, height: 28)
                .background(accentColor.opacity(0.14), in: RoundedRectangle(cornerRadius: 7))

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(item.name)
                        .font(.system(size: 13, weight: .semibold))
                    Text(item.kind.rawValue)
                        .font(.system(size: 10, weight: .medium))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 1)
                        .background(Color.primary.opacity(0.08), in: Capsule())
                }

                HStack(spacing: 8) {
                    Label(item.layoutPreset.rawValue, systemImage: item.layoutPreset.systemImage)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text("• Desktop \(item.spaceIndex)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if item.kind == .browser && !item.urls.isEmpty {
                        Text("• \(item.urls.count) URL(s)")
                            .font(.caption)
                            .foregroundStyle(.blue)
                    }
                    if item.kind == .terminal && !item.terminalCommands.isEmpty {
                        Text("• \(item.terminalCommands.count) cmd(s)")
                            .font(.caption)
                            .foregroundStyle(.green)
                    }
                }
            }

            Spacer()

            Menu {
                ForEach(["Halves & Full", "Thirds", "Quarters", "Sixths"], id: \.self) { category in
                    Section(category) {
                        ForEach(WindowLayoutPreset.allCases.filter { $0.category == category }) { preset in
                            Button {
                                item.layoutPreset = preset
                                item.customRect = preset.normalizedRect
                            } label: {
                                Label(preset.rawValue, systemImage: preset.systemImage)
                            }
                        }
                    }
                }
            } label: {
                Label(item.layoutPreset.rawValue, systemImage: item.layoutPreset.systemImage)
                    .font(.caption)
            }
            .frame(width: 155)

            Button(role: .destructive, action: onDelete) {
                Image(systemName: "trash")
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.borderless)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .background(
            isSelected ? accentColor.opacity(0.12) : Color.primary.opacity(0.03),
            in: RoundedRectangle(cornerRadius: 10, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .strokeBorder(isSelected ? accentColor.opacity(0.6) : Color.primary.opacity(0.07), lineWidth: 1)
        )
        .contentShape(Rectangle())
        .onTapGesture(perform: onSelect)
    }
}

// MARK: - Right-hand Item Inspector (Layout, Browser URLs & Profile, Terminal Commands)

private struct WorkspaceItemInspectorView: View {
    @Binding var item: WorkspaceItem
    let maxSpaces: Int
    let onApplyNow: () -> Void
    let onDelete: () -> Void

    @ViewState private var newURLText: String = ""
    @ViewState private var newCommandText: String = ""
    @ViewState private var discoveredProfiles: [BrowserProfile] = []

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                // Title
                HStack {
                    Image(systemName: item.kind.systemImage)
                        .font(.title3)
                        .foregroundStyle(.blue)
                    VStack(alignment: .leading, spacing: 2) {
                        TextField("Item Name", text: $item.name)
                            .font(.headline)
                            .textFieldStyle(.plain)
                        Text(item.bundleIdentifier)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("Snap Now", action: onApplyNow)
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                        .help("Immediately position this app's window to the selected layout")
                }

                Divider()

                // Kind & Space
                GroupBox("Placement & Space") {
                    VStack(alignment: .leading, spacing: 10) {
                        Picker("Item Type", selection: $item.kind) {
                            ForEach(WorkspaceItemKind.allCases) { k in
                                Text(k.rawValue).tag(k)
                            }
                        }

                        Picker("Target Desktop", selection: $item.spaceIndex) {
                            ForEach(1...min(16, maxSpaces), id: \.self) { sp in
                                Text("Desktop \(sp)").tag(sp)
                            }
                        }

                        Picker("Display", selection: $item.displayIndex) {
                            ForEach(1...max(1, NSScreen.screens.count), id: \.self) { d in
                                Text("Display \(d)").tag(d)
                            }
                        }

                        Picker("Layout Preset", selection: $item.layoutPreset) {
                            ForEach(WindowLayoutPreset.allCases) { preset in
                                Label(preset.rawValue, systemImage: preset.systemImage)
                                    .tag(preset)
                            }
                        }
                        .onChange(of: item.layoutPreset) { _, newValue in
                            if newValue != .custom {
                                item.customRect = newValue.normalizedRect
                            }
                        }

                        if item.layoutPreset == .custom {
                            VStack(alignment: .leading, spacing: 6) {
                                Text("Custom Normalized Position")
                                    .font(.caption.weight(.semibold))
                                HStack {
                                    Text("X: \(Int(item.customRect.x * 100))%")
                                        .font(.caption2)
                                        .frame(width: 50, alignment: .leading)
                                    Slider(value: $item.customRect.x, in: 0...0.9)
                                }
                                HStack {
                                    Text("Y: \(Int(item.customRect.y * 100))%")
                                        .font(.caption2)
                                        .frame(width: 50, alignment: .leading)
                                    Slider(value: $item.customRect.y, in: 0...0.9)
                                }
                                HStack {
                                    Text("W: \(Int(item.customRect.width * 100))%")
                                        .font(.caption2)
                                        .frame(width: 50, alignment: .leading)
                                    Slider(value: $item.customRect.width, in: 0.1...1.0)
                                }
                                HStack {
                                    Text("H: \(Int(item.customRect.height * 100))%")
                                        .font(.caption2)
                                        .frame(width: 50, alignment: .leading)
                                    Slider(value: $item.customRect.height, in: 0.1...1.0)
                                }
                            }
                        }
                    }
                    .padding(6)
                }

                // Quick Layout Grid Buttons
                GroupBox("Quick Tile Presets") {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 85), spacing: 6)], spacing: 6) {
                        ForEach([
                            WindowLayoutPreset.leftHalf, .rightHalf, .fullScreen,
                            .leftThird, .middleThird, .rightThird,
                            .leftTwoThirds, .rightTwoThirds, .center,
                            .topLeftQuarter, .topRightQuarter, .bottomLeftQuarter, .bottomRightQuarter
                        ]) { preset in
                            Button {
                                item.layoutPreset = preset
                                item.customRect = preset.normalizedRect
                            } label: {
                                VStack(spacing: 3) {
                                    Image(systemName: preset.systemImage)
                                        .font(.system(size: 13))
                                    Text(preset.rawValue)
                                        .font(.system(size: 9))
                                        .lineLimit(1)
                                }
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 6)
                                .background(
                                    item.layoutPreset == preset ? Color.accentColor.opacity(0.2) : Color.primary.opacity(0.05),
                                    in: RoundedRectangle(cornerRadius: 6)
                                )
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(6)
                }

                // Browser URLs & Profile Section (Observed in Lattix binary)
                if item.kind == .browser {
                    GroupBox("Manage URLs & Profile") {
                        VStack(alignment: .leading, spacing: 10) {
                            Picker("Browser", selection: Binding(
                                get: { item.browserType ?? .chrome },
                                set: { newBrowser in
                                    item.browserType = newBrowser
                                    item.bundleIdentifier = newBrowser.bundleIdentifier
                                    item.name = newBrowser.rawValue
                                    discoveredProfiles = WindowManagerService.shared.discoverProfiles(for: newBrowser)
                                }
                            )) {
                                ForEach(BrowserType.allCases) { b in
                                    Text(b.rawValue).tag(b)
                                }
                            }

                            if !discoveredProfiles.isEmpty {
                                Picker("Browser Profile:", selection: Binding(
                                    get: { item.browserProfileDirectory ?? "Default" },
                                    set: { item.browserProfileDirectory = $0 }
                                )) {
                                    ForEach(discoveredProfiles) { prof in
                                        Text(prof.displayName).tag(prof.directoryName)
                                    }
                                }
                            }

                            Text("Note: Profile names come from your browser directories and it may be not matching. You can easily rename it according to your preference.")
                                .font(.caption2)
                                .foregroundStyle(.secondary)

                            Divider()

                            HStack {
                                TextField("Enter new URL...", text: $newURLText)
                                    .textFieldStyle(.roundedBorder)
                                    .onSubmit {
                                        addURL()
                                    }
                                Button("Add") {
                                    addURL()
                                }
                                .disabled(newURLText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                            }

                            if item.urls.isEmpty {
                                Text("No URLs added yet.")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            } else {
                                ForEach(Array(item.urls.enumerated()), id: \.offset) { idx, url in
                                    HStack {
                                        Image(systemName: "link")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                        Text(url)
                                            .font(.caption)
                                            .lineLimit(1)
                                        Spacer()
                                        Button {
                                            item.urls.remove(at: idx)
                                        } label: {
                                            Image(systemName: "xmark.circle.fill")
                                                .foregroundStyle(.secondary)
                                        }
                                        .buttonStyle(.plain)
                                    }
                                }
                            }
                        }
                        .padding(6)
                    }
                    .onAppear {
                        let b = item.browserType ?? BrowserType.from(bundleIdentifier: item.bundleIdentifier) ?? .chrome
                        discoveredProfiles = WindowManagerService.shared.discoverProfiles(for: b)
                    }
                }

                // Terminal Commands Section (Observed in Lattix binary)
                if item.kind == .terminal {
                    GroupBox("Terminal Commands") {
                        VStack(alignment: .leading, spacing: 10) {
                            Picker("Terminal App", selection: Binding(
                                get: { item.terminalType ?? .appleTerminal },
                                set: { newTerm in
                                    item.terminalType = newTerm
                                    item.bundleIdentifier = newTerm.bundleIdentifier
                                    item.name = newTerm.rawValue
                                }
                            )) {
                                ForEach(TerminalType.allCases) { t in
                                    Text(t.rawValue).tag(t)
                                }
                            }

                            HStack {
                                TextField("Enter command (e.g., npm start)", text: $newCommandText)
                                    .textFieldStyle(.roundedBorder)
                                    .onSubmit {
                                        addCommand()
                                    }
                                Button("Add") {
                                    addCommand()
                                }
                                .disabled(newCommandText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                            }

                            if item.terminalCommands.isEmpty {
                                Text("No commands added yet.")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            } else {
                                ForEach(Array(item.terminalCommands.enumerated()), id: \.offset) { idx, cmd in
                                    HStack {
                                        Text("$ \(cmd)")
                                            .font(.system(.caption, design: .monospaced))
                                            .lineLimit(1)
                                        Spacer()
                                        Button {
                                            item.terminalCommands.remove(at: idx)
                                        } label: {
                                            Image(systemName: "xmark.circle.fill")
                                                .foregroundStyle(.secondary)
                                        }
                                        .buttonStyle(.plain)
                                    }
                                }
                            }
                        }
                        .padding(6)
                    }
                }

                // File / Folder path
                if item.kind == .fileOrFolder {
                    GroupBox("File or Folder Path") {
                        TextField("Path", text: Binding(
                            get: { item.filePath ?? "" },
                            set: { item.filePath = $0 }
                        ))
                        .textFieldStyle(.roundedBorder)
                        .padding(6)
                    }
                }

                Divider()

                Button(role: .destructive, action: onDelete) {
                    Label("Remove Item from Workspace", systemImage: "trash")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
            }
            .padding(16)
        }
        .background(Color(nsColor: .windowBackgroundColor))
    }

    private func addURL() {
        let trimmed = newURLText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        item.urls.append(trimmed)
        newURLText = ""
    }

    private func addCommand() {
        let trimmed = newCommandText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        item.terminalCommands.append(trimmed)
        newCommandText = ""
    }
}

// MARK: - Shortcut Recorder Button

public struct ShortcutRecorderView: View {
    let title: String
    @Binding var shortcut: ShortcutCombo?
    @ViewState private var isRecording: Bool = false

    public var body: some View {
        HStack(spacing: 6) {
            Button {
                isRecording.toggle()
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "keyboard")
                        .font(.caption)
                    if isRecording {
                        Text("Press ⌘/⌥/⌃/⇧ + Key…")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.orange)
                    } else if let sc = shortcut {
                        Text("\(title): \(sc.displayString)")
                            .font(.system(.caption, design: .monospaced).weight(.semibold))
                    } else {
                        Text("Record \(title)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(Color.primary.opacity(0.07), in: Capsule())
            }
            .buttonStyle(.plain)
            .help("Record a shortcut with ⌘, ⌥, ⌃, or ⇧ to launch this workspace.")

            if shortcut != nil {
                Button {
                    shortcut = nil
                    isRecording = false
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
            }
        }
        .background(
            ShortcutKeyCaptureRepresentable(isRecording: $isRecording, shortcut: $shortcut)
                .frame(width: 0, height: 0)
        )
    }
}

private struct ShortcutKeyCaptureRepresentable: NSViewRepresentable {
    @Binding var isRecording: Bool
    @Binding var shortcut: ShortcutCombo?

    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        context.coordinator.isRecording = $isRecording
        context.coordinator.shortcut = $shortcut
        context.coordinator.updateMonitor()
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(isRecording: $isRecording, shortcut: $shortcut)
    }

    final class Coordinator {
        var isRecording: Binding<Bool>
        var shortcut: Binding<ShortcutCombo?>
        private var monitor: Any?

        init(isRecording: Binding<Bool>, shortcut: Binding<ShortcutCombo?>) {
            self.isRecording = isRecording
            self.shortcut = shortcut
        }

        func updateMonitor() {
            if isRecording.wrappedValue {
                if monitor == nil {
                    monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
                        guard let self = self, self.isRecording.wrappedValue else { return event }
                        if event.keyCode == 53 { // Escape
                            self.isRecording.wrappedValue = false
                            return nil
                        }
                        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
                        guard let chars = event.charactersIgnoringModifiers?.uppercased(), !chars.isEmpty else {
                            return nil
                        }
                        let combo = ShortcutCombo(
                            key: chars,
                            command: flags.contains(.command),
                            option: flags.contains(.option),
                            control: flags.contains(.control),
                            shift: flags.contains(.shift)
                        )
                        if combo.hasModifier {
                            self.shortcut.wrappedValue = combo
                            self.isRecording.wrappedValue = false
                        }
                        return nil
                    }
                }
            } else if let m = monitor {
                NSEvent.removeMonitor(m)
                monitor = nil
            }
        }

        deinit {
            if let m = monitor {
                NSEvent.removeMonitor(m)
            }
        }
    }
}
