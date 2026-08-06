import Foundation
import Testing
@testable import VpnRouteHostCore

// MARK: - IPv4 validation

/// Validates dotted-decimal IPv4 acceptance and rejection rules.
@Suite("IPv4Validator")
struct IPv4ValidatorTests {

    @Test("accepts ordinary IPv4 addresses")
    func acceptedOrdinaryAddresses() {
        #expect(IPv4Validator.isValid("1.1.1.1"))
        #expect(IPv4Validator.isValid("192.168.0.1"))
        #expect(IPv4Validator.isValid("10.0.0.255"))
    }

    @Test("accepts boundary values 0.0.0.0 and 255.255.255.255")
    func boundaryValues() {
        #expect(IPv4Validator.isValid("0.0.0.0"))
        #expect(IPv4Validator.isValid("255.255.255.255"))
    }

    @Test("rejects empty input")
    func emptyInput() {
        #expect(!IPv4Validator.isValid(""))
    }

    @Test("rejects fewer or more than four octets")
    func wrongOctetCount() {
        #expect(!IPv4Validator.isValid("1.1.1"))
        #expect(!IPv4Validator.isValid("1.1.1.1.1"))
    }

    @Test("rejects octets over 255")
    func octetsOver255() {
        #expect(!IPv4Validator.isValid("256.1.1.1"))
        #expect(!IPv4Validator.isValid("1.256.1.1"))
        #expect(!IPv4Validator.isValid("1.1.1.256"))
    }

    @Test("rejects negative values")
    func negativeValues() {
        #expect(!IPv4Validator.isValid("-1.0.0.1"))
        #expect(!IPv4Validator.isValid("1.-1.0.0"))
    }

    @Test("rejects hostnames")
    func hostnames() {
        #expect(!IPv4Validator.isValid("example.com"))
        #expect(!IPv4Validator.isValid("localhost"))
    }

    @Test("rejects IPv6")
    func ipv6() {
        #expect(!IPv4Validator.isValid("::1"))
        #expect(!IPv4Validator.isValid("2001:db8::1"))
    }

    @Test("rejects trailing junk")
    func trailingJunk() {
        #expect(!IPv4Validator.isValid("1.1.1.1a"))
        // Newline-separated junk after a valid address must fail (not a single trimmed token).
        #expect(!IPv4Validator.isValid("1.1.1.1\nextra"))
        #expect(!IPv4Validator.isValid("1.1.1.1;drop"))
    }

    @Test("rejects unnecessary leading zeros")
    func leadingZeroPolicy() {
        #expect(!IPv4Validator.isValid("01.1.1.1"))
        #expect(!IPv4Validator.isValid("1.01.1.1"))
        #expect(!IPv4Validator.isValid("1.1.1.01"))
        // A single digit zero is allowed as an octet value.
        #expect(IPv4Validator.isValid("0.0.0.0"))
    }
}

// MARK: - Route output parsing

/// Extracts `interface:` from `/sbin/route -n get` style text.
@Suite("RouteOutputParser")
struct RouteOutputParserTests {

    @Test("parses interface: en0")
    func parseInterfaceEn0() {
        let output = """
        route to 1.1.1.1
        destination: 1.1.1.1
            interface: en0
        """
        #expect(RouteOutputParser.parseInterface(from: output) == "en0")
    }

    @Test("parses interface: utun4")
    func parseInterfaceUtun4() {
        let output = """
        route to 1.1.1.1
        destination: 1.1.1.1
            interface: utun4
        """
        #expect(RouteOutputParser.parseInterface(from: output) == "utun4")
    }

    @Test("allows optional leading whitespace before interface:")
    func optionalLeadingWhitespace() {
        #expect(RouteOutputParser.parseInterface(from: "    interface: en0") == "en0")
        #expect(RouteOutputParser.parseInterface(from: "\tinterface: utun4") == "utun4")
    }

    @Test("returns nil when interface field is missing")
    func missingInterface() {
        #expect(RouteOutputParser.parseInterface(from: "no interface here") == nil)
        #expect(RouteOutputParser.parseInterface(from: "route to 1.1.1.1") == nil)
    }

