import Foundation

/// Pure business logic: decode a JSON request, validate input, run route lookup, build response.
/// Milestone 1: `checkRoute` (single IPv4).
/// Milestone 3: `checkRoutes` (batch, sequential, per-item errors).
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
        case "checkRoutes":
            return checkRoutes(requestId: request.requestId, ips: request.ips)
        default:
            return .failure(
                requestId: request.requestId,
                code: HostErrorCode.invalidAction,
                message: "Unsupported action: \(request.action)"
            )
        }
    }

    // MARK: - Single IP (Milestone 1)

    /// Validates IPv4, runs `/sbin/route -n get`, parses interface, and classifies the route.
    private func checkRoute(requestId: String?, ip: String?) -> HostResponse {
        let item = lookupRouteItem(ip: ip)
        if item.ok, let interface = item.interface, let routeType = item.routeType {
            return .success(
                requestId: requestId,
                ip: item.ip,
                interface: interface,
                routeType: RouteType(rawValue: routeType) ?? .unknown
            )
        }
        return .failure(
            requestId: requestId,
            code: item.error?.code ?? HostErrorCode.internalError,
            message: item.error?.message ?? "Unexpected route lookup failure."
        )
    }

    // MARK: - Batch IPs (Milestone 3)

    /// Validates the `ips` array, deduplicates valid IPv4s, and looks up each sequentially.
    /// One failed IP never aborts the rest of the batch.
    private func checkRoutes(requestId: String?, ips: [String]?) -> HostResponse {
        guard let ips else {
            return .failure(
                requestId: requestId,
                code: HostErrorCode.invalidIPList,
                message: "Field \"ips\" must be a non-empty array of IPv4 address strings."
            )
        }

        if ips.isEmpty {
            return .failure(
                requestId: requestId,
                code: HostErrorCode.emptyIPList,
                message: "Field \"ips\" must not be empty."
            )
        }

        // Reject oversized input before any /sbin/route invocation.
        if ips.count > HostBatchLimits.maxInputIPs {
            return .failure(
                requestId: requestId,
                code: HostErrorCode.tooManyIPs,
                message: "Field \"ips\" accepts at most \(HostBatchLimits.maxInputIPs) items."
            )
        }

        // Preserve first-seen order; invalid inputs still get a per-item result.
        // Deduplicate only among valid IPv4s so each distinct valid IP is looked up once,
        // while every original input position still receives an explicit result.
        var results: [RouteLookupItem] = []
        results.reserveCapacity(ips.count)

        var seenValid: Set<String> = []
        /// Cache lookup outcomes for repeated valid IPs so Process is not re-run.
        var validLookupCache: [String: RouteLookupItem] = [:]

        for raw in ips {
            let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)

            guard IPv4Validator.isValid(trimmed) else {
                results.append(.failure(
                    ip: raw,
                    code: HostErrorCode.invalidIP,
                    message: "A valid IPv4 address is required."
                ))
                continue
            }

            if let cached = validLookupCache[trimmed] {
                // Same valid IP again — return an equivalent result without another Process call.
                results.append(cached)
                continue
            }

            // First occurrence of this valid IP — perform the sequential route lookup.
            _ = seenValid.insert(trimmed)
            let item = lookupRouteItem(ip: trimmed)
            validLookupCache[trimmed] = item
            results.append(item)
        }

        return .batchSuccess(requestId: requestId, results: results)
    }

    // MARK: - Shared lookup

    /// Shared single-IP lookup used by both `checkRoute` and `checkRoutes`.
    /// Returns a `RouteLookupItem` so batch processing can collect per-item outcomes.
    /// Never exposes raw `/sbin/route` stdout/stderr in the public error body.
    private func lookupRouteItem(ip: String?) -> RouteLookupItem {
        guard let rawIP = ip else {
            return .failure(
                ip: "",
                code: HostErrorCode.invalidIP,
                message: "A valid IPv4 address is required."
            )
        }

        let trimmedIP = rawIP.trimmingCharacters(in: .whitespacesAndNewlines)

        guard IPv4Validator.isValid(trimmedIP) else {
            return .failure(
                ip: rawIP,
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
                ip: trimmedIP,
                code: HostErrorCode.routeCommandFailed,
                message: "Unable to execute route lookup."
            )
        }

        guard let interfaceName = RouteOutputParser.parseInterface(from: routeOutput) else {
            fputs("No interface field in route output for \(trimmedIP)\n", stderr)
            return .failure(
                ip: trimmedIP,
                code: HostErrorCode.interfaceNotFound,
                message: "Could not determine routing interface for this IP."
            )
        }

        let routeType = RouteClassifier.classify(interface: interfaceName)
        return .success(ip: trimmedIP, interface: interfaceName, routeType: routeType)
    }
}
