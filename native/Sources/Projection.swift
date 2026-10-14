import Foundation
import QuartzCore

/// A projective mapping in top-left window coordinates, shared by rendering and input.
struct Projection {
    let h: [Double]
    let inverse: [Double]

    init(width: Double, height: Double, yaw: Double, pitch: Double, depth: Double) {
        let ry = yaw * .pi / 180, rx = pitch * .pi / 180
        let cy = cos(ry), sy = sin(ry), cx = cos(rx), sx = sin(rx)
        let distance = max(width, height) * 2.5
        let scale = distance / (distance + max(0, depth)) * 0.82
        let a = cy, b = sy * sx, c = 0.0, d = cx
        let p = sy / distance, q = -cy * sx / distance
        let ox = width / 2, oy = height / 2
        let k = 1 - p * ox - q * oy
        h = [scale*a + ox*p, scale*b + ox*q, ox*k - scale*a*ox - scale*b*oy,
             scale*c + oy*p, scale*d + oy*q, oy*k - scale*c*ox - scale*d*oy,
             p, q, k]
        inverse = Self.invert(h)
    }

    static func invert(_ m: [Double]) -> [Double] {
        let a = m[0], b = m[1], c = m[2], d = m[3], e = m[4], f = m[5], g = m[6], h = m[7], i = m[8]
        let det = a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g)
        precondition(abs(det) > 1e-10)
        return [(e*i-f*h)/det,(c*h-b*i)/det,(b*f-c*e)/det,
                (f*g-d*i)/det,(a*i-c*g)/det,(c*d-a*f)/det,
                (d*h-e*g)/det,(b*g-a*h)/det,(a*e-b*d)/det]
    }
    static func map(_ point: CGPoint, _ m: [Double]) -> CGPoint {
        let x = Double(point.x), y = Double(point.y), w = m[6]*x + m[7]*y + m[8]
        return CGPoint(x:(m[0]*x+m[1]*y+m[2])/w, y:(m[3]*x+m[4]*y+m[5])/w)
    }
    func project(_ p: CGPoint) -> CGPoint { Self.map(p, h) }
    func unproject(_ p: CGPoint) -> CGPoint { Self.map(p, inverse) }
    var layerTransform: CATransform3D {
        var t = CATransform3DIdentity
        t.m11 = h[0]; t.m21 = h[1]; t.m41 = h[2]
        t.m12 = h[3]; t.m22 = h[4]; t.m42 = h[5]
        t.m14 = h[6]; t.m24 = h[7]; t.m44 = h[8]
        return t
    }
}