    @Test("returns nil for empty interface value")
    func emptyInterfaceValue() {
        #expect(RouteOutputParser.parseInterface(from: "interface:") == nil)
        #expect(RouteOutputParser.parseInterface(from: "interface:   ") == nil)
    }

    @Test("returns nil for empty or malformed route output")
    func malformedRouteOutput() {
        #expect(RouteOutputParser.parseInterface(from: "") == nil)
        #expect(RouteOutputParser.parseInterface(from: "iface: en0") == nil)
        #expect(RouteOutputParser.parseInterface(from: "interfaces: en0") == nil)
    }
}

// MARK: - Route classification

/// Maps interface name prefixes to DIRECT / VPN / UNKNOWN (case-insensitive).
@Suite("RouteClassifier")
struct RouteClassifierTests {

    @Test("utun* classifies as VPN")
    func utunIsVPN() {
        #expect(RouteClassifier.classify(interface: "utun4") == .vpn)
        #expect(RouteClassifier.classify(interface: "utun0") == .vpn)
    }

    @Test("en* classifies as DIRECT")
    func enIsDirect() {
        #expect(RouteClassifier.classify(interface: "en0") == .direct)
        #expect(RouteClassifier.classify(interface: "en1") == .direct)
    }

    @Test("bridge* classifies as DIRECT")
    func bridgeIsDirect() {
        #expect(RouteClassifier.classify(interface: "bridge0") == .direct)
    }

    @Test("pdp_ip* classifies as DIRECT")
    func pdpIpIsDirect() {
        #expect(RouteClassifier.classify(interface: "pdp_ip0") == .direct)
    }

    @Test("unrecognized interface classifies as UNKNOWN")
    func unrecognizedIsUnknown() {
        #expect(RouteClassifier.classify(interface: "lo0") == .unknown)
        #expect(RouteClassifier.classify(interface: "gif0") == .unknown)
        #expect(RouteClassifier.classify(interface: "awdl0") == .unknown)
    }

    @Test("classification is case-insensitive")
    func caseInsensitive() {
        #expect(RouteClassifier.classify(interface: "UTUN4") == .vpn)
        #expect(RouteClassifier.classify(interface: "En0") == .direct)
        #expect(RouteClassifier.classify(interface: "BRIDGE0") == .direct)
        #expect(RouteClassifier.classify(interface: "PDP_IP0") == .direct)
    }
}

// MARK: - Native Messaging framing

/// Little-endian length-prefix framing used on Chrome Native Messaging stdin/stdout.
@Suite("NativeMessagingFraming")
struct NativeMessagingFramingTests {

    @Test("decodes length prefix as little-endian")
    func decodeLengthLittleEndian() throws {
        let bytes = Data([0x05, 0x00, 0x00, 0x00])
        #expect(try NativeMessagingFraming.decodeLengthPrefix(bytes) == 5)
    }

    @Test("encodes length prefix as little-endian")
    func encodeLengthLittleEndian() throws {
        // Must stay within maxMessageSize (1 MiB). 0x00010203 demonstrates
        // little-endian byte order without exceeding the framing limit.
        let prefix = try NativeMessagingFraming.encodeLengthPrefix(0x00010203)
        #expect(prefix == Data([0x03, 0x02, 0x01, 0x00]))
    }

