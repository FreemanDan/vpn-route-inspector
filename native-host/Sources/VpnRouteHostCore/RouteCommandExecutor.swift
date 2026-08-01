import Foundation

/// Abstraction over `/sbin/route` execution so tests can inject fake output.
public protocol RouteCommandExecuting {
    /// Runs `route -n get <ip>` and returns combined stdout+stderr text, or throws on failure.
    func runRouteGet(ip: String) throws -> String
}

/// Production implementation that invokes `/sbin/route` directly via `Process` (no shell).
public struct SystemRouteCommandExecutor: RouteCommandExecuting {
    public init() {}

    public func runRouteGet(ip: String) throws -> String {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/sbin/route")
        // Arguments are passed as a discrete array — never interpolated into a shell string.
        process.arguments = ["-n", "get", ip]

        let stdoutPipe = Pipe()
        let stderrPipe = Pipe()
        process.standardOutput = stdoutPipe
        process.standardError = stderrPipe

        do {
            try process.run()
        } catch {
            fputs("Failed to launch /sbin/route: \(error)\n", stderr)
            throw RouteCommandError.launchFailed
        }

        process.waitUntilExit()

        let stdoutData = stdoutPipe.fileHandleForReading.readDataToEndOfFile()
        let stderrData = stderrPipe.fileHandleForReading.readDataToEndOfFile()

        let stdout = String(data: stdoutData, encoding: .utf8) ?? ""
        let stderrText = String(data: stderrData, encoding: .utf8) ?? ""

        let reason = process.terminationReason
        let status = process.terminationStatus

        guard reason == .exit, status == 0 else {
            if !stderrText.isEmpty {
                fputs("/sbin/route stderr: \(stderrText)\n", stderr)
            }
            fputs("/sbin/route exited with reason=\(reason) status=\(status)\n", stderr)
            throw RouteCommandError.nonZeroExit(status: status, reason: reason)
        }

        // Route may write useful fields to either stream depending on macOS version.
        return stdout + stderrText
    }
}
