import AppKit
import ManorKit
import SwiftUI

/// The knowledge base: captures an agent saved and bookmarked X posts, in compact rows. Entries have no read
/// state; opening one shows its content in a centered dialog.
struct BookmarksPage: View {
  @Environment(AppContext.self) private var context
  @State private var store = BookmarksStore()

  var body: some View {
    VStack(spacing: 0) {
      PageHeader("Bookmarks", subtitle: store.load == .ready ? "\(store.entries.count) saved" : nil) {
        if store.searching && store.load == .ready {
          let count = store.captures.count + store.xEntries.count
          Text("\(count) \(count == 1 ? "match" : "matches")")
            .font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted).tabular()
        }
        SearchField(text: $store.query, prompt: "Search bookmarks")
          .frame(width: 260)
      }
      .centeredColumn()
      content
    }
    .onAppear { store.attach(context) }
    .manorDialog(item: Binding(get: { store.openEntry }, set: { store.openEntryId = $0?.id }), width: 680) { entry in
      BookmarkDetailPanel(entry: entry, store: store) { store.openEntryId = nil }
    }
    .manorDialog(item: $store.removeTarget, width: 420) { target in
      VStack(alignment: .leading, spacing: Space.s3) {
        ConfirmPanel(
          title: target.source == .xBookmark ? "Remove this bookmark?" : "Remove this capture?",
          message: store.removeError ?? "It leaves your knowledge base.",
          confirmLabel: store.removing ? "Removing" : "Remove",
          onCancel: { if !store.removing { store.removeTarget = nil; store.removeError = nil } },
          onConfirm: { Task { await store.confirmRemove() } }
        )
      }
    }
  }

  @ViewBuilder
  private var content: some View {
    switch store.load {
    case .loading:
      ProgressView().controlSize(.small).frame(maxWidth: .infinity, maxHeight: .infinity)
    case .failed(let message):
      VStack {
        ErrorBanner("Your bookmarks did not load. \(message)") { Task { await store.reload() } }
        Spacer()
      }
      .padding(.horizontal, Space.s8)
    case .ready:
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 0) {
          if let notice = store.notice {
            ErrorBanner(notice) { Task { await store.reload() } }
              .padding(.horizontal, Space.s2)
              .padding(.bottom, Space.s4)
          }
          capturesSection
          Color.clear.frame(height: Space.s6)
          xSection
        }
        // Rows carry their own inset for the hover fill, so their icons line up with the section titles.
        .padding(.horizontal, Space.s8 - Space.s2)
        .padding(.top, Space.s1)
        .padding(.bottom, Space.s12)
        .centeredColumn()
      }
      .scrollBounceBehavior(.basedOnSize)
    }
  }

  // Sections are groups so their rows stay lazy; spacing between them is a spacer, since a modifier on a group
  // (padding, say) would apply to every row in it.
  private var capturesSection: some View {
    Group {
      BookmarkSectionHeader(title: "Captures", count: store.captures.count) { EmptyView() }
      if store.captures.isEmpty {
        if store.searching {
          BookmarkPlaceholder(systemImage: "magnifyingglass", title: "No captures match your search")
        } else {
          BookmarkPlaceholder(systemImage: "camera", title: "Nothing captured yet",
                              message: "Ask your agent to save a page or a screenshot, and it lands here.")
        }
      } else {
        ForEach(store.captures) { entry in row(entry) }
      }
    }
  }

  private var xSection: some View {
    Group {
      BookmarkSectionHeader(title: "From X", count: store.xEntries.count) {
        if let note = store.syncNote {
          Text(note.text).font(.ui(Typography.Size.xs)).foregroundStyle(note.failed ? Palette.overdueError : Palette.inkMuted)
            .lineLimit(1).transition(.opacity)
        }
        if store.xStatus?.connected == true {
          Button { Task { await store.syncX() } } label: {
            Image(systemName: "arrow.clockwise")
              .font(.system(size: 11, weight: .semibold))
              .rotationEffect(.degrees(store.syncing ? 360 : 0))
              .animation(store.syncing ? .linear(duration: 0.9).repeatForever(autoreverses: false) : .default, value: store.syncing)
              .frame(width: 24, height: 24)
              .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
          .foregroundStyle(Palette.inkMuted)
          .disabled(store.syncing)
          .help("Sync X bookmarks")
          .accessibilityLabel("Sync X bookmarks")
        }
      }
      if let error = store.xStatusError {
        ErrorBanner("X connection status could not load. \(error)") { Task { await store.loadXStatus() } }
          .padding(.horizontal, Space.s2)
          .padding(.vertical, Space.s2)
      }
      if !store.xEntries.isEmpty {
        ForEach(store.xEntries) { entry in row(entry) }
      } else if store.searching {
        BookmarkPlaceholder(systemImage: "magnifyingglass", title: "No X bookmarks match your search")
      } else if let status = store.xStatus {
        if status.connected {
          BookmarkPlaceholder(systemImage: "bookmark", title: "No X bookmarks yet",
                              message: "Posts you bookmark on X arrive here after the next sync.")
        } else {
          BookmarkPlaceholder(systemImage: "bookmark", title: "Bring in your X bookmarks",
                              message: "Connect X once and the posts you bookmark there arrive here.") {
            Button("Connect X") {
              context.linkTarget = (.settings, ["connections"], [:])
              context.navigate(to: .settings)
            }
              .buttonStyle(.manor(.secondary, size: .small))
              .help("Opens Connections in Settings")
          }
        }
      } else if store.xStatusError == nil {
        HStack(spacing: Space.s2) {
          ProgressView().controlSize(.mini)
          Text("Checking your X connection").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
        }
        .padding(.horizontal, Space.s2)
        .frame(minHeight: 48)
      }
    }
  }

  private func row(_ entry: KnowledgeBase.Entry) -> some View {
    BookmarkRow(
      entry: entry,
      timeZone: context.timeZone,
      onOpen: { store.openEntryId = entry.id },
      onRetry: { Task { await store.retry(entry) } },
      onRemove: { store.removeError = nil; store.removeTarget = entry }
    )
  }
}