    @Test("clean EOF before any prefix byte")
    func cleanEOFBeforePrefix() {
        #expect(throws: NativeMessagingFraming.FramingError.cleanEOF) {
            try NativeMessagingFraming.decodeFramedMessage(from: Data())
        }
    }

    @Test("partial four-byte prefix is rejected")
    func partialLengthPrefix() {
        let partial = Data([0x01, 0x00])
        #expect(throws: NativeMessagingFraming.FramingError.partialLengthPrefix(bytesRead: 2)) {
            try NativeMessagingFraming.decodeLengthPrefix(partial)
        }
    }

    @Test("zero length is rejected")
    func zeroLengthRejected() {
        let zero = Data([0x00, 0x00, 0x00, 0x00])
        #expect(throws: NativeMessagingFraming.FramingError.zeroLength) {
            try NativeMessagingFraming.decodeLengthPrefix(zero)
        }
    }

    @Test("message exceeding configured limit is rejected")
    func oversizedLengthRejected() throws {
        // maxMessageSize is 1_048_576 (0x00100000). One byte over:
        // 1_048_577 = 0x00100001 → little-endian [0x01, 0x00, 0x10, 0x00]
        let tooLarge = Data([0x01, 0x00, 0x10, 0x00])
        let error = #expect(throws: NativeMessagingFraming.FramingError.self) {
            try NativeMessagingFraming.decodeLengthPrefix(tooLarge)
        }
        guard case .messageTooLarge = error else {
            Issue.record("Expected messageTooLarge, got \(String(describing: error))")
            return
        }
    }

    @Test("truncated payload is rejected")
    func truncatedPayload() throws {
        let payload = Data("abc".utf8)
        var framed = try NativeMessagingFraming.encodeFramedMessage(payload)
        framed.removeLast()

        let error = #expect(throws: NativeMessagingFraming.FramingError.self) {
            try NativeMessagingFraming.decodeFramedMessage(from: framed)
        }
        guard case .truncatedPayload = error else {
            Issue.record("Expected truncatedPayload, got \(String(describing: error))")
            return
        }
    }

    @Test("decodes one valid framed message")
    func oneValidFramedMessage() throws {
        let payload = Data("{\"ok\":true}".utf8)
        let framed = try NativeMessagingFraming.encodeFramedMessage(payload)
        let decoded = try NativeMessagingFraming.decodeFramedMessage(from: framed)
        #expect(decoded.message == payload)
        #expect(decoded.remaining.isEmpty)
    }

    @Test("decodes two consecutive framed messages")
    func twoConsecutiveFramedMessages() throws {
        let first = Data("{\"a\":1}".utf8)
        let second = Data("{\"b\":2}".utf8)
        let buffer = try NativeMessagingFraming.encodeFramedMessage(first)
            + NativeMessagingFraming.encodeFramedMessage(second)

        let decodedFirst = try NativeMessagingFraming.decodeFramedMessage(from: buffer)
        #expect(decodedFirst.message == first)

        let decodedSecond = try NativeMessagingFraming.decodeFramedMessage(from: decodedFirst.remaining)
        #expect(decodedSecond.message == second)
        #expect(decodedSecond.remaining.isEmpty)
    }

    @Test("framed response output has correct length prefix and payload")
    func framedResponseEncoding() throws {
        let response = Data("{\"ok\":true,\"requestId\":\"r1\"}".utf8)
        let framed = try NativeMessagingFraming.encodeFramedMessage(response)
        #expect(framed.prefix(4) == (try NativeMessagingFraming.encodeLengthPrefix(UInt32(response.count))))
        #expect(framed.suffix(from: 4) == response)
    }

    @Test("empty payload is rejected on encode")
    func emptyPayloadRejectedOnEncode() {
        #expect(throws: NativeMessagingFraming.FramingError.emptyPayload) {
            try NativeMessagingFraming.encodeFramedMessage(Data())
        }
    }
}

// MARK: - Test doubles

/// Immutable per-call outcome for a fake route executor.
private struct FakeRouteOutcome: Sendable {
    let output: String
    let thrownError: RouteCommandError?

    init(output: String, thrownError: RouteCommandError? = nil) {
        self.output = output
        self.thrownError = thrownError
    }

    static func output(_ text: String) -> FakeRouteOutcome {
        FakeRouteOutcome(output: text)
    }

    static func throwError(_ error: RouteCommandError) -> FakeRouteOutcome {
        FakeRouteOutcome(output: "", thrownError: error)
    }
}

