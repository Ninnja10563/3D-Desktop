import Foundation

@main struct PointerMotionTests {
    static var checks = 0

    static func point(_ x: CGFloat, _ y: CGFloat = 0) -> CGPoint { CGPoint(x: x, y: y) }

    static func expect(_ result: PointerMotion.Result, _ expected: CGPoint,
                       suppressed: Bool = false, file: StaticString = #file, line: UInt = #line) {
        let actual: CGPoint
        switch result {
        case .position(let value):
            precondition(!suppressed, "Expected suppressed movement", file: file, line: line)
            actual = value
        case .suppressed(let value):
            precondition(suppressed, "Unexpected suppressed movement", file: file, line: line)
            actual = value
        case .failure(let reason):
            preconditionFailure(reason, file: file, line: line)
        }
        precondition(hypot(actual.x-expected.x, actual.y-expected.y) < 1e-9,
                     "Expected \(expected), received \(actual)", file: file, line: line)
        checks += 1
    }

    static func expectFailure(_ result: PointerMotion.Result, containing text: String,
                              file: StaticString = #file, line: UInt = #line) {
        guard case .failure(let reason) = result else {
            preconditionFailure("Expected failure", file: file, line: line)
        }
        precondition(reason.contains(text), "Unexpected error: \(reason)", file: file, line: line)
        checks += 1
    }

    static func started(maximumPendingWarps: Int = 64) -> PointerMotion {
        var motion = PointerMotion(maximumPendingWarps: maximumPendingWarps)
        expect(motion.begin(absolute: point(100), virtual: point(300), timestamp: 10), point(300))
        precondition(motion.canWarp)
        return motion
    }

