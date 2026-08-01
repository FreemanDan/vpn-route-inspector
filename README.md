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

**Not yet implemented:** browser request interception, `webRequest`, or `<all_urls>` permissions.

## Prerequisites

- macOS 13 or later
- Xcode Command Line Tools (provides Swift)
- Google Chrome
- An active network connection

No Node.js, npm, Python runtime, or Homebrew dependencies are required for the extension or native host.

## Build the native host

```bash
chmod +x scripts/*.sh
./scripts/build-host.sh
```

This runs Swift unit tests and builds the release binary at:

```
native-host/.build/release/vpn-route-host
```

On some Command Line Tools installs, SwiftPM may fail due to a duplicate `SwiftBridging` module map. In that case `build-host.sh` automatically falls back to a direct `swiftc` build with a VFS overlay:

```
native-host/.manual-build/vpn-route-host
```

Both paths are supported by `install-host.sh` and `doctor.sh`.

## Load the unpacked Chrome extension

1. Open Chrome and go to `chrome://extensions/`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked**.
4. Select the `extension/` directory from this repository.

## Obtain the extension ID

After loading the unpacked extension:

1. On `chrome://extensions/`, find **VPN Route Inspector**.
2. Copy the **ID** shown under the extension name (32 lowercase letters `a`–`p`).

Example format: `abcdefghijklmnopqrstuvwxyzabcdef`

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

### Testing with VPN enabled/disabled

1. **VPN disabled:** check `1.1.1.1` — expect `en*` and `DIRECT`.
2. **VPN enabled:** check the same IP — if not excluded, expect `utun*` and `VPN`.
3. Add an exclusion for that IP in your VPN client, reconnect the VPN, **fully quit Chrome** (Command+Q), reopen, and check again — expect `DIRECT`.

Route table changes may require reconnecting the VPN and fully restarting Chrome before results reflect the new routing.

## Uninstall

```bash
./scripts/uninstall-host.sh
```

Remove the extension from `chrome://extensions/` manually if desired.

## Project layout

```
extension/          Chrome MV3 extension (plain JS/HTML/CSS)
native-host/        Swift native messaging host
scripts/            build, install, uninstall, doctor
docs/               architecture and milestone documentation
```

## Documentation

- [Architecture](docs/architecture.md)
- [Milestones](docs/milestones.md)
- [Native Messaging protocol](docs/native-messaging.md)

## License

No license file yet.
