import Foundation

/// Chrome Native Messaging length-prefix framing (little-endian UInt32).
/// Pure encode/decode logic lives here so Swift Testing can cover boundaries without a live host process.
public enum NativeMessagingFraming {
    /// Maximum accepted message payload size (1 MiB).
    public static let maxMessageSize: UInt32 = 1_048_576

    /// Framing errors for malformed or incomplete binary protocol input/output.
    public enum FramingError: Error, Equatable {
        /// EOF before any length-prefix byte was read (clean shutdown).
        case cleanEOF
        /// Fewer than four length-prefix bytes were available.
        case partialLengthPrefix(bytesRead: Int)
        /// Decoded length is zero.
        case zeroLength
        /// Decoded length exceeds `maxMessageSize`.
        case messageTooLarge(UInt32)
        /// Stream ended before the full payload was read.
        case truncatedPayload(expected: UInt32, received: Int)
        /// Outgoing payload is empty.
        case emptyPayload
        /// Outgoing payload length exceeds `maxMessageSize` or platform `Int` limits.
        case payloadTooLarge
    }

    // MARK: - Pure length codec

    /// Decodes a four-byte unsigned little-endian length prefix.
    public static func decodeLengthPrefix(_ bytes: Data) throws -> UInt32 {
        guard bytes.count == 4 else {
            if bytes.isEmpty {
                throw FramingError.cleanEOF
            }
            throw FramingError.partialLengthPrefix(bytesRead: bytes.count)
        }

        let b0 = UInt32(bytes[bytes.startIndex])
        let b1 = UInt32(bytes[bytes.startIndex + 1])
        let b2 = UInt32(bytes[bytes.startIndex + 2])
        let b3 = UInt32(bytes[bytes.startIndex + 3])
        let length = b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)

        guard length > 0 else {
            throw FramingError.zeroLength
        }

        guard length <= maxMessageSize else {
            throw FramingError.messageTooLarge(length)
        }

        return length
    }

    /// Encodes a payload length as four little-endian bytes.
    public static func encodeLengthPrefix(_ length: UInt32) throws -> Data {
        guard length > 0 else {
            throw FramingError.zeroLength
        }

        guard length <= maxMessageSize else {
            throw FramingError.messageTooLarge(length)
        }

        var prefix = Data(capacity: 4)
        prefix.append(UInt8(length & 0xFF))
        prefix.append(UInt8((length >> 8) & 0xFF))
        prefix.append(UInt8((length >> 16) & 0xFF))
        prefix.append(UInt8((length >> 24) & 0xFF))
        return prefix
    }

    // MARK: - Framed message codec

    /// Wraps `payload` with a four-byte little-endian length prefix.
    public static func encodeFramedMessage(_ payload: Data) throws -> Data {
        guard !payload.isEmpty else {
            throw FramingError.emptyPayload
        }

        guard payload.count <= Int(maxMessageSize) else {
            throw FramingError.payloadTooLarge
        }

        let length = UInt32(payload.count)
        var framed = try encodeLengthPrefix(length)
        framed.append(payload)
        return framed
    }

    /// Decodes the first framed message from an in-memory buffer.
    /// Returns the message bytes and any trailing bytes after the frame.
    public static func decodeFramedMessage(from buffer: Data) throws -> (message: Data, remaining: Data) {
        guard buffer.count >= 4 else {
            if buffer.isEmpty {
                throw FramingError.cleanEOF
            }
            throw FramingError.partialLengthPrefix(bytesRead: buffer.count)
        }

        let prefix = buffer.prefix(4)
        let length = try decodeLengthPrefix(prefix)
        let totalNeeded = 4 + Int(length)

        guard buffer.count >= totalNeeded else {
            throw FramingError.truncatedPayload(expected: length, received: buffer.count - 4)
        }

        let messageStart = buffer.startIndex + 4
        let messageEnd = messageStart + Int(length)
        let message = buffer.subdata(in: messageStart..<messageEnd)
        let remaining = buffer.subdata(in: messageEnd..<buffer.endIndex)
        return (message, remaining)
    }

    // MARK: - Stream I/O (stdin/stdout)

    /// Reads one framed message from `input`.
    /// Returns `nil` on clean EOF before any length-prefix byte.
    public static func readMessage(from input: FileHandle) throws -> Data? {
        guard let prefix = try readExact(count: 4, from: input) else {
            return nil
        }

        if prefix.count < 4 {
            throw FramingError.partialLengthPrefix(bytesRead: prefix.count)
        }

        let length = try decodeLengthPrefix(prefix)

        guard let payload = try readExact(count: Int(length), from: input) else {
            throw FramingError.truncatedPayload(expected: length, received: 0)
        }

        if payload.count < Int(length) {
            throw FramingError.truncatedPayload(expected: length, received: payload.count)
        }

        return payload
    }

    /// Writes one framed message to `output`. stdout must carry only these bytes.
    public static func writeMessage(_ payload: Data, to output: FileHandle) throws {
        let framed = try encodeFramedMessage(payload)
        output.write(framed)
    }

    /// Reads exactly `count` bytes, or `nil` if EOF occurs before any byte is read.
    private static func readExact(count: Int, from input: FileHandle) throws -> Data? {
        var buffer = Data()
        buffer.reserveCapacity(count)

        while buffer.count < count {
            let chunk = input.readData(ofLength: count - buffer.count)
            if chunk.isEmpty {
                if buffer.isEmpty {
                    return nil
                }
                return buffer
            }
            buffer.append(chunk)
        }

        return buffer
    }
}
