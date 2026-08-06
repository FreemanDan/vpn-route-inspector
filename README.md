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

## Current milestone scope (Milestone 1)

Manual IPv4 route check only:

```
Chrome popup → service worker → Native Messaging → Swift host → /sbin/route → JSON → popup
```

**Not yet implemented:** browser request interception, `webRequest`, `<all_urls>`, or DNS inspection.

Milestone 1 does **not** capture browser traffic. After VPN route changes, reconnect the VPN and fully restart Chrome (Command+Q) before trusting new results.

## Prerequisites

- macOS 13 or later (minimum supported platform)
- Xcode Command Line Tools with **Swift 6.1 or newer** (Swift Package Manager + Swift Testing)
- Google Chrome
- An active network connection

Full Xcode is **not** required for this command-line project. Unit tests use **Swift Testing** (the `Testing` module from the toolchain), not XCTest. There is no XCTest dependency and no fallback test runner.

No Node.js, npm, Python, or Homebrew dependencies are required for build, installation, diagnostics, or runtime.

## Build the native host

Swift Package Manager is the **only** supported build path. There is no fallback build. Unit tests run through SwiftPM via `swift test`. If `swift test` or `swift build -c release` fails, the build fails visibly.

```bash
chmod +x scripts/*.sh
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

## Load the unpacked Chrome extension

1. Open Chrome and go to `chrome://extensions/`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked**.
4. Select the `extension/` directory from this repository.

## Obtain the extension ID

After loading the unpacked extension:

1. On `chrome://extensions/`, find **VPN Route Inspector**.
2. Copy the **ID** shown under the extension name (32 lowercase letters `a`–`p`).

Do not commit this ID to the repository — it is machine-specific for unpacked extensions.

## Install the native host

```bash
./scripts/install-host.sh <your-32-char-extension-id>
```

This installs:

- Binary: `~/Library/Application Support/VpnRouteInspector/vpn-route-host`
- Manifest: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.freemandan.vpn_route_inspector.json`

Restart Chrome completely (Command+Q, then reopen) after installation.

## Test the extension

Chrome Native Messaging is **not verified** until:

1. The unpacked extension ID is known,
2. `./scripts/install-host.sh <extension-id>` has been run,
3. Chrome has been fully restarted (Command+Q),
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

Run `./scripts/doctor.sh` if native messaging fails.

## Uninstall

```bash
./scripts/uninstall-host.sh
```

Remove the extension from `chrome://extensions/` manually if desired.

## Project layout

```
extension/          Chrome MV3 extension (plain JS/HTML/CSS)
native-host/        Swift native messaging host (SwiftPM)
scripts/            build, install, uninstall, doctor
docs/               architecture and milestone documentation
```

## Documentation

- [Architecture](docs/architecture.md)
- [Milestones](docs/milestones.md)
- [Native Messaging protocol](docs/native-messaging.md)

## License

No license file yet.
