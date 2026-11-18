import SwiftUI

/// The Flowing M, drawn from `manor-mark.svg` (viewBox 240 210 410 240).
public struct ManorMark: Shape {
  public init() {}
  public func path(in rect: CGRect) -> Path {
    let commands = "M284 418C237 418 254 348 271 312C290 268 321 226 356 225C404 219 418 263 433 309L445 340C464 303 480 255 520 257C556 255 572 287 583 326C595 371 606 394 630 411C616 427 591 434 570 422C542 407 535 371 525 340C521 327 516 317 509 318C496 318 484 341 475 360C465 381 456 395 442 394C423 394 415 374 401 334C391 304 386 286 375 287C359 287 345 320 331 356C317 395 311 418 284 418Z"
    let scale = min(rect.width / 410, rect.height / 240)
    let offset = CGPoint(x: rect.midX - 205 * scale, y: rect.midY - 120 * scale)
    func point(_ x: Double, _ y: Double) -> CGPoint { CGPoint(x: offset.x + (x - 240) * scale, y: offset.y + (y - 210) * scale) }
    var path = Path()
    let scanner = Scanner(string: commands)
    scanner.charactersToBeSkipped = .whitespaces
    var numbers: [Double] { var values: [Double] = []; while let value = scanner.scanDouble() { values.append(value) }; return values }
    while !scanner.isAtEnd {
      guard let command = scanner.scanCharacter() else { break }
      let values = numbers
      switch command {
      case "M": path.move(to: point(values[0], values[1]))
      case "L": path.addLine(to: point(values[0], values[1]))
      case "C":
        for index in stride(from: 0, to: values.count, by: 6) {
          path.addCurve(to: point(values[index + 4], values[index + 5]), control1: point(values[index], values[index + 1]), control2: point(values[index + 2], values[index + 3]))
        }
      case "Z": path.closeSubpath()
      default: break
      }
    }
    return path
  }
}

/// The mark in the brand plum, sized by its width.
public struct ManorLogo: View {
  let width: CGFloat
  public init(width: CGFloat = 28) { self.width = width }
  public var body: some View {
    ManorMark().fill(Palette.primary).frame(width: width, height: width * 240 / 410).accessibilityLabel("Manor")
  }
}
