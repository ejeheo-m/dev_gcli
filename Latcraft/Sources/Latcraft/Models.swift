import Foundation
import CoreGraphics
import SwiftUI

// MARK: - Window Layout Presets (Observed in Lattix binary)

public enum WindowLayoutPreset: String, Codable, CaseIterable, Identifiable {
    case fullScreen = "Full Screen"
    case leftHalf = "Left Half"
    case rightHalf = "Right Half"
    case topHalf = "Top Half"
    case bottomHalf = "Bottom Half"
    case center = "Centered (75%)"

    // Thirds
    case leftThird = "Left One Third"
    case middleThird = "Middle One Third"
    case rightThird = "Right One Third"
    case leftTwoThirds = "Left Two Thirds"
    case rightTwoThirds = "Right Two Thirds"

    // Quarters
    case topLeftQuarter = "Top Left Quarter"
    case topRightQuarter = "Top Right Quarter"
    case bottomLeftQuarter = "Bottom Left Quarter"
    case bottomRightQuarter = "Bottom Right Quarter"

    // Sixths
    case topLeftSixth = "Top Left Sixth"
    case topMiddleSixth = "Top Middle Sixth"
    case topRightSixth = "Top Right Sixth"
    case bottomLeftSixth = "Bottom Left Sixth"
    case bottomMiddleSixth = "Bottom Middle Sixth"
    case bottomRightSixth = "Bottom Right Sixth"

    // Custom
    case custom = "Custom"

    public var id: String { rawValue }

    /// Normalized rect in top-left screen coordinates (x: 0..1, y: 0..1, w: 0..1, h: 0..1)
    public var normalizedRect: NormalizedRect {
        switch self {
        case .fullScreen:
            return NormalizedRect(x: 0.0, y: 0.0, width: 1.0, height: 1.0)
        case .leftHalf:
            return NormalizedRect(x: 0.0, y: 0.0, width: 0.5, height: 1.0)
        case .rightHalf:
            return NormalizedRect(x: 0.5, y: 0.0, width: 0.5, height: 1.0)
        case .topHalf:
            return NormalizedRect(x: 0.0, y: 0.0, width: 1.0, height: 0.5)
        case .bottomHalf:
            return NormalizedRect(x: 0.0, y: 0.5, width: 1.0, height: 0.5)
        case .center:
            return NormalizedRect(x: 0.125, y: 0.1, width: 0.75, height: 0.8)
        case .leftThird:
            return NormalizedRect(x: 0.0, y: 0.0, width: 1.0 / 3.0, height: 1.0)
        case .middleThird:
            return NormalizedRect(x: 1.0 / 3.0, y: 0.0, width: 1.0 / 3.0, height: 1.0)
        case .rightThird:
            return NormalizedRect(x: 2.0 / 3.0, y: 0.0, width: 1.0 / 3.0, height: 1.0)
        case .leftTwoThirds:
            return NormalizedRect(x: 0.0, y: 0.0, width: 2.0 / 3.0, height: 1.0)
        case .rightTwoThirds:
            return NormalizedRect(x: 1.0 / 3.0, y: 0.0, width: 2.0 / 3.0, height: 1.0)
        case .topLeftQuarter:
            return NormalizedRect(x: 0.0, y: 0.0, width: 0.5, height: 0.5)
        case .topRightQuarter:
            return NormalizedRect(x: 0.5, y: 0.0, width: 0.5, height: 0.5)
        case .bottomLeftQuarter:
            return NormalizedRect(x: 0.0, y: 0.5, width: 0.5, height: 0.5)
        case .bottomRightQuarter:
            return NormalizedRect(x: 0.5, y: 0.5, width: 0.5, height: 0.5)
        case .topLeftSixth:
            return NormalizedRect(x: 0.0, y: 0.0, width: 1.0 / 3.0, height: 0.5)
        case .topMiddleSixth:
            return NormalizedRect(x: 1.0 / 3.0, y: 0.0, width: 1.0 / 3.0, height: 0.5)
        case .topRightSixth:
            return NormalizedRect(x: 2.0 / 3.0, y: 0.0, width: 1.0 / 3.0, height: 0.5)
        case .bottomLeftSixth:
            return NormalizedRect(x: 0.0, y: 0.5, width: 1.0 / 3.0, height: 0.5)
        case .bottomMiddleSixth:
            return NormalizedRect(x: 1.0 / 3.0, y: 0.5, width: 1.0 / 3.0, height: 0.5)
        case .bottomRightSixth:
            return NormalizedRect(x: 2.0 / 3.0, y: 0.5, width: 1.0 / 3.0, height: 0.5)
        case .custom:
            return NormalizedRect(x: 0.1, y: 0.1, width: 0.8, height: 0.8)
        }
    }

