# VPN Route Inspector

Local diagnostic tool for **macOS** and **Google Chrome** that helps investigate split-tunnel VPN routing problems.

## Problem this project solves

When a VPN client uses split tunneling, only some traffic is routed through the VPN tunnel. In real-world cases (verified on sites such as Wildberries and Ozon):

1. A hostname resolves to **multiple IPv4 addresses**.
2. The VPN may create exclusion rules for **only some** of those IPs.
3. One IP for the same hostname may route through a `utun` interface (VPN) while another routes directly via `en0`.
4. The site may return **HTTP 403** when the request reaches it through the VPN path.
5. After route changes, Chrome may keep stale HTTP/2, QUIC, DNS, Service Worker, or socket state — a **full browser restart** (Command+Q) may be required.

VPN Route Inspector helps you see **which macOS interface actually routes a given IP** so you can prepare accurate VPN exclusion lists.

## Current milestone scope

**Milestone 1 (complete):** manual IPv4 route check via Native Messaging.

**Milestone 2 (current):** user-controlled capture of network **responses** for one active HTTP/HTTPS tab.

```
Chrome popup → service worker → chrome.webRequest (one tab)
                              ↘ chrome.storage.session (metadata only)

Chrome popup → service worker → Native Messaging → Swift host → /sbin/route
```

Remote IPs come from Chrome `webRequest` response metadata (`details.ip`), **not** from DNS. The IP may be missing or IPv6. Cross-origin subresources require optional HTTP/HTTPS host access, requested only after you click **Start capture and reload**. `activeTab` alone is not enough for all CDN/API traffic.

Captured metadata stays in `chrome.storage.session` (max 500 entries) and is cleared when the browser or extension restarts. Bodies, headers, cookies, and authorization values are **not** captured. URLs may still contain path/query data — use capture only for intentional diagnostics.

Automatic VPN/DIRECT classification of captured IPs is **not** in this milestone (comes later). The stable extension `key` / ID must remain unchanged.

After VPN route changes, reconnect the VPN and fully restart Chrome (Command+Q) before trusting new manual route-check results.

## Prerequisites

- macOS 13 or later (minimum supported platform)
- Xcode Command Line Tools with **Swift 6.1 or newer** (Swift Package Manager + Swift Testing)
- Google Chrome
- An active network connection

Full Xcode is **not** required for this command-line project. Unit tests use **Swift Testing** (the `Testing` module from the toolchain), not XCTest. There is no XCTest dependency and no fallback test runner.

No Node.js, npm, Python, or Homebrew dependencies are required for build, installation, diagnostics, or runtime.

## Stable extension identity

The extension has a committed public key in `extension/manifest.json` (`key`). That gives every clone the **same stable development extension ID**, independent of the repository path on disk.

- The public key is committed.
- The private PEM key lives **outside** the repository at:

  `$HOME/.config/vpn-route-inspector/chrome-extension.pem`

- **Back up that private key securely.** Never commit `*.pem` or `*.crx`.
- Do not remove or regenerate the public `key` casually — that would change the stable ID and break Native Messaging until reinstall.

Expected stable ID:

```
iipnohegjdidiffjfhlccfbpbjeeicba
```

## One-time setup

```bash
chmod +x scripts/*.sh
./scripts/setup.sh
```

This runs `build-host.sh` → `install-host.sh` → `doctor.sh`, prints the stable extension ID, and prints the absolute `extension/` path to load in Chrome.

Then load the unpacked extension **once** (or **Reload** it on `chrome://extensions` after extension source updates):

1. Open Chrome and go to `chrome://extensions/`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** (first time) or **Reload**.
4. Select / confirm the repository’s `extension/` folder.
5. Confirm the ID is still `iipnohegjdidiffjfhlccfbpbjeeicba`.

Fully quit Chrome with **Command+Q** and reopen it after the native host manifest is installed or changed.

Manual pasting of an ID from `chrome://extensions` is not part of this workflow, and `install-host.sh` takes no ID argument.

## Normal updates

| What changed | What to do |
|--------------|------------|
| Extension JS/HTML/CSS | On `chrome://extensions`, click **Reload** for VPN Route Inspector |
| Native host binary | Re-run `./scripts/setup.sh` (or `build-host.sh` + `install-host.sh`), then **Command+Q** Chrome |
| Native Messaging manifest / allowed origin | Re-run `./scripts/install-host.sh` or `./scripts/setup.sh`, then **Command+Q** Chrome |

## Active tab capture (Milestone 2)

1. Open a normal `http:` / `https:` page (for example Wildberries, Ozon, or Yandex Market).
2. Open the extension popup.
3. Click **Start capture and reload**.
4. Accept the optional host-access prompt if Chrome shows it.
5. After the tab reloads, reopen the popup.
6. Inspect hostname, remote IP (when Chrome provides it), status, resource type, method, and CACHE markers.
7. Use **Stop capture**, **Clear results**, or **Revoke network access** as needed.

Requests from other tabs must not appear. Manual **Check route** remains available in the same popup.

## Build the native host only

Swift Package Manager is the **only** supported build path. There is no fallback build. Unit tests run through SwiftPM via `swift test`. If `swift test` or `swift build -c release` fails, the build fails visibly.

```bash
./scripts/build-host.sh
```

The script runs:

1. `swift test` (Swift Testing via SwiftPM — one test path only)
2. `swift build -c release`
3. Copies the release executable to the canonical artifact:

```
native-host/dist/vpn-route-host
```

Install and doctor scripts use **only** that path.

## Install the native host only

```bash
./scripts/install-host.sh
```

No arguments. The installer derives the stable ID from `extension/manifest.json` via `scripts/extension-id.sh` and writes exactly one `allowed_origins` entry (no wildcards):

```
chrome-extension://<stable-id>/
```

This installs:

- Binary: `~/Library/Application Support/VpnRouteInspector/vpn-route-host`
- Manifest: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.freemandan.vpn_route_inspector.json`

Restart Chrome completely (Command+Q, then reopen) after installation or manifest changes.

## Manual route check

Chrome Native Messaging is ready when:

1. `./scripts/setup.sh` (or build + install + doctor) has succeeded,
2. The unpacked `extension/` directory is loaded in Chrome,
3. Chrome has been fully restarted (Command+Q) after the latest native host install,
4. The popup **Check route** test succeeds.

Then:

1. Click the VPN Route Inspector toolbar icon.
2. Leave the default IP `1.1.1.1` or enter another IPv4 address.
3. Click **Check route**.

### Expected results

| VPN state | Typical interface | Route type |
|-----------|-------------------|------------|
| VPN off   | `en0` (or `en1`)  | `DIRECT`   |
| VPN on, IP not excluded | `utun4` (or similar) | `VPN` |
| VPN on, IP excluded     | `en0`             | `DIRECT`   |

Run `./scripts/doctor.sh` if native messaging fails. Doctor verifies that the installed `allowed_origins` matches the stable ID from the committed key.

## Uninstall

```bash
./scripts/uninstall-host.sh
```

Remove the extension from `chrome://extensions/` manually if desired.

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
