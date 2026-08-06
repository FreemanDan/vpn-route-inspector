import Foundation

// MARK: - Request / Response models

/// Incoming action from the Chrome extension via Native Messaging.
/// Milestone 1: `checkRoute` with optional `ip`.
/// Milestone 3: `checkRoutes` with optional `ips` array (batch).
public struct HostRequest: Codable, Equatable {
    public let action: String
    public let requestId: String?
    public let ip: String?
    /// Batch IPv4 list for `checkRoutes`. Ignored by `checkRoute`.
    public let ips: [String]?

    public init(
        action: String,
        requestId: String? = nil,
        ip: String? = nil,
        ips: [String]? = nil
    ) {
        self.action = action
        self.requestId = requestId
        self.ip = ip
        self.ips = ips
    }
}

/// Structured error returned to the extension when a request fails.
public struct HostErrorBody: Codable, Equatable {
    public let code: String
    public let message: String

    public init(code: String, message: String) {
        self.code = code
        self.message = message
    }
}

/// Per-IP result inside a `checkRoutes` batch response.
public struct RouteLookupItem: Codable, Equatable {
    public let ok: Bool
    public let ip: String
    public let interface: String?
    public let routeType: String?
    public let error: HostErrorBody?

    public init(
        ok: Bool,
        ip: String,
        interface: String? = nil,
        routeType: String? = nil,
        error: HostErrorBody? = nil
    ) {
        self.ok = ok
        self.ip = ip
        self.interface = interface
        self.routeType = routeType
        self.error = error
    }

    /// Successful single-IP classification within a batch.
    public static func success(ip: String, interface: String, routeType: RouteType) -> RouteLookupItem {
        RouteLookupItem(
            ok: true,
            ip: ip,
            interface: interface,
            routeType: routeType.rawValue,
            error: nil
        )
    }

    /// Per-item failure that does not abort the rest of the batch.
    public static func failure(ip: String, code: String, message: String) -> RouteLookupItem {
        RouteLookupItem(
            ok: false,
            ip: ip,
            interface: nil,
            routeType: nil,
            error: HostErrorBody(code: code, message: message)
        )
    }
}

/// Outgoing response envelope sent back through Native Messaging.
public struct HostResponse: Codable, Equatable {
    public let ok: Bool
    public let requestId: String?
    public let ip: String?
    public let interface: String?
    public let routeType: String?
    public let error: HostErrorBody?
    /// Present for successful `checkRoutes` batches (and omitted for single `checkRoute`).
    public let results: [RouteLookupItem]?

    public init(
        ok: Bool,
        requestId: String? = nil,
        ip: String? = nil,
        interface: String? = nil,
        routeType: String? = nil,
        error: HostErrorBody? = nil,
        results: [RouteLookupItem]? = nil
    ) {
        self.ok = ok
        self.requestId = requestId
        self.ip = ip
        self.interface = interface
        self.routeType = routeType
        self.error = error
        self.results = results
    }

    /// Successful single-IP route lookup response (`checkRoute`).
    public static func success(
        requestId: String?,
        ip: String,
        interface: String,
        routeType: RouteType
    ) -> HostResponse {
        HostResponse(
            ok: true,
            requestId: requestId,
            ip: ip,
            interface: interface,
            routeType: routeType.rawValue
        )
    }

    /// Successful batch response (`checkRoutes`).
    public static func batchSuccess(
        requestId: String?,
        results: [RouteLookupItem]
    ) -> HostResponse {
        HostResponse(
            ok: true,
            requestId: requestId,
            results: results
        )
    }

    /// Top-level error response with a structured error body.
    public static func failure(requestId: String?, code: String, message: String) -> HostResponse {
        HostResponse(
            ok: false,
            requestId: requestId,
            error: HostErrorBody(code: code, message: message)
        )
    }
}

/// Classification of how macOS routes traffic to the target IP.
public enum RouteType: String, Equatable {
    case direct = "DIRECT"
    case vpn = "VPN"
    case unknown = "UNKNOWN"
}

/// Well-known error codes returned by the native host.
public enum HostErrorCode {
    public static let invalidJSON = "INVALID_JSON"
    public static let invalidAction = "INVALID_ACTION"
    public static let invalidIP = "INVALID_IP"
    public static let routeCommandFailed = "ROUTE_COMMAND_FAILED"
    public static let interfaceNotFound = "INTERFACE_NOT_FOUND"
    public static let internalError = "INTERNAL_ERROR"
    /// `ips` is missing or not an array (decode may surface as INVALID_JSON; used when present but wrong type via empty).
    public static let invalidIPList = "INVALID_IP_LIST"
    public static let emptyIPList = "EMPTY_IP_LIST"
    public static let tooManyIPs = "TOO_MANY_IPS"
}

/// Shared limits for the batch route API.
public enum HostBatchLimits {
    /// Maximum number of input items accepted in `ips` before any `/sbin/route` call.
    public static let maxInputIPs = 128
}