    public var systemImage: String {
        switch self {
        case .fullScreen: return "rectangle.inset.filled"
        case .leftHalf: return "rectangle.lefthalf.inset.filled"
        case .rightHalf: return "rectangle.righthalf.inset.filled"
        case .topHalf: return "rectangle.tophalf.inset.filled"
        case .bottomHalf: return "rectangle.bottomhalf.inset.filled"
        case .center: return "rectangle.center.inset.filled"
        case .leftThird, .middleThird, .rightThird: return "rectangle.split.3x1"
        case .leftTwoThirds, .rightTwoThirds: return "uiwindow.split.2x1"
        case .topLeftQuarter, .topRightQuarter, .bottomLeftQuarter, .bottomRightQuarter:
            return "rectangle.split.2x2"
        case .topLeftSixth, .topMiddleSixth, .topRightSixth, .bottomLeftSixth, .bottomMiddleSixth, .bottomRightSixth:
            return "rectangle.split.3x2"
        case .custom: return "slider.horizontal.below.rectangle"
        }
    }

    public var category: String {
        switch self {
        case .fullScreen, .leftHalf, .rightHalf, .topHalf, .bottomHalf, .center:
            return "Halves & Full"
        case .leftThird, .middleThird, .rightThird, .leftTwoThirds, .rightTwoThirds:
            return "Thirds"
        case .topLeftQuarter, .topRightQuarter, .bottomLeftQuarter, .bottomRightQuarter:
            return "Quarters"
        case .topLeftSixth, .topMiddleSixth, .topRightSixth, .bottomLeftSixth, .bottomMiddleSixth, .bottomRightSixth:
            return "Sixths"
        case .custom:
            return "Custom"
        }
    }

    public static func closestPreset(for rect: NormalizedRect, tolerance: Double = 0.07) -> WindowLayoutPreset {
        for preset in WindowLayoutPreset.allCases where preset != .custom {
            let p = preset.normalizedRect
            if abs(p.x - rect.x) <= tolerance &&
               abs(p.y - rect.y) <= tolerance &&
               abs(p.width - rect.width) <= tolerance &&
               abs(p.height - rect.height) <= tolerance {
                return preset
            }
        }
        return .custom
    }
}

public struct NormalizedRect: Codable, Equatable, Hashable {
    public var x: Double
    public var y: Double
    public var width: Double
    public var height: Double

    public init(x: Double, y: Double, width: Double, height: Double) {
        self.x = min(max(x, 0.0), 0.95)
        self.y = min(max(y, 0.0), 0.95)
        self.width = min(max(width, 0.1), 1.0 - self.x)
        self.height = min(max(height, 0.1), 1.0 - self.y)
    }
}

// MARK: - Item Kinds & Browsers / Terminals

public enum WorkspaceItemKind: String, Codable, CaseIterable, Identifiable {
    case application = "Application"
    case browser = "Browser"
    case terminal = "Terminal"
    case fileOrFolder = "File / Folder"

    public var id: String { rawValue }

    public var systemImage: String {
        switch self {
        case .application: return "macwindow"
        case .browser: return "globe"
        case .terminal: return "terminal"
        case .fileOrFolder: return "folder.badge.plus"
        }
    }
}

