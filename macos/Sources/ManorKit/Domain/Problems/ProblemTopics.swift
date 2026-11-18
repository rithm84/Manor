import Foundation

public struct ProblemTopicDefinition: Sendable, Hashable {
  public let label: String
  /// What the label means, so it reads the same on every problem.
  public let rubric: String
}

public struct ProblemTopicCategory: Sendable, Hashable {
  public let category: String
  public let topics: [ProblemTopicDefinition]
}

/// The closed, two-level topic vocabulary of the problem library. Categories drive browsing and filtering; each
/// holds specific patterns and structures, and every pattern belongs to exactly one category. A problem carries
/// one to six patterns, and its categories follow from them. A pattern never shares its name with a category that
/// holds other patterns, so a filter value is never ambiguous.
public enum ProblemTopics {
  public static let categories: [ProblemTopicCategory] = [
    .init(category: "Arrays & Hashing", topics: [
      .init(label: "Arrays", rubric: "The input or core state is an indexed sequence and the solution manipulates positions."),
      .init(label: "Hash tables", rubric: "Constant-time lookup by key (map or set) is essential to the intended solution."),
      .init(label: "Counting", rubric: "Frequencies or occurrence counts are tallied and compared."),
      .init(label: "Prefix sums", rubric: "Cumulative sums or counts answer range queries, often paired with a hash map of earlier prefixes."),
      .init(label: "Difference arrays", rubric: "Range updates are recorded at boundaries and resolved with a running sum."),
      .init(label: "Sorting", rubric: "Ordering the data, possibly by a custom comparator, is a key step of the solution."),
      .init(label: "Bucket sort", rubric: "Counting sort, bucket sort, or radix sort exploits a bounded key range."),
      .init(label: "Matrices", rubric: "The input is a two-dimensional grid or matrix addressed by row and column.")
    ]),
    .init(category: "Two Pointers", topics: [
      .init(label: "Two pointers: opposite ends", rubric: "Two indices start at both ends of a sequence and move toward each other."),
      .init(label: "Two pointers: same direction", rubric: "A read pointer and a write or trailing pointer move forward together, including merging sorted sequences."),
      .init(label: "Fast and slow pointers", rubric: "Pointers advance at different speeds to detect cycles or find midpoints.")
    ]),
    .init(category: "Stack & Queue", topics: [
      .init(label: "Stacks", rubric: "Last-in, first-out processing such as bracket matching, undo, or explicit DFS."),
      .init(label: "Monotonic stack", rubric: "A stack kept sorted to find next or previous greater or smaller elements, or spans."),
      .init(label: "Queues", rubric: "First-in, first-out or double-ended queue processing outside of graph BFS.")
    ]),
    .init(category: "Sliding Window", topics: [
      .init(label: "Sliding window: fixed", rubric: "A window of constant length slides across the sequence while an aggregate is updated."),
      .init(label: "Sliding window: variable", rubric: "A window grows and shrinks to satisfy a constraint, such as the longest or shortest valid subarray."),
      .init(label: "Monotonic queue", rubric: "A deque kept sorted to answer window maximums or minimums in amortized constant time.")
    ]),
    .init(category: "Binary Search", topics: [
      .init(label: "Binary search", rubric: "Binary search over a sorted sequence or a monotonic index predicate."),
      .init(label: "Binary search on answer", rubric: "Binary search over the answer value with a feasibility check.")
    ]),
    .init(category: "Linked List", topics: [
      .init(label: "Linked lists", rubric: "Nodes linked by next pointers are traversed, rewired, or built.")
    ]),
    .init(category: "Trees", topics: [
      .init(label: "Binary trees", rubric: "Nodes with left and right children are traversed, built, or restructured."),
      .init(label: "Binary search trees", rubric: "The ordering invariant of a binary search tree is used or maintained."),
      .init(label: "N-ary trees", rubric: "Rooted trees with arbitrary child lists, including trees given as parent or edge lists."),
      .init(label: "Ordered sets", rubric: "A balanced search tree or sorted container supports ordered insert, delete, and neighbor queries."),
      .init(label: "Segment trees", rubric: "A segment tree answers range queries with point or range updates."),
      .init(label: "Fenwick trees", rubric: "A binary indexed tree maintains prefix aggregates under updates.")
    ]),
    .init(category: "Tries", topics: [
      .init(label: "Tries", rubric: "A prefix tree over characters or bits stores and queries keys.")
    ]),
    .init(category: "Heap / Priority Queue", topics: [
      .init(label: "Heaps", rubric: "A priority queue repeatedly extracts the smallest or largest element."),
      .init(label: "Top k elements", rubric: "The task asks for the k largest, smallest, or most frequent items."),
      .init(label: "Quickselect", rubric: "Partition-based selection finds the k-th element in expected linear time.")
    ]),
    .init(category: "Backtracking", topics: [
      .init(label: "Backtracking", rubric: "Choices are explored depth-first and undone to enumerate or find valid configurations."),
      .init(label: "Recursion", rubric: "The natural solution is a recursive decomposition without memoization or branching search."),
      .init(label: "Divide and conquer", rubric: "The input is split into independent parts whose results are combined.")
    ]),
    .init(category: "Graphs", topics: [
      .init(label: "Graph modeling", rubric: "Vertices and edges, explicit or implicit, model the problem."),
      .init(label: "Depth-first search", rubric: "A depth-first traversal of a tree, graph, or grid drives the solution."),
      .init(label: "Breadth-first search", rubric: "A level-by-level traversal, including shortest paths in unweighted graphs and grids."),
      .init(label: "Multi-source BFS", rubric: "Breadth-first search starts from many sources at once, such as spreading from all marked cells."),
      .init(label: "Topological sort", rubric: "Dependencies in a directed acyclic graph are ordered, or a cycle among them is detected."),
      .init(label: "Union-find", rubric: "Disjoint-set union merges components and answers connectivity queries."),
      .init(label: "Graph connectivity", rubric: "Components, bridges, articulation points, strongly connected components, or bipartiteness.")
    ]),
    .init(category: "Advanced Graphs", topics: [
      .init(label: "Shortest paths", rubric: "Weighted shortest paths with Dijkstra, Bellman-Ford, Floyd-Warshall, or 0-1 BFS."),
      .init(label: "Minimum spanning tree", rubric: "Kruskal or Prim connects vertices at minimum total cost.")
    ]),
    .init(category: "1-D Dynamic Programming", topics: [
      .init(label: "DP: 1D", rubric: "A single-index recurrence over positions or values, such as climbing stairs or house robber."),
      .init(label: "DP: subsequences", rubric: "Longest increasing or other subsequence recurrences over one sequence."),
      .init(label: "DP: knapsack", rubric: "Items are chosen under a capacity or target-sum constraint, bounded or unbounded."),
      .init(label: "DP: state machine", rubric: "A small set of explicit states transitions at each step, such as stock trading with cooldown."),
      .init(label: "DP: trees", rubric: "Each tree node computes its state from its children."),
      .init(label: "DP: digits", rubric: "Counting numbers digit by digit under bound constraints."),
      .init(label: "Memoized search", rubric: "A recursive search caches results for repeated arguments when no simple table order exists.")
    ]),
    .init(category: "2-D Dynamic Programming", topics: [
      .init(label: "DP: grid", rubric: "A recurrence over grid cells or two independent indices, such as unique paths."),
      .init(label: "DP: strings", rubric: "Two-string or substring recurrences such as edit distance, common subsequences, or palindromes."),
      .init(label: "DP: intervals", rubric: "A recurrence over contiguous ranges, merging or splitting interval subproblems."),
      .init(label: "DP: bitmask", rubric: "The state includes a bitmask of chosen elements.")
    ]),
    .init(category: "Greedy", topics: [
      .init(label: "Greedy", rubric: "A locally optimal choice at each step provably yields the global optimum.")
    ]),
    .init(category: "Intervals", topics: [
      .init(label: "Interval operations", rubric: "Ranges with start and end points are merged, intersected, scheduled, or covered."),
      .init(label: "Sweep line", rubric: "Sorted events are processed in order while active state is maintained.")
    ]),
    .init(category: "Math & Geometry", topics: [
      .init(label: "Math", rubric: "Arithmetic reasoning, a closed-form formula, or direct enumeration of a small bounded space is the core of the solution."),
      .init(label: "Number theory", rubric: "Divisibility, primes, greatest common divisors, or modular arithmetic."),
      .init(label: "Combinatorics", rubric: "Counting arrangements or selections, often with binomial coefficients modulo a prime."),
      .init(label: "Probability", rubric: "Probabilities or expected values are computed or reasoned about."),
      .init(label: "Randomized algorithms", rubric: "Randomness is required, such as sampling, shuffling, or reservoir sampling."),
      .init(label: "Geometry", rubric: "Points, lines, distances, areas, or angles in the plane or space."),
      .init(label: "Game theory", rubric: "Two players move optimally; minimax, Nim values, or winning positions decide the result."),
      .init(label: "Linear algebra", rubric: "Vectors and matrices are multiplied, decomposed, or transformed numerically."),
      .init(label: "Quantitative finance", rubric: "Pricing, trading, order books, or risk computations.")
    ]),
    .init(category: "Bit Manipulation", topics: [
      .init(label: "Bit manipulation", rubric: "Bitwise operations, masks, or binary representations are central to the solution.")
    ]),
    .init(category: "Strings & Simulation", topics: [
      .init(label: "Strings", rubric: "The input or output is text and the solution works with characters or substrings."),
      .init(label: "String matching", rubric: "Pattern search with KMP, Z-function, rolling hashes, or suffix structures."),
      .init(label: "Parsing", rubric: "Structured text is tokenized or evaluated, such as expressions, paths, logs, or encoded strings."),
      .init(label: "Simulation", rubric: "The process described in the statement is carried out step by step.")
    ]),
    .init(category: "Design", topics: [
      .init(label: "Data structure design", rubric: "Implement a class whose operations meet stated complexity, such as an LRU cache or iterator."),
      .init(label: "Object-oriented design", rubric: "Model classes, responsibilities, and interactions for a described domain."),
      .init(label: "API design", rubric: "Design or implement service endpoints, request handling, or client integration."),
      .init(label: "Frontend", rubric: "Browser user interfaces, the DOM, CSS, or component frameworks."),
      .init(label: "Debugging and testing", rubric: "Find and fix defects in supplied code or a failing system, or write and reason about tests.")
    ]),
    .init(category: "Concurrency", topics: [
      .init(label: "Concurrency", rubric: "Threads, locks, or asynchronous coordination must be implemented correctly."),
      .init(label: "Operating systems", rubric: "Processes, memory, scheduling, or file system internals.")
    ]),
    .init(category: "Databases & SQL", topics: [
      .init(label: "SQL", rubric: "The answer is a relational query over given tables."),
      .init(label: "Data manipulation", rubric: "Tabular data is transformed with a dataframe or similar library."),
      .init(label: "Shell", rubric: "The answer is a shell command or script over text files.")
    ]),
    .init(category: "System Design", topics: [
      .init(label: "System design", rubric: "Design a scalable service end to end: storage, compute, traffic, and trade-offs."),
      .init(label: "Distributed systems", rubric: "Replication, consistency, partitioning, consensus, or failure handling across machines."),
      .init(label: "Caching", rubric: "Cache placement, eviction, invalidation, or expiration is the focus."),
      .init(label: "Databases", rubric: "Data modeling, indexing, transactions, or storage engine choices for a system."),
      .init(label: "Stream processing", rubric: "Unbounded event streams are ingested, aggregated, or processed in real time."),
      .init(label: "Rate limiting", rubric: "Requests are throttled with token buckets, sliding logs, or similar policies."),
      .init(label: "Networking", rubric: "Protocols, sockets, HTTP, DNS, or load balancing."),
      .init(label: "Security", rubric: "Authentication, authorization, encryption, or attack mitigation.")
    ]),
    .init(category: "Machine Learning", topics: [
      .init(label: "Machine learning", rubric: "Classical models, training, evaluation metrics, or feature work."),
      .init(label: "Deep learning", rubric: "Neural network layers, attention, backpropagation, or training loops."),
      .init(label: "Large language models", rubric: "Language model inference, retrieval-augmented generation, agents, or evaluation."),
      .init(label: "Machine learning system design", rubric: "Design a production ML system: data, training, serving, and monitoring."),
      .init(label: "Statistics", rubric: "Estimation, distributions, hypothesis tests, or experiment analysis.")
    ]),
    .init(category: "Behavioral", topics: [
      .init(label: "Behavioral", rubric: "Questions about past experience, collaboration, conflict, leadership, or motivation."),
      .init(label: "Project deep dive", rubric: "Discuss and defend the design and decisions of a past project.")
    ])
  ]

