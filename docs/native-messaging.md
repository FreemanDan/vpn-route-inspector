# Native Messaging

VPN Route Inspector uses [Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging) to communicate between the extension service worker and the macOS Swift host.

## Host identifier

```
com.freemandan.vpn_route_inspector
```

## Installed manifest location

```
~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.freemandan.vpn_route_inspector.json
```

Generated locally by `scripts/install-host.sh` (ID from `scripts/extension-id.sh`) — **never committed**.

The installer takes **no** extension-ID argument. It derives the stable development ID from the committed public `key` in `extension/manifest.json`. `allowed_origins` contains exactly one origin — no wildcards and no manually pasted IDs:

```json
{
  "name": "com.freemandan.vpn_route_inspector",
  "description": "VPN Route Inspector native host for macOS route lookups",
  "path": "/absolute/path/to/vpn-route-host",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://<stable-id-from-manifest-key>/"
  ]
}
```

The stable ID does **not** depend on the repository path. The private PEM key stays outside the repo (`$HOME/.config/vpn-route-inspector/chrome-extension.pem`) and must be backed up; never commit it.

## Binary framing protocol

All messages on stdin/stdout use Chrome's standard framing:

| Field | Size | Encoding |
|-------|------|----------|
| Length | 4 bytes | little-endian unsigned integer |
| Payload | `length` bytes | UTF-8 JSON object |

The host rejects zero-length or oversized (> 1 MiB) incoming messages.

**Important:** stdout must contain **only** framed JSON responses. All logging goes to stderr.

## Request schema

### `checkRoute`

```json
{
  "action": "checkRoute",
  "requestId": "uuid-or-generated-id",
  "ip": "1.1.1.1"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `action` | string | yes | Must be `"checkRoute"` |
| `requestId` | string | no | Correlation ID echoed in response |
| `ip` | string | yes | IPv4 address to look up |

## Response schema

### Success (direct)

```json
{
  "ok": true,
  "requestId": "uuid-or-generated-id",
  "ip": "1.1.1.1",
  "interface": "en0",
  "routeType": "DIRECT"
}
```

### Success (VPN)

```json
{
  "ok": true,
  "requestId": "uuid-or-generated-id",
  "ip": "1.1.1.1",
  "interface": "utun4",
  "routeType": "VPN"
}
```

### Error

```json
{
  "ok": false,
  "requestId": "uuid-or-generated-id",
  "error": {
    "code": "INVALID_IP",
    "message": "A valid IPv4 address is required."
  }
}
```

## Error codes

| Code | Meaning |
|------|---------|
| `INVALID_JSON` | Request body is not valid JSON |
| `INVALID_ACTION` | Unknown `action` value |
| `INVALID_IP` | Missing or invalid IPv4 address |
| `ROUTE_COMMAND_FAILED` | Could not execute `/sbin/route` |
| `INTERFACE_NOT_FOUND` | Route output missing `interface:` field |
| `INTERNAL_ERROR` | Unexpected host failure |

## Extension-side usage

The service worker calls:

```javascript
chrome.runtime.sendNativeMessage(
  'com.freemandan.vpn_route_inspector',
  { action: 'checkRoute', requestId, ip },
  callback
);
```

Chrome handles process lifecycle: it starts `vpn-route-host`, writes the framed request to stdin, reads the framed response from stdout, and terminates the host.

The service worker verifies that the native host echoes the same `requestId` that was sent.

## Build artifact

The installed binary comes from the canonical SwiftPM output copied by `./scripts/build-host.sh`:

```
native-host/dist/vpn-route-host
```

There is no alternate manual build path. Framing encode/decode is covered by Swift Testing unit tests under `native-host/Tests/` and executed with `swift test` (SwiftPM only — no XCTest, no fallback runner).

## Milestone 2 note

Active-tab capture uses `chrome.webRequest` and `chrome.storage.session` inside the extension only. It does **not** change this Native Messaging protocol, the Swift `checkRoute` API, or send captured IPs to the native host. Automatic route classification of captured addresses is a later milestone.
