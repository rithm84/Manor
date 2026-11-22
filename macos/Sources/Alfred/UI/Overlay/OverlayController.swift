import AppKit
import Combine
import SwiftUI

/// Borderless, non-activating floating panel: Alfred never steals focus from the call or the editor.
final class OverlayPanel: NSPanel {
    init(frame: NSRect) {
        super.init(contentRect: frame,
                   styleMask: [.borderless, .nonactivatingPanel, .fullSizeContentView],
                   backing: .buffered, defer: false)
        isFloatingPanel = true
        // Above the menu bar so the surface can sit in (and grow out of) the notch.
        level = NSWindow.Level(rawValue: NSWindow.Level.mainMenu.rawValue + 3)
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        isOpaque = false
        backgroundColor = .clear
        hasShadow = false
        hidesOnDeactivate = false
        becomesKeyOnlyIfNeeded = true
        animationBehavior = .none
        appearance = NSAppearance(named: .darkAqua)
        ignoresMouseEvents = true
    }

    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }

    /// Standard text-editing shortcuts (⌘X/C/V/A/Z, ⇧⌘Z) for the ask field. The panel takes keys without
    /// activating Manor, so these can't rely on Manor's main-menu key equivalents reaching it.
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        if let action = Self.editAction(for: event), let responder = firstResponder,
           responder.tryToPerform(action, with: self) { return true }
        return super.performKeyEquivalent(with: event)
    }

    nonisolated static func editAction(for event: NSEvent) -> Selector? {
        let flags = event.modifierFlags.intersection([.command, .shift, .option, .control])
        guard event.type == .keyDown, flags == .command || flags == [.command, .shift],
              let key = event.charactersIgnoringModifiers?.lowercased() else { return nil }
        switch (key, flags.contains(.shift)) {
        case ("x", false): return #selector(NSText.cut(_:))
        case ("c", false): return #selector(NSText.copy(_:))
        case ("v", false): return #selector(NSText.paste(_:))
        case ("a", false): return #selector(NSResponder.selectAll(_:))
        case ("z", false): return Selector(("undo:"))
        case ("z", true): return Selector(("redo:"))
        default: return nil
        }
    }
}

final class FirstMouseHostingView<Content: View>: NSHostingView<Content> {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

@MainActor
final class OverlayController {
    private let state: AlfredState
    private let panel: OverlayPanel
    private let regions = HitRegions()
    private var hosting: NSView!
    private var monitors: [Any] = []
    private var bag = Set<AnyCancellable>()
    private var previousApp: NSRunningApplication?
    private let notch: NotchModel
    /// Hover opening (Settings ▸ Alfred ▸ Open from the notch): a short rest on the notch opens the card, and
    /// leaving it folds a hover-opened card away after a grace period.
    private var hoverOpenTask: Task<Void, Never>?
    private var hoverCloseTask: Task<Void, Never>?
    /// False after the card folds away with the pointer still on the notch: hover waits for the pointer to leave
    /// first, so closing never immediately reopens.
    private var hoverArmed = true
    private var cardWasOpen = false
    static let hoverOpenDelay: Duration = .milliseconds(140)
    static let hoverCloseDelay: Duration = .milliseconds(350)

    static let size = CGSize(width: Theme.cardWidth + 120, height: 820)

