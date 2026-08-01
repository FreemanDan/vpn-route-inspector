import Foundation

/// Validates that a string is a syntactically valid IPv4 address.
/// Rejects empty strings, hostnames, IPv6, and out-of-range octets.
public enum IPv4Validator {
    /// Returns `true` when `value` is a valid dotted-decimal IPv4 address.
    public static func isValid(_ value: String) -> Bool {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }

        let parts = trimmed.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4 else { return false }

        for part in parts {
            // Each octet must be numeric only (no leading/trailing junk).
            guard !part.isEmpty, part.allSatisfy(\.isNumber) else { return false }
            guard let octet = Int(part), octet >= 0, octet <= 255 else { return false }
            // Reject unnecessary leading zeros except the single digit "0".
            if part.count > 1, part.first == "0" { return false }
        }

        return true
    }
}
