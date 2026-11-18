import SwiftUI

/// The answer card: chat tabs → the active chat (prompt bubbles + streamed answers) → quick actions → ask box.
/// Spacing: 16 pt padding, 12 pt rhythm, 12 pt action chips, 12 pt input inset.
struct AssistCard: View {
    @EnvironmentObject private var state: AlfredState
    @EnvironmentObject private var prefs: Preferences
    @EnvironmentObject private var answers: AnswerEngine
    let regions: HitRegions
    let maxAnswerHeight: CGFloat

    private var showsChat: Bool { state.answerVisible && (!answers.answers.isEmpty || answers.threads.count > 1) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 0) {
                if showsChat {
                    ChatTabs()
                        .padding(.bottom, 10)
                    let thread = answers.threads[answers.active]
                    if thread.answers.isEmpty {
                        Text(prefs.alfredMode == .interview ? "New chat. Ask below, or press ⌃⌥␣ to answer the conversation."
                                                            : "New chat. Ask anything below, or press ⌃⌥␣ for help with your screen.")
                            .font(.alfred(12.5))
                            .foregroundStyle(Theme.dim)
                            .padding(.bottom, 12)
                    } else {
                        Conversation(thread: thread, maxHeight: maxAnswerHeight)
                            .id(thread.id)
                            .transition(.opacity.combined(with: .offset(y: -4)))
                            .padding(.bottom, 12)
                    }
                }
                QuickActions()
                    .padding(.leading, -6)
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 8)

            AskBox()
                .padding(.horizontal, 12)
                .padding(.bottom, 12)
        }
        .frame(width: Theme.cardWidth)
        .animation(Theme.spring, value: state.answerVisible)
        .animation(Theme.spring, value: answers.threads[answers.active].id)
    }
}

// MARK: - Chat tabs

/// Up to five chats. Every answer joins the active chat; + (⌃⌥T) opens another, × (⌃⌥W) closes one.
private struct ChatTabs: View {
    @EnvironmentObject private var state: AlfredState
    @EnvironmentObject private var answers: AnswerEngine

    var body: some View {
        HStack(spacing: 4) {
            ForEach(Array(answers.threads.enumerated()), id: \.element.id) { i, thread in
                ChatTab(title: thread.title, active: i == answers.active, streaming: thread.answers.last?.isActive ?? false,
                        select: { withAnimation(Theme.spring) { answers.selectThread(i) } },
                        close: { withAnimation(Theme.spring) { state.closeChat(i) } })
            }
            let full = answers.threads.count >= AnswerEngine.maxThreads && !answers.threads.contains { $0.answers.isEmpty }
            Button { withAnimation(Theme.spring) { state.newChat() } } label: {
                Image(systemName: "plus")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(Theme.icon)
                    .frame(width: 22, height: 22)
            }
            .buttonStyle(GhostButtonStyle(padding: .init(), radius: 11))
            .opacity(full ? 0.35 : 1)
            .help(full ? "\(AnswerEngine.maxThreads) chats are open. Close one to start another" : "New chat (⌃⌥T)")
            .accessibilityLabel("New chat")
            Spacer(minLength: 0)
        }
    }
}

private struct ChatTab: View {
    let title: String
    let active: Bool
    let streaming: Bool
    let select: () -> Void
    let close: () -> Void
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 5) {
            if streaming { PulsingDot(color: Theme.accent).scaleEffect(0.8) }
            Text(title)
                .font(.alfred(12, .medium))
                .foregroundStyle(active ? Color.white : Theme.dim)
                .lineLimit(1)
                .frame(maxWidth: 128, alignment: .leading)
            if active || hovering {
                Button(action: close) {
                    Image(systemName: "xmark").font(.system(size: 8, weight: .bold)).foregroundStyle(Theme.icon)
                        .frame(width: 14, height: 14)
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .help("Close chat (⌃⌥W)")
                .accessibilityLabel("Close chat")
            }
        }
        .padding(.leading, 9)
        .padding(.trailing, active || hovering ? 4 : 9)
        .frame(height: 24)
        .background(Capsule().fill(Color.white.opacity(active ? 0.12 : (hovering ? 0.06 : 0))))
        .overlay(Capsule().strokeBorder(Color.white.opacity(active ? 0.14 : 0), lineWidth: 0.5))
        .contentShape(Capsule())
        .onTapGesture(perform: select)
        .onHover { hovering = $0 }
        .animation(Theme.snappy, value: hovering)
        .help(title)
    }
}

// MARK: - Conversation

