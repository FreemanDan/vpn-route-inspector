import Foundation

/// Parses the `interface:` line from `/sbin/route -n get` output.
public enum RouteOutputParser {
    /// Extracts the interface name from macOS route command stdout/stderr combined text.
    /// Returns `nil` when no recognizable `interface:` field is present.
    public static func parseInterface(from output: String) -> String? {
        for line in output.split(whereSeparator: \.isNewline) {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            // macOS route output uses "interface: en0" (with optional leading spaces).
            guard trimmed.lowercased().hasPrefix("interface:") else { continue }

            let value = trimmed.dropFirst("interface:".count)
                .trimmingCharacters(in: .whitespaces)
            if !value.isEmpty {
                return String(value)
            }
        }
        return nil
    }
}
