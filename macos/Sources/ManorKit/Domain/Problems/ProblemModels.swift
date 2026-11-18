import Foundation

// The problem library's shared model: what one problem is, as the library index and the solving workspace read it.

public enum ProblemDifficulty: String, Sendable, CaseIterable, Hashable, Comparable {
  case easy = "Easy", medium = "Medium", hard = "Hard"

  public var order: Int {
    switch self {
    case .easy: return 0
    case .medium: return 1
    case .hard: return 2
    }
  }

  public static func < (lhs: Self, rhs: Self) -> Bool { lhs.order < rhs.order }
}

public enum ProblemKind: String, Sendable, CaseIterable, Hashable {
  case coding, systemDesign = "system_design", behavioral, other

  public var label: String {
    switch self {
    case .coding: return "Coding"
    case .systemDesign: return "System design"
    case .behavioral: return "Behavioral"
    case .other: return "Other"
    }
  }
}

public enum ProblemSourceType: String, Sendable, CaseIterable, Hashable {
  case stock, imported, custom

  public var label: String {
    switch self {
    case .stock: return "LeetCode catalog"
    case .imported: return "Imported"
    case .custom: return "Custom"
    }
  }
}

/// The account's practice on one problem: solved once it has an attempt, otherwise its recorded practice status.
public enum ProblemStatus: String, Sendable, CaseIterable, Hashable {
  case unattempted, attempted, solved

  public var label: String {
    switch self {
    case .unattempted: return "Not started"
    case .attempted: return "Attempted"
    case .solved: return "Solved"
    }
  }
}

/// One problem as the library lists it: a shared catalog problem or one of the account's custom problems.
/// `status` is the account's own practice on this exact problem.
public struct ProblemRecord: Sendable, Identifiable, Equatable {
  public var id: String
  public var name: String
  public var difficulty: ProblemDifficulty?
  public var kind: ProblemKind
  public var topics: [String]
  public var companies: [String]
  public var tags: [String]
  public var collections: [String]
  public var sourceUrl: String?
  public var sourceType: ProblemSourceType
  public var externalKey: String?
  public var sourceMetadata: ProblemSourceMetadata?
  /// The problem this one is grouped under, or nil for a canonical (or ungrouped) problem.
  public var canonicalProblemId: String?
  public var sourceName: String?
  public var duplicateReason: String?
  public var contentAvailable: Bool
  public var contentVersion: Int
  /// The testset version of the current statement, when the problem has a grader.
  public var gradingVersion: Int?
  public var revision: Int
  public var status: ProblemStatus
  public var createdAt: String
  public var updatedAt: String
  /// True for the account's own problems (`leetcode_problems`), false for the shared catalog (`problem_catalog`).
  public var isCustom: Bool

  public init(
    id: String, name: String, difficulty: ProblemDifficulty? = nil, kind: ProblemKind = .coding, topics: [String] = [],
    companies: [String] = [], tags: [String] = [], collections: [String] = [], sourceUrl: String? = nil,
    sourceType: ProblemSourceType = .imported, externalKey: String? = nil, sourceMetadata: ProblemSourceMetadata? = nil,
    canonicalProblemId: String? = nil, sourceName: String? = nil, duplicateReason: String? = nil, contentAvailable: Bool = false,
    contentVersion: Int = 0, gradingVersion: Int? = nil, revision: Int = 1, status: ProblemStatus = .unattempted,
    createdAt: String = "", updatedAt: String = "", isCustom: Bool = false
  ) {
    self.id = id
    self.name = name
    self.difficulty = difficulty
    self.kind = kind
    self.topics = topics
    self.companies = companies
    self.tags = tags
    self.collections = collections
    self.sourceUrl = sourceUrl
    self.sourceType = sourceType
    self.externalKey = externalKey
    self.sourceMetadata = sourceMetadata
    self.canonicalProblemId = canonicalProblemId
    self.sourceName = sourceName
    self.duplicateReason = duplicateReason
    self.contentAvailable = contentAvailable
    self.contentVersion = contentVersion
    self.gradingVersion = gradingVersion
    self.revision = revision
    self.status = status
    self.createdAt = createdAt
    self.updatedAt = updatedAt
    self.isCustom = isCustom
  }

  /// Stock entries are keyed `leetcode:<frontend number>`.
  public var leetCodeNumber: Int? {
    guard sourceType == .stock, let key = externalKey, key.hasPrefix("leetcode:") else { return nil }
    let digits = key.dropFirst("leetcode:".count)
    guard !digits.isEmpty, digits.allSatisfy(\.isASCII), digits.allSatisfy(\.isNumber) else { return nil }
    return Int(digits)
  }

  /// A stock problem's title carries its LeetCode number ("636. Exclusive Time of Functions"); the stored name stays plain.
  public var title: String { leetCodeNumber.map { "\($0). \(name)" } ?? name }

  /// The id of the problem whose statement and grader this problem's group uses.
  public var canonicalId: String { canonicalProblemId ?? id }

  /// Labels by property, for code that treats the four label lists alike.
  public func labels(_ property: ProblemLabelProperty) -> [String] {
    switch property {
    case .topics: return topics
    case .companies: return companies
    case .tags: return tags
    case .collections: return collections
    }
  }
}

public enum ProblemLabelProperty: String, Sendable, CaseIterable, Hashable {
  case topics, companies, tags, collections
}

/// A dated solve or review with the exact source the account used. Whitespace and comments are significant.
public struct ProblemAttempt: Sendable, Identifiable, Equatable {
  public var id: String
  public var problemId: String
  /// `YYYY-MM-DD` in the account's time zone.
  public var date: String
  public var solution: String
  public var createdAt: String
  public var updatedAt: String
  public var revision: Int

  public init(id: String, problemId: String, date: String, solution: String, createdAt: String, updatedAt: String, revision: Int) {
    self.id = id
    self.problemId = problemId
    self.date = date
    self.solution = solution
    self.createdAt = createdAt
    self.updatedAt = updatedAt
    self.revision = revision
  }
}

/// A short note about a mistake or recurring pattern, kept beside the library.
public struct ProblemMistake: Sendable, Identifiable, Equatable {
  public static let maxLength = 2000
  public var id: String
  public var text: String
  public var createdAt: String
  public var updatedAt: String
  public var revision: Int

  public init(id: String, text: String, createdAt: String, updatedAt: String, revision: Int) {
    self.id = id
    self.text = text
    self.createdAt = createdAt
    self.updatedAt = updatedAt
    self.revision = revision
  }
}

/// The reader-facing failure of a problem-library parse or validation.
public struct ProblemLibraryError: LocalizedError, Sendable, Equatable {
  public let message: String
  public init(_ message: String) { self.message = message }
  public var errorDescription: String? { message }
}
