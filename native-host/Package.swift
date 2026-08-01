// swift-tools-version: 5.9
// VPN Route Inspector — native macOS host for Chrome Native Messaging.
// Uses only Apple system libraries; no third-party dependencies.

import PackageDescription

let package = Package(
    name: "VpnRouteHost",
    products: [
        .executable(name: "vpn-route-host", targets: ["VpnRouteHost"]),
        .library(name: "VpnRouteHostCore", targets: ["VpnRouteHostCore"])
    ],
    targets: [
        .target(
            name: "VpnRouteHostCore",
            path: "Sources/VpnRouteHostCore"
        ),
        .executableTarget(
            name: "VpnRouteHost",
            dependencies: ["VpnRouteHostCore"],
            path: "Sources/VpnRouteHost"
        ),
        .testTarget(
            name: "VpnRouteHostCoreTests",
            dependencies: ["VpnRouteHostCore"],
            path: "Tests/VpnRouteHostCoreTests"
        )
    ]
)
