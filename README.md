# VPN Route Inspector

Local diagnostic tool for **macOS** and **Google Chrome** that helps investigate split-tunnel VPN routing problems.

## Problem this project solves

When a VPN client uses split tunneling, only some traffic is routed through the VPN tunnel. In real-world cases (verified on sites such as Wildberries and Ozon):

1. A hostname resolves to **multiple IPv4 addresses**.
2. The VPN may create exclusion rules for **only some** of those IPs.
3. One IP for the same hostname may route through a `utun` interface (VPN) while another routes directly via `en0`.
4. The site may return **HTTP 403** when the request reaches it through the VPN path.
5. After route changes, Chrome may keep stale HTTP/2, QUIC, DNS, Service Worker, or socket state — a **full browser restart** (Command+Q) may be required.

VPN Route Inspector helps you see **which remote IPv4 Chrome actually used**, **how macOS currently routes those IPs**, and **which IPs are strong candidates for VPN exclusions**.

## Current milestone scope

**Milestone 1 (complete):** manual IPv4 route check via Native Messaging (`checkRoute`).

**Milestone 2 (complete):** user-controlled capture of network responses for one active HTTP/HTTPS tab (Chrome Side Panel + `chrome.storage.session`).

**Milestone 3 (current):** explicit batch route analysis of captured unique IPv4s (`checkRoutes`) and split-tunnel diagnosis.

```
Side Panel → service worker → chrome.webRequest (one tab)
                            ↘ chrome.storage.session (metadata + diagnostics + routeAnalysis)

Side Panel → Analyze captured routes → CAPTURE_ANALYZE_ROUTES
           → one Native Messaging checkRoutes batch → Swift host → /sbin/route (sequential)
           → diagnostic findings + candidate exclusion IPs
```

Remote IPs come from Chrome `webRequest` response metadata (`details.ip`), **not** from DNS. Route classification uses `/sbin/route -n get` at **analysis time** — a snapshot of the current macOS routing table, not packet capture of the earlier connection.

**No route check runs inside webRequest listeners.** Analysis starts only when you click **Analyze captured routes** (or **Re-analyze routes**).

IPv6 entries remain visible but are labelled **Route analysis not supported yet**. Bodies, headers, cookies, and authorization values are **not** captured. The stable extension `key` / ID must remain unchanged.

## Prerequisites

- macOS 13 or later (minimum supported platform)
- Xcode Command Line Tools with **Swift 6.1 or newer** (Swift Package Manager + Swift Testing)
- Google Chrome
- An active network connection

Full Xcode is **not** required. Unit tests use **Swift Testing**, not XCTest. No Node.js, npm, Python, or Homebrew dependencies for build, installation, diagnostics, or runtime.

## Stable extension identity

Expected stable ID (committed public `key` in `extension/manifest.json`):

```
iipnohegjdidiffjfhlccfbpbjeeicba
```

Private PEM: `$HOME/.config/vpn-route-inspector/chrome-extension.pem` (never commit).

## One-time setup

```bash
chmod +x scripts/*.sh
./scripts/setup.sh
```

Then load / reload the unpacked `extension/` folder at `chrome://extensions/` and confirm the ID. Fully quit Chrome with **Command+Q** after native host install changes.

## Split-tunnel diagnosis (Milestone 3)

1. Wait until VPN/network state is stable.
2. Open Side Panel → **Start capture and reload** on Wildberries, Ozon, or similar.
3. Stop capture after the page settles.
4. Click **Analyze captured routes**.
5. Review the **Route analysis** summary (Unique IPv4 / VPN / DIRECT / UNKNOWN).
6. Inspect **Problematic routes** (ERROR VIA VPN, MIXED ROUTING, …).
7. Click **Copy candidate IPs** for newline-separated exclusion candidates only.
8. Click **Copy diagnostic report** for a privacy-reduced Markdown summary suitable for support chat.
9. Optional advanced: **Copy full technical JSON** (contains path/query data — review before sharing).
10. Optional: change a VPN exclusion, reconnect VPN, **Re-analyze routes** and confirm the current route snapshot changed.
11. Manual **Check route** remains under **Manual tools**.

### Diagnostic report export

**Copy diagnostic report** builds Markdown from the authoritative `chrome.storage.session` capture session (service worker actions `CAPTURE_EXPORT_REPORT` / `CAPTURE_EXPORT_JSON`). The Side Panel only copies the returned string — it does not reconstruct diagnosis from a stale DOM snapshot.

The Markdown report:

- aggregates evidence (no raw hundreds-of-events dump);
- removes URL query strings, fragments, and userinfo;
- labels stale analysis clearly;
- never includes cookies, authorization values, headers, or bodies;
- stays under 100,000 characters with explicit truncation notes when sections are capped.

**Full technical JSON** is an explicit advanced action only. It may contain captured URLs including path and query data. Nothing is uploaded automatically; exports stay on the clipboard.

### Diagnostic categories

| Category | Meaning | Candidate IP? |
|----------|---------|---------------|
| `ERROR_VIA_VPN` | Captured IPv4 routes VPN **and** HTTP 4xx/5xx or network error | Yes |
| `MIXED_ROUTING` | Same hostname has both DIRECT and VPN IPv4s | VPN-side IPs |
| `ERROR_VIA_DIRECT` | Failure while current route is already DIRECT | No |
| `VPN_WITHOUT_ERROR` | VPN route, no failure observed | No (unless also MIXED) |
| `UNCLASSIFIED_ERROR` | Failure without usable IPv4 route classification | No |

`net::ERR_NETWORK_CHANGED` events without an IP are preserved and counted, aggregated in the summary, and **never** become exclusion candidates. They are not interpreted as a blocked VPN destination.

### Stale analysis

`CAPTURE_START`, `CAPTURE_CLEAR`, and revoke reset analysis. New captured entries after a completed analysis mark it **stale**. Stop capture keeps completed analysis. Only one analysis runs at a time (`ALREADY_ANALYZING`). In-flight results are discarded if the capture IPv4 set / session identity changed.

## Active tab capture (Milestone 2)

1. Open a normal `http:` / `https:` page.
2. Open the **Side Panel**.
3. **Start capture and reload** (optional host access from that click).
4. Watch entries / diagnostics; expand **Raw captured responses** for technical detail.
5. **Stop** / **Clear** / **Revoke** as needed.

## Build / install / doctor

```bash
./scripts/build-host.sh    # swift test + release → native-host/dist/vpn-route-host
./scripts/install-host.sh  # stable ID from scripts/extension-id.sh
./scripts/doctor.sh
```

Swift Package Manager is the only supported build path. No fallback build.

## Manual route check

Under **Manual tools** in the Side Panel (or via `CHECK_ROUTE`):

| VPN state | Typical interface | Route type |
|-----------|-------------------|------------|
| VPN off   | `en0` (or `en1`)  | `DIRECT`   |
| VPN on, IP not excluded | `utun*` | `VPN` |
| VPN on, IP excluded     | `en0`   | `DIRECT`   |

## Uninstall

```bash
./scripts/uninstall-host.sh
```

## Project layout

```
extension/          Chrome MV3 extension (plain JS/HTML/CSS; committed public key)
native-host/        Swift native messaging host (SwiftPM)
scripts/            setup, build, install, uninstall, doctor, extension-id
docs/               architecture and milestone documentation
```

## Documentation

- [Architecture](docs/architecture.md)
- [Milestones](docs/milestones.md)
- [Native Messaging protocol](docs/native-messaging.md)

## License

No license file yet.
