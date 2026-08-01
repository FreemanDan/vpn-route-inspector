import Foundation

// MARK: - Request / Response models

/// Incoming action from the Chrome extension via Native Messaging.
public struct HostRequest: Codable, Equatable {
    public let action: String
    public let requestId: String?
    public let ip: String?

    public init(action: String, requestId: String? = nil, ip: String? = nil) {
        self.action = action
        self.requestId = requestId
        self.ip = ip
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

/// Outgoing response envelope sent back through Native Messaging.
public struct HostResponse: Codable, Equatable {
    public let ok: Bool
    public let requestId: String?
    public let ip: String?
    public let interface: String?
    public let routeType: String?
    public let error: HostErrorBody?

    public init(
        ok: Bool,
        requestId: String? = nil,
        ip: String? = nil,
        interface: String? = nil,
        routeType: String? = nil,
        error: HostErrorBody? = nil
    ) {
        self.ok = ok
        self.requestId = requestId
        self.ip = ip
        self.interface = interface
        self.routeType = routeType
        self.error = error
    }

    /// Successful route lookup response.
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

    /// Error response with a structured error body.
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
}