public enum BrowserType: String, Codable, CaseIterable, Identifiable {
    case chrome = "Google Chrome"
    case brave = "Brave Browser"
    case edge = "Microsoft Edge"
    case vivaldi = "Vivaldi"
    case safari = "Safari"

    public var id: String { rawValue }

    public var bundleIdentifier: String {
        switch self {
        case .chrome: return "com.google.Chrome"
        case .brave: return "com.brave.Browser"
        case .edge: return "com.microsoft.edgemac"
        case .vivaldi: return "com.vivaldi.Vivaldi"
        case .safari: return "com.apple.Safari"
        }
    }

    public var appSupportSubpath: String? {
        switch self {
        case .chrome: return "Google/Chrome"
        case .brave: return "BraveSoftware/Brave-Browser"
        case .edge: return "Microsoft Edge"
        case .vivaldi: return "Vivaldi"
        case .safari: return nil
        }
    }

    public static func from(bundleIdentifier: String) -> BrowserType? {
        allCases.first { $0.bundleIdentifier.caseInsensitiveCompare(bundleIdentifier) == .orderedSame }
    }
}

public struct BrowserProfile: Codable, Equatable, Hashable, Identifiable {
    public var id: String { directoryName }
    public var directoryName: String // e.g., "Default", "Profile 1"
    public var displayName: String   // e.g., "Work", "Personal"

    public init(directoryName: String, displayName: String) {
        self.directoryName = directoryName
        self.displayName = displayName
    }
}

public enum TerminalType: String, Codable, CaseIterable, Identifiable {
    case appleTerminal = "Terminal"
    case iTerm2 = "iTerm2"

    public var id: String { rawValue }

    public var bundleIdentifier: String {
        switch self {
        case .appleTerminal: return "com.apple.Terminal"
        case .iTerm2: return "com.googlecode.iterm2"
        }
    }

    public static func from(bundleIdentifier: String) -> TerminalType? {
        allCases.first { $0.bundleIdentifier.caseInsensitiveCompare(bundleIdentifier) == .orderedSame }
    }
}

public enum StopBehavior: String, Codable, CaseIterable, Identifiable {
    case minimizeWindows = "Minimize Windows"
    case closeWindows = "Close Windows"
    case hideApplications = "Hide Applications"

    public var id: String { rawValue }
}

public enum SpaceHopModifier: String, Codable, CaseIterable, Identifiable {
    case controlOption = "⌃⌥ (Control + Option)"
    case commandOption = "⌘⌥ (Command + Option)"
    case controlCommand = "⌃⌘ (Control + Command)"
    case commandShift = "⌘⇧ (Command + Shift)"

    public var id: String { rawValue }
}

// MARK: - Keyboard Shortcut Model

public struct ShortcutCombo: Codable, Equatable, Hashable {
    public var key: String
    public var command: Bool
    public var option: Bool
    public var control: Bool
    public var shift: Bool

    public init(key: String, command: Bool = true, option: Bool = true, control: Bool = false, shift: Bool = false) {
        self.key = key.uppercased()
        self.command = command
        self.option = option
        self.control = control
        self.shift = shift
    }

    public var hasModifier: Bool {
        command || option || control || shift
    }

    public var displayString: String {
        var s = ""
        if control { s += "⌃" }
        if option { s += "⌥" }
        if shift { s += "⇧" }
        if command { s += "⌘" }
        s += key.uppercased()
        return s
    }
}

// MARK: - Workspace Item & Workspace

public struct WorkspaceItem: Codable, Equatable, Hashable, Identifiable {
    public var id: UUID
    public var name: String
    public var kind: WorkspaceItemKind
    public var bundleIdentifier: String
    public var appPath: String?
    public var filePath: String?
    public var windowTitleHint: String?
    public var layoutPreset: WindowLayoutPreset
    public var customRect: NormalizedRect
    public var displayIndex: Int
    public var spaceIndex: Int
    public var isMinimized: Bool
    public var isFullscreen: Bool

