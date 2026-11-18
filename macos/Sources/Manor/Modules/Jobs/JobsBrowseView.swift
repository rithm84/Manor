import ManorKit
import SwiftUI

/// The shared internship catalog: search, AND filters, and explicit adds into the pipeline.
struct JobsBrowseView: View {
  @Bindable var store: JobsStore
  let today: String
  let openExternal: (URL) -> Void
  @State private var filtersOpen = false

  var body: some View {
    Group {
      if let feed = store.feed {
        content(feed)
      } else if let error = store.feedError {
        VStack(spacing: Space.s3) {
          ErrorBanner("Listings could not be loaded. \(error)") { Task { await store.reloadFeed() } }
            .frame(maxWidth: 520)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(Space.s8)
      } else {
        ProgressView().controlSize(.small).frame(maxWidth: .infinity, maxHeight: .infinity)
          .accessibilityLabel("Loading listings")
      }
    }
    .onAppear { store.loadFeedIfNeeded() }
  }

  private func content(_ feed: JobFeedPage) -> some View {
    let visible = store.visibleListings
    return VStack(spacing: 0) {
      toolbar(feed: feed, visible: visible.count)
        .padding(.horizontal, Space.s8)
        .padding(.bottom, Space.s3)
      if let error = store.addError {
        ErrorBanner(error).padding(.horizontal, Space.s8).padding(.bottom, Space.s3)
      }
      Hairline()
      ScrollView {
        LazyVStack(spacing: 0, pinnedViews: [.sectionHeaders]) {
          Section {
            ForEach(visible) { listing in
              BrowseRow(listing: listing, today: today, added: store.isAdded(listing), pending: store.addingListingId == listing.id,
                        add: { Task { await store.addListing(listing) } }, open: { URL(string: listing.url).map(openExternal) })
            }
            if visible.isEmpty { emptyResult(feed) }
          } header: {
            BrowseHeader()
          }
        }
        .padding(.horizontal, Space.s6)
        .padding(.bottom, Space.s8)
      }
      .scrollIndicators(.automatic)
    }
  }

  private func toolbar(feed: JobFeedPage, visible: Int) -> some View {
    HStack(spacing: Space.s2) {
      SearchField(text: $store.browseQuery, prompt: "Search listings").frame(maxWidth: 320)
      Button {
        filtersOpen.toggle()
      } label: {
        HStack(spacing: 6) {
          Image(systemName: "line.3.horizontal.decrease")
          Text("Filter")
          if !store.browseRules.isEmpty { Text("\(store.browseRules.count)").tabular() }
        }
        .foregroundStyle(store.browseRules.isEmpty ? Palette.ink : Palette.primary)
      }
      .buttonStyle(.manor(store.browseRules.isEmpty ? .ghost : .secondary, size: .small))
      .manorPopover(isPresented: $filtersOpen) {
        BrowseFilterPopover(rules: $store.browseRules, today: today, terms: feed.terms, categories: feed.categories) { filtersOpen = false }
      }
      .accessibilityLabel(store.browseRules.isEmpty ? "Filter" : "Filter, \(store.browseRules.count) active")
      if !store.browseRules.isEmpty {
        Button {
          withAnimation(Motion.fast) { store.browseRules = [] }
        } label: { Label("Clear filters", systemImage: "arrow.counterclockwise") }
          .buttonStyle(.manor(.ghost, size: .small))
      }
      Spacer()
      Group {
        if visible == feed.listings.count {
          Text("\(feed.listings.count) \(feed.listings.count == 1 ? "listing" : "listings")")
        } else {
          Text("\(visible) of \(feed.listings.count)")
        }
      }
      .font(.ui(Typography.Size.sm))
      .foregroundStyle(Palette.inkMuted)
      .tabular()
    }
  }

  @ViewBuilder
  private func emptyResult(_ feed: JobFeedPage) -> some View {
    VStack(spacing: Space.s2) {
      if feed.listings.isEmpty {
        Text("No open listings right now.").foregroundStyle(Palette.inkMuted)
      } else {
        Text(store.browseRules.isEmpty ? "No listings match this search." : "No listings match these filters.")
          .foregroundStyle(Palette.inkMuted)
        Button(store.browseRules.isEmpty ? "Clear search" : "Clear filters") {
          store.browseRules = []
          store.browseQuery = ""
        }
        .buttonStyle(.manor(.secondary, size: .small))
      }
    }
    .font(.ui(Typography.Size.body))
    .frame(maxWidth: .infinity)
    .padding(.vertical, Space.s10)
  }
}

private enum BrowseColumns {
  static let company: CGFloat = 170
  static let location: CGFloat = 180
  static let term: CGFloat = 110
  static let posted: CGFloat = 88
  static let action: CGFloat = 64
}

private struct BrowseHeader: View {
  var body: some View {
    HStack(spacing: Space.s3) {
      Text("Company").frame(width: BrowseColumns.company, alignment: .leading)
      Text("Role").frame(maxWidth: .infinity, alignment: .leading)
      Text("Location").frame(width: BrowseColumns.location, alignment: .leading)
      Text("Cycle").frame(width: BrowseColumns.term, alignment: .leading)
      Text("Posted").frame(width: BrowseColumns.posted, alignment: .leading)
      Color.clear.frame(width: BrowseColumns.action, height: 1)
    }
    .font(.ui(Typography.Size.xs, weight: .medium))
    .foregroundStyle(Palette.inkMuted)
    .padding(.horizontal, Space.s2)
    .frame(height: 30)
    .background(Palette.surfaceCanvas)
    .overlay(alignment: .bottom) { Hairline() }
    .accessibilityHidden(true)
  }
}

private struct BrowseRow: View {
  let listing: JobListing
  let today: String
  let added: Bool
  let pending: Bool
  let add: () -> Void
  let open: () -> Void
  @State private var hoveringLink = false