/// Immutable fake route executor for unit tests — never touches `/sbin/route`.
/// All stored properties are `let`; each test constructs its own instance so
/// concurrent Swift Testing runs do not share mutable state across tests.
private struct FakeRouteExecutor: RouteCommandExecuting {
    let output: String
    /// Optional failure injected into `runRouteGet`. Uses `RouteCommandError` only
    /// (no existential `Error`) so the double stays simple and immutable.
    let thrownError: RouteCommandError?

    init(output: String, thrownError: RouteCommandError? = nil) {
        self.output = output
        self.thrownError = thrownError
    }

    func runRouteGet(ip: String) throws -> String {
        // `ip` is ignored: tests assert on MessageHandler behavior, not Process arguments.
        if let thrownError {
            throw thrownError
        }
        return output
    }
}

/// Immutable map-based fake executor: different IPs can return different outputs/errors.
/// Tracks which IPs were queried (via a box) only when the test needs call-order assertions;
/// the box is created per-test and never shared across concurrent suites.
private final class FakeRouteCallLog: @unchecked Sendable {
    private(set) var ips: [String] = []
    func append(_ ip: String) { ips.append(ip) }
}

private struct FakeRouteMapExecutor: RouteCommandExecuting {
    /// Per-IP outcomes. Missing keys use `defaultOutcome`.
    let outcomesByIP: [String: FakeRouteOutcome]
    let defaultOutcome: FakeRouteOutcome
    let callLog: FakeRouteCallLog?

    init(
        outcomesByIP: [String: FakeRouteOutcome],
        defaultOutcome: FakeRouteOutcome = .output("    interface: en0\n"),
        callLog: FakeRouteCallLog? = nil
    ) {
        self.outcomesByIP = outcomesByIP
        self.defaultOutcome = defaultOutcome
        self.callLog = callLog
    }

    func runRouteGet(ip: String) throws -> String {
        callLog?.append(ip)
        let outcome = outcomesByIP[ip] ?? defaultOutcome
        if let thrownError = outcome.thrownError {
            throw thrownError
        }
        return outcome.output
    }
}

// MARK: - Message handler

/// End-to-end request handling with injected fake route output (no Process I/O).
@Suite("MessageHandler")
struct MessageHandlerTests {

    @Test("successful DIRECT route")
    func checkRouteSuccessDirect() {
        let output = "route to 1.1.1.1\n    interface: en0\n"
        let handler = MessageHandler(routeExecutor: FakeRouteExecutor(output: output))

        let requestJSON = """
        {"action":"checkRoute","requestId":"req-1","ip":"1.1.1.1"}
        """
        let response = handler.handle(data: Data(requestJSON.utf8))

        #expect(response.ok)
        #expect(response.requestId == "req-1")
        #expect(response.ip == "1.1.1.1")
        #expect(response.interface == "en0")
        #expect(response.routeType == "DIRECT")
        #expect(response.error == nil)
    }

    @Test("successful VPN route")
    func checkRouteSuccessVPN() {
        let output = "route to 1.1.1.1\n    interface: utun4\n"
        let handler = MessageHandler(routeExecutor: FakeRouteExecutor(output: output))

        let requestJSON = """
        {"action":"checkRoute","requestId":"req-2","ip":"1.1.1.1"}
        """
        let response = handler.handle(data: Data(requestJSON.utf8))

        #expect(response.ok)
        #expect(response.interface == "utun4")
        #expect(response.routeType == "VPN")
    }

    @Test("request ID is preserved on success and failure")
    func requestIdPreserved() {
        let successHandler = MessageHandler(
            routeExecutor: FakeRouteExecutor(output: "    interface: en0\n")
        )
        let successJSON = """
        {"action":"checkRoute","requestId":"preserve-ok","ip":"1.1.1.1"}
        """
        let success = successHandler.handle(data: Data(successJSON.utf8))
        #expect(success.requestId == "preserve-ok")

        let failHandler = MessageHandler(routeExecutor: FakeRouteExecutor(output: ""))
        let failJSON = """
        {"action":"checkRoute","requestId":"preserve-fail","ip":"not-an-ip"}
        """
        let failure = failHandler.handle(data: Data(failJSON.utf8))
        #expect(failure.requestId == "preserve-fail")
        #expect(failure.error?.code == HostErrorCode.invalidIP)
    }

