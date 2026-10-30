// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "Latcraft",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "Latcraft", targets: ["Latcraft"])
    ],
    targets: [
        .executableTarget(
            name: "Latcraft",
            path: "Sources/Latcraft",
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("SwiftUI"),
                .linkedFramework("ApplicationServices"),
                .linkedFramework("Carbon"),
                .linkedFramework("ServiceManagement"),
                .linkedFramework("AppIntents"),
                .linkedFramework("UniformTypeIdentifiers")
            ]
        )
    ]
)
