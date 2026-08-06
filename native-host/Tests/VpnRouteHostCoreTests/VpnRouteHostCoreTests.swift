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
