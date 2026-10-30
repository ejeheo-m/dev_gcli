import Foundation
import AppIntents

public struct WorkspaceEntity: AppEntity {
    public static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Workspace")
    public static var defaultQuery = WorkspaceEntityQuery()

    public var id: UUID
    public var name: String

    public var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)", image: .init(systemName: "rectangle.3.group"))
    }

    public init(id: UUID, name: String) {
        self.id = id
        self.name = name
    }
}

public struct WorkspaceEntityQuery: EntityQuery {
    public init() {}

    public func entities(for identifiers: [UUID]) async throws -> [WorkspaceEntity] {
        await MainActor.run {
            WorkspaceStore.shared.workspaces
                .filter { identifiers.contains($0.id) }
                .map { WorkspaceEntity(id: $0.id, name: $0.name) }
        }
    }

    public func suggestedEntities() async throws -> [WorkspaceEntity] {
        await MainActor.run {
            WorkspaceStore.shared.workspaces
                .map { WorkspaceEntity(id: $0.id, name: $0.name) }
        }
    }
}

public struct LaunchWorkspaceIntent: AppIntent {
    public static var title: LocalizedStringResource = "Launch Workspace"
    public static var description = IntentDescription("Launches a specific workspace in Latcraft")
    public static var openAppWhenRun: Bool = false

    @Parameter(title: "Workspace")
    public var workspace: WorkspaceEntity

    public init() {}

    public func perform() async throws -> some IntentResult {
        await MainActor.run {
            WorkspaceStore.shared.launchOrRestoreWorkspace(workspace.id)
        }
        return .result()
    }
}

public struct StopWorkspaceIntent: AppIntent {
    public static var title: LocalizedStringResource = "Stop Workspace"
    public static var description = IntentDescription("Stops a specific workspace in Latcraft")
    public static var openAppWhenRun: Bool = false

    @Parameter(title: "Workspace")
    public var workspace: WorkspaceEntity

    public init() {}

    public func perform() async throws -> some IntentResult {
        await MainActor.run {
            WorkspaceStore.shared.stopWorkspace(workspace.id)
        }
        return .result()
    }
}

public struct LatcraftShortcuts: AppShortcutsProvider {
    public static var shortcutTileColor: ShortcutTileColor = .blue

    public static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: LaunchWorkspaceIntent(),
            phrases: [
                "Launch \(\.$workspace) in \(.applicationName)",
                "Open \(\.$workspace) workspace in \(.applicationName)",
                "Start \(\.$workspace) in \(.applicationName)"
            ],
            shortTitle: "Launch Workspace",
            systemImageName: "rectangle.3.group"
        )
        AppShortcut(
            intent: StopWorkspaceIntent(),
            phrases: [
                "Stop \(\.$workspace) in \(.applicationName)",
                "Close \(\.$workspace) workspace in \(.applicationName)",
                "Quit \(\.$workspace) in \(.applicationName)"
            ],
            shortTitle: "Stop Workspace",
            systemImageName: "stop.circle"
        )
    }
}
