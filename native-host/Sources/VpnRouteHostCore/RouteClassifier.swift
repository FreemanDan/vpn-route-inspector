import Foundation

/// Maps a macOS network interface name to a route classification.
public enum RouteClassifier {
    /// Classifies `interfaceName` as VPN, DIRECT, or UNKNOWN based on naming conventions.
    public static func classify(interface interfaceName: String) -> RouteType {
        let name = interfaceName.lowercased()

        // utun* interfaces are typically created by VPN clients (WireGuard, OpenVPN, etc.).
        if name.hasPrefix("utun") {
            return .vpn
        }

        // Physical/Wi‑Fi/Ethernet and common cellular interfaces route outside the VPN tunnel.
        if name.hasPrefix("en") || name.hasPrefix("bridge") || name.hasPrefix("pdp_ip") {
            return .direct
        }

        return .unknown
    }
}
