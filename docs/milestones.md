# Milestones

Small, independently verifiable milestones for VPN Route Inspector.

## 1. Manual IP route check ✅

**Goal:** User enters an IPv4; extension returns interface and route type.

**Verify:**
- `./scripts/setup.sh` passes; install derives the stable ID from the committed extension `key`
- Unpacked `extension/` loaded; Chrome fully restarted after native host install; **Check route** succeeds
- Shows `en0` / `DIRECT` with VPN off; `utun*` / `VPN` for non-excluded IPs with VPN on

## 2. Active-tab response capture ✅

**Goal:** User starts capture on one HTTP/HTTPS tab; Side Panel lists responses for that tab only.

**Verify:**
- Manifest permissions include `nativeMessaging`, `webRequest`, `storage`, `activeTab`, `sidePanel`
- Broad access is only `optional_host_permissions` (no permanent `<all_urls>`)
- Session recovered from `storage.session` after MV3 worker restart
- Entries stored even when `details.ip` is missing
- No bodies/headers/cookies; max 500 entries
- Stable extension ID remains `iipnohegjdidiffjfhlccfbpbjeeicba`
- Pure capture-core tests pass via macOS `jsc`

## 3. Automatic split-tunneling diagnosis (batch routes) ✅ (current)

**Goal:** After capture, the user clicks **Analyze captured routes**. The extension batches unique IPv4s into one Native Messaging `checkRoutes` call, classifies current macOS routes, and shows a concise diagnostic summary with copyable exclusion candidates.

**Important interpretation boundary:** `/sbin/route -n get` reports the **current** macOS route at analysis time. It does **not** prove which route a previously completed TCP/QUIC connection used. This is strong evidence when Chrome observed a remote IP, the current route is VPN, and the capture shows HTTP/network errors — not packet capture.

**Verify:**
- Manifest version ≥ `0.3.0`
- Native host keeps `checkRoute` backward compatible and adds `checkRoutes`
- Batch validates `ips` (required array, non-empty, ≤128), trims, dedupes valid IPv4s, sequential Process calls
- Per-item errors (`INVALID_IP`, `ROUTE_COMMAND_FAILED`, `INTERFACE_NOT_FOUND`) do not abort the batch
- Top-level batch errors: `INVALID_IP_LIST`, `EMPTY_IP_LIST`, `TOO_MANY_IPS`
- Extension action `CAPTURE_ANALYZE_ROUTES` only (never from webRequest listeners)
- One analysis at a time (`ALREADY_ANALYZING`); stale-write protection via source fingerprint
- Findings: `ERROR_VIA_VPN`, `MIXED_ROUTING`, `ERROR_VIA_DIRECT`, `VPN_WITHOUT_ERROR`, `UNCLASSIFIED_ERROR`
- Candidates only from `ERROR_VIA_VPN` and VPN side of `MIXED_ROUTING`
- `ERR_NETWORK_CHANGED` without IP counted/aggregated, never a candidate
- IPv6 labelled “Route analysis not supported yet”
- Side Panel prioritizes diagnosis; raw list secondary; **Copy candidate IPs**; current-route warning visible
- Manual **Check route** still works (collapsed Manual tools)
- Swift Testing + JavaScriptCore tests pass
- Stable ID unchanged

### Diagnostic report export (0.3.1+)

**Verify:**
- **Copy diagnostic report** produces privacy-reduced Markdown from `storage.session`
- Query strings / fragments / userinfo removed; no raw event dump
- Stale analysis labelled; candidates come from stored `candidateExclusionIps`
- **Copy full technical JSON** is under Advanced diagnostics with a visible path/query warning
- Full JSON parses; size > 4 MiB returns `EXPORT_TOO_LARGE`
- Nothing uploaded; clipboard only
- Manifest version ≥ `0.3.1`; stable ID unchanged
- Pure report helpers covered by JavaScriptCore tests

## 4. Domain/IP grouping (partially covered by M3)

**Goal:** Richer grouping / registrable-domain UX beyond hostname→IPv4 pairs already shown in M3.

## 5. DNS and CNAME inspection

**Goal:** Show DNS resolution chain to explain why multiple IPs appear.

**Out of scope for Milestone 3.**

## 6. Route recheck after exclusions / history

**Goal:** Before/after comparison history after user updates VPN split-tunnel rules.

**Out of scope for Milestone 3** (user can click **Re-analyze routes** for a fresh snapshot).

## 7. Stale-browser-state workflow polish

**Goal:** Stronger UX checklist after VPN exclusion changes (reconnect VPN → Command+Q → recapture).

Milestone 3 already surfaces `ERROR_VIA_DIRECT` guidance mentioning Command+Q as one possibility.