/// The active chat, oldest exchange first. A new question scrolls to its own prompt bubble so the answer
/// is read from the top while it streams.
private struct Conversation: View {
    @EnvironmentObject private var state: AlfredState
    let thread: ChatThread
    let maxHeight: CGFloat

    @State private var position = ScrollPosition(idType: UUID.self)
    @State private var offset: CGFloat = 0
    @State private var viewport: CGFloat = 0
    @State private var contentHeight: CGFloat = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ScrollView(.vertical) {
                VStack(alignment: .leading, spacing: 22) {
                    ForEach(thread.answers) { answer in
                        Exchange(answer: answer).id(answer.id)
                    }
                }
                .scrollTargetLayout()
                .padding(.trailing, 4)
                .padding(.bottom, 2)
            }
            .scrollPosition($position, anchor: .top)
            .scrollIndicators(.automatic)
            .onScrollGeometryChange(for: [CGFloat].self) { [$0.contentOffset.y, $0.containerSize.height, $0.contentSize.height] } action: { _, v in
                offset = v[0]; viewport = v[1]; contentHeight = v[2]
            }
            .frame(maxHeight: maxHeight)
            .fixedSize(horizontal: false, vertical: true)
            .mask(fadeMask)
            if let last = thread.answers.last { MetaRow(answer: last) }
        }
        .onAppear { if let id = thread.answers.last?.id { position.scrollTo(id: id, anchor: .top) } }
        .onChange(of: thread.answers.last?.id) { _, id in
            guard let id else { return }
            withAnimation(Theme.spring) { position.scrollTo(id: id, anchor: .top) }
        }
        .onChange(of: state.scrollRequest.nonce) {
            let step = max(80, viewport * 0.8) * CGFloat(state.scrollRequest.direction)
            let target = min(max(0, offset + step), max(0, contentHeight - viewport))
            withAnimation(Theme.spring) { position.scrollTo(y: target) }
        }
    }

    private var fadeMask: some View {
        let overflow = contentHeight > viewport + 1
        return LinearGradient(stops: [
            .init(color: overflow && offset > 2 ? .clear : .black, location: 0),
            .init(color: .black, location: 0.05),
            .init(color: .black, location: 0.93),
            .init(color: overflow && offset < contentHeight - viewport - 2 ? .clear : .black, location: 1),
        ], startPoint: .top, endPoint: .bottom)
    }
}

/// One question and its answer.
private struct Exchange: View {
    @EnvironmentObject private var prefs: Preferences
    let answer: Answer

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Spacer(minLength: 72)
                PromptBubble(text: answer.heading)
            }
            switch answer.phase {
            case .preparing:
                Shimmer(text: "Thinking")
            case .failed(let message) where answer.text.isEmpty:
                ErrorNote(message: message)
            default:
                MarkdownView(text: answer.text, scale: prefs.textScale, streaming: answer.phase == .streaming)
                    .environment(\.diagramAnimation, answer.phase == .streaming || answer.started.timeIntervalSinceNow > -3)
                if case .failed(let message) = answer.phase { ErrorNote(message: message) }
            }
        }
    }
}

/// Right-aligned user-intent bubble: 12 pt text on Manor's plum, 2 pt "tail" corner.
private struct PromptBubble: View {
    let text: String
    var body: some View {
        let shape = UnevenRoundedRectangle(topLeadingRadius: 12, bottomLeadingRadius: 12, bottomTrailingRadius: 2,
                                           topTrailingRadius: 12, style: .continuous)
        Text(text)
            .font(.alfred(12))
            .foregroundStyle(.white)
            .lineLimit(3)
            .multilineTextAlignment(.leading)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(IntentSurface(shape: shape))
            .textSelection(.enabled)
    }
}

private struct MetaRow: View {
    @EnvironmentObject private var state: AlfredState
    @EnvironmentObject private var answers: AnswerEngine
    let answer: Answer

    var body: some View {
        HStack(spacing: 2) {
            if let ms = answer.perceivedMs ?? answer.firstTokenMs {
                Text(answer.prefetched && ms < 50 ? "\(tierName) · ready" : "\(tierName) · \(ms) ms")
                    .font(.alfred(12))
                    .monospacedDigit()
                    .foregroundStyle(Theme.dim)
                .help(footerHelp)
            }
            if answer.usedScreen {
                Image(systemName: "macwindow").font(.system(size: 10)).foregroundStyle(Theme.dim)
                    .padding(.leading, 6)
                    .help("This answer looked at your screen")
            }
            Spacer()
            icon("square.on.square", disabled: answer.text.isEmpty) { state.copyAnswer() }
                .help("Copy answer")
                .accessibilityLabel("Copy answer")
            icon("xmark") { state.answerVisible = false }
                .help("Dismiss")
                .accessibilityLabel("Dismiss")
        }
    }