    init(state: AlfredState) {
        self.state = state
        let screen = NotchGeometry.preferredScreen
        notch = NotchModel(screen.map(NotchGeometry.of) ?? NotchGeometry(hasNotch: false, notch: CGSize(width: 0, height: 24)))
        let size = CGSize(width: Self.size.width, height: min(Self.size.height, (screen?.frame.height ?? 900) - 40))
        panel = OverlayPanel(frame: NSRect(origin: .zero, size: size))

        let root = OverlayRoot(regions: regions, size: size)
            .environmentObject(notch)
            .environmentObject(state)
            .environmentObject(state.prefs)
            .environmentObject(state.listener)
            .environmentObject(state.answers)
            .environmentObject(state.context)
            .environmentObject(state.transcript)
        let hosting = FirstMouseHostingView(rootView: root)
        hosting.sizingOptions = []
        hosting.frame = NSRect(origin: .zero, size: size)
        panel.contentView = hosting
        self.hosting = hosting
        // While the panel takes clicks, the global monitor goes quiet (events are ours), so make sure
        // our own window reports mouse movement too — otherwise click-through could get stuck "on".
        panel.acceptsMouseMovedEvents = true
        hosting.addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseMoved, .activeAlways, .inVisibleRect],
                                               owner: hosting, userInfo: nil))

        if let screen { position(on: screen) }
        installMouseTracking()

        // On a notched screen the panel stays up: "hidden" just folds the surface back into the notch.
        // Elsewhere there's nothing to fold into, so it fades out as before.
        state.$overlayVisible
            .removeDuplicates()
            .sink { [weak self] visible in
                guard let self else { return }
                if visible || self.notch.geometry.hasNotch { self.show() } else { self.hide() }
            }
            .store(in: &bag)
        NotificationCenter.default.publisher(for: NSApplication.didChangeScreenParametersNotification)
            .sink { [weak self] _ in
                MainActor.assumeIsolated {
                    guard let self, let screen = NotchGeometry.preferredScreen else { return }
                    self.notch.geometry = .of(screen)
                    self.position(on: screen)
                }
            }
            .store(in: &bag)

        state.focusAskField = { [weak self] focus in self?.setKeyboardFocus(focus) }
    }

    func show() {
        guard !panel.isVisible || panel.alphaValue < 1 else { return }
        panel.alphaValue = 0
        panel.orderFrontRegardless()
        NSAnimationContext.runAnimationGroup { ctx in
            ctx.duration = 0.16
            ctx.timingFunction = CAMediaTimingFunction(name: .easeOut)
            panel.animator().alphaValue = 1
        }
    }

    func hide() {
        if panel.isKeyWindow { setKeyboardFocus(false) }
        NSAnimationContext.runAnimationGroup({ ctx in
            ctx.duration = 0.14
            ctx.timingFunction = CAMediaTimingFunction(name: .easeIn)
            panel.animator().alphaValue = 0
        }, completionHandler: { [weak self] in
            MainActor.assumeIsolated {
                guard let self, !self.state.overlayVisible else { return }
                self.panel.orderOut(nil)
            }
        })
    }

    /// Debug aid for UI review without Screen Recording permission: renders the panel's view tree to a PNG.
    func snapshot(to url: URL) {
        Self.writePNG(of: hosting, geometry: notch.geometry,
                      dark: ProcessInfo.processInfo.environment["ALFRED_SNAPSHOT_DARK"] == "1", to: url)
    }

    /// Draws `view` over a desktop backdrop with a menu bar (and the hardware notch, if any), so the surface is
    /// judged against what it really sits in.
    static func writePNG(of view: NSView, geometry: NotchGeometry, dark: Bool, to url: URL) {
        let bounds = view.bounds
        guard let rep = view.bitmapImageRepForCachingDisplay(in: bounds) else { return }
        view.cacheDisplay(in: bounds, to: rep)
        let image = NSImage(size: bounds.size, flipped: false) { rect in
            (dark ? NSColor(calibratedRed: 0.12, green: 0.13, blue: 0.16, alpha: 1)
                  : NSColor(calibratedRed: 0.94, green: 0.945, blue: 0.965, alpha: 1)).setFill()
            rect.fill()
            let barHeight = max(geometry.notch.height, 24)
            let bar = NSRect(x: 0, y: rect.maxY - barHeight, width: rect.width, height: barHeight)
            NSColor(white: dark ? 0.2 : 0.86, alpha: 1).setFill()
            bar.fill()
            if geometry.hasNotch {
                NSColor.black.setFill()
                NSBezierPath(roundedRect: NSRect(x: rect.midX - geometry.notch.width / 2, y: bar.minY, width: geometry.notch.width, height: bar.height + 10),
                             xRadius: 8, yRadius: 8).fill()
            }
            rep.draw(in: rect)
            return true
        }
        guard let tiff = image.tiffRepresentation, let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) else { return }
        try? png.write(to: url)
    }

    /// Centred on the notch, flush with the top edge of the screen.
    private func position(on screen: NSScreen) {
        let f = screen.frame
        panel.setFrameOrigin(NSPoint(x: f.midX - panel.frame.width / 2, y: f.maxY - panel.frame.height))
    }

    // MARK: - Focus (ask bar)

    private func setKeyboardFocus(_ focus: Bool) {
        if focus {
            if !NSApp.isActive { previousApp = NSWorkspace.shared.frontmostApplication }
            panel.ignoresMouseEvents = false
            panel.makeKeyAndOrderFront(nil)
            if !panel.isKeyWindow { NSApp.activate() }
        } else {
            panel.resignKey()
            if let app = previousApp, app != NSRunningApplication.current {
                app.activate()
            } else if NSApp.isActive {
                // Typed into Alfred over Manor itself: give the keyboard back to Manor's front window.
                NSApp.orderedWindows.first { $0 !== panel && $0.isVisible && $0.canBecomeKey }?.makeKey()
            }
            previousApp = nil
            updateMouseThrough()
        }
    }

    // MARK: - Click-through outside drawn surfaces

    private func installMouseTracking() {
        let mask: NSEvent.EventTypeMask = [.mouseMoved, .leftMouseDragged, .leftMouseUp]
        if let global = NSEvent.addGlobalMonitorForEvents(matching: mask, handler: { [weak self] _ in
            MainActor.assumeIsolated { self?.updateMouseThrough() }
        }) { monitors.append(global) }
        if let local = NSEvent.addLocalMonitorForEvents(matching: mask, handler: { [weak self] event in
            MainActor.assumeIsolated { self?.updateMouseThrough() }
            return event
        }) { monitors.append(local) }

        // Clicking anywhere outside the card while typing hands the keyboard back, like Spotlight. Other apps'
        // clicks arrive through the global monitor; Manor's own windows through the local one.
        let clicks: NSEvent.EventTypeMask = [.leftMouseDown, .rightMouseDown]
        if let global = NSEvent.addGlobalMonitorForEvents(matching: clicks, handler: { [weak self] _ in
            MainActor.assumeIsolated { self?.clickedOutside() }
        }) { monitors.append(global) }
        if let local = NSEvent.addLocalMonitorForEvents(matching: clicks, handler: { [weak self] event in
            MainActor.assumeIsolated {
                guard let self else { return }
                if event.window !== self.panel { self.clickedOutside(); return }
                // Clicking into a hover-opened card keeps it open. The notch strip itself has its own meaning
                // (see NotchSurface), so a click there is left to it.
                if !self.inNotchStrip(event.locationInWindow) { self.state.engageHoverPeek() }
            }
            return event
        }) { monitors.append(local) }
    }

    private func clickedOutside() {
        if state.hoverPeek {
            state.endHoverPeek()
            return
        }
        guard state.askActive else { return }
        // The click already went to (and activated) whatever was clicked; don't switch apps behind it.
        previousApp = nil
        state.endAsk()
    }

    /// The pointer's position in the overlay's SwiftUI space (top-left origin).
    private func pointerPoint(windowPoint: CGPoint? = nil) -> CGPoint {
        let point = windowPoint ?? panel.convertPoint(fromScreen: NSEvent.mouseLocation)
        let viewPoint = hosting.convert(point, from: nil)
        return hosting.isFlipped ? viewPoint : CGPoint(x: viewPoint.x, y: hosting.bounds.height - viewPoint.y)
    }

    private func inNotchStrip(_ windowPoint: CGPoint) -> Bool {
        pointerPoint(windowPoint: windowPoint).y <= notch.geometry.notch.height
    }

    // MARK: - Hover

    /// Opens the card when the pointer rests on the notch and folds a hover-opened card away once the pointer leaves
    /// it. Never opens while a mouse button is down (a window drag passing the top edge) or right after the card
    /// closed under the pointer.
    private func updateHover(point: CGPoint) {
        let open = state.overlayVisible && state.isCardOpen
        defer { cardWasOpen = open }
        let onSurface = regions.contains(point)
        if !open {
            hoverCloseTask?.cancel()
            hoverCloseTask = nil
            if cardWasOpen && onSurface { hoverArmed = false }
            if !onSurface { hoverArmed = true }
            guard state.prefs.notchOpening == .hover, notch.geometry.hasNotch, onSurface, hoverArmed,
                  NSEvent.pressedMouseButtons == 0 else { cancelHoverOpen(); return }
            guard hoverOpenTask == nil else { return }
            hoverOpenTask = Task { [weak self] in
                try? await Task.sleep(for: Self.hoverOpenDelay)
                guard let self, !Task.isCancelled else { return }
                self.hoverOpenTask = nil
                // Still resting there, and nothing opened the card in the meantime.
                guard self.regions.contains(self.pointerPoint()), self.hoverArmed, NSEvent.pressedMouseButtons == 0,
                      !(self.state.overlayVisible && self.state.isCardOpen) else { return }
                self.state.peekFromHover()
                self.updateMouseThrough()
            }
            return
        }
        cancelHoverOpen()
        // A little slack around the card, so brushing past its edge doesn't close it.
        guard state.hoverPeek, !regions.contains(point, margin: 16) else {
            hoverCloseTask?.cancel()
            hoverCloseTask = nil
            return
        }
        guard hoverCloseTask == nil else { return }
        hoverCloseTask = Task { [weak self] in
            try? await Task.sleep(for: Self.hoverCloseDelay)
            guard let self, !Task.isCancelled else { return }
            self.hoverCloseTask = nil
            guard self.state.hoverPeek, !self.regions.contains(self.pointerPoint(), margin: 16) else { return }
            self.state.endHoverPeek()
            self.updateMouseThrough()
        }
    }

    private func cancelHoverOpen() {
        hoverOpenTask?.cancel()
        hoverOpenTask = nil
    }

    /// The panel spans a large transparent area; only the drawn card takes clicks, everything else passes through
    /// to the windows below, even while typing.
    private func updateMouseThrough() {
        guard panel.isVisible else { return }
        let point = pointerPoint()
        let inside = regions.contains(point)
        if panel.ignoresMouseEvents == inside { panel.ignoresMouseEvents = !inside }
        updateHover(point: point)
    }
}
