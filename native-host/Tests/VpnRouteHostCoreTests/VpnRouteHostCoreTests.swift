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
        XCTAssertFalse(IPv4Validator.isValid("01.1.1.1")) // leading zero
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

/// Fake route executor for unit tests — never touches `/sbin/route`.
private struct FakeRouteExecutor: RouteCommandExecuting {
    let output: String
    let shouldThrow: Bool

    init(output: String, shouldThrow: Bool = false) {
        self.output = output
        self.shouldThrow = shouldThrow
    }

    func runRouteGet(ip: String) throws -> String {
        if shouldThrow { throw NSError(domain: "test", code: 1) }
        return output
    }
}

final class MessageHandlerTests: XCTestCase {
    func testCheckRouteSuccessDirect() throws {
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

    func testCheckRouteSuccessVPN() throws {
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
}
