import CoreGraphics
import Foundation

/// A node of the application flow: a stage past To apply, or the Responded and No response yet split.
public enum JobFlowStage: String, CaseIterable, Sendable, Hashable, Identifiable {
  case applied
  case noResponse = "no_response"
  case responded
  case oa
  case interview1 = "interview_1"
  case interview2 = "interview_2"
  case interview3 = "interview_3"
  case offer
  case rejected

  public var id: String { rawValue }

  public init?(_ stage: JobStage) {
    switch stage {
    case .toApply: return nil
    case .applied: self = .applied
    case .oa: self = .oa
    case .interview1: self = .interview1
    case .interview2: self = .interview2
    case .interview3: self = .interview3
    case .offer: self = .offer
    case .rejected: self = .rejected
    }
  }

  public var label: String {
    switch self {
    case .responded: return "Responded"
    case .noResponse: return "No response yet"
    case .applied: return "Applied"
    case .oa: return "OA"
    case .interview1: return "Interview 1"
    case .interview2: return "Interview 2"
    case .interview3: return "Interview 3"
    case .offer: return "Offer"
    case .rejected: return "Rejected"
    }
  }

  /// What a node's count measures, for its caption.
  public func unit(_ count: Int) -> String {
    switch self {
    case .applied: return count == 1 ? "application" : "applications"
    case .responded, .noResponse: return count == 1 ? "role" : "roles"
    default: return "moved"
    }
  }

  var rank: Int { JobFlow.rank(of: self) }
}

public struct JobFlowLink: Equatable, Hashable, Sendable, Identifiable {
  public let source: JobFlowStage
  public let target: JobFlowStage
  public let value: Int
  public var id: String { "\(source.rawValue):\(target.rawValue)" }

  public init(source: JobFlowStage, target: JobFlowStage, value: Int) {
    self.source = source
    self.target = target
    self.value = value
  }

  /// "Applied to Responded: 3 roles", for tooltips and assistive technology.
  public var summary: String { "\(source.label) to \(target.label): \(value) \(value == 1 ? "role" : "roles")" }
}

public struct JobFlowData: Equatable, Sendable {
  /// Every tracked application: roles past To apply.
  public let appliedCount: Int
  /// Stages in rank order.
  public let nodes: [JobFlowStage]
  public let links: [JobFlowLink]

  public init(appliedCount: Int, nodes: [JobFlowStage], links: [JobFlowLink]) {
    self.appliedCount = appliedCount
    self.nodes = nodes
    self.links = links
  }

  /// No tracked applications.
  public static let empty = JobFlowData(appliedCount: 0, nodes: [], links: [])

  public var isEmpty: Bool { links.isEmpty }

  /// "4 applications".
  public var applicationTotal: String { "\(appliedCount) \(appliedCount == 1 ? "application" : "applications")" }
}

/// Builds the Sankey of every tracked application from current stages and stage history.
public enum JobFlow {
  static func rank(of stage: JobStage) -> Int {
    switch stage {
    case .toApply: return 0
    case .applied: return 1
    case .oa: return 3
    case .interview1: return 4
    case .interview2: return 5
    case .interview3: return 6
    case .offer, .rejected: return 7
    }
  }

  static func rank(of stage: JobFlowStage) -> Int {
    switch stage {
    case .applied: return 1
    case .noResponse, .responded: return 2
    case .oa: return 3
    case .interview1: return 4
    case .interview2: return 5
    case .interview3: return 6
    case .offer, .rejected: return 7
    }
  }

  /// A correction discards undone stages and replaces an outcome at the same rank.
  static func record(_ stage: JobStage, in path: inout [JobStage]) {
    while let last = path.last, rank(of: last) >= rank(of: stage) { path.removeLast() }
    path.append(stage)
  }

