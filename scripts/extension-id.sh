#!/bin/zsh
# Derive the stable Chrome extension ID from extension/manifest.json "key".
# Prints only the 32-character ID (a–p) to stdout. Diagnostics go to stderr.
# Algorithm: SHA-256(DER SubjectPublicKeyInfo) → first 16 bytes as hex → map 0–9a–f → a–p.
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
REPO_ROOT="${SCRIPT_DIR:h}"
MANIFEST_PATH="${REPO_ROOT}/extension/manifest.json"

if [[ $# -ne 0 ]]; then
  echo "Usage: $0" >&2
  echo "  Reads the committed public key from extension/manifest.json." >&2
  echo "  Does not accept an extension ID argument." >&2
  exit 1
fi

if [[ ! -f "${MANIFEST_PATH}" ]]; then
  echo "ERROR: Extension manifest not found at ${MANIFEST_PATH}" >&2
  exit 1
fi

# Extract the base64-encoded DER SubjectPublicKeyInfo from the committed "key" field.
PUBLIC_KEY_B64="$(/usr/bin/plutil -extract key raw -o - "${MANIFEST_PATH}" 2>/dev/null || true)"
if [[ -z "${PUBLIC_KEY_B64}" ]]; then
  echo "ERROR: extension/manifest.json is missing a non-empty \"key\" field." >&2
  exit 1
fi

TMP_DER=""
cleanup() {
  [[ -n "${TMP_DER}" && -f "${TMP_DER}" ]] && rm -f "${TMP_DER}"
}
trap cleanup EXIT

TMP_DER="$(mktemp "${TMPDIR:-/tmp}/vpn-route-inspector-spki.XXXXXX")"

# Decode base64 → DER bytes. Fail visibly if the key is not valid base64.
if ! printf '%s' "${PUBLIC_KEY_B64}" | /usr/bin/base64 -D -o "${TMP_DER}" 2>/dev/null; then
  echo "ERROR: Failed to base64-decode the manifest \"key\" field." >&2
  exit 1
fi

if [[ ! -s "${TMP_DER}" ]]; then
  echo "ERROR: Decoded public key is empty." >&2
  exit 1
fi

# SHA-256 of the DER SPKI, take the first 32 hex characters (16 bytes).
HASH_HEX="$(
  /usr/bin/openssl dgst -sha256 -binary "${TMP_DER}" \
    | /usr/bin/xxd -p -c 256 \
    | /usr/bin/cut -c1-32 \
    | /usr/bin/tr '[:upper:]' '[:lower:]'
)"

if [[ ! "${HASH_HEX}" =~ '^[0-9a-f]{32}$' ]]; then
  echo "ERROR: Unexpected SHA-256 hex prefix: ${HASH_HEX}" >&2
  exit 1
fi

# Chrome extension ID alphabet: 0–9 → a–j, a–f → k–p.
EXTENSION_ID="$(printf '%s' "${HASH_HEX}" | /usr/bin/tr '0-9a-f' 'a-p')"

if [[ ! "${EXTENSION_ID}" =~ '^[a-p]{32}$' ]]; then
  echo "ERROR: Calculated extension ID is invalid: ${EXTENSION_ID}" >&2
  exit 1
fi

# stdout: ID only (consumed by install-host.sh / doctor.sh / setup.sh).
printf '%s\n' "${EXTENSION_ID}"