/// A section's title and count over a hairline, with trailing controls.
private struct BookmarkSectionHeader<Trailing: View>: View {
  let title: String
  let count: Int
  @ViewBuilder let trailing: () -> Trailing

  var body: some View {
    HStack(spacing: Space.s2) {
      Text(title).font(.ui(Typography.Size.sm, weight: .semibold)).foregroundStyle(Palette.ink)
      if count > 0 { Text("\(count)").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted).tabular() }
      Spacer(minLength: Space.s2)
      trailing()
    }
    .padding(.horizontal, Space.s2)
    .frame(height: 32)
    .overlay(alignment: .bottom) { Hairline().padding(.horizontal, Space.s2) }
    .padding(.bottom, Space.s1)
  }
}

/// An empty section shaped like a row: the same icon tile, a short title, one sentence, and its one action.
private struct BookmarkPlaceholder<Action: View>: View {
  let systemImage: String
  let title: String
  var message: String?
  @ViewBuilder let action: () -> Action

  var body: some View {
    HStack(spacing: Space.s3) {
      Image(systemName: systemImage)
        .font(.system(size: 12, weight: .medium))
        .foregroundStyle(Palette.inkMuted)
        .frame(width: 28, height: 28)
        .background(Circle().fill(Palette.surfaceSoft))
      VStack(alignment: .leading, spacing: 2) {
        Text(title).font(.ui(Typography.Size.body, weight: .medium)).foregroundStyle(Palette.inkBody)
        if let message { Text(message).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted) }
      }
      Spacer(minLength: Space.s3)
      action()
    }
    .padding(.horizontal, Space.s2)
    .padding(.vertical, Space.s2)
    .frame(minHeight: 48)
  }
}

private extension BookmarkPlaceholder where Action == EmptyView {
  init(systemImage: String, title: String, message: String? = nil) {
    self.init(systemImage: systemImage, title: title, message: message) { EmptyView() }
  }
}

// MARK: Row

/// One entry in a compact row: source icon, title and host, a one-line gist or its saving state, and time.
struct BookmarkRow: View {
  let entry: KnowledgeBase.Entry
  let timeZone: TimeZone
  let onOpen: () -> Void
  let onRetry: () -> Void
  let onRemove: () -> Void
  @State private var hovering = false
  @Environment(\.openURL) private var openURL

  private var host: String? { KnowledgeBase.host(entry.url) }
  /// An X post without a headline reads by its author rather than by "x.com".
  private var title: String {
    if entry.source == .xBookmark, entry.title?.isEmpty ?? true, let author = entry.author, !author.isEmpty { return author }
    return KnowledgeBase.title(entry)
  }
  private var gist: String? {
    if let summary = entry.summary, !summary.isEmpty { return summary }
    guard let content = entry.contentMd, !content.isEmpty, content != entry.title else { return nil }
    return content.split(whereSeparator: \.isNewline).first.map(String.init)
  }