  public static func data(roles: [(id: String, stage: JobStage)], transitions: [JobStageTransition]) -> JobFlowData {
    let applications = roles.filter { $0.stage != .toApply }
    var paths: [String: [JobStage]] = Dictionary(uniqueKeysWithValues: applications.map { ($0.id, []) })
    let ordered = transitions.enumerated().sorted { left, right in
      left.element.changedAt == right.element.changedAt ? left.offset < right.offset : left.element.changedAt < right.element.changedAt
    }.map(\.element)
    for transition in ordered {
      guard var path = paths[transition.roleId] else { continue }
      if let from = transition.fromStage { record(from, in: &path) }
      record(transition.toStage, in: &path)
      paths[transition.roleId] = path
    }

    var counts: [String: JobFlowLink] = [:]
    var order: [String] = []
    for role in applications {
      var history = paths[role.id] ?? []
      // The current stage anchors imported roles whose history is incomplete.
      record(role.stage, in: &history)
      let path: [JobFlowStage]
      if role.stage == .applied {
        path = [.applied, .noResponse]
      } else {
        path = [.applied, .responded] + history.filter { $0 != .toApply && $0 != .applied }.compactMap(JobFlowStage.init)
      }
      for index in path.indices.dropFirst() {
        let source = path[index - 1], target = path[index]
        let key = "\(source.rawValue):\(target.rawValue)"
        if let current = counts[key] {
          counts[key] = JobFlowLink(source: source, target: target, value: current.value + 1)
        } else {
          counts[key] = JobFlowLink(source: source, target: target, value: 1)
          order.append(key)
        }
      }
    }

    let links = order.compactMap { counts[$0] }
    var stageSet = Set<JobFlowStage>()
    for link in links {
      stageSet.insert(link.source)
      stageSet.insert(link.target)
    }
    let stages = stageSet.sorted { (first: JobFlowStage, second: JobFlowStage) -> Bool in
      if first.rank != second.rank { return first.rank < second.rank }
      return first.rawValue < second.rawValue
    }
    return JobFlowData(appliedCount: applications.count, nodes: stages, links: links)
  }

  public static func data(roles: [JobRole], transitions: [JobStageTransition]) -> JobFlowData {
    data(roles: roles.map { ($0.id, $0.stage) }, transitions: transitions)
  }
}

// MARK: Layout

/// A laid-out Sankey: node bars and ribbon bands, in the coordinate space of `size`.
public struct JobFlowLayout: Sendable {
  public struct Node: Sendable, Identifiable {
    public let stage: JobFlowStage
    public let value: Int
    public let rect: CGRect
    public var id: JobFlowStage { stage }
  }

  public struct Ribbon: Sendable, Identifiable {
    public let link: JobFlowLink
    /// Top and bottom of the band where it leaves the source bar.
    public let sourceY: ClosedRange<CGFloat>
    /// Top and bottom of the band where it enters the target bar.
    public let targetY: ClosedRange<CGFloat>
    public let sourceX: CGFloat
    public let targetX: CGFloat
    public var id: String { link.id }
    public var width: CGFloat { sourceY.upperBound - sourceY.lowerBound }
  }

  public let size: CGSize
  public let nodes: [Node]
  public let ribbons: [Ribbon]

