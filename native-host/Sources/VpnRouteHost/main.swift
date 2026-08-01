import Foundation
import VpnRouteHostCore

/// Main read/process/write loop for the native messaging host.
/// stdout is reserved exclusively for framed Native Messaging responses.
@main
struct VpnRouteHostApp {
    static func main() {
        let handler = MessageHandler()
        let input = FileHandle.standardInput
        let output = FileHandle.standardOutput

        while true {
            do {
                guard let messageData = try NativeMessagingFraming.readMessage(from: input) else {
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

                try NativeMessagingFraming.writeMessage(responseData, to: output)
            } catch {
                fputs("Native messaging I/O error: \(error)\n", stderr)
                let errorResponse = HostResponse.failure(
                    requestId: nil,
                    code: HostErrorCode.internalError,
                    message: "Native messaging protocol error."
                )
                if let data = try? JSONEncoder().encode(errorResponse) {
                    try? NativeMessagingFraming.writeMessage(data, to: output)
                }
                break
            }
        }
    }
}
