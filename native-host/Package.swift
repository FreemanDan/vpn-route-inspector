// swift-tools-version: 5.9
// VPN Route Inspector — native macOS host for Chrome Native Messaging.
// Uses only Apple system libraries; no third-party dependencies.
// Unit tests use the Swift Testing module supplied by the Swift 6.1+ toolchain
// (no XCTest, no external test packages). Tools version 5.9 remains sufficient:
// Swift Testing does not require a tools-version bump on this toolchain.

import PackageDescription

let package = Package(
    name: "VpnRouteHost",
    platforms: [
        .macOS(.v13)
    ],
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