    @Test("malformed JSON is rejected")
    func invalidJSONRejected() {
        let handler = MessageHandler(routeExecutor: FakeRouteExecutor(output: ""))
        let response = handler.handle(data: Data("{not json}".utf8))

        #expect(!response.ok)
        #expect(response.error?.code == HostErrorCode.invalidJSON)
    }

    @Test("unsupported action is rejected")
    func invalidActionRejected() {
        let handler = MessageHandler(routeExecutor: FakeRouteExecutor(output: ""))
        let requestJSON = """
        {"action":"unknownAction","requestId":"req-4"}
        """
        let response = handler.handle(data: Data(requestJSON.utf8))

        #expect(!response.ok)
        #expect(response.error?.code == HostErrorCode.invalidAction)
        #expect(response.requestId == "req-4")
    }

    @Test("missing IP is rejected")
    func missingIPRejected() {
        let handler = MessageHandler(routeExecutor: FakeRouteExecutor(output: ""))
        let requestJSON = """
        {"action":"checkRoute","requestId":"req-missing-ip"}
        """
        let response = handler.handle(data: Data(requestJSON.utf8))

        #expect(!response.ok)
        #expect(response.error?.code == HostErrorCode.invalidIP)
        #expect(response.requestId == "req-missing-ip")
    }

    @Test("invalid IP is rejected")
    func invalidIPRejected() {
        let handler = MessageHandler(routeExecutor: FakeRouteExecutor(output: ""))

        let requestJSON = """
        {"action":"checkRoute","requestId":"req-3","ip":"not-an-ip"}
        """
        let response = handler.handle(data: Data(requestJSON.utf8))

        #expect(!response.ok)
        #expect(response.error?.code == HostErrorCode.invalidIP)
    }

    @Test("route executor failure maps to ROUTE_COMMAND_FAILED")
    func routeCommandFailure() {
        let handler = MessageHandler(routeExecutor: FakeRouteExecutor(
            output: "",
            thrownError: .nonZeroExit(status: 1, reason: .exit)
        ))

        let requestJSON = """
        {"action":"checkRoute","requestId":"req-6","ip":"1.1.1.1"}
        """
        let response = handler.handle(data: Data(requestJSON.utf8))

        #expect(!response.ok)
        #expect(response.error?.code == HostErrorCode.routeCommandFailed)
        #expect(response.requestId == "req-6")
    }

    @Test("successful route command without interface maps to INTERFACE_NOT_FOUND")
    func interfaceNotFound() {
        let handler = MessageHandler(routeExecutor: FakeRouteExecutor(output: "route to nowhere"))

        let requestJSON = """
        {"action":"checkRoute","requestId":"req-5","ip":"1.1.1.1"}
        """
        let response = handler.handle(data: Data(requestJSON.utf8))

        #expect(!response.ok)
        #expect(response.error?.code == HostErrorCode.interfaceNotFound)
    }

    @Test("public error response does not expose raw stderr or route output")
    func errorResponseHidesRawOutput() {
        // Embed distinctive raw fragments that must never appear in the public error body.
        let rawMarker = "SECRET_ROUTE_STDERR_FRAGMENT_utun99"
        let handler = MessageHandler(routeExecutor: FakeRouteExecutor(
            output: "",
            thrownError: .nonZeroExit(status: 1, reason: .exit)
        ))

        let requestJSON = """
        {"action":"checkRoute","requestId":"req-hide","ip":"1.1.1.1"}
        """
        let response = handler.handle(data: Data(requestJSON.utf8))

        #expect(!response.ok)
        #expect(response.error?.code == HostErrorCode.routeCommandFailed)
        let message = response.error?.message ?? ""
        #expect(!message.contains(rawMarker))
        #expect(!message.contains("/sbin/route"))
        #expect(message == "Unable to execute route lookup.")

        // INTERFACE_NOT_FOUND path: raw route stdout must not leak into the public message.
        let leakyOutput = "route to 1.1.1.1\nraw dump \(rawMarker)\n"
        let noIfaceHandler = MessageHandler(routeExecutor: FakeRouteExecutor(output: leakyOutput))
        let noIface = noIfaceHandler.handle(data: Data(requestJSON.utf8))
        #expect(noIface.error?.code == HostErrorCode.interfaceNotFound)
        let noIfaceMessage = noIface.error?.message ?? ""
        #expect(!noIfaceMessage.contains(rawMarker))
        #expect(noIfaceMessage == "Could not determine routing interface for this IP.")
    }
}