    static func main() {
        // Physical trajectory: 100 -> 102 -> 104, warp to 20, move to 22,
        // warp to 30, move to 33. Net physical movement = 9, independent of
        // delivery delays. The old newest-anchor subtraction adds 82 at t=15.
        var queued = started()
        precondition(queued.recordWarp(from: point(104), to: point(20), start: 20, end: 21) == nil)
        expect(queued.consume(absolute: point(102), timestamp: 15, isMotion: true), point(302))
        precondition(queued.pendingWarpCount == 1)
        precondition(queued.recordWarp(from: point(22), to: point(30), start: 30, end: 31) == nil)
        expect(queued.consume(absolute: point(22), timestamp: 25, isMotion: true), point(306))
        precondition(queued.pendingWarpCount == 1)
        expect(queued.consume(absolute: point(33), timestamp: 40, isMotion: true), point(309))
        precondition(queued.pendingWarpCount == 0)

        // Coalescing all those movements into one event must give the same sum.
        var coalesced = started()
        precondition(coalesced.recordWarp(from: point(104), to: point(20), start: 20, end: 21) == nil)
        precondition(coalesced.recordWarp(from: point(22), to: point(30), start: 30, end: 31) == nil)
        expect(coalesced.consume(absolute: point(33), timestamp: 40, isMotion: true), point(309))

        // A post-warp readback at 52 includes two points of legitimate movement.
        // The correction must use requested 50, never post-warp readback 52.
        var readback = started()
        precondition(readback.recordWarp(from: point(104), to: point(50), start: 20, end: 21) == nil)
        expect(readback.consume(absolute: point(52), timestamp: 30, isMotion: true), point(306))

        // When the clock repeats a tick, call ordering still proves this warp
        // happened after the already-consumed initial anchor.
        var sameTick = started()
        precondition(sameTick.recordWarp(from: point(100), to: point(20), start: 10, end: 11) == nil)
        expect(sameTick.consume(absolute: point(22), timestamp: 12, isMotion: true), point(302))

        // Button down/up and scroll neither move the virtual cursor nor consume
        // the pending correction; their absolute location may be the source.
        var buttons = started()
        precondition(buttons.recordWarp(from: point(100), to: point(20), start: 20, end: 21) == nil)
        for timestamp: UInt64 in [22, 23, 24] {
            expect(buttons.consume(absolute: point(20), timestamp: timestamp, isMotion: false), point(300))
            precondition(buttons.pendingWarpCount == 1)
        }
        expect(buttons.consume(absolute: point(22), timestamp: 30, isMotion: true), point(302))

        // Both bracket boundaries are uncertain. After ambiguity, the first
        // clean event is a baseline, not a movement inferred across the gap.
        for boundary: UInt64 in [20, 21, 22] {
            var ambiguous = started()
            precondition(ambiguous.recordWarp(from: point(100), to: point(20), start: 20, end: 22) == nil)
            expect(ambiguous.consume(absolute: point(101), timestamp: boundary, isMotion: true),
                   point(300), suppressed: true)
            precondition(!ambiguous.canWarp)
            expect(ambiguous.consume(absolute: point(20), timestamp: 22, isMotion: false), point(300))
            precondition(!ambiguous.canWarp)
            expect(ambiguous.consume(absolute: point(22), timestamp: 23, isMotion: true),
                   point(300), suppressed: true)
            precondition(ambiguous.canWarp)
            expect(ambiguous.consume(absolute: point(23), timestamp: 24, isMotion: true), point(301))
            precondition(ambiguous.pendingWarpCount == 0)
        }
        var noBaseline = started()
        precondition(noBaseline.recordWarp(from: point(100), to: point(20), start: 20, end: 22) == nil)
        expect(noBaseline.consume(absolute: point(20), timestamp: 21, isMotion: true), point(300), suppressed: true)
        precondition(noBaseline.recordWarp(from: point(20), to: point(21), start: 23, end: 24)?.contains("baseline") == true)

        // Guard corrected physical movement, not the potentially huge warp.
        var largeWarp = started()
        precondition(largeWarp.recordWarp(from: point(100), to: point(1000), start: 20, end: 21) == nil)
        expect(largeWarp.consume(absolute: point(1001), timestamp: 30, isMotion: true), point(301))
        var excessive = started()
        precondition(excessive.recordWarp(from: point(100), to: point(-100), start: 20, end: 21) == nil)
        expectFailure(excessive.consume(absolute: point(110), timestamp: 30, isMotion: true), containing: "exceeded")
        precondition(!excessive.canWarp)
        expectFailure(excessive.consume(absolute: point(-99), timestamp: 31, isMotion: true), containing: "exceeded")
        expect(excessive.begin(absolute: point(0), virtual: point(0), timestamp: 40), point(0))
        expect(excessive.consume(absolute: point(1), timestamp: 41, isMotion: true), point(1))

        var regression = started()
        expect(regression.consume(absolute: point(100), timestamp: 20, isMotion: false), point(300))
        expectFailure(regression.consume(absolute: point(101), timestamp: 19, isMotion: true), containing: "timestamp regression")
        var warpRegression = started()
        precondition(warpRegression.recordWarp(from: point(100), to: point(20), start: 20, end: 22) == nil)
        precondition(warpRegression.recordWarp(from: point(20), to: point(30), start: 21, end: 23)?.contains("overlapping") == true)
        var priorWarp = started()
        precondition(priorWarp.recordWarp(from: point(100), to: point(20), start: 9, end: 11)?.contains("regression") == true)

        for invalid in [CGFloat.nan, .infinity, -.infinity] {
            var initial = PointerMotion()
            expectFailure(initial.begin(absolute: point(invalid), virtual: point(0), timestamp: 10), containing: "non-finite")
            var event = started()
            expectFailure(event.consume(absolute: point(100, invalid), timestamp: 11, isMotion: false), containing: "non-finite")
            var warp = started()
            precondition(warp.recordWarp(from: point(100), to: point(invalid), start: 20, end: 21)?.contains("non-finite") == true)
        }
        var arithmetic = started()
        precondition(arithmetic.recordWarp(from: point(-.greatestFiniteMagnitude), to: point(.greatestFiniteMagnitude),
                                          start: 20, end: 21)?.contains("non-finite") == true)

        var overflow = started(maximumPendingWarps: 2)
        precondition(overflow.recordWarp(from: point(100), to: point(20), start: 20, end: 21) == nil)
        precondition(overflow.recordWarp(from: point(20), to: point(30), start: 30, end: 31) == nil)
        precondition(overflow.recordWarp(from: point(30), to: point(40), start: 40, end: 41)?.contains("history") == true)
        expectFailure(overflow.consume(absolute: point(40), timestamp: 50, isMotion: true), containing: "history")
        var bounded = started(maximumPendingWarps: 1)
        for index in 0..<100 {
            let time = UInt64(index*10+20)
            precondition(bounded.recordWarp(from: point(100), to: point(100), start: time, end: time+1) == nil)
            expect(bounded.consume(absolute: point(100), timestamp: time+2, isMotion: true), point(300))
            precondition(bounded.pendingWarpCount == 0)
        }
        bounded.reset()
        precondition(bounded.virtualPoint == nil && bounded.pendingWarpCount == 0 && bounded.failureReason == nil && !bounded.canWarp)
        expectFailure(bounded.consume(absolute: point(0), timestamp: 2000, isMotion: true), containing: "not started")

        // Independent 2D trajectory with two warps and two coalesced physical
        // movements. Correction conserves the known physical displacement.
        var twoDimensions = PointerMotion()
        expect(twoDimensions.begin(absolute: point(10, 20), virtual: point(300, 400), timestamp: 10), point(300, 400))
        precondition(twoDimensions.recordWarp(from: point(13, 24), to: point(-50, 80), start: 20, end: 21) == nil)
        precondition(twoDimensions.recordWarp(from: point(-52, 86), to: point(100, -100), start: 30, end: 31) == nil)
        expect(twoDimensions.consume(absolute: point(105, -103), timestamp: 40, isMotion: true), point(306, 407))

        print("PASS: \(checks) pointer-motion assertions, including queued pre-warp events, coalescing, ambiguity, buttons, bounds and failure recovery. macOS timestamp/position assumptions remain unverified.")
    }
}
