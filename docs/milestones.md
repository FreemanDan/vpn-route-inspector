# Milestones

Small, independently verifiable milestones for VPN Route Inspector.

## 1. Manual IP route check ✅ (current)

**Goal:** User enters an IPv4 in the popup; extension returns interface and route type.

**Verify:**
- `./scripts/build-host.sh` passes (`swift test` with Swift Testing via SwiftPM, `swift build -c release`, artifact at `native-host/dist/vpn-route-host`; no XCTest, no fallback runner; failed tests fail the build)
- `./scripts/install-host.sh <extension-id>` installs manifest
- Chrome fully restarted; popup **Check route** succeeds
- Popup shows `en0` / `DIRECT` with VPN off
- Popup shows `utun*` / `VPN` for non-excluded IPs with VPN on

## 2. Active-tab request capture

**Goal:** List network requests initiated by the currently active tab.

**Verify:**
- Extension shows recent request URLs/hostnames for active tab only
- No native host changes required for basic listing
- Permissions added incrementally (not `<all_urls>` unless required)

## 3. Actual remote-IP collection

**Goal:** Determine the IP address Chrome actually connected to (not just DNS resolution).

**Verify:**
- For a multi-IP hostname, displayed IP matches the connection used
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
