import Foundation
import VpnRouteHostCore

/// Chrome Native Messaging protocol limits (bytes).
enum NativeMessagingLimits {
    /// Maximum accepted incoming message size (1 MiB).
    static let maxMessageSize = 1_048_576
}

/// Reads and writes length-prefixed JSON messages for Chrome Native Messaging.
/// stdout is reserved exclusively for the binary protocol; logs go to stderr.
enum NativeMessagingIO {
    /// Reads one framed message from stdin. Returns `nil` on clean EOF with no data.
    static func readMessage(from input: FileHandle) throws -> Data? {
        // First 4 bytes: little-endian unsigned message length.
        guard let lengthData = try readExact(count: 4, from: input) else {
            return nil
        }

        let length: UInt32 = lengthData.withUnsafeBytes { raw in
            raw.load(as: UInt32.self)
        }

        guard length > 0 else {
            throw NativeMessagingError.invalidLength
        }

        guard length <= NativeMessagingLimits.maxMessageSize else {
            throw NativeMessagingError.messageTooLarge
        }

        guard let payload = try readExact(count: Int(length), from: input) else {
            throw NativeMessagingError.unexpectedEOF
        }

        return payload
    }

    /// Writes one framed JSON response to stdout.
    static func writeMessage(_ data: Data, to output: FileHandle) throws {
        var length = UInt32(data.count).littleEndian
        let lengthData = Data(bytes: &length, count: 4)
        output.write(lengthData)
        output.write(data)
    }

    /// Reads exactly `count` bytes or returns `nil` on clean EOF before any byte was read.
    private static func readExact(count: Int, from input: FileHandle) throws -> Data? {
        var buffer = Data()
        buffer.reserveCapacity(count)

        while buffer.count < count {
            let chunk = input.readData(ofLength: count - buffer.count)
            if chunk.isEmpty {
                // Clean EOF: no message if we haven't read the length prefix yet.
                if buffer.isEmpty { return nil }
                throw NativeMessagingError.unexpectedEOF
            }
            buffer.append(chunk)
        }

        return buffer
    }
}

enum NativeMessagingError: Error, CustomStringConvertible {
    case invalidLength
    case messageTooLarge
    case unexpectedEOF

    var description: String {
        switch self {
        case .invalidLength: return "Invalid message length (zero)."
        case .messageTooLarge: return "Message exceeds maximum allowed size."
        case .unexpectedEOF: return "Unexpected end of input while reading message."
        }
    }
}

/// Main read/process/write loop for the native messaging host.
@main
struct VpnRouteHostApp {
    static func main() {
        let handler = MessageHandler()
        let input = FileHandle.standardInput
        let output = FileHandle.standardOutput

        fputs("vpn-route-host started\n", stderr)

        while true {
            do {
                guard let messageData = try NativeMessagingIO.readMessage(from: input) else {
                    // Chrome closed stdin — exit cleanly.
                    break
                }

                let response = handler.handle(data: messageData)

                let responseData: Data
                do {
                    responseData = try JSONEncoder().encode(response)
                } catch {
                    fputs("Failed to encode response: \(error)\n", stderr)
                    let fallback = HostResponse.failure(
                        requestId: nil,
                        code: HostErrorCode.internalError,
                        message: "Failed to encode response."
                    )
                    responseData = (try? JSONEncoder().encode(fallback)) ?? Data("{}".utf8)
                }

                try NativeMessagingIO.writeMessage(responseData, to: output)
            } catch {
                fputs("Native messaging I/O error: \(error)\n", stderr)
                // Attempt to send a structured error response before exiting.
                let errorResponse = HostResponse.failure(
                    requestId: nil,
                    code: HostErrorCode.internalError,
                    message: "Native messaging protocol error."
                )
                if let data = try? JSONEncoder().encode(errorResponse) {
                    try? NativeMessagingIO.writeMessage(data, to: output)
                }
                break
            }
        }

        fputs("vpn-route-host exiting\n", stderr)
    }
}
