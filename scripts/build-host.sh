#!/bin/zsh
# Build the VPN Route Inspector native host (release) and run Swift tests.
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
REPO_ROOT="${SCRIPT_DIR:h}"
HOST_DIR="${REPO_ROOT}/native-host"
VFS_OVERLAY="${HOST_DIR}/swift-vfs-overlay.yaml"

SPM_BINARY="${HOST_DIR}/.build/release/vpn-route-host"
MANUAL_BINARY="${HOST_DIR}/.manual-build/vpn-route-host"

run_spm_build() {
  echo "==> Running Swift tests (SwiftPM)..."
  (cd "${HOST_DIR}" && swift test \
    -Xswiftc -vfsoverlay -Xswiftc "${VFS_OVERLAY}")

  echo ""
  echo "==> Building release executable (SwiftPM)..."
  (cd "${HOST_DIR}" && swift build -c release \
    -Xswiftc -vfsoverlay -Xswiftc "${VFS_OVERLAY}")
}

if run_spm_build 2>/dev/null; then
  BINARY_PATH="${SPM_BINARY}"
else
  echo "SwiftPM build unavailable (often due to CLT SwiftBridging module map conflict)."
  echo "==> Falling back to manual swiftc build with VFS overlay..."
  echo ""
  chmod +x "${HOST_DIR}/build-manual.sh"
  "${HOST_DIR}/build-manual.sh"
  BINARY_PATH="${MANUAL_BINARY}"
fi

if [[ ! -f "${BINARY_PATH}" ]]; then
  echo "ERROR: Expected binary not found at ${BINARY_PATH}" >&2
  exit 1
fi

echo ""
echo "Build complete."
echo "Release binary: ${BINARY_PATH}"
