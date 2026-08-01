import Foundation

/// Errors raised when `/sbin/route` cannot be executed or exits unsuccessfully.
public enum RouteCommandError: Error, Equatable {
    /// The process could not be launched.
    case launchFailed
    /// The process terminated abnormally or with a non-zero exit code.
    case nonZeroExit(status: Int32, reason: Process.TerminationReason)
}