// MARK: - Batch checkRoutes (Milestone 3)

/// Batch Native Messaging action — sequential lookups, per-item errors, no shared globals.
@Suite("MessageHandler.checkRoutes")
struct MessageHandlerBatchTests {

    @Test("existing checkRoute still succeeds alongside batch models")
    func checkRouteStillWorks() throws {
        let handler = MessageHandler(routeExecutor: FakeRouteExecutor(output: "    interface: en0\n"))
        let response = handler.handle(data: Data("""
        {"action":"checkRoute","requestId":"single","ip":"1.1.1.1"}
        """.utf8))
        #expect(response.ok)
        #expect(response.routeType == "DIRECT")
        #expect(response.results == nil)
    }

    @Test("valid two-IP batch returns both results")
    func validTwoIPBatch() throws {
        let executor = FakeRouteMapExecutor(outcomesByIP: [
            "1.1.1.1": .output("    interface: en0\n"),
            "8.8.8.8": .output("    interface: utun4\n"),
        ])
        let handler = MessageHandler(routeExecutor: executor)
        let response = handler.handle(data: Data("""
        {"action":"checkRoutes","requestId":"batch-2","ips":["1.1.1.1","8.8.8.8"]}
        """.utf8))

        #expect(response.ok)
        #expect(response.requestId == "batch-2")
        let results = try #require(response.results)
        #expect(results.count == 2)
        #expect(results[0].ok)
        #expect(results[0].ip == "1.1.1.1")
        #expect(results[0].routeType == "DIRECT")
        #expect(results[1].ok)
        #expect(results[1].ip == "8.8.8.8")
        #expect(results[1].routeType == "VPN")
    }

    @Test("input order is preserved in results")
    func orderPreservation() throws {
        let executor = FakeRouteMapExecutor(outcomesByIP: [
            "8.8.8.8": .output("    interface: utun0\n"),
            "1.1.1.1": .output("    interface: en0\n"),
        ])
        let handler = MessageHandler(routeExecutor: executor)
        let response = handler.handle(data: Data("""
        {"action":"checkRoutes","requestId":"order","ips":["8.8.8.8","1.1.1.1"]}
        """.utf8))
        let results = try #require(response.results)
        #expect(results.map(\.ip) == ["8.8.8.8", "1.1.1.1"])
    }

    @Test("duplicate valid IPs are looked up once but each input gets a result")
    func duplicateDeduplication() throws {
        let log = FakeRouteCallLog()
        let executor = FakeRouteMapExecutor(
            outcomesByIP: ["1.1.1.1": .output("    interface: en0\n")],
            callLog: log
        )
        let handler = MessageHandler(routeExecutor: executor)
        let response = handler.handle(data: Data("""
        {"action":"checkRoutes","requestId":"dedupe","ips":["1.1.1.1","1.1.1.1"," 1.1.1.1 "]}
        """.utf8))
        let results = try #require(response.results)
        #expect(results.count == 3)
        #expect(results.allSatisfy { $0.ok && $0.routeType == "DIRECT" })
        #expect(log.ips == ["1.1.1.1"])
    }

    @Test("empty ips list is rejected")
    func emptyListRejected() {
        let handler = MessageHandler(routeExecutor: FakeRouteExecutor(output: ""))
        let response = handler.handle(data: Data("""
        {"action":"checkRoutes","requestId":"empty","ips":[]}
        """.utf8))
        #expect(!response.ok)
        #expect(response.error?.code == HostErrorCode.emptyIPList)
        #expect(response.requestId == "empty")
    }