  /// Lays out `data` left to right: each node's column is its longest path from Applied, bar heights and
  /// ribbon widths are proportional to role counts, and each column is centered vertically.
  public init(data: JobFlowData, size: CGSize, nodeWidth: CGFloat = 12, nodePadding: CGFloat = 28,
              horizontalInset: CGFloat = 96, verticalInset: CGFloat = 20) {
    self.size = size
    guard !data.links.isEmpty, size.width > 0, size.height > 0 else {
      nodes = []
      ribbons = []
      return
    }
    var depth: [JobFlowStage: Int] = [:]
    for stage in data.nodes {
      let incoming = data.links.filter { $0.target == stage }.compactMap { depth[$0.source] }
      depth[stage] = incoming.isEmpty ? 0 : (incoming.max() ?? 0) + 1
    }
    var value: [JobFlowStage: Int] = [:]
    for stage in data.nodes {
      let incoming = data.links.filter { $0.target == stage }.reduce(0) { $0 + $1.value }
      let outgoing = data.links.filter { $0.source == stage }.reduce(0) { $0 + $1.value }
      value[stage] = max(incoming, outgoing)
    }
    let maxDepth = depth.values.max() ?? 0
    let columns = (0...maxDepth).map { column in data.nodes.filter { depth[$0] == column } }
    let usableHeight = max(1, size.height - verticalInset * 2)
    let scale = columns.filter { !$0.isEmpty }.map { column -> CGFloat in
      let total = CGFloat(column.reduce(0) { $0 + (value[$1] ?? 0) })
      let gaps = CGFloat(max(0, column.count - 1)) * nodePadding
      return total > 0 ? max(0.5, (usableHeight - gaps) / total) : usableHeight
    }.min() ?? 1
    let left = min(horizontalInset, size.width / 4)
    let span = max(0, size.width - left * 2 - nodeWidth)
    var rects: [JobFlowStage: CGRect] = [:]
    for (index, column) in columns.enumerated() {
      let x = left + (maxDepth == 0 ? 0 : span * CGFloat(index) / CGFloat(maxDepth))
      let heights = column.map { CGFloat(value[$0] ?? 0) * scale }
      let total = heights.reduce(0, +) + CGFloat(max(0, column.count - 1)) * nodePadding
      var y = verticalInset + max(0, (usableHeight - total) / 2)
      for (stage, height) in zip(column, heights) {
        rects[stage] = CGRect(x: x, y: y, width: nodeWidth, height: max(1, height))
        y += height + nodePadding
      }
    }
    nodes = data.nodes.compactMap { stage in rects[stage].map { Node(stage: stage, value: value[stage] ?? 0, rect: $0) } }

    var sourceOffset: [JobFlowStage: CGFloat] = [:]
    var targetOffset: [JobFlowStage: CGFloat] = [:]
    // Bands leave and enter in the order of the bar at their other end, so ribbons never cross at a node.
    let outgoingOrder = data.links.sorted { (rects[$0.target]?.minY ?? 0) < (rects[$1.target]?.minY ?? 0) }
    var sourceBands: [String: ClosedRange<CGFloat>] = [:]
    for link in outgoingOrder {
      guard let rect = rects[link.source] else { continue }
      let top = rect.minY + (sourceOffset[link.source] ?? 0)
      let width = CGFloat(link.value) * scale
      sourceBands[link.id] = top...(top + width)
      sourceOffset[link.source, default: 0] += width
    }
    let incomingOrder = data.links.sorted { (rects[$0.source]?.minY ?? 0) < (rects[$1.source]?.minY ?? 0) }
    var targetBands: [String: ClosedRange<CGFloat>] = [:]
    for link in incomingOrder {
      guard let rect = rects[link.target] else { continue }
      let top = rect.minY + (targetOffset[link.target] ?? 0)
      let width = CGFloat(link.value) * scale
      targetBands[link.id] = top...(top + width)
      targetOffset[link.target, default: 0] += width
    }
    ribbons = data.links.compactMap { link in
      guard let source = rects[link.source], let target = rects[link.target],
            let sourceY = sourceBands[link.id], let targetY = targetBands[link.id] else { return nil }
      return Ribbon(link: link, sourceY: sourceY, targetY: targetY, sourceX: source.maxX, targetX: target.minX)
    }
  }

  /// The closed band shape of a ribbon: a cubic curve along the top, back along the bottom.
  public static func path(for ribbon: Ribbon) -> CGPath {
    let path = CGMutablePath()
    let midX = (ribbon.sourceX + ribbon.targetX) / 2
    path.move(to: CGPoint(x: ribbon.sourceX, y: ribbon.sourceY.lowerBound))
    path.addCurve(to: CGPoint(x: ribbon.targetX, y: ribbon.targetY.lowerBound),
                  control1: CGPoint(x: midX, y: ribbon.sourceY.lowerBound),
                  control2: CGPoint(x: midX, y: ribbon.targetY.lowerBound))
    path.addLine(to: CGPoint(x: ribbon.targetX, y: ribbon.targetY.upperBound))
    path.addCurve(to: CGPoint(x: ribbon.sourceX, y: ribbon.sourceY.upperBound),
                  control1: CGPoint(x: midX, y: ribbon.targetY.upperBound),
                  control2: CGPoint(x: midX, y: ribbon.sourceY.upperBound))
    path.closeSubpath()
    return path
  }

  /// The node or ribbon under `point`, nodes first.
  public func hit(_ point: CGPoint) -> HitTarget? {
    if let node = nodes.first(where: { $0.rect.insetBy(dx: -4, dy: -2).contains(point) }) { return .node(node) }
    if let ribbon = ribbons.last(where: { Self.path(for: $0).contains(point) }) { return .ribbon(ribbon) }
    return nil
  }

  public enum HitTarget: Sendable {
    case node(Node)
    case ribbon(Ribbon)
  }
}
