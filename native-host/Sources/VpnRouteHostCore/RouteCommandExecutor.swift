import Foundation

/// Abstraction over `/sbin/route` execution so tests can inject fake output.
public protocol RouteCommandExecuting {
    /// Runs `route -n get <ip>` and returns combined stdout+stderr text, or throws on launch failure.
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

        try process.run()
        process.waitUntilExit()

        let stdoutData = stdoutPipe.fileHandleForReading.readDataToEndOfFile()
        let stderrData = stderrPipe.fileHandleForReading.readDataToEndOfFile()

        let stdout = String(data: stdoutData, encoding: .utf8) ?? ""
        let stderr = String(data: stderrData, encoding: .utf8) ?? ""

        // Route may write useful fields to either stream depending on macOS version.
        return stdout + stderr
    }
}