    @Test("missing ips field is rejected")
    func missingListRejected() throws {
        let handler = MessageHandler(routeExecutor: FakeRouteExecutor(output: ""))
        let response = handler.handle(data: Data("""
        {"action":"checkRoutes","requestId":"missing"}
        """.utf8))
        #expect(!response.ok)
        #expect(response.error?.code == HostErrorCode.invalidIPList)
        #expect(response.requestId == "missing")
    }

    @Test("oversized ips list is rejected before route lookup")
    func oversizedListRejected() throws {
        let log = FakeRouteCallLog()
        let executor = FakeRouteMapExecutor(outcomesByIP: [:], callLog: log)
        let handler = MessageHandler(routeExecutor: executor)
        let ips = (0..<129).map { "1.1.1.\($0 % 250)" }
        let ipsJSON = ips.map { "\"\($0)\"" }.joined(separator: ",")
        let response = handler.handle(data: Data("""
        {"action":"checkRoutes","requestId":"big","ips":[\(ipsJSON)]}
        """.utf8))
        #expect(!response.ok)
        #expect(response.error?.code == HostErrorCode.tooManyIPs)
        #expect(log.ips.isEmpty)
    }

    @Test("invalid item produces per-item INVALID_IP without failing the batch")
    func invalidItemPerItemError() throws {
        let log = FakeRouteCallLog()
        let executor = FakeRouteMapExecutor(
            outcomesByIP: ["1.1.1.1": .output("    interface: en0\n")],
            callLog: log
        )
        let handler = MessageHandler(routeExecutor: executor)
        let response = handler.handle(data: Data("""
        {"action":"checkRoutes","requestId":"mix","ips":["not-an-ip","1.1.1.1"]}
        """.utf8))
        #expect(response.ok)
        let results = try #require(response.results)
        #expect(results.count == 2)
        #expect(!results[0].ok)
        #expect(results[0].error?.code == HostErrorCode.invalidIP)
        #expect(results[1].ok)
        #expect(log.ips == ["1.1.1.1"])
    }

    @Test("one route command failure does not fail other items")
    func oneFailureDoesNotAbortBatch() throws {
        let executor = FakeRouteMapExecutor(outcomesByIP: [
            "1.1.1.1": .throwError(.nonZeroExit(status: 1, reason: .exit)),
            "8.8.8.8": .output("    interface: en0\n"),
        ])
        let handler = MessageHandler(routeExecutor: executor)
        let response = handler.handle(data: Data("""
        {"action":"checkRoutes","requestId":"partial","ips":["1.1.1.1","8.8.8.8"]}
        """.utf8))
        #expect(response.ok)
        let results = try #require(response.results)
        #expect(!results[0].ok)
        #expect(results[0].error?.code == HostErrorCode.routeCommandFailed)
        #expect(results[1].ok)
        #expect(results[1].routeType == "DIRECT")
        #expect(results[0].error?.message == "Unable to execute route lookup.")
        #expect(!(results[0].error?.message.contains("/sbin/route") ?? true))
    }

    @Test("missing interface for one item maps to INTERFACE_NOT_FOUND")
    func missingInterfaceOneItem() throws {
        let executor = FakeRouteMapExecutor(outcomesByIP: [
            "1.1.1.1": .output("route to nowhere"),
            "8.8.8.8": .output("    interface: bridge0\n"),
        ])
        let handler = MessageHandler(routeExecutor: executor)
        let response = handler.handle(data: Data("""
        {"action":"checkRoutes","requestId":"iface","ips":["1.1.1.1","8.8.8.8"]}
        """.utf8))
        let results = try #require(response.results)
        #expect(results[0].error?.code == HostErrorCode.interfaceNotFound)
        #expect(results[1].routeType == "DIRECT")
    }