  public static let labels: [String] = categories.flatMap { $0.topics.map(\.label) }
  public static let categoryNames: [String] = categories.map(\.category)

  /// Labels from earlier vocabularies and their current pattern, or nil where the label was dropped.
  public static let retired: [String: String?] = ["Graphs": "Graph modeling", "Intervals": "Interval operations", "Enumeration": nil, "Debugging": "Debugging and testing", "Testing": "Debugging and testing", "Dynamic programming": "DP: 1D", "Mathematics": "Math", "Trees": "Binary trees", "Binary tree": "Binary trees", "Binary indexed tree": "Fenwick trees", "Segment tree": "Segment trees", "Sliding window": "Sliding window: variable", "Matrix": "Matrices", "Bitmask": "Bit manipulation", "Hash function": "Hash tables", "Two pointers": "Two pointers: same direction", "Cycle detection": "Graph modeling", "Bracket sequences": "Stacks", "Algorithms": nil, "Algorithm x": nil]

  private static let categoryOfTopic: [String: String] = Dictionary(
    categories.flatMap { category in category.topics.map { ($0.label, category.category) } }, uniquingKeysWith: { first, _ in first })
  private static let topicsOfCategory: [String: [String]] = Dictionary(
    categories.map { ($0.category, $0.topics.map(\.label)) }, uniquingKeysWith: { first, _ in first })
  private static let rubrics: [String: String] = Dictionary(
    categories.flatMap { $0.topics.map { ($0.label, $0.rubric) } }, uniquingKeysWith: { first, _ in first })
  private static let labelSet = Set(labels)

  public static func isTopic(_ label: String) -> Bool { labelSet.contains(label) }

  /// The category a pattern belongs to, or nil for a label outside the vocabulary.
  public static func category(of label: String) -> String? { categoryOfTopic[label] }

  /// The rubric of a pattern in the vocabulary.
  public static func rubric(of label: String) -> String? { rubrics[label] }

  /// A problem's categories in vocabulary order, derived from its patterns.
  public static func categories(for topics: [String]) -> [String] {
    let present = Set(topics.compactMap { categoryOfTopic[$0] })
    return categoryNames.filter { present.contains($0) }
  }

  /// The patterns a topic filter value selects: a category selects every pattern in it, and a pattern selects
  /// itself. Retired or unknown labels select themselves, so an older saved view still matches what it named.
  public static func filterPatterns(_ value: String) -> [String] { topicsOfCategory[value] ?? [value] }
}
