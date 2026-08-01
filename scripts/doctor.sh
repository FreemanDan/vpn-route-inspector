#!/bin/zsh
# Diagnostic checks for VPN Route Inspector development environment.
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
REPO_ROOT="${SCRIPT_DIR:h}"
HOST_DIR="${REPO_ROOT}/native-host"
BUILT_BINARY="${HOST_DIR}/.build/release/vpn-route-host"
MANUAL_BINARY="${HOST_DIR}/.manual-build/vpn-route-host"
INSTALLED_BINARY="${HOME}/Library/Application Support/VpnRouteInspector/vpn-route-host"
MANIFEST_PATH="${HOME}/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.freemandan.vpn_route_inspector.json"

pass_count=0
warn_count=0
fail_count=0

check_pass() {
  echo "  OK   $1"
  pass_count=$((pass_count + 1))
}

check_warn() {
  echo "  WARN $1"
  warn_count=$((warn_count + 1))
}

check_fail() {
  echo "  FAIL $1"
  fail_count=$((fail_count + 1))
}

echo "VPN Route Inspector — environment doctor"
echo "========================================="
echo ""

echo "Platform"
if [[ "$(uname -s)" == "Darwin" ]]; then
  arch="$(uname -m)"
  check_pass "macOS detected (${arch})"
else
  check_fail "Not macOS ($(uname -s)) — this project targets macOS only"
fi

echo ""
echo "Toolchain"
if command -v swift >/dev/null 2>&1; then
  check_pass "Swift available: $(swift --version | head -1)"
else
  check_fail "Swift not found — install Xcode Command Line Tools"
fi

if [[ -x /sbin/route ]]; then
  check_pass "/sbin/route exists and is executable"
else
  check_fail "/sbin/route not found or not executable"
fi

echo ""
echo "Google Chrome"
chrome_app="/Applications/Google Chrome.app"
if [[ -d "${chrome_app}" ]]; then
  check_pass "Google Chrome found at ${chrome_app}"
else
  check_warn "Google Chrome not found at ${chrome_app}"
fi

echo ""
echo "Native host build"
if [[ -f "${BUILT_BINARY}" && -x "${BUILT_BINARY}" ]]; then
  check_pass "Release binary built (SwiftPM): ${BUILT_BINARY}"
elif [[ -f "${MANUAL_BINARY}" && -x "${MANUAL_BINARY}" ]]; then
  check_pass "Release binary built (manual): ${MANUAL_BINARY}"
else
  check_warn "Release binary not built — run scripts/build-host.sh"
fi

echo ""
echo "Native host installation"
if [[ -f "${MANIFEST_PATH}" ]]; then
  check_pass "Native Messaging manifest exists: ${MANIFEST_PATH}"

  if command -v python3 >/dev/null 2>&1; then
    manifest_path="$(python3 - <<PY
import json
with open("${MANIFEST_PATH}", encoding="utf-8") as f:
    data = json.load(f)
print(data.get("path", ""))
PY
)"
    if [[ -n "${manifest_path}" && -f "${manifest_path}" && -x "${manifest_path}" ]]; then
      check_pass "Manifest path points to existing executable: ${manifest_path}"
    else
      check_fail "Manifest path does not point to an existing executable: ${manifest_path:-<missing>}"
    fi

    origins="$(python3 - <<PY
import json
with open("${MANIFEST_PATH}", encoding="utf-8") as f:
    data = json.load(f)
for o in data.get("allowed_origins", []):
    print(o)
PY
)"
    if [[ -n "${origins}" ]]; then
      check_pass "allowed_origins configured"
      echo "       ${origins}"
    else
      check_warn "allowed_origins is empty"
    fi
  else
    check_warn "python3 not available — skipping manifest content validation"
  fi
else
  check_warn "Native Messaging manifest not installed — run scripts/install-host.sh <extension-id>"
fi

if [[ -f "${INSTALLED_BINARY}" && -x "${INSTALLED_BINARY}" ]]; then
  check_pass "Installed binary exists: ${INSTALLED_BINARY}"
else
  check_warn "Installed binary not found at ${INSTALLED_BINARY}"
fi

echo ""
echo "Summary: ${pass_count} passed, ${warn_count} warnings, ${fail_count} failed"

if [[ "${fail_count}" -gt 0 ]]; then
  exit 1
fi

exit 0
