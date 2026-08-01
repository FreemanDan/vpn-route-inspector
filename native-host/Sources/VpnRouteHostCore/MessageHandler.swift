import Foundation

/// Pure business logic: decode a JSON request, validate input, run route lookup, build response.
public struct MessageHandler {
    private let routeExecutor: RouteCommandExecuting

    public init(routeExecutor: RouteCommandExecuting = SystemRouteCommandExecutor()) {
        self.routeExecutor = routeExecutor
    }

    /// Handles raw JSON bytes from Chrome and returns a structured response.
    public func handle(data: Data) -> HostResponse {
        do {
            let request = try JSONDecoder().decode(HostRequest.self, from: data)
            return try handleRequest(request)
        } catch let decodingError as DecodingError {
            fputs("JSON decode error: \(decodingError)\n", stderr)
            return .failure(
                requestId: nil,
                code: HostErrorCode.invalidJSON,
                message: "Request body must be a valid JSON object."
            )
        } catch {
            fputs("Unexpected decode error: \(error)\n", stderr)
            return .failure(
                requestId: nil,
                code: HostErrorCode.invalidJSON,
                message: "Request body must be a valid JSON object."
            )
        }
    }

    /// Dispatches a decoded request to the appropriate handler.
    private func handleRequest(_ request: HostRequest) throws -> HostResponse {
        switch request.action {
        case "checkRoute":
            return checkRoute(requestId: request.requestId, ip: request.ip)
        default:
            return .failure(
                requestId: request.requestId,
                code: HostErrorCode.invalidAction,
                message: "Unsupported action: \(request.action)"
            )
        }
    }

    /// Validates IPv4, runs `/sbin/route -n get`, parses interface, and classifies the route.
    private func checkRoute(requestId: String?, ip: String?) -> HostResponse {
        guard let rawIP = ip else {
            return .failure(
                requestId: requestId,
                code: HostErrorCode.invalidIP,
                message: "A valid IPv4 address is required."
            )
        }

        let trimmedIP = rawIP.trimmingCharacters(in: .whitespacesAndNewlines)

        guard IPv4Validator.isValid(trimmedIP) else {
            return .failure(
                requestId: requestId,
                code: HostErrorCode.invalidIP,
                message: "A valid IPv4 address is required."
            )
        }

        let routeOutput: String
        do {
            routeOutput = try routeExecutor.runRouteGet(ip: trimmedIP)
        } catch {
            fputs("Failed to run /sbin/route: \(error)\n", stderr)
            return .failure(
                requestId: requestId,
                code: HostErrorCode.routeCommandFailed,
                message: "Unable to execute route lookup."
            )
        }

        guard let interfaceName = RouteOutputParser.parseInterface(from: routeOutput) else {
            fputs("No interface field in route output for \(trimmedIP)\n", stderr)
            return .failure(
                requestId: requestId,
                code: HostErrorCode.interfaceNotFound,
                message: "Could not determine routing interface for this IP."
            )
        }

        let routeType = RouteClassifier.classify(interface: interfaceName)

        return .success(
            requestId: requestId,
            ip: trimmedIP,
            interface: interfaceName,
            routeType: routeType
        )
    }
}
