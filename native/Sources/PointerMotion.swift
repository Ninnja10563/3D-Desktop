import Foundation

/// Pure bookkeeping for the experimental, still-associated system pointer.
///
/// This relies on unverified macOS timing assumptions: hardware event timestamps
/// and warp brackets must share an uptime clock, and an event's absolute location
/// must describe its timestamp. Tests prove the bookkeeping, not those OS facts.
/// The displacement uses the requested destination minus a live sample taken
/// immediately before the warp. A post-warp sample can include real movement and
/// must not be substituted for the requested destination.
struct PointerMotion {
    enum Result {
        case position(CGPoint)
        // Do not warp on this result. Resume only after a clean baseline exists.
        case suppressed(CGPoint)
        case failure(String)
    }

    private struct Anchor {
        let absolute: CGPoint
        let timestamp: UInt64
    }

    private struct Warp {
        let displacement: CGPoint
        let start: UInt64
        let end: UInt64
    }

    private var anchor: Anchor?
    private var lastInputTimestamp: UInt64?
    private var lastWarpEnd: UInt64?
    private var warps: [Warp] = []
    private let maximumMovement: CGFloat
    private let maximumPendingWarps: Int
    private(set) var virtualPoint: CGPoint?
    private(set) var failureReason: String?
    var pendingWarpCount: Int { warps.count }
    var canWarp: Bool { virtualPoint != nil && anchor != nil && failureReason == nil }

    init(maximumMovement: CGFloat = 120, maximumPendingWarps: Int = 64) {
        precondition(maximumMovement.isFinite && maximumMovement > 0)
        precondition(maximumPendingWarps > 0)
        self.maximumMovement = maximumMovement
        self.maximumPendingWarps = maximumPendingWarps
    }

    mutating func reset() {
        anchor = nil
        lastInputTimestamp = nil
        lastWarpEnd = nil
        warps.removeAll(keepingCapacity: true)
        virtualPoint = nil
        failureReason = nil
    }

    mutating func begin(absolute: CGPoint, virtual: CGPoint, timestamp: UInt64) -> Result {
        reset()
        guard Self.finite(absolute), Self.finite(virtual) else {
            return fail("non-finite initial pointer")
        }
        anchor = Anchor(absolute: absolute, timestamp: timestamp)
        virtualPoint = virtual
        lastInputTimestamp = timestamp
        return .position(virtual)
    }

    /// Record only successful CGWarpMouseCursorPosition calls. The caller must
    /// stop the probe when this returns an error; failed state remains latched.
    mutating func recordWarp(from livePosition: CGPoint, to destination: CGPoint,
                             start: UInt64, end: UInt64) -> String? {
        if let failureReason { return failureReason }
        guard virtualPoint != nil, anchor != nil else {
            return latch("warp without an unambiguous pointer baseline")
        }
        guard Self.finite(livePosition), Self.finite(destination) else {
            return latch("non-finite warp position")
        }
        guard start <= end,
              lastInputTimestamp.map({ start >= $0 }) ?? false,
              lastWarpEnd.map({ start >= $0 }) ?? true else {
            return latch("warp timestamp regression or overlapping brackets")
        }
        let displacement = CGPoint(x: destination.x-livePosition.x,
                                   y: destination.y-livePosition.y)
        guard Self.finite(displacement) else { return latch("non-finite warp displacement") }
        guard warps.count < maximumPendingWarps else {
            return latch("pending warp history exceeded its limit")
        }
        warps.append(Warp(displacement: displacement, start: start, end: end))
        lastWarpEnd = end
        return nil
    }

    /// Feed ordered, untagged hardware events. Button/scroll events intentionally
    /// freeze the virtual point and do not consume a movement correction. Their
    /// ownership and matching releases remain the caller's responsibility.
    mutating func consume(absolute: CGPoint, timestamp: UInt64, isMotion: Bool) -> Result {
        if let failureReason { return .failure(failureReason) }
        guard let virtualPoint else { return fail("pointer motion was not started") }
        guard Self.finite(absolute) else { return fail("non-finite event position") }
        guard let lastInputTimestamp, timestamp >= lastInputTimestamp else {
            return fail("event timestamp regression")
        }
        self.lastInputTimestamp = timestamp
        guard isMotion else { return .position(virtualPoint) }

        // An event generated during a warp could describe either coordinate
        // state. Do not guess. Stop warping until a later unambiguous movement
        // establishes a baseline; that baseline also emits no movement.
        if warps.contains(where: { $0.start <= timestamp && timestamp <= $0.end }) {
            anchor = nil
            retireWarps(before: timestamp)
            return .suppressed(virtualPoint)
        }
        guard let anchor else {
            self.anchor = Anchor(absolute: absolute, timestamp: timestamp)
            retireWarps(before: timestamp)
            return .suppressed(virtualPoint)
        }

        var dx = absolute.x-anchor.absolute.x
        var dy = absolute.y-anchor.absolute.y
        // Equality at the anchor is possible with a coarse clock. recordWarp
        // was called after that anchor was consumed, so ordering is known.
        for warp in warps where warp.start >= anchor.timestamp && warp.end < timestamp {
            dx -= warp.displacement.x
            dy -= warp.displacement.y
        }
        guard dx.isFinite, dy.isFinite else { return fail("non-finite corrected movement") }
        guard hypot(dx, dy) <= maximumMovement else {
            return fail("corrected movement exceeded \(maximumMovement) points")
        }
        let next = CGPoint(x: virtualPoint.x+dx, y: virtualPoint.y+dy)
        guard Self.finite(next) else { return fail("non-finite virtual pointer") }
        self.virtualPoint = next
        self.anchor = Anchor(absolute: absolute, timestamp: timestamp)
        retireWarps(before: timestamp)
        return .position(next)
    }

    private mutating func retireWarps(before timestamp: UInt64) {
        warps.removeAll { $0.end < timestamp }
    }

    private static func finite(_ point: CGPoint) -> Bool {
        point.x.isFinite && point.y.isFinite
    }

    @discardableResult
    private mutating func latch(_ reason: String) -> String {
        failureReason = reason
        return reason
    }

    private mutating func fail(_ reason: String) -> Result {
        .failure(latch(reason))
    }
}
