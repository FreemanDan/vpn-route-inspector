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

`allowed_origins` contains exactly one origin derived from the committed public `key` in `extension/manifest.json` — no wildcards.

## Binary framing protocol

| Field | Size | Encoding |
|-------|------|----------|
| Length | 4 bytes | little-endian unsigned integer |
| Payload | `length` bytes | UTF-8 JSON object |

Max payload 1 MiB. **stdout** is reserved for framed JSON only. Logs go to **stderr**.

## Request: `checkRoute` (Milestone 1, backward compatible)

```json
{
  "action": "checkRoute",
  "requestId": "uuid-or-generated-id",
  "ip": "1.1.1.1"
}
```

### Success

```json
{
  "ok": true,
  "requestId": "uuid-or-generated-id",
  "ip": "1.1.1.1",
  "interface": "en0",
  "routeType": "DIRECT"
}
```

`results` is omitted for single-IP success.

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

## Request: `checkRoutes` (Milestone 3)

One Native Messaging call for many IPv4s. The extension must batch unique captured IPv4s — never call once per captured event.

```json
{
  "action": "checkRoutes",
  "requestId": "uuid",
  "ips": [
    "185.138.255.20",
    "87.250.250.22"
  ]
}
```

### Validation (top-level, before any `/sbin/route`)

| Rule | Error code |
|------|------------|
| `ips` missing / not an array | `INVALID_IP_LIST` |
| `ips` empty | `EMPTY_IP_LIST` |
| more than 128 input items | `TOO_MANY_IPS` |

### Success (batch)

Top-level `ok: true` even when some items fail. Every input position gets an explicit result. Valid IPv4s are trimmed and deduplicated for Process execution (first-seen order preserved in the result list). Lookups run **sequentially**.

```json
{
  "ok": true,
  "requestId": "same-uuid",
  "results": [
    {
      "ok": true,
      "ip": "185.138.255.20",
      "interface": "utun4",
      "routeType": "VPN",
      "error": null
    },
    {
      "ok": false,
      "ip": "192.0.2.999",
      "interface": null,
      "routeType": null,
      "error": {
        "code": "INVALID_IP",
        "message": "A valid IPv4 address is required."
      }
    }
  ]
}
```

### Per-item error codes

| Code | Meaning |
|------|---------|
| `INVALID_IP` | That list item is not a valid IPv4 |
| `ROUTE_COMMAND_FAILED` | `/sbin/route` failed for that IP |
| `INTERFACE_NOT_FOUND` | Route output missing `interface:` |

Raw route stdout/stderr never appears in public error messages.

## Shared error codes

| Code | Meaning |
|------|---------|
| `INVALID_JSON` | Request body is not valid JSON |
| `INVALID_ACTION` | Unknown `action` value |
| `INVALID_IP` | Missing or invalid IPv4 (single or per-item) |
| `INVALID_IP_LIST` | Batch `ips` missing / invalid |
| `EMPTY_IP_LIST` | Batch `ips` is empty |
| `TOO_MANY_IPS` | Batch `ips` longer than 128 |
| `ROUTE_COMMAND_FAILED` | Could not execute `/sbin/route` |
| `INTERFACE_NOT_FOUND` | Route output missing `interface:` |
| `INTERNAL_ERROR` | Unexpected host failure |

## Extension-side usage

Single IP:

```javascript
chrome.runtime.sendNativeMessage(
  'com.freemandan.vpn_route_inspector',
  { action: 'checkRoute', requestId, ip },
  callback
);
```

Batch (Milestone 3 — from `CAPTURE_ANALYZE_ROUTES` only):

```javascript
chrome.runtime.sendNativeMessage(
  'com.freemandan.vpn_route_inspector',
  { action: 'checkRoutes', requestId, ips },
  callback
);
```

The service worker verifies that the native host echoes the same `requestId`.

## Route result meaning

`interface` / `routeType` describe the **current** macOS routing table at the moment of the lookup. They are not a historical packet-capture proof of which path an earlier browser connection used.

## Build artifact

```
native-host/dist/vpn-route-host
```

Produced only by SwiftPM via `./scripts/build-host.sh` (`swift test` then release build).
