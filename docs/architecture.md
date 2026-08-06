# Architecture

VPN Route Inspector is a local diagnostic stack composed of a Chrome extension and a macOS native host. Milestone 1 implements manual IPv4 route lookup only.

## High-level flow (Milestone 1)

```mermaid
sequenceDiagram
    participant Popup as Extension Popup
    participant SW as Service Worker
    participant NM as Chrome Native Messaging
    participant Host as Swift Native Host
    participant Route as /sbin/route

    Popup->>SW: chrome.runtime.sendMessage(CHECK_ROUTE)
    SW->>NM: sendNativeMessage(checkRoute)
    NM->>Host: length-prefixed JSON (stdin)
    Host->>Route: Process(["-n","get",ip])
    Route-->>Host: route output
    Host-->>NM: length-prefixed JSON (stdout)
    NM-->>SW: structured response
    SW-->>Popup: bridge response
    Popup->>Popup: render result
```

## Components

### Extension popup (`extension/popup/`)

Plain HTML/CSS/JavaScript UI. Collects an IPv4 address, shows loading state, and displays structured success or error results. Does not call Native Messaging directly — it only talks to the service worker.

### Manifest V3 service worker (`extension/service-worker.js`)

Background script registered in `manifest.json`. Receives internal messages from the popup, generates a `requestId`, and calls `chrome.runtime.sendNativeMessage` with host name `com.freemandan.vpn_route_inspector`.

Milestone 1 permissions are limited to `nativeMessaging` only.

### Native Messaging boundary

Chrome launches the native host as a child process and communicates over stdin/stdout using a binary framing protocol:

1. 4-byte little-endian message length
2. UTF-8 JSON payload

See [native-messaging.md](native-messaging.md) for message schemas.

**Security boundary:** only extension origins listed in the installed manifest's `allowed_origins` may invoke the host. The host validates all input before executing system commands.

### Swift native host (`native-host/`)

Executable `vpn-route-host` plus testable core library `VpnRouteHostCore`:

| Module | Responsibility |
|--------|----------------|
| `IPv4Validator` | Reject non-IPv4 input before any system call |
| `RouteCommandExecutor` | Run `/sbin/route` via `Process` (no shell) |
| `RouteOutputParser` | Extract `interface:` from command output |
| `RouteClassifier` | Map interface name to `DIRECT`, `VPN`, or `UNKNOWN` |
| `NativeMessagingFraming` | Little-endian length-prefix encode/decode |
| `MessageHandler` | Decode JSON, orchestrate lookup, encode response |

All diagnostics and logs go to **stderr**. **stdout** is reserved exclusively for Native Messaging framed responses.

The canonical release artifact is `native-host/dist/vpn-route-host`, produced only by SwiftPM via `./scripts/build-host.sh`.

### Testing

Unit tests live under `native-host/Tests/` and use **Swift Testing** (`import Testing`) supplied by the Swift 6.1+ toolchain. They run only through SwiftPM:

```bash
cd native-host && swift test
```

Full Xcode is not required; Xcode Command Line Tools with Swift 6.1 or newer are sufficient. There is no XCTest dependency and no fallback test runner. A failed test makes the build fail visibly (`./scripts/build-host.sh` runs `swift test` before the release build). Minimum supported platform is macOS 13.

### Route lookup

The host executes:

```
/sbin/route -n get <validated-ipv4>
```

Arguments are passed as a discrete array to `Process` — never interpolated into a shell command string.

Classification rules:

| Interface prefix | Route type |
|------------------|------------|
| `utun`           | `VPN`      |
| `en`, `bridge`, `pdp_ip` | `DIRECT` |
| other            | `UNKNOWN`  |

## Security boundaries

1. **Input validation** — only validated IPv4 addresses reach `/sbin/route`.
2. **No shell execution** — no `/bin/sh -c`, `system()`, or string-built commands.
3. **Origin allowlist** — installed manifest restricts which extension ID may connect.
4. **Minimal Chrome permissions** — no `<all_urls>` or `webRequest` until request capture is implemented.
5. **No secrets** — the tool does not store credentials, cookies, or browsing history.

## Future request-capture flow (not implemented)

Later milestones will add `webRequest` (or an equivalent that exposes actual request metadata and remote IP information) to observe requests from the active tab. `declarativeNetRequest` alone is **not** a substitute when the goal is collecting the actual remote IP Chrome connected to.

```mermaid
flowchart LR
    A[Active tab requests] --> B[Extension capture layer]
    B --> C[Remote IP extraction]
    C --> D[Native host route checks]
    D --> E[Domain/IP grouping UI]
    E --> F[Export exclusions]
```

Each milestone remains independently testable before the next layer is added.
