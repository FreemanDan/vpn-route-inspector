import Foundation
import VpnRouteHostCore

/// Lightweight test runner used when XCTest is unavailable (Command Line Tools only).
@main
enum ManualTestRunner {
    static func main() {
        var failures = 0

        func assert(_ condition: Bool, _ message: String) {
            if condition {
                print("PASS: \(message)")
            } else {
                fputs("FAIL: \(message)\n", stderr)
                failures += 1
            }
        }

        // IPv4 validation
        assert(IPv4Validator.isValid("1.1.1.1"), "valid IPv4 1.1.1.1")
        assert(IPv4Validator.isValid("192.168.0.1"), "valid IPv4 192.168.0.1")
        assert(!IPv4Validator.isValid("256.1.1.1"), "invalid IPv4 256.1.1.1")
        assert(!IPv4Validator.isValid("not-an-ip"), "invalid hostname")
        assert(!IPv4Validator.isValid("01.1.1.1"), "invalid leading zero")

        // Route output parsing
        assert(
            RouteOutputParser.parseInterface(from: "route to 1.1.1.1\n    interface: en0\n") == "en0",
            "parse interface en0"
        )
        assert(
            RouteOutputParser.parseInterface(from: "route to 1.1.1.1\n    interface: utun4\n") == "utun4",
            "parse interface utun4"
        )
        assert(
            RouteOutputParser.parseInterface(from: "no interface here") == nil,
            "malformed route output"
        )

        // Classification
        assert(RouteClassifier.classify(interface: "en0") == .direct, "DIRECT classification en0")
        assert(RouteClassifier.classify(interface: "utun4") == .vpn, "VPN classification utun4")
        assert(RouteClassifier.classify(interface: "lo0") == .unknown, "UNKNOWN classification lo0")

        // Message handler integration with fake executor
        struct FakeRouteExecutor: RouteCommandExecuting {
            let output: String
            func runRouteGet(ip: String) throws -> String { output }
        }

        let directHandler = MessageHandler(routeExecutor: FakeRouteExecutor(output: "interface: en0\n"))
        let directResponse = directHandler.handle(data: Data("""
        {"action":"checkRoute","requestId":"r1","ip":"1.1.1.1"}
        """.utf8))
        assert(directResponse.ok && directResponse.routeType == "DIRECT", "handler DIRECT path")

        let vpnHandler = MessageHandler(routeExecutor: FakeRouteExecutor(output: "interface: utun4\n"))
        let vpnResponse = vpnHandler.handle(data: Data("""
        {"action":"checkRoute","requestId":"r2","ip":"1.1.1.1"}
        """.utf8))
        assert(vpnResponse.ok && vpnResponse.routeType == "VPN", "handler VPN path")

        let badIPHandler = MessageHandler(routeExecutor: FakeRouteExecutor(output: ""))
        let badIPResponse = badIPHandler.handle(data: Data("""
        {"action":"checkRoute","requestId":"r3","ip":"bad"}
        """.utf8))
        assert(!badIPResponse.ok && badIPResponse.error?.code == HostErrorCode.invalidIP, "invalid IP rejected")

        if failures > 0 {
            fputs("\n\(failures) test(s) failed.\n", stderr)
            exit(1)
        }

        print("\nAll manual tests passed.")
    }
}