    private func icon(_ name: String, disabled: Bool = false, action: @escaping () -> Void) -> some View {
        Button { withAnimation(Theme.spring) { action() } } label: {
            Image(systemName: name).font(.system(size: 10.5, weight: .semibold)).foregroundStyle(Theme.icon)
                .frame(width: 14, height: 14)
        }
        .buttonStyle(GhostButtonStyle(padding: .init(top: 5, leading: 5, bottom: 5, trailing: 5)))
        .disabled(disabled)
        .opacity(disabled ? 0.35 : 1)
    }

    private var tierName: String {
        switch answer.tier?.lowercased() {
        case "ultrafast": "Ultrafast"
        case "fast", "priority": "Fast"
        case nil: "Streamed"
        case let t?: t.capitalized
        }
    }

    private var footerHelp: String {
        var parts = [answer.prefetched ? "Prepared as soon as the question ended" : "Hotkey → first token \(answer.firstTokenMs ?? 0) ms"]
        if let p = answer.perceivedMs, answer.prefetched { parts.append("visible \(p) ms after ⌃⌥␣") }
        if let total = answer.totalMs { parts.append("total \(total) ms") }
        if let cached = answer.cachedTokens, cached > 0 { parts.append("\(cached) cached tokens") }
        return parts.joined(separator: " · ")
    }
}

/// "Thinking" with a light sweep across the letters.
private struct Shimmer: View {
    let text: String
    @State private var phase: CGFloat = -1
    var body: some View {
        Text(text)
            .font(.alfred(Theme.answerSize, .medium))
            .foregroundStyle(Theme.dim)
            .overlay(
                GeometryReader { geo in
                    LinearGradient(colors: [.clear, .white.opacity(0.9), .clear], startPoint: .leading, endPoint: .trailing)
                        .frame(width: geo.size.width * 0.6)
                        .offset(x: phase * geo.size.width * 1.4)
                }
                .mask(Text(text).font(.alfred(Theme.answerSize, .medium)))
            )
            .onAppear { withAnimation(.linear(duration: 1.2).repeatForever(autoreverses: false)) { phase = 1 } }
    }
}

private struct ErrorNote: View {
    let message: String
    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 11)).foregroundStyle(Theme.warning)
            Text(message).font(.alfred(12.5)).foregroundStyle(Theme.text.opacity(0.8)).textSelection(.enabled)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Theme.warning.opacity(0.10)))
    }
}

// MARK: - Quick actions

private struct QuickActions: View {
    @EnvironmentObject private var state: AlfredState
    @EnvironmentObject private var prefs: Preferences
    var body: some View {
        HStack(spacing: 2) {
            ForEach(Array(QuickAction.actions(for: prefs.alfredMode).enumerated()), id: \.element) { index, action in
                if index > 0 { Circle().fill(Theme.dim).frame(width: 3, height: 3).padding(.horizontal, 3) }
                Button { state.run(action) } label: {
                    HStack(spacing: 6) {
                        Image(systemName: action.icon).symbolRenderingMode(.monochrome).font(.system(size: 11.5, weight: .medium)).foregroundStyle(Theme.icon)
                            .frame(width: 14, height: 14)
                        Text(action.title).font(.alfred(12)).foregroundStyle(Theme.text).lineLimit(1)
                    }
                }
                .buttonStyle(GhostButtonStyle())
                .help(action.hotkey.map { "\(action.title) (\($0.display))" } ?? action.title)
            }
            Spacer(minLength: 0)
        }
    }
}

// MARK: - Ask box

private struct AskBox: View {
    @EnvironmentObject private var state: AlfredState
    @EnvironmentObject private var prefs: Preferences
    @FocusState private var focused: Bool

    private var canSend: Bool { !state.askText.trimmingCharacters(in: .whitespaces).isEmpty }