    @Test("DIRECT VPN and UNKNOWN classifications in one batch")
    func mixedRouteTypes() throws {
        let executor = FakeRouteMapExecutor(outcomesByIP: [
            "1.1.1.1": .output("    interface: en0\n"),
            "2.2.2.2": .output("    interface: utun4\n"),
            "3.3.3.3": .output("    interface: lo0\n"),
        ])
        let handler = MessageHandler(routeExecutor: executor)
        let response = handler.handle(data: Data("""
        {"action":"checkRoutes","requestId":"types","ips":["1.1.1.1","2.2.2.2","3.3.3.3"]}
        """.utf8))
        let results = try #require(response.results)
        #expect(results.map(\.routeType) == ["DIRECT", "VPN", "UNKNOWN"])
    }

    @Test("batch requestId is preserved")
    func batchRequestIdPreserved() throws {
        let handler = MessageHandler(routeExecutor: FakeRouteExecutor(output: "    interface: en0\n"))
        let response = handler.handle(data: Data("""
        {"action":"checkRoutes","requestId":"keep-me","ips":["1.1.1.1"]}
        """.utf8))
        #expect(response.requestId == "keep-me")
    }

    @Test("raw route output does not leak in batch item errors")
    func batchNoRawLeak() throws {
        let marker = "SECRET_BATCH_ROUTE_OUTPUT"
        let executor = FakeRouteMapExecutor(outcomesByIP: [
            "1.1.1.1": .output("no interface \(marker)"),
        ])
        let handler = MessageHandler(routeExecutor: executor)
        let response = handler.handle(data: Data("""
        {"action":"checkRoutes","requestId":"leak","ips":["1.1.1.1"]}
        """.utf8))
        let results = try #require(response.results)
        let message = results[0].error?.message ?? ""
        #expect(!message.contains(marker))
    }

    @Test("route executor is called only for valid deduplicated IPs")
    func executorOnlyForValidDeduped() throws {
        let log = FakeRouteCallLog()
        let executor = FakeRouteMapExecutor(
            outcomesByIP: [
                "1.1.1.1": .output("    interface: en0\n"),
                "8.8.8.8": .output("    interface: utun4\n"),
            ],
            callLog: log
        )
        let handler = MessageHandler(routeExecutor: executor)
        let response = handler.handle(data: Data("""
        {"action":"checkRoutes","requestId":"calls","ips":["bad","1.1.1.1","8.8.8.8","1.1.1.1"]}
        """.utf8))
        #expect(response.ok)
        #expect(log.ips == ["1.1.1.1", "8.8.8.8"])
        #expect(response.results?.count == 4)
    }
}

// MARK: - Live / framed smoke (environment-dependent observations)

@Suite("checkRoutes live smoke")
struct CheckRoutesLiveSmokeTests {

    /// Uses the real `/sbin/route` executor. Interface and routeType are machine-dependent.
    @Test("live batch for 1.1.1.1 and 185.138.255.20")
    func liveTwoIPBatch() throws {
        let handler = MessageHandler()
        let requestJSON = """
        {"action":"checkRoutes","requestId":"live-smoke","ips":["1.1.1.1","185.138.255.20"]}
        """
        let framed = try NativeMessagingFraming.encodeFramedMessage(Data(requestJSON.utf8))
        let (payload, _) = try NativeMessagingFraming.decodeFramedMessage(from: framed)
        let response = handler.handle(data: payload)

        #expect(response.ok)
        #expect(response.requestId == "live-smoke")
        let results = try #require(response.results)
        #expect(results.count == 2)

        for item in results {
            #expect(!item.ip.isEmpty)
            // Environment-dependent observation (not a fixed expectation).
            fputs(
                "OBS live route: ip=\(item.ip) ok=\(item.ok) interface=\(item.interface ?? "null") routeType=\(item.routeType ?? "null")\n",
                stderr
            )
            if item.ok {
                #expect(item.interface != nil)
                #expect(item.routeType == "DIRECT" || item.routeType == "VPN" || item.routeType == "UNKNOWN")
            }
        }
    }
}