  var body: some View {
    HStack(spacing: Space.s3) {
      Text(listing.company).font(.ui(Typography.Size.body, weight: .medium)).foregroundStyle(Palette.ink).lineLimit(1)
        .frame(width: BrowseColumns.company, alignment: .leading)
      HStack(spacing: Space.s2) {
        Button(action: open) {
          Text(listing.role)
            .font(.ui(Typography.Size.body))
            .foregroundStyle(hoveringLink ? Palette.linkHover : Palette.link)
            .underline(hoveringLink)
            .lineLimit(1)
        }
        .buttonStyle(.plain)
        .onHover { hoveringLink = $0 }
        .help("\(listing.role)\n\(listing.url)")
        if listing.openings > 1 {
          Text("\(listing.openings) openings").font(.ui(Typography.Size.xs)).foregroundStyle(Palette.inkMuted).tabular().fixedSize()
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      Text(listing.locations.isEmpty ? "Not listed" : listing.locations)
        .font(.ui(Typography.Size.sm))
        .foregroundStyle(listing.locations.isEmpty ? Palette.inkMuted : Palette.inkBody)
        .lineLimit(1)
        .help(listing.locations)
        .frame(width: BrowseColumns.location, alignment: .leading)
      Group {
        if listing.term.isEmpty { Color.clear.frame(height: 1) } else { JobPill(listing.term, tone: JobLabels.termTone(listing.term)) }
      }
      .frame(width: BrowseColumns.term, alignment: .leading)
      JobPill(JobLabels.posted(listing.posted, today: today), tone: JobLabels.postedTone(listing.posted, today: today))
        .frame(width: BrowseColumns.posted, alignment: .leading)
      Group {
        if added {
          Label("Added", systemImage: "checkmark").font(.ui(Typography.Size.sm, weight: .medium)).foregroundStyle(Palette.completion)
            .labelStyle(.titleAndIcon)
        } else {
          Button(pending ? "Adding" : "Add", action: add)
            .buttonStyle(.manor(.secondary, size: .small))
            .disabled(pending)
        }
      }
      .frame(width: BrowseColumns.action, alignment: .trailing)
    }
    .padding(.horizontal, Space.s2)
    .frame(minHeight: 38)
    .rowBackground()
    .overlay(alignment: .bottom) { Hairline().opacity(0.6) }
    .contextMenu {
      Button("Open posting", action: open)
      if !added { Button("Add to pipeline", action: add).disabled(pending) }
    }
    .accessibilityElement(children: .combine)
    .accessibilityLabel("\(listing.company), \(listing.role), \(listing.locations)")
    .accessibilityValue(added ? "In pipeline" : "Posted \(JobLabels.posted(listing.posted, today: today))")
  }
}

/// Match-all filter rules over the catalog.
private struct BrowseFilterPopover: View {
  @Binding var rules: [BrowseFilterRule]
  let today: String
  let terms: [String]
  let categories: [String]
  let close: () -> Void

  private var properties: [BrowseFilterProperty] { BrowseFilterProperty.available(terms: terms, categories: categories) }

  var body: some View {
    VStack(alignment: .leading, spacing: Space.s3) {
      HStack {
        Text("Match all rules").font(.ui(Typography.Size.sm, weight: .semibold)).foregroundStyle(Palette.ink)
        Spacer()
        IconButton("xmark", label: "Close filters", size: 24, action: close)
      }
      if rules.isEmpty {
        Text("No filters. Every listing is shown.").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
      }
      ForEach($rules) { $rule in
        RuleRow(rule: $rule, today: today, terms: terms, categories: categories, properties: properties) {
          rules.removeAll { $0.id == rule.id }
        }
      }
      Menu {
        ForEach(properties) { property in
          Button(property.label) {
            if let rule = try? BrowseFilterRule.make(property, today: today, terms: terms, categories: categories) { rules.append(rule) }
          }
        }
      } label: {
        Label("Add filter", systemImage: "plus").font(.ui(Typography.Size.sm, weight: .medium)).foregroundStyle(Palette.primary)
      }
      .menuStyle(.button)
      .buttonStyle(.plain)
      .menuIndicator(.hidden)
      .fixedSize()
    }
    .padding(Space.s4)
    .frame(width: 560)
  }
}

private struct RuleRow: View {
  @Binding var rule: BrowseFilterRule
  let today: String
  let terms: [String]
  let categories: [String]
  let properties: [BrowseFilterProperty]
  let remove: () -> Void

  var body: some View {
    HStack(spacing: Space.s2) {
      MenuField(options: properties.map { ($0, $0.label) },
                selection: Binding(get: { rule.property }, set: { property in
                  if let property, property != rule.property,
                     let changed = try? rule.changingProperty(to: property, today: today, terms: terms, categories: categories) { rule = changed }
                }),
                placeholder: "Property", accessibilityLabel: "Filter property")
        .frame(width: 140)
      Text("is").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
      value
      IconButton("xmark", label: "Remove filter", size: 24, action: remove)
    }
  }

  @ViewBuilder
  private var value: some View {
    switch rule.condition {
    case .term(let current):
      MenuField(options: terms.map { ($0, $0) }, selection: Binding(get: { current }, set: { if let value = $0 { rule.condition = .term(value) } }),
                placeholder: "Cycle", tone: { JobLabels.termTone($0) }, accessibilityLabel: "Hiring cycle")
    case .category(let current):
      MenuField(options: categories.map { ($0, $0) }, selection: Binding(get: { current }, set: { if let value = $0 { rule.condition = .category(value) } }),
                placeholder: "Category", accessibilityLabel: "Category")
    case .company(let current):
      TextField("Company name", text: Binding(get: { current }, set: { rule.condition = .company($0) })).textFieldStyle(.manor)
    case .location(let current):
      TextField("City or state", text: Binding(get: { current }, set: { rule.condition = .location($0) })).textFieldStyle(.manor)
    case .added(let current):
      MenuField(options: AddedFilterValue.allCases.map { ($0, $0.label) }, selection: Binding(get: { current }, set: { if let value = $0 { rule.condition = .added(value) } }),
                placeholder: "Pipeline", accessibilityLabel: "Pipeline")
    case .posted(let op, let from, let to):
      HStack(spacing: Space.s2) {
        MenuField(options: PostedFilterOperator.allCases.map { ($0, $0.label) },
                  selection: Binding(get: { op }, set: { if let value = $0 { rule = rule.changingOperator(to: value, today: today) } }),
                  placeholder: "Operator", accessibilityLabel: "Posted date operator")
          .frame(width: 130)
        if op == .within {
          dateField(from, label: "Range start") { value in rule.condition = .posted(op, from: value, to: max(value, to)) }
          Text("to").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
          dateField(to, label: "Range end") { value in rule.condition = .posted(op, from: min(from, value), to: value) }
        } else {
          dateField(from, label: "Posted date") { value in rule.condition = .posted(op, from: value, to: value) }
        }
      }
    }
  }

  private func dateField(_ value: String, label: String, set: @escaping (String) -> Void) -> some View {
    ManorDatePicker(label, selection: Binding(get: { value }, set: { set($0) }), quickPicks: [.today, .custom("A week ago", days: -7), .custom("30 days ago", days: -30)])
      .fixedSize()
  }
}
