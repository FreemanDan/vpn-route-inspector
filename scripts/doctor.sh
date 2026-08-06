#!/bin/zsh
# Diagnostic checks for VPN Route Inspector development environment.
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
REPO_ROOT="${SCRIPT_DIR:h}"
DIST_BINARY="${REPO_ROOT}/native-host/dist/vpn-route-host"
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
if xcrun --find swift >/dev/null 2>&1; then
  check_pass "swift: $(xcrun --find swift)"
else
  check_fail "xcrun --find swift failed"
fi

if xcrun --find swiftc >/dev/null 2>&1; then
  check_pass "swiftc: $(xcrun --find swiftc)"
else
  check_fail "xcrun --find swiftc failed"
fi

if command -v swift >/dev/null 2>&1; then
  check_pass "Swift version: $(swift --version | head -1)"
else
  check_fail "swift not available"
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
echo "Canonical build artifact"
if [[ -f "${DIST_BINARY}" && -x "${DIST_BINARY}" ]]; then
  check_pass "dist binary exists: ${DIST_BINARY}"
  file_output="$(file "${DIST_BINARY}")"
  if [[ "${file_output}" == *"Mach-O"* ]]; then
    check_pass "dist binary is Mach-O"
  else
    check_fail "dist binary is not Mach-O: ${file_output}"
  fi

  forbidden_dep=0
  while IFS= read -r line; do
    [[ -z "${line}" ]] && continue
    # Strip leading whitespace, then drop the " (compatibility ...)" suffix.
    # Use "%% *" (not "%% (*") — unescaped "(" is a bad zsh glob pattern.
    dep="${line##[[:space:]]#}"
    dep="${dep%% *}"
    case "${dep}" in
      @executable_path/*|@loader_path/*|/usr/lib/*|/System/*|/usr/lib/swift/*) continue ;;
    esac
    if [[ "${dep}" == "${REPO_ROOT}"* ]] || [[ "${dep}" == *"/.build/"* ]] || [[ "${dep}" == *"/dist/"* ]]; then
      check_fail "dist binary depends on repository path: ${dep}"
      forbidden_dep=1
    fi
  done < <(otool -L "${DIST_BINARY}" | tail -n +2)
  if [[ "${forbidden_dep}" -eq 0 ]]; then
    check_pass "dist binary has no repository-local runtime dependencies"
  fi
else
  check_warn "dist binary missing — run ./scripts/build-host.sh"
fi

echo ""
echo "Native host installation"
if [[ -f "${MANIFEST_PATH}" ]]; then
  # On macOS 15, `plutil -lint` falsely rejects valid JSON ("Unexpected character {").
  # Round-trip through plutil instead to confirm the manifest is readable property-list JSON.
  if plutil -convert xml1 -o /dev/null "${MANIFEST_PATH}" 2>/dev/null; then
    check_pass "Native Messaging manifest is valid JSON/plist: ${MANIFEST_PATH}"
  else
    check_fail "Native Messaging manifest is malformed: ${MANIFEST_PATH}"
  fi

  manifest_name="$(plutil -extract name raw -o - "${MANIFEST_PATH}" 2>/dev/null || echo "")"
  if [[ "${manifest_name}" == "com.freemandan.vpn_route_inspector" ]]; then
    check_pass "manifest name is correct"
  else
    check_fail "manifest name is incorrect: ${manifest_name:-<missing>}"
  fi

  manifest_path="$(plutil -extract path raw -o - "${MANIFEST_PATH}" 2>/dev/null || echo "")"
  expected_path="${INSTALLED_BINARY}"
  if [[ "${manifest_path}" == "${expected_path}" ]]; then
    check_pass "manifest path matches expected installed executable"
  else
    check_fail "manifest path mismatch: ${manifest_path:-<missing>}"
  fi

  if [[ -n "${manifest_path}" && -f "${manifest_path}" && -x "${manifest_path}" ]]; then
    check_pass "installed executable exists and is executable"
  else
    check_fail "installed executable missing or not executable: ${manifest_path:-<missing>}"
  fi

  origin="$(plutil -extract allowed_origins.0 raw -o - "${MANIFEST_PATH}" 2>/dev/null || echo "")"
  if [[ "${origin}" =~ '^chrome-extension://[a-p]{32}/$' ]]; then
    check_pass "allowed_origins contains a valid extension origin"
    echo "       ${origin}"
  else
    check_fail "allowed_origins is missing or invalid: ${origin:-<missing>}"
  fi

  if [[ -f "${INSTALLED_BINARY}" && -x "${INSTALLED_BINARY}" ]]; then
    # Closing stdin immediately should let the host exit without hanging.
    if "${INSTALLED_BINARY}" </dev/null >/dev/null 2>&1; then
      check_pass "installed binary starts and exits cleanly with closed stdin"
    else
      check_fail "installed binary did not exit cleanly with closed stdin"
    fi

    forbidden_installed=0
    while IFS= read -r line; do
      [[ -z "${line}" ]] && continue
      # Same otool suffix trim as above — avoid unescaped "(" in zsh patterns.
      dep="${line##[[:space:]]#}"
      dep="${dep%% *}"
      case "${dep}" in
        @executable_path/*|@loader_path/*|/usr/lib/*|/System/*|/usr/lib/swift/*) continue ;;
      esac
      if [[ "${dep}" == "${REPO_ROOT}"* ]] || [[ "${dep}" == *"/.build/"* ]] || [[ "${dep}" == *"/dist/"* ]]; then
        check_fail "installed binary depends on repository path: ${dep}"
        forbidden_installed=1
      fi
    done < <(otool -L "${INSTALLED_BINARY}" | tail -n +2)
    if [[ "${forbidden_installed}" -eq 0 ]]; then
      check_pass "installed binary has no repository-local runtime dependencies"
    fi
  else
    check_warn "installed binary not present for runtime checks"
  fi
else
  check_warn "Native Messaging manifest not installed — run scripts/install-host.sh <extension-id>"
fi

echo ""
echo "Summary: ${pass_count} passed, ${warn_count} warnings, ${fail_count} failed"

if [[ "${fail_count}" -gt 0 ]]; then
  exit 1
fi

exit 0
