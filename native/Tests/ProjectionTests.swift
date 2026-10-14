import Foundation
import QuartzCore

@main struct ProjectionTests {
    static func main() {
        var checks = 0
        for (width, height) in [(586.0,488.0),(1470,923),(920,436),(300,900)] {
            for yaw in [-35.0,0,25,35] { for pitch in [-20.0,0,20] { for depth in [0.0,80,500] {
                let projection = Projection(width:width,height:height,yaw:yaw,pitch:pitch,depth:depth)
                for ix in 0...10 { for iy in 0...10 {
                    let point = CGPoint(x:width*Double(ix)/10,y:height*Double(iy)/10)
                    let output = projection.project(point)
                    let roundtrip = projection.unproject(output)
                    precondition(hypot(roundtrip.x-point.x,roundtrip.y-point.y) < 1e-7, "Inverse input mapping failed")
                    // Independent 3D rotation and pinhole projection, not an inverse-only test.
                    let x = point.x-width/2, y = point.y-height/2
                    let ry = yaw * .pi/180, rx = pitch * .pi/180
                    let rotatedX = cos(ry)*x + sin(ry)*sin(rx)*y
                    let rotatedY = cos(rx)*y
                    let rotatedZ = -sin(ry)*x + cos(ry)*sin(rx)*y
                    let focal = max(width,height)*2.5
                    let factor = (focal/(focal+depth)*0.82)/(1-rotatedZ/focal)
                    precondition(abs(output.x-(width/2+rotatedX*factor)) < 1e-7)
                    precondition(abs(output.y-(height/2+rotatedY*factor)) < 1e-7)
                    let t = projection.layerTransform
                    let w = point.x*t.m14+point.y*t.m24+t.m44
                    precondition(abs((point.x*t.m11+point.y*t.m21+t.m41)/w-output.x) < 1e-7)
                    precondition(abs((point.x*t.m12+point.y*t.m22+t.m42)/w-output.y) < 1e-7)
                    checks += 1
                }}
            }}}
        }
        print("PASS: \(checks) projected points agree with independent 3D math, CALayer coefficients, and inverse input coordinates.")
    }
}
