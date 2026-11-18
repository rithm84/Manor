import AppKit

/// Manor's Flowing M as a monochrome template glyph for the menu bar, so Alfred's item reads as part of Manor.
/// The outline is Manor's mark (`manor-mark.svg`, viewBox 240 210 410 240). While Alfred listens, a small dot
/// sits at the glyph's top right, the same place macOS puts its own recording cues.
enum MenuBarIcon {
    private static let commands = "M284 418C237 418 254 348 271 312C290 268 321 226 356 225C404 219 418 263 433 309L445 340C464 303 480 255 520 257C556 255 572 287 583 326C595 371 606 394 630 411C616 427 591 434 570 422C542 407 535 371 525 340C521 327 516 317 509 318C496 318 484 341 475 360C465 381 456 395 442 394C423 394 415 374 401 334C391 304 386 286 375 287C359 287 345 320 331 356C317 395 311 418 284 418Z"

    static func make(listening: Bool) -> NSImage {
        let size = NSSize(width: 24, height: 16)
        let image = NSImage(size: size, flipped: true) { rect in
            let markWidth: CGFloat = listening ? 19 : 21
            let markRect = CGRect(x: 1, y: (rect.height - markWidth * 240 / 410) / 2 + 0.5, width: markWidth, height: markWidth * 240 / 410)
            NSColor.black.setFill()
            path(in: markRect).fill()
            if listening {
                NSBezierPath(ovalIn: CGRect(x: rect.maxX - 5.5, y: 1.5, width: 5, height: 5)).fill()
            }
            return true
        }
        image.isTemplate = true
        image.accessibilityDescription = listening ? "Alfred, listening" : "Alfred"
        return image
    }

    /// The mark's outline scaled into `rect` (flipped coordinates, like the SVG).
    static func path(in rect: CGRect) -> NSBezierPath {
        let scale = min(rect.width / 410, rect.height / 240)
        let origin = CGPoint(x: rect.midX - 205 * scale, y: rect.midY - 120 * scale)
        func point(_ x: Double, _ y: Double) -> CGPoint { CGPoint(x: origin.x + (x - 240) * scale, y: origin.y + (y - 210) * scale) }
        let path = NSBezierPath()
        let scanner = Scanner(string: commands)
        scanner.charactersToBeSkipped = .whitespaces
        func numbers() -> [Double] {
            var values: [Double] = []
            while let value = scanner.scanDouble() { values.append(value) }
            return values
        }
        while !scanner.isAtEnd {
            guard let command = scanner.scanCharacter() else { break }
            let values = numbers()
            switch command {
            case "M": path.move(to: point(values[0], values[1]))
            case "L": path.line(to: point(values[0], values[1]))
            case "C":
                for i in stride(from: 0, to: values.count - 5, by: 6) {
                    path.curve(to: point(values[i + 4], values[i + 5]),
                               controlPoint1: point(values[i], values[i + 1]),
                               controlPoint2: point(values[i + 2], values[i + 3]))
                }
            case "Z": path.close()
            default: break
            }
        }
        return path
    }
}
