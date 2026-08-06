#!/bin/zsh
# Install the native messaging host for this project's stable Chrome extension ID.
# The ID is derived from extension/manifest.json "key" via scripts/extension-id.sh.
# No positional arguments — do not pass a manually copied extension ID.
set -euo pipefail

usage() {
  echo "Usage: $0" >&2
  echo "  Installs native-host/dist/vpn-route-host and a Native Messaging manifest" >&2
  echo "  whose allowed_origins entry is derived from the committed extension key." >&2
  echo "  Do not pass an extension ID argument." >&2
  exit 1
}

if [[ $# -ne 0 ]]; then
  usage
fi

SCRIPT_DIR="${0:A:h}"
REPO_ROOT="${SCRIPT_DIR:h}"
SOURCE_BINARY="${REPO_ROOT}/native-host/dist/vpn-route-host"
ID_SCRIPT="${SCRIPT_DIR}/extension-id.sh"

if [[ ! -f "${SOURCE_BINARY}" ]]; then
  echo "ERROR: Canonical binary not found at ${SOURCE_BINARY}" >&2
  echo "Run ./scripts/build-host.sh first (or ./scripts/setup.sh)." >&2
  exit 1
fi

if [[ ! -x "${ID_SCRIPT}" ]]; then
  echo "ERROR: Missing executable ${ID_SCRIPT}" >&2
  exit 1
fi

# Stable development ID from the committed public key — never from chrome://extensions.
EXTENSION_ID="$("${ID_SCRIPT}")"
if [[ ! "${EXTENSION_ID}" =~ '^[a-p]{32}$' ]]; then
  echo "ERROR: extension-id.sh returned an invalid ID: ${EXTENSION_ID}" >&2
  exit 1
fi

INSTALL_DIR="${HOME}/Library/Application Support/VpnRouteInspector"
INSTALL_BINARY="${INSTALL_DIR}/vpn-route-host"
MANIFEST_DIR="${HOME}/Library/Application Support/Google/Chrome/NativeMessagingHosts"
MANIFEST_PATH="${MANIFEST_DIR}/com.freemandan.vpn_route_inspector.json"
ALLOWED_ORIGIN="chrome-extension://${EXTENSION_ID}/"

# Temporary install artifacts. Manifest plist/json live under TMP_DIR so mktemp
# templates can end in XXXXXX (required on macOS) and so empty mktemp files are
# never passed to PlistBuddy before they are initialized as a real plist.
TMP_DIR=""
TMP_BINARY=""
TMP_MANIFEST=""
cleanup() {
  [[ -n "${TMP_BINARY}" && -f "${TMP_BINARY}" ]] && rm -f "${TMP_BINARY}"
  [[ -n "${TMP_MANIFEST}" && -f "${TMP_MANIFEST}" ]] && rm -f "${TMP_MANIFEST}"
  [[ -n "${TMP_DIR}" && -d "${TMP_DIR}" ]] && rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

echo "==> Stable extension ID: ${EXTENSION_ID}"
echo "==> Allowed origin: ${ALLOWED_ORIGIN}"

echo "==> Creating install directories..."
mkdir -p "${INSTALL_DIR}"
mkdir -p "${MANIFEST_DIR}"

echo "==> Installing binary to ${INSTALL_BINARY}..."
TMP_BINARY="$(mktemp "${INSTALL_DIR}/.vpn-route-host.XXXXXX")"
cp "${SOURCE_BINARY}" "${TMP_BINARY}"
chmod +x "${TMP_BINARY}"
mv -f "${TMP_BINARY}" "${INSTALL_BINARY}"
TMP_BINARY=""

echo "==> Generating Native Messaging manifest..."

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/vpn-route-inspector.XXXXXX")"
TMP_PLIST="${TMP_DIR}/manifest.plist"
TMP_JSON="${TMP_DIR}/manifest.json"

# PlistBuddy cannot Add keys into a zero-length file; create a valid empty plist first.
/usr/bin/plutil -create xml1 "${TMP_PLIST}"

/usr/libexec/PlistBuddy \
  -c "Add :name string com.freemandan.vpn_route_inspector" \
  "${TMP_PLIST}"

/usr/libexec/PlistBuddy \
  -c "Add :description string VPN Route Inspector native host for macOS route lookups" \
  "${TMP_PLIST}"

/usr/libexec/PlistBuddy \
  -c "Add :path string ${INSTALL_BINARY}" \
  "${TMP_PLIST}"

/usr/libexec/PlistBuddy \
  -c "Add :type string stdio" \
  "${TMP_PLIST}"

/usr/libexec/PlistBuddy \
  -c "Add :allowed_origins array" \
  "${TMP_PLIST}"

# Exactly one origin — the stable project ID. No wildcards, no manual IDs.
/usr/libexec/PlistBuddy \
  -c "Add :allowed_origins:0 string ${ALLOWED_ORIGIN}" \
  "${TMP_PLIST}"

/usr/bin/plutil -convert json -o "${TMP_JSON}" "${TMP_PLIST}"
# Validate structure on the XML plist. On macOS 15, `plutil -lint` falsely rejects
# valid JSON ("Unexpected character {"), so confirm the JSON by round-tripping it.
/usr/bin/plutil -lint "${TMP_PLIST}" >/dev/null
/usr/bin/plutil -convert xml1 -o /dev/null "${TMP_JSON}"

TMP_MANIFEST="$(mktemp "${MANIFEST_DIR}/.com.freemandan.vpn_route_inspector.json.XXXXXX")"
cp "${TMP_JSON}" "${TMP_MANIFEST}"
mv -f "${TMP_MANIFEST}" "${MANIFEST_PATH}"
TMP_MANIFEST=""

echo ""
echo "Installation complete."
echo "  Stable extension ID: ${EXTENSION_ID}"
echo "  Binary:              ${INSTALL_BINARY}"
echo "  Manifest:            ${MANIFEST_PATH}"
echo "  Allowed origin:      ${ALLOWED_ORIGIN}"
