#!/bin/zsh
# Build and test the native host when SwiftPM manifest compilation fails due to
# duplicate SwiftBridging module maps in some Command Line Tools installs.
# Uses a VFS overlay to hide the duplicate bridging.modulemap.
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
HOST_DIR="${SCRIPT_DIR}"
VFS_OVERLAY="${HOST_DIR}/swift-vfs-overlay.yaml"
BUILD_DIR="${HOST_DIR}/.manual-build"
CORE_MODULE="${BUILD_DIR}/VpnRouteHostCore"
PRODUCT="${BUILD_DIR}/vpn-route-host"
TEST_BIN="${BUILD_DIR}/manual-test-runner"

SWIFTC="/usr/bin/swiftc"
SDK="/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk"
TARGET="arm64-apple-macosx13.0"

COMMON_FLAGS=(
  -vfsoverlay "${VFS_OVERLAY}"
  -sdk "${SDK}"
  -target "${TARGET}"
)

mkdir -p "${BUILD_DIR}"

echo "==> Building VpnRouteHostCore module..."
"${SWIFTC}" "${COMMON_FLAGS[@]}" \
  -module-name VpnRouteHostCore \
  -emit-module -emit-module-path "${BUILD_DIR}/VpnRouteHostCore.swiftmodule" \
  -enable-testing \
  -emit-library \
  -o "${BUILD_DIR}/libVpnRouteHostCore.dylib" \
  "${HOST_DIR}/Sources/VpnRouteHostCore/"*.swift

echo "==> Compiling and running manual unit tests..."
"${SWIFTC}" "${COMMON_FLAGS[@]}" \
  -parse-as-library \
  -I "${BUILD_DIR}" \
  -L "${BUILD_DIR}" \
  -lVpnRouteHostCore \
  -Xlinker -rpath -Xlinker "${BUILD_DIR}" \
  "${HOST_DIR}/Tests/ManualTestRunner/main.swift" \
  -o "${TEST_BIN}"

echo "==> Running unit tests..."
"${TEST_BIN}"

echo ""
echo "==> Building release executable..."
"${SWIFTC}" "${COMMON_FLAGS[@]}" -O \
  -parse-as-library \
  -I "${BUILD_DIR}" \
  -L "${BUILD_DIR}" \
  -lVpnRouteHostCore \
  -Xlinker -rpath -Xlinker "${BUILD_DIR}" \
  "${HOST_DIR}/Sources/VpnRouteHost/"*.swift \
  -o "${PRODUCT}"

echo ""
echo "Manual build complete."
echo "Release binary: ${PRODUCT}"
