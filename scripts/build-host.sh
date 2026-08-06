#!/bin/zsh
# Build the VPN Route Inspector native host via Swift Package Manager only.
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
REPO_ROOT="${SCRIPT_DIR:h}"
HOST_DIR="${REPO_ROOT}/native-host"
DIST_DIR="${HOST_DIR}/dist"
CANONICAL_BINARY="${DIST_DIR}/vpn-route-host"

echo "==> Removing previous dist output..."
rm -rf "${DIST_DIR}"
mkdir -p "${DIST_DIR}"

echo "==> Running Swift Testing suite via SwiftPM (swift test)..."
( cd "${HOST_DIR}" && swift test )

echo ""
echo "==> Building release executable..."
( cd "${HOST_DIR}" && swift build -c release )

echo ""
echo "==> Locating SwiftPM release binary..."
BUILD_BIN_DIR="$( cd "${HOST_DIR}" && swift build -c release --show-bin-path )"
SPM_BINARY="${BUILD_BIN_DIR}/vpn-route-host"

if [[ ! -f "${SPM_BINARY}" ]]; then
  echo "ERROR: SwiftPM release binary not found at ${SPM_BINARY}" >&2
  exit 1
fi

echo "==> Copying to canonical artifact path..."
cp "${SPM_BINARY}" "${CANONICAL_BINARY}"
chmod +x "${CANONICAL_BINARY}"

echo "==> Verifying Mach-O executable..."
FILE_OUTPUT="$(file "${CANONICAL_BINARY}")"
if [[ "${FILE_OUTPUT}" != *"Mach-O"* ]]; then
  echo "ERROR: Canonical binary is not a Mach-O executable:" >&2
  echo "  ${FILE_OUTPUT}" >&2
  exit 1
fi

echo "==> Checking dynamic library dependencies..."
FORBIDDEN=0
while IFS= read -r line; do
  [[ -z "${line}" ]] && continue
  # Strip leading whitespace, then drop the " (compatibility ...)" suffix.
  # Use "%% *" (not "%% (*") — unescaped "(" is a bad zsh glob pattern.
  dep="${line##[[:space:]]#}"
  dep="${dep%% *}"

  case "${dep}" in
    @executable_path/*|@loader_path/*|/usr/lib/*|/System/*|/usr/lib/swift/*)
      continue
      ;;
  esac

  if [[ "${dep}" == "${REPO_ROOT}"* ]] \
    || [[ "${dep}" == *"/.build/"* ]] \
    || [[ "${dep}" == *"/dist/"* ]] \
    || [[ "${dep}" == *"/native-host/"* ]]; then
    echo "ERROR: Forbidden repository-local dependency: ${dep}" >&2
    FORBIDDEN=1
  fi
done < <(otool -L "${CANONICAL_BINARY}" | tail -n +2)

if [[ "${FORBIDDEN}" -ne 0 ]]; then
  exit 1
fi

echo ""
echo "Build complete."
echo "Canonical release binary: ${CANONICAL_BINARY}"
