#!/bin/zsh
# One-command setup: build native host, install Native Messaging host, run doctor.
# Does not modify the Chrome profile or auto-load the unpacked extension.
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
REPO_ROOT="${SCRIPT_DIR:h}"
EXTENSION_DIR="${REPO_ROOT}/extension"

echo "==> Building native host..."
"${SCRIPT_DIR}/build-host.sh"

echo ""
echo "==> Installing native messaging host..."
"${SCRIPT_DIR}/install-host.sh"

echo ""
echo "==> Running environment doctor..."
"${SCRIPT_DIR}/doctor.sh"

STABLE_ID="$("${SCRIPT_DIR}/extension-id.sh")"

echo ""
echo "========================================="
echo "Setup complete."
echo ""
echo "Stable extension ID:"
echo "  ${STABLE_ID}"
echo ""
echo "Load this unpacked extension directory in Chrome"
echo "(chrome://extensions → Developer mode → Load unpacked):"
echo "  ${EXTENSION_DIR}"
echo ""
echo "Fully quit Chrome with Command+Q and reopen it."
echo "========================================="
