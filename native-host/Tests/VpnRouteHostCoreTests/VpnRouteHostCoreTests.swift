import XCTest
@testable import VpnRouteHostCore

final class IPv4ValidatorTests: XCTestCase {
    func testValidIPv4Addresses() {
        XCTAssertTrue(IPv4Validator.isValid("1.1.1.1"))
        XCTAssertTrue(IPv4Validator.isValid("192.168.0.1"))
        XCTAssertTrue(IPv4Validator.isValid("10.0.0.255"))
        XCTAssertTrue(IPv4Validator.isValid("0.0.0.0"))
        XCTAssertTrue(IPv4Validator.isValid("255.255.255.255"))
    }

    func testInvalidIPv4Addresses() {
        XCTAssertFalse(IPv4Validator.isValid(""))
        XCTAssertFalse(IPv4Validator.isValid("256.1.1.1"))
        XCTAssertFalse(IPv4Validator.isValid("1.1.1"))
        XCTAssertFalse(IPv4Validator.isValid("1.1.1.1.1"))
        XCTAssertFalse(IPv4Validator.isValid("1.1.1.1a"))
        XCTAssertFalse(IPv4Validator.isValid("example.com"))
        XCTAssertFalse(IPv4Validator.isValid("::1"))
        XCTAssertFalse(IPv4Validator.isValid("01.1.1.1"))
        XCTAssertFalse(IPv4Validator.isValid("-1.0.0.1"))
    }
}

final class RouteOutputParserTests: XCTestCase {
    func testParseInterfaceEn0() {
        let output = """
        route to 1.1.1.1
        destination: 1.1.1.1
            interface: en0
        """
        XCTAssertEqual(RouteOutputParser.parseInterface(from: output), "en0")
    }

    func testParseInterfaceUtun4() {
        let output = """
        route to 1.1.1.1
        destination: 1.1.1.1
            interface: utun4
        """
        XCTAssertEqual(RouteOutputParser.parseInterface(from: output), "utun4")
    }

    func testMalformedRouteOutput() {
        XCTAssertNil(RouteOutputParser.parseInterface(from: "no interface here"))
        XCTAssertNil(RouteOutputParser.parseInterface(from: "interface:"))
        XCTAssertNil(RouteOutputParser.parseInterface(from: ""))
    }
}

final class RouteClassifierTests: XCTestCase {
    func testDirectClassification() {
        XCTAssertEqual(RouteClassifier.classify(interface: "en0"), .direct)
        XCTAssertEqual(RouteClassifier.classify(interface: "en1"), .direct)
        XCTAssertEqual(RouteClassifier.classify(interface: "bridge0"), .direct)
        XCTAssertEqual(RouteClassifier.classify(interface: "pdp_ip0"), .direct)
    }

    func testVPNClassification() {
        XCTAssertEqual(RouteClassifier.classify(interface: "utun4"), .vpn)
        XCTAssertEqual(RouteClassifier.classify(interface: "utun0"), .vpn)
    }

    func testUnknownClassification() {
        XCTAssertEqual(RouteClassifier.classify(interface: "lo0"), .unknown)
        XCTAssertEqual(RouteClassifier.classify(interface: "gif0"), .unknown)
        XCTAssertEqual(RouteClassifier.classify(interface: "awdl0"), .unknown)
    }
}

final class NativeMessagingFramingTests: XCTestCase {
    func testDecodeLengthLittleEndian() throws {
        let bytes = Data([0x05, 0x00, 0x00, 0x00])
        XCTAssertEqual(try NativeMessagingFraming.decodeLengthPrefix(bytes), 5)
    }

    func testEncodeLengthLittleEndian() throws {
        let prefix = try NativeMessagingFraming.encodeLengthPrefix(0x01020304)
        XCTAssertEqual(prefix, Data([0x04, 0x03, 0x02, 0x01]))
    }

    func testCleanEOFBeforePrefix() {
        XCTAssertThrowsError(try NativeMessagingFraming.decodeFramedMessage(from: Data())) { error in
            XCTAssertEqual(error as? NativeMessagingFraming.FramingError, .cleanEOF)
        }
    }

    func testPartialLengthPrefix() {
        let partial = Data([0x01, 0x00])
        XCTAssertThrowsError(try NativeMessagingFraming.decodeLengthPrefix(partial)) { error in
            XCTAssertEqual(error as? NativeMessagingFraming.FramingError, .partialLengthPrefix(bytesRead: 2))
        }
    }

    func testZeroLengthRejected() {
        let zero = Data([0x00, 0x00, 0x00, 0x00])
        XCTAssertThrowsError(try NativeMessagingFraming.decodeLengthPrefix(zero)) { error in
            XCTAssertEqual(error as? NativeMessagingFraming.FramingError, .zeroLength)
        }
    }

    func testOversizedLengthRejected() {
        let tooLarge = Data([0x00, 0x00, 0x10, 0x00])
        XCTAssertThrowsError(try NativeMessagingFraming.decodeLengthPrefix(tooLarge)) { error in
            if case .messageTooLarge = error as? NativeMessagingFraming.FramingError {
                return
            }
            XCTFail("Expected messageTooLarge")
        }
    }

    func testTruncatedPayload() throws {
        let payload = Data("abc".utf8)
        var framed = try NativeMessagingFraming.encodeFramedMessage(payload)
        framed.removeLast()

        XCTAssertThrowsError(try NativeMessagingFraming.decodeFramedMessage(from: framed)) { error in
            if case .truncatedPayload = error as? NativeMessagingFraming.FramingError {
                return
            }
            XCTFail("Expected truncatedPayload")
        }
    }

