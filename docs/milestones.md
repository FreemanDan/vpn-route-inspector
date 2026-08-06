# Milestones

Small, independently verifiable milestones for VPN Route Inspector.

## 1. Manual IP route check ✅

**Goal:** User enters an IPv4 in the popup; extension returns interface and route type.

**Verify:**
- `./scripts/setup.sh` (or `build-host.sh` + `install-host.sh` + `doctor.sh`) passes; install derives the stable ID from the committed extension `key` (no manual ID argument)
- Unpacked `extension/` loaded once in Chrome; Chrome fully restarted after native host install; popup **Check route** succeeds
- Popup shows `en0` / `DIRECT` with VPN off
- Popup shows `utun*` / `VPN` for non-excluded IPs with VPN on

## 2. Active-tab response capture ✅ (current)

**Goal:** User starts capture on one HTTP/HTTPS tab; after reload, the popup lists responses for that tab only (hostname, remote IP from Chrome, status, type, method, cache).

**Verify:**
- Manifest version ≥ `0.2.0`; permissions include `nativeMessaging`, `webRequest`, `storage`, `activeTab`
- Broad access is only `optional_host_permissions` for `http://*/*` and `https://*/*` (no permanent `<all_urls>`)
- **Start capture and reload** requests optional hosts from the click handler; deny path shows a clear message and does not start
- Capture binds to the active tab’s numeric ID; other tabs’ requests do not appear
- Entries show hostname, remote IP when Chrome supplies `details.ip` (may be missing or IPv6), status / ERR, resource type, method, CACHE when applicable
- Stop prevents new entries; Clear empties the list; Revoke network access stops, clears, and removes optional hosts
- Captured data lives only in `chrome.storage.session` (max 500 entries); no bodies/headers/cookies
- Manual **Check route** still works (`en0` / `DIRECT`, `utun*` / `VPN`)
- Stable extension ID remains `iipnohegjdidiffjfhlccfbpbjeeicba` (committed `key` unchanged)
- No native-host changes required for this milestone; captured IPs are **not** auto route-checked yet

## 3. Actual remote-IP collection (superseded in part by Milestone 2)

**Goal:** Determine the IP address Chrome actually connected to (not just DNS resolution).

**Note:** Milestone 2 already stores `details.ip` from `webRequest.onResponseStarted` when Chrome provides it. Remaining work is documentation of QUIC/HTTP3 gaps and UX for missing IPs.

**Verify:**
- For a multi-IP hostname, displayed IP matches the connection used when Chrome reports it
- Document limitation when HTTP/3/QUIC obscures remote IP

## 4. Domain/IP grouping

**Goal:** Group collected IPs by registrable domain / hostname.

**Verify:**
- UI shows hostname → list of observed IPs with last-seen timestamp
- Duplicate IPs collapsed per hostname

## 5. VPN/DIRECT route checks (batch)

**Goal:** Route-check all collected IPs automatically.

**Verify:**
- Mixed `DIRECT` and `VPN` results for multi-IP hostnames
- Batch native host action (if added) handles timeouts gracefully
- Must **not** call the native host from inside every webRequest listener

## 6. Export of problematic IPs

**Goal:** Export IPs that route through VPN (`utun*`) for exclusion list preparation.

**Verify:**
- Copy or download plain-text list of VPN-routed IPs
- No machine-specific paths in exported content

## 7. DNS and CNAME inspection

**Goal:** Show DNS resolution chain to explain why multiple IPs appear.

**Verify:**
- Display A/AAAA records and CNAME chain for selected hostname
- Clearly label DNS vs observed connection IP

## 8. Route recheck after exclusions

**Goal:** Re-run route checks after user updates VPN split-tunnel rules.

**Verify:**
- "Recheck all" updates classifications
- Document need to reconnect VPN and restart Chrome

## 9. Stale-browser-state warning and diagnostic workflow

**Goal:** Warn when results may be stale due to Chrome connection caching.

**Verify:**
- UI explains Command+Q restart requirement
- Optional checklist: reconnect VPN → restart Chrome → recheck