    // Browser specific
    public var browserType: BrowserType?
    public var browserProfileDirectory: String?
    public var browserProfileCustomName: String?
    public var urls: [String]

    // Terminal specific
    public var terminalType: TerminalType?
    public var terminalWorkingDirectory: String?
    public var terminalCommands: [String]

    public var isEnabled: Bool

    public init(
        id: UUID = UUID(),
        name: String,
        kind: WorkspaceItemKind = .application,
        bundleIdentifier: String,
        appPath: String? = nil,
        filePath: String? = nil,
        windowTitleHint: String? = nil,
        layoutPreset: WindowLayoutPreset = .leftHalf,
        customRect: NormalizedRect? = nil,
        displayIndex: Int = 1,
        spaceIndex: Int = 1,
        isMinimized: Bool = false,
        isFullscreen: Bool = false,
        browserType: BrowserType? = nil,
        browserProfileDirectory: String? = "Default",
        browserProfileCustomName: String? = nil,
        urls: [String] = [],
        terminalType: TerminalType? = nil,
        terminalWorkingDirectory: String? = nil,
        terminalCommands: [String] = [],
        isEnabled: Bool = true
    ) {
        self.id = id
        self.name = name
        self.kind = kind
        self.bundleIdentifier = bundleIdentifier
        self.appPath = appPath
        self.filePath = filePath
        self.windowTitleHint = windowTitleHint
        self.layoutPreset = layoutPreset
        self.customRect = customRect ?? layoutPreset.normalizedRect
        self.displayIndex = max(1, displayIndex)
        self.spaceIndex = min(max(1, spaceIndex), 16)
        self.isMinimized = isMinimized
        self.isFullscreen = isFullscreen
        self.browserType = browserType
        self.browserProfileDirectory = browserProfileDirectory
        self.browserProfileCustomName = browserProfileCustomName
        self.urls = urls
        self.terminalType = terminalType
        self.terminalWorkingDirectory = terminalWorkingDirectory
        self.terminalCommands = terminalCommands
        self.isEnabled = isEnabled
    }

    public var effectiveRect: NormalizedRect {
        layoutPreset == .custom ? customRect : layoutPreset.normalizedRect
    }
}

public struct Workspace: Codable, Equatable, Hashable, Identifiable {
    public var id: UUID
    public var name: String
    public var iconName: String
    public var accentColorName: String
    public var items: [WorkspaceItem]
    public var hotkey: ShortcutCombo?
    public var stopBehavior: StopBehavior
    public var capturedSpaceCountsByScreen: [Int: Int]
    public var spaceNames: [Int: String]
    public var createdAt: Date
    public var updatedAt: Date

    public init(
        id: UUID = UUID(),
        name: String,
        iconName: String = "rectangle.3.group",
        accentColorName: String = "blue",
        items: [WorkspaceItem] = [],
        hotkey: ShortcutCombo? = nil,
        stopBehavior: StopBehavior = .minimizeWindows,
        capturedSpaceCountsByScreen: [Int: Int] = [1: 1],
        spaceNames: [Int: String] = [:],
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.name = name
        self.iconName = iconName
        self.accentColorName = accentColorName
        self.items = items
        self.hotkey = hotkey
        self.stopBehavior = stopBehavior
        self.capturedSpaceCountsByScreen = capturedSpaceCountsByScreen
        self.spaceNames = spaceNames
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    public var requiredSpacesCount: Int {
        let maxItemSpace = items.map(\.spaceIndex).max() ?? 1
        let maxCaptured = capturedSpaceCountsByScreen.values.max() ?? 1
        return max(maxItemSpace, maxCaptured)
    }

    public var swiftUIColor: Color {
        switch accentColorName {
        case "purple": return .purple
        case "orange": return .orange
        case "green": return .green
        case "red": return .red
        case "pink": return .pink
        case "teal": return .teal
        case "indigo": return .indigo
        default: return .blue
        }
    }
}