    func testOneValidFramedMessage() throws {
        let payload = Data("{\"ok\":true}".utf8)
        let framed = try NativeMessagingFraming.encodeFramedMessage(payload)
        let decoded = try NativeMessagingFraming.decodeFramedMessage(from: framed)
        XCTAssertEqual(decoded.message, payload)
        XCTAssertTrue(decoded.remaining.isEmpty)
    }

    func testTwoConsecutiveFramedMessages() throws {
        let first = Data("{\"a\":1}".utf8)
        let second = Data("{\"b\":2}".utf8)
        let buffer = try NativeMessagingFraming.encodeFramedMessage(first)
            + NativeMessagingFraming.encodeFramedMessage(second)

        let decodedFirst = try NativeMessagingFraming.decodeFramedMessage(from: buffer)
        XCTAssertEqual(decodedFirst.message, first)

        let decodedSecond = try NativeMessagingFraming.decodeFramedMessage(from: decodedFirst.remaining)
        XCTAssertEqual(decodedSecond.message, second)
        XCTAssertTrue(decodedSecond.remaining.isEmpty)
    }

    func testFramedResponseEncoding() throws {
        let response = Data("{\"ok\":true,\"requestId\":\"r1\"}".utf8)
        let framed = try NativeMessagingFraming.encodeFramedMessage(response)
        XCTAssertEqual(framed.prefix(4), try NativeMessagingFraming.encodeLengthPrefix(UInt32(response.count)))
        XCTAssertEqual(framed.suffix(from: 4), response)
    }

    func testEmptyPayloadRejectedOnEncode() {
        XCTAssertThrowsError(try NativeMessagingFraming.encodeFramedMessage(Data())) { error in
            XCTAssertEqual(error as? NativeMessagingFraming.FramingError, .emptyPayload)
        }
    }
}

/// Fake route executor for unit tests — never touches `/sbin/route`.
private struct FakeRouteExecutor: RouteCommandExecuting {
    let output: String
    let thrownError: Error?

    init(output: String, thrownError: Error? = nil) {
        self.output = output
        self.thrownError = thrownError
    }

    func runRouteGet(ip: String) throws -> String {
        if let thrownError {
            throw thrownError
        }
        return output
    }
}

final class MessageHandlerTests: XCTestCase {
    func testCheckRouteSuccessDirect() {
        let output = "route to 1.1.1.1\n    interface: en0\n"
        let handler = MessageHandler(routeExecutor: FakeRouteExecutor(output: output))

        let requestJSON = """
        {"action":"checkRoute","requestId":"req-1","ip":"1.1.1.1"}
        """
        let response = handler.handle(data: Data(requestJSON.utf8))

        XCTAssertTrue(response.ok)
        XCTAssertEqual(response.requestId, "req-1")
        XCTAssertEqual(response.ip, "1.1.1.1")
        XCTAssertEqual(response.interface, "en0")
        XCTAssertEqual(response.routeType, "DIRECT")
        XCTAssertNil(response.error)
    }

    func testCheckRouteSuccessVPN() {
        let output = "route to 1.1.1.1\n    interface: utun4\n"
        let handler = MessageHandler(routeExecutor: FakeRouteExecutor(output: output))

        let requestJSON = """
        {"action":"checkRoute","requestId":"req-2","ip":"1.1.1.1"}
        """
        let response = handler.handle(data: Data(requestJSON.utf8))

        XCTAssertTrue(response.ok)
        XCTAssertEqual(response.interface, "utun4")
        XCTAssertEqual(response.routeType, "VPN")
    }

    func testInvalidIPRejected() {
        let handler = MessageHandler(routeExecutor: FakeRouteExecutor(output: ""))

        let requestJSON = """
        {"action":"checkRoute","requestId":"req-3","ip":"not-an-ip"}
        """
        let response = handler.handle(data: Data(requestJSON.utf8))

        XCTAssertFalse(response.ok)
        XCTAssertEqual(response.error?.code, HostErrorCode.invalidIP)
    }

    func testInvalidJSONRejected() {
        let handler = MessageHandler()
        let response = handler.handle(data: Data("{not json}".utf8))

        XCTAssertFalse(response.ok)
        XCTAssertEqual(response.error?.code, HostErrorCode.invalidJSON)
    }

    func testInvalidActionRejected() {
        let handler = MessageHandler()
        let requestJSON = """
        {"action":"unknownAction","requestId":"req-4"}
        """
        let response = handler.handle(data: Data(requestJSON.utf8))

        XCTAssertFalse(response.ok)
        XCTAssertEqual(response.error?.code, HostErrorCode.invalidAction)
    }

    func testInterfaceNotFound() {
        let handler = MessageHandler(routeExecutor: FakeRouteExecutor(output: "route to nowhere"))

        let requestJSON = """
        {"action":"checkRoute","requestId":"req-5","ip":"1.1.1.1"}
        """
        let response = handler.handle(data: Data(requestJSON.utf8))

        XCTAssertFalse(response.ok)
        XCTAssertEqual(response.error?.code, HostErrorCode.interfaceNotFound)
    }

    func testRouteCommandFailure() {
        let handler = MessageHandler(routeExecutor: FakeRouteExecutor(
            output: "",
            thrownError: RouteCommandError.nonZeroExit(status: 1, reason: .exit)
        ))

        let requestJSON = """
        {"action":"checkRoute","requestId":"req-6","ip":"1.1.1.1"}
        """
        let response = handler.handle(data: Data(requestJSON.utf8))

        XCTAssertFalse(response.ok)
        XCTAssertEqual(response.error?.code, HostErrorCode.routeCommandFailed)
    }
}