  var body: some View {
    HStack(alignment: .center, spacing: Space.s3) {
      Image(systemName: entry.source == .capture ? "camera" : "bookmark")
        .font(.system(size: 12, weight: .medium))
        .foregroundStyle(entry.status == .failed ? Palette.overdueError : Palette.inkMuted)
        .frame(width: 28, height: 28)
        .background(Circle().fill(entry.status == .failed ? Palette.overdueErrorTint : Palette.surfaceSoft))
      VStack(alignment: .leading, spacing: 2) {
        HStack(spacing: Space.s2) {
          Text(title).font(.ui(Typography.Size.body, weight: .medium)).foregroundStyle(Palette.ink).lineLimit(1)
          if let host, host != title {
            Text(host).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted).lineLimit(1)
          }
        }
        switch entry.status {
        case .pending:
          HStack(spacing: 6) {
            ProgressView().controlSize(.mini)
            Text("Saving").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
          }
        case .failed:
          Text(entry.error ?? "This capture did not save.").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.overdueError).lineLimit(1)
        case .normalized:
          if let gist { Text(gist).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted).lineLimit(1) }
        }
      }
      Spacer(minLength: Space.s3)
      if entry.status == .failed {
        Button("Try again", action: onRetry).buttonStyle(.manor(.secondary, size: .small))
      }
      HStack(spacing: 2) {
        if KnowledgeBase.isSecureLink(entry.url), let url = entry.url.flatMap(URL.init(string:)) {
          IconButton("arrow.up.right.square", label: "Open link", size: 26) { openURL(url) }
        }
        IconButton("trash", label: "Remove", size: 26, action: onRemove)
      }
      .opacity(hovering ? 1 : 0)
      .accessibilityHidden(!hovering)
      Text(KnowledgeBase.timeLabel(entry.capturedAt, now: Date(), timeZone: timeZone))
        .font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted).tabular()
        .frame(minWidth: 72, alignment: .trailing)
    }
    .padding(.horizontal, Space.s2)
    .padding(.vertical, Space.s2)
    .frame(minHeight: 48)
    .contentShape(Rectangle())
    .rowBackground()
    .onHover { hovering = $0 }
    .onTapGesture(perform: onOpen)
    .contextMenu {
      Button("Open", action: onOpen)
      if KnowledgeBase.isSecureLink(entry.url), let url = entry.url.flatMap(URL.init(string:)) {
        Button("Open link in browser") { openURL(url) }
        Button("Copy link") {
          NSPasteboard.general.clearContents()
          NSPasteboard.general.setString(url.absoluteString, forType: .string)
        }
      }
      if entry.status == .failed { Button("Try again", action: onRetry) }
      Divider()
      Button("Remove", role: .destructive, action: onRemove)
    }
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(.isButton)
    .accessibilityAction(named: "Remove", onRemove)
  }
}

// MARK: Detail

/// An entry's content: its source, author, and the saved text rendered as Markdown.
struct BookmarkDetailPanel: View {
  let entry: KnowledgeBase.Entry
  let store: BookmarksStore
  let onClose: () -> Void
  @Environment(AppContext.self) private var context
  @Environment(\.openURL) private var openURL

  private var body_: String {
    if let content = entry.contentMd, !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return content }
    return entry.summary ?? ""
  }

  var body: some View {
    DialogPanel(KnowledgeBase.title(entry), onClose: onClose) {
      VStack(alignment: .leading, spacing: Space.s4) {
        HStack(spacing: Space.s2) {
          Image(systemName: entry.source == .capture ? "camera" : "bookmark").foregroundStyle(Palette.inkMuted)
          Text(meta).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted).tabular()
        }
        switch entry.status {
        case .pending:
          HStack(spacing: Space.s2) {
            ProgressView().controlSize(.small)
            Text("Still saving. The content appears here when it is ready.").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
          }
        case .failed:
          HStack {
            SettingsNotice(text: entry.error ?? "This capture did not save.", failed: true)
            Button("Try again") { Task { await store.retry(entry) } }.buttonStyle(.manor(.secondary, size: .small))
          }
        case .normalized:
          EmptyView()
        }
        if let summary = entry.summary, !summary.isEmpty, summary != body_ {
          Text(summary).font(.ui(Typography.Size.md, weight: .medium)).foregroundStyle(Palette.ink)
            .fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
        }
        if !body_.isEmpty {
          MarkdownView(body_)
        } else if entry.status == .normalized {
          Text("Nothing was saved beyond the link.").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    } footer: {
      Button("Remove") { store.removeError = nil; store.removeTarget = entry }
        .buttonStyle(.manor(.ghost))
      Spacer()
      if let post = entry.postUrl, KnowledgeBase.isSecureLink(post), post != entry.url, let url = URL(string: post) {
        Button("Open post on X") { openURL(url) }.buttonStyle(.secondary)
      }
      if KnowledgeBase.isSecureLink(entry.url), let url = entry.url.flatMap(URL.init(string:)) {
        Button("Open link") { openURL(url) }.buttonStyle(.primary).keyboardShortcut(.defaultAction)
      }
    }
  }

  private var meta: String {
    var parts: [String] = []
    if let author = entry.author, !author.isEmpty { parts.append(author) }
    if let host = KnowledgeBase.host(entry.url) { parts.append(host) }
    parts.append(KnowledgeBase.timeLabel(entry.capturedAt, now: Date(), timeZone: context.timeZone))
    return parts.joined(separator: " · ")
  }
}
