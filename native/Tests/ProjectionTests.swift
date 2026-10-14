import Foundation
import QuartzCore

@main struct ProjectionTests {
    static func containsIncludingEdges(_ rect: CGRect, _ point: CGPoint) -> Bool {
        // CGRect.contains excludes its maximum edges; a render enclosure must
        // also retain points exactly on those edges.
        let epsilon = 1e-8
        return point.x >= rect.minX-epsilon && point.x <= rect.maxX+epsilon &&
               point.y >= rect.minY-epsilon && point.y <= rect.maxY+epsilon
    }

    static func main() {
        var checks = 0
        var canvasChecks = 0
        var minimumDenominator = Double.infinity
        let sizes = [(586.0,488.0),(1470,923),(920,436),(300,900),
                     (151,900),(1470,101),(900,900),(151,101)]
        let yaws = Array(stride(from: -65.0, through: 65.0, by: 5.0)) + [-58.0, 58.0]
        let pitches = Array(stride(from: -55.0, through: 55.0, by: 5.0)) + [-8.0, 8.0]
        for (width, height) in sizes {
            for yaw in yaws { for pitch in pitches { for depth in [0.0,80,500,1000,1500] {
                let projection = Projection(width:width,height:height,yaw:yaw,pitch:pitch,depth:depth)
                let bounds = projection.projectedBounds
                precondition(!bounds.isNull && !bounds.isInfinite && !bounds.isEmpty)
                precondition(bounds.minX == floor(bounds.minX) && bounds.minY == floor(bounds.minY) &&
                             bounds.maxX == ceil(bounds.maxX) && bounds.maxY == ceil(bounds.maxY),
                             "Projected bounds must round outward to whole points")
                let ry = yaw * .pi/180, rx = pitch * .pi/180
                let focal = max(width,height)*2.5
                for ix in 0...10 { for iy in 0...10 {
                    let point = CGPoint(x:width*Double(ix)/10,y:height*Double(iy)/10)
                    let output = projection.project(point)
                    let roundtrip = projection.unproject(output)
                    precondition(hypot(roundtrip.x-point.x,roundtrip.y-point.y) < 1e-7, "Inverse input mapping failed")
                    precondition(output.x.isFinite && output.y.isFinite && containsIncludingEdges(bounds, output),
                                 "Projected content escapes its render enclosure")
                    // Independent 3D rotation and pinhole projection, not an inverse-only test.
                    let x = point.x-width/2, y = point.y-height/2
                    let rotatedX = cos(ry)*x + sin(ry)*sin(rx)*y
                    let rotatedY = cos(rx)*y
                    let rotatedZ = -sin(ry)*x + cos(ry)*sin(rx)*y
                    let factor = (focal/(focal+depth)*0.82)/(1-rotatedZ/focal)
                    precondition(abs(output.x-(width/2+rotatedX*factor)) < 1e-7)
                    precondition(abs(output.y-(height/2+rotatedY*factor)) < 1e-7)
                    let t = projection.layerTransform
                    let w = point.x*t.m14+point.y*t.m24+t.m44
                    precondition(w.isFinite && w >= 0.6-1e-12, "Perspective denominator can cross zero")
                    minimumDenominator = min(minimumDenominator, w)
                    precondition(abs((point.x*t.m11+point.y*t.m21+t.m41)/w-output.x) < 1e-7)
                    precondition(abs((point.x*t.m12+point.y*t.m22+t.m42)/w-output.y) < 1e-7)
                    checks += 1
                }}
                // Exercise the top-left projection to bottom-left screen
                // conversion and canvas-origin changes in every move direction.
                let original = CGRect(x: -1100, y: 70, width: width, height: height)
                for offset in [CGPoint.zero, CGPoint(x:410,y:250), CGPoint(x:-410,y:250),
                               CGPoint(x:410,y:-250), CGPoint(x:-410,y:-250)] {
                    let presentation = original.offsetBy(dx: offset.x, dy: offset.y)
                    let projectedScreen = CGRect(x: presentation.minX+bounds.minX,
                                                 y: presentation.maxY-bounds.maxY,
                                                 width: bounds.width, height: bounds.height)
                    let canvas = original.union(presentation).union(projectedScreen).integral
                    let origin = CGPoint(x: presentation.minX-canvas.minX, y: canvas.maxY-presentation.maxY)
                    for point in [CGPoint.zero, CGPoint(x:width,y:0),
                                  CGPoint(x:width,y:height), CGPoint(x:0,y:height)] {
                        let output = projection.project(point)
                        let local = CGPoint(x: origin.x+output.x, y: origin.y+output.y)
                        precondition(containsIncludingEdges(CGRect(origin:.zero,size:canvas.size), local),
                                     "Moved projected corner escapes the union canvas")
                        let screen = CGPoint(x: canvas.minX+local.x, y: canvas.maxY-local.y)
                        precondition(abs(screen.x-(presentation.minX+output.x)) < 1e-7 &&
                                     abs(screen.y-(presentation.maxY-output.y)) < 1e-7,
                                     "Moving the canvas changes presentation screen coordinates")
                        let restored = projection.unproject(CGPoint(x:local.x-origin.x,y:local.y-origin.y))
                        precondition(hypot(restored.x-point.x,restored.y-point.y) < 1e-7,
                                     "Canvas translation changes inverse input mapping")
                        canvasChecks += 1
                    }
                    let backdropOrigin = CGPoint(x:original.minX-canvas.minX,y:canvas.maxY-original.maxY)
                    precondition(abs(canvas.minX+backdropOrigin.x-original.minX) < 1e-7 &&
                                 abs(canvas.maxY-backdropOrigin.y-original.maxY) < 1e-7,
                                 "Canvas movement displaces the original desktop patch")
                }
            }}}
        }
        // Regression cases: nominal width/height alone previously clipped them.
        let tall = Projection(width:300,height:900,yaw:-58,pitch:-55,depth:80).projectedBounds
        precondition(tall.minX <= -170 && tall.maxX >= 451, "Tall-window clipping regression")
        let textEdit = Projection(width:586,height:488,yaw:20,pitch:-55,depth:0).projectedBounds
        precondition(textEdit.maxX >= 593, "TextEdit corner clipping regression")
        print("PASS: \(checks) points match independent 3D math, CALayer and inverse input; \(canvasChecks) moved-canvas corners enclosed. Full control ranges sampled; minimum perspective denominator \(minimumDenominator).")
    }
}