    private func send() { state.submitAsk() }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .leading) {
                if state.askText.isEmpty {
                    HStack(spacing: 4) {
                        Text(prefs.alfredMode == .interview ? "Ask about your screen or the call, or" : "Ask Alfred anything, or")
                        Keycap(label: "⌃"); Keycap(label: "⌥"); Keycap(label: "␣")
                        Text(prefs.alfredMode == .interview ? "to answer" : "for your screen")
                    }
                    .font(.alfred(13))
                    .foregroundStyle(Theme.secondaryText)
                    .allowsHitTesting(false)
                }
                TextField("", text: $state.askText, axis: .vertical)
                    .textFieldStyle(.plain)
                    .font(.alfred(13))
                    .foregroundStyle(.white)
                    .lineLimit(1...5)
                    .focused($focused)
                    .onSubmit { send() }
                    .onExitCommand { state.endAsk() }
            }
            .padding(.horizontal, 10)
            .padding(.top, 10)
            .padding(.bottom, 8)
            .frame(minHeight: 38)

            HStack(spacing: 6) {
                ModeMenu()
                OverflowMenu()
                Spacer()
                if prefs.alfredMode == .interview {
                    LiveStatus()
                    ListenButton(size: 28)
                }
                Button { send() } label: {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 28, height: 28)
                        .background(IntentSurface(shape: Circle()).opacity(canSend ? 1 : 0.45))
                }
                .buttonStyle(PressScaleStyle())
                .disabled(!canSend)
                .accessibilityLabel("Send")
                .animation(Theme.snappy, value: canSend)
            }
            .padding(.horizontal, 10)
            .padding(.bottom, 8)
        }
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.black.opacity(0.12)))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
            .strokeBorder(focused ? Theme.accent.opacity(0.55) : Color(white: 155 / 255).opacity(0.4), lineWidth: 0.5))
        .overlay(alignment: .top) {
            // A 1 pt white/25 rim on the input's top edge.
            Rectangle().fill(Color.white.opacity(0.25)).frame(height: 1).padding(.horizontal, 12).offset(y: -1)
                .mask(LinearGradient(colors: [.clear, .white, .white, .clear], startPoint: .leading, endPoint: .trailing))
        }
        .contentShape(Rectangle())
        .onTapGesture { focused = true }
        .animation(Theme.snappy, value: focused)
        .onChange(of: state.askActive) { _, active in focused = active }
        .onChange(of: focused) { _, isFocused in if isFocused && !state.askActive { state.askActive = true } }
    }
}

/// The mode chip: General or Prep, and in Prep the answer style.
private struct ModeMenu: View {
    @EnvironmentObject private var prefs: Preferences
    @State private var hovering = false
    var body: some View {
        Menu {
            Picker("Mode", selection: $prefs.alfredMode) {
                ForEach(AlfredMode.allCases) { Text($0.title).tag($0) }
            }
            .pickerStyle(.inline)
            if prefs.alfredMode == .interview {
                Picker("Answer style", selection: $prefs.mode) {
                    ForEach(AssistMode.allCases) { Text($0.title).tag($0) }
                }
            }
        } label: {
            HStack(spacing: 5) {
                Image(systemName: prefs.alfredMode == .interview ? "person.wave.2" : "sparkles")
                    .symbolRenderingMode(.monochrome).font(.system(size: 11, weight: .semibold))
                Text(label).font(.alfred(12, .medium))
            }
            .foregroundStyle(hovering ? Theme.text : Theme.secondaryText)
            .padding(.leading, 8).padding(.trailing, 10)
            .frame(height: 26)
            .background(Capsule().fill(Color.white.opacity(hovering ? 0.08 : 0.04)))
            .overlay(Capsule().strokeBorder(Color.white.opacity(hovering ? 0.25 : 0.15), lineWidth: 1))
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .fixedSize()
        .onHover { hovering = $0 }
        .help("Mode")
        .accessibilityLabel("Mode, \(label)")
    }

    private var label: String {
        prefs.alfredMode == .interview && prefs.mode != .interview ? "Prep · \(prefs.mode.title)" : prefs.alfredMode.title
    }
}

private struct OverflowMenu: View {
    @EnvironmentObject private var state: AlfredState
    @EnvironmentObject private var prefs: Preferences
    @State private var hovering = false
    var body: some View {
        Menu {
            if prefs.alfredMode == .interview {
                Button(prefs.captureMic ? "Mute Microphone  ⌃⌥M" : "Unmute Microphone  ⌃⌥M") { state.toggleMic() }
            }
            Button("New Session  ⌃⌥N") { state.newSession() }
            Divider()
            Button("Alfred Settings…  ⌃⌥,") { state.openSettings() }
            Button("Open Manor") { state.openManor() }
        } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(hovering ? Theme.text : Theme.secondaryText)
                .frame(width: 28, height: 28)
                .background(Circle().fill(hovering ? Color.white.opacity(0.1) : .clear))
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .fixedSize()
        .onHover { hovering = $0 }
        .help("More")
        .accessibilityLabel("More")
    }
}

struct PressScaleStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.easeOut(duration: 0.16), value: configuration.isPressed)
    }
}
