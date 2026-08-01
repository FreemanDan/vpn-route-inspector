#!/bin/zsh
# Remove files installed by scripts/install-host.sh (this project only).
set -euo pipefail

INSTALL_DIR="${HOME}/Library/Application Support/VpnRouteInspector"
INSTALL_BINARY="${INSTALL_DIR}/vpn-route-host"
MANIFEST_PATH="${HOME}/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.freemandan.vpn_route_inspector.json"

removed_any=false

if [[ -f "${INSTALL_BINARY}" ]]; then
  echo "==> Removing ${INSTALL_BINARY}..."
  rm -f "${INSTALL_BINARY}"
  removed_any=true
fi

if [[ -d "${INSTALL_DIR}" ]] && [[ -z "$(ls -A "${INSTALL_DIR}" 2>/dev/null || true)" ]]; then
  echo "==> Removing empty directory ${INSTALL_DIR}..."
  rmdir "${INSTALL_DIR}" 2>/dev/null || true
fi

if [[ -f "${MANIFEST_PATH}" ]]; then
  echo "==> Removing ${MANIFEST_PATH}..."
  rm -f "${MANIFEST_PATH}"
  removed_any=true
fi

if [[ "${removed_any}" == true ]]; then
  echo "Uninstall complete."
else
  echo "Nothing to uninstall — no project files found."
fi
