#!/bin/zsh
# Install the native messaging host for a specific unpacked Chrome extension ID.
set -euo pipefail

usage() {
  echo "Usage: $0 <chrome-extension-id>" >&2
  echo "  chrome-extension-id: exactly 32 lowercase a-p characters" >&2
  exit 1
}

if [[ $# -ne 1 ]]; then
  usage
fi

EXTENSION_ID="$1"

# Chrome extension IDs use base16 letters a–p only (32 chars).
if [[ ! "${EXTENSION_ID}" =~ '^[a-p]{32}$' ]]; then
  echo "ERROR: Invalid extension ID. Expected exactly 32 lowercase a-p characters." >&2
  exit 1
fi

SCRIPT_DIR="${0:A:h}"
REPO_ROOT="${SCRIPT_DIR:h}"
HOST_DIR="${REPO_ROOT}/native-host"
SOURCE_BINARY="${HOST_DIR}/.build/release/vpn-route-host"
MANUAL_BINARY="${HOST_DIR}/.manual-build/vpn-route-host"

if [[ -f "${SOURCE_BINARY}" ]]; then
  :
elif [[ -f "${MANUAL_BINARY}" ]]; then
  SOURCE_BINARY="${MANUAL_BINARY}"
else
  echo "ERROR: Release binary not found. Run scripts/build-host.sh first." >&2
  echo "  Expected: ${SOURCE_BINARY}" >&2
  exit 1
fi

INSTALL_DIR="${HOME}/Library/Application Support/VpnRouteInspector"
INSTALL_BINARY="${INSTALL_DIR}/vpn-route-host"
MANIFEST_DIR="${HOME}/Library/Application Support/Google/Chrome/NativeMessagingHosts"
MANIFEST_PATH="${MANIFEST_DIR}/com.freemandan.vpn_route_inspector.json"

echo "==> Creating install directory..."
mkdir -p "${INSTALL_DIR}"
mkdir -p "${MANIFEST_DIR}"

echo "==> Installing binary to ${INSTALL_BINARY}..."
cp -f "${SOURCE_BINARY}" "${INSTALL_BINARY}"
chmod +x "${INSTALL_BINARY}"

echo "==> Writing Native Messaging manifest to ${MANIFEST_PATH}..."

# Use python3 for JSON generation to avoid shell-escaping issues with paths.
python3 - <<PY
import json
import os

manifest = {
    "name": "com.freemandan.vpn_route_inspector",
    "description": "VPN Route Inspector native host for macOS route lookups",
    "path": os.path.abspath("${INSTALL_BINARY}"),
    "type": "stdio",
    "allowed_origins": [
        "chrome-extension://${EXTENSION_ID}/"
    ],
}

with open("${MANIFEST_PATH}", "w", encoding="utf-8") as f:
    json.dump(manifest, f, indent=2)
    f.write("\n")
PY

echo ""
echo "Installation complete."
echo "  Binary:    ${INSTALL_BINARY}"
echo "  Manifest:  ${MANIFEST_PATH}"
echo "  Extension: chrome-extension://${EXTENSION_ID}/"
