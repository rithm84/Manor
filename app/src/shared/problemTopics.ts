/**
 * The closed, two-level topic vocabulary for the problem library. Categories, modeled on NeetCode's roadmap, drive
 * browsing and filtering; each category holds specific patterns and structures, and every pattern belongs to exactly
 * one category. A problem carries one to six patterns, and its categories follow from them. Imports, classification,
 * and the spec validator reject anything else. Each description is the rubric a classifier or reviewer applies, so a
 * label means the same thing on every problem. Prefer the most specific pattern that a reasonable solution actually
 * relies on, plus the data structures it is posed over; never tag a technique that only appears in a suboptimal
 * approach. A pattern never shares its name with a category that holds other patterns, so a filter value is never
 * ambiguous.
 */
export interface ProblemTopicDefinition { readonly label: string; readonly rubric: string }
export interface ProblemTopicCategory { readonly category: string; readonly topics: readonly ProblemTopicDefinition[] }

export const PROBLEM_TOPIC_CATEGORIES: readonly ProblemTopicCategory[] = [
  { category: 'Arrays & Hashing', topics: [
    { label: 'Arrays', rubric: 'The input or core state is an indexed sequence and the solution manipulates positions.' },
    { label: 'Hash tables', rubric: 'Constant-time lookup by key (map or set) is essential to the intended solution.' },
    { label: 'Counting', rubric: 'Frequencies or occurrence counts are tallied and compared.' },
    { label: 'Prefix sums', rubric: 'Cumulative sums or counts answer range queries, often paired with a hash map of earlier prefixes.' },
    { label: 'Difference arrays', rubric: 'Range updates are recorded at boundaries and resolved with a running sum.' },
    { label: 'Sorting', rubric: 'Ordering the data, possibly by a custom comparator, is a key step of the solution.' },
    { label: 'Bucket sort', rubric: 'Counting sort, bucket sort, or radix sort exploits a bounded key range.' },
    { label: 'Matrices', rubric: 'The input is a two-dimensional grid or matrix addressed by row and column.' },
  ] },
  { category: 'Two Pointers', topics: [
    { label: 'Two pointers: opposite ends', rubric: 'Two indices start at both ends of a sequence and move toward each other.' },
    { label: 'Two pointers: same direction', rubric: 'A read pointer and a write or trailing pointer move forward together, including merging sorted sequences.' },
    { label: 'Fast and slow pointers', rubric: 'Pointers advance at different speeds to detect cycles or find midpoints.' },
  ] },
  { category: 'Stack & Queue', topics: [
    { label: 'Stacks', rubric: 'Last-in, first-out processing such as bracket matching, undo, or explicit DFS.' },
    { label: 'Monotonic stack', rubric: 'A stack kept sorted to find next or previous greater or smaller elements, or spans.' },
    { label: 'Queues', rubric: 'First-in, first-out or double-ended queue processing outside of graph BFS.' },
  ] },
  { category: 'Sliding Window', topics: [
    { label: 'Sliding window: fixed', rubric: 'A window of constant length slides across the sequence while an aggregate is updated.' },
    { label: 'Sliding window: variable', rubric: 'A window grows and shrinks to satisfy a constraint, such as the longest or shortest valid subarray.' },
    { label: 'Monotonic queue', rubric: 'A deque kept sorted to answer window maximums or minimums in amortized constant time.' },
  ] },
  { category: 'Binary Search', topics: [
    { label: 'Binary search', rubric: 'Binary search over a sorted sequence or a monotonic index predicate.' },
    { label: 'Binary search on answer', rubric: 'Binary search over the answer value with a feasibility check.' },
  ] },
  { category: 'Linked List', topics: [
    { label: 'Linked lists', rubric: 'Nodes linked by next pointers are traversed, rewired, or built.' },
  ] },
  { category: 'Trees', topics: [
    { label: 'Binary trees', rubric: 'Nodes with left and right children are traversed, built, or restructured.' },
    { label: 'Binary search trees', rubric: 'The ordering invariant of a binary search tree is used or maintained.' },
    { label: 'N-ary trees', rubric: 'Rooted trees with arbitrary child lists, including trees given as parent or edge lists.' },
    { label: 'Ordered sets', rubric: 'A balanced search tree or sorted container supports ordered insert, delete, and neighbor queries.' },
    { label: 'Segment trees', rubric: 'A segment tree answers range queries with point or range updates.' },
    { label: 'Fenwick trees', rubric: 'A binary indexed tree maintains prefix aggregates under updates.' },
  ] },
  { category: 'Tries', topics: [
    { label: 'Tries', rubric: 'A prefix tree over characters or bits stores and queries keys.' },
  ] },
  { category: 'Heap / Priority Queue', topics: [
    { label: 'Heaps', rubric: 'A priority queue repeatedly extracts the smallest or largest element.' },
    { label: 'Top k elements', rubric: 'The task asks for the k largest, smallest, or most frequent items.' },
    { label: 'Quickselect', rubric: 'Partition-based selection finds the k-th element in expected linear time.' },
  ] },
  { category: 'Backtracking', topics: [
    { label: 'Backtracking', rubric: 'Choices are explored depth-first and undone to enumerate or find valid configurations.' },
    { label: 'Recursion', rubric: 'The natural solution is a recursive decomposition without memoization or branching search.' },
    { label: 'Divide and conquer', rubric: 'The input is split into independent parts whose results are combined.' },
  ] },
  { category: 'Graphs', topics: [
    { label: 'Graph modeling', rubric: 'Vertices and edges, explicit or implicit, model the problem.' },
    { label: 'Depth-first search', rubric: 'A depth-first traversal of a tree, graph, or grid drives the solution.' },
    { label: 'Breadth-first search', rubric: 'A level-by-level traversal, including shortest paths in unweighted graphs and grids.' },
    { label: 'Multi-source BFS', rubric: 'Breadth-first search starts from many sources at once, such as spreading from all marked cells.' },
    { label: 'Topological sort', rubric: 'Dependencies in a directed acyclic graph are ordered, or a cycle among them is detected.' },
    { label: 'Union-find', rubric: 'Disjoint-set union merges components and answers connectivity queries.' },
    { label: 'Graph connectivity', rubric: 'Components, bridges, articulation points, strongly connected components, or bipartiteness.' },
  ] },
  { category: 'Advanced Graphs', topics: [
    { label: 'Shortest paths', rubric: 'Weighted shortest paths with Dijkstra, Bellman-Ford, Floyd-Warshall, or 0-1 BFS.' },
    { label: 'Minimum spanning tree', rubric: 'Kruskal or Prim connects vertices at minimum total cost.' },
  ] },
  { category: '1-D Dynamic Programming', topics: [
    { label: 'DP: 1D', rubric: 'A single-index recurrence over positions or values, such as climbing stairs or house robber.' },
    { label: 'DP: subsequences', rubric: 'Longest increasing or other subsequence recurrences over one sequence.' },
    { label: 'DP: knapsack', rubric: 'Items are chosen under a capacity or target-sum constraint, bounded or unbounded.' },
    { label: 'DP: state machine', rubric: 'A small set of explicit states transitions at each step, such as stock trading with cooldown.' },
    { label: 'DP: trees', rubric: 'Each tree node computes its state from its children.' },
    { label: 'DP: digits', rubric: 'Counting numbers digit by digit under bound constraints.' },
    { label: 'Memoized search', rubric: 'A recursive search caches results for repeated arguments when no simple table order exists.' },
  ] },
  { category: '2-D Dynamic Programming', topics: [
    { label: 'DP: grid', rubric: 'A recurrence over grid cells or two independent indices, such as unique paths.' },
    { label: 'DP: strings', rubric: 'Two-string or substring recurrences such as edit distance, common subsequences, or palindromes.' },
    { label: 'DP: intervals', rubric: 'A recurrence over contiguous ranges, merging or splitting interval subproblems.' },
    { label: 'DP: bitmask', rubric: 'The state includes a bitmask of chosen elements.' },
  ] },
  { category: 'Greedy', topics: [
    { label: 'Greedy', rubric: 'A locally optimal choice at each step provably yields the global optimum.' },
  ] },
  { category: 'Intervals', topics: [
    { label: 'Interval operations', rubric: 'Ranges with start and end points are merged, intersected, scheduled, or covered.' },
    { label: 'Sweep line', rubric: 'Sorted events are processed in order while active state is maintained.' },
  ] },
  { category: 'Math & Geometry', topics: [
    { label: 'Math', rubric: 'Arithmetic reasoning, a closed-form formula, or direct enumeration of a small bounded space is the core of the solution.' },
    { label: 'Number theory', rubric: 'Divisibility, primes, greatest common divisors, or modular arithmetic.' },
    { label: 'Combinatorics', rubric: 'Counting arrangements or selections, often with binomial coefficients modulo a prime.' },
    { label: 'Probability', rubric: 'Probabilities or expected values are computed or reasoned about.' },
    { label: 'Randomized algorithms', rubric: 'Randomness is required, such as sampling, shuffling, or reservoir sampling.' },
    { label: 'Geometry', rubric: 'Points, lines, distances, areas, or angles in the plane or space.' },
    { label: 'Game theory', rubric: 'Two players move optimally; minimax, Nim values, or winning positions decide the result.' },
    { label: 'Linear algebra', rubric: 'Vectors and matrices are multiplied, decomposed, or transformed numerically.' },
    { label: 'Quantitative finance', rubric: 'Pricing, trading, order books, or risk computations.' },
  ] },
  { category: 'Bit Manipulation', topics: [
    { label: 'Bit manipulation', rubric: 'Bitwise operations, masks, or binary representations are central to the solution.' },
  ] },
  { category: 'Strings & Simulation', topics: [
    { label: 'Strings', rubric: 'The input or output is text and the solution works with characters or substrings.' },
    { label: 'String matching', rubric: 'Pattern search with KMP, Z-function, rolling hashes, or suffix structures.' },
    { label: 'Parsing', rubric: 'Structured text is tokenized or evaluated, such as expressions, paths, logs, or encoded strings.' },
    { label: 'Simulation', rubric: 'The process described in the statement is carried out step by step.' },
  ] },
  { category: 'Design', topics: [
    { label: 'Data structure design', rubric: 'Implement a class whose operations meet stated complexity, such as an LRU cache or iterator.' },
    { label: 'Object-oriented design', rubric: 'Model classes, responsibilities, and interactions for a described domain.' },
    { label: 'API design', rubric: 'Design or implement service endpoints, request handling, or client integration.' },
    { label: 'Frontend', rubric: 'Browser user interfaces, the DOM, CSS, or component frameworks.' },
    { label: 'Debugging and testing', rubric: 'Find and fix defects in supplied code or a failing system, or write and reason about tests.' },
  ] },
  { category: 'Concurrency', topics: [
    { label: 'Concurrency', rubric: 'Threads, locks, or asynchronous coordination must be implemented correctly.' },
    { label: 'Operating systems', rubric: 'Processes, memory, scheduling, or file system internals.' },
  ] },
  { category: 'Databases & SQL', topics: [
    { label: 'SQL', rubric: 'The answer is a relational query over given tables.' },
    { label: 'Data manipulation', rubric: 'Tabular data is transformed with a dataframe or similar library.' },
    { label: 'Shell', rubric: 'The answer is a shell command or script over text files.' },
  ] },
  { category: 'System Design', topics: [
    { label: 'System design', rubric: 'Design a scalable service end to end: storage, compute, traffic, and trade-offs.' },
    { label: 'Distributed systems', rubric: 'Replication, consistency, partitioning, consensus, or failure handling across machines.' },
    { label: 'Caching', rubric: 'Cache placement, eviction, invalidation, or expiration is the focus.' },
    { label: 'Databases', rubric: 'Data modeling, indexing, transactions, or storage engine choices for a system.' },
    { label: 'Stream processing', rubric: 'Unbounded event streams are ingested, aggregated, or processed in real time.' },
    { label: 'Rate limiting', rubric: 'Requests are throttled with token buckets, sliding logs, or similar policies.' },
    { label: 'Networking', rubric: 'Protocols, sockets, HTTP, DNS, or load balancing.' },
    { label: 'Security', rubric: 'Authentication, authorization, encryption, or attack mitigation.' },
  ] },
  { category: 'Machine Learning', topics: [
    { label: 'Machine learning', rubric: 'Classical models, training, evaluation metrics, or feature work.' },
    { label: 'Deep learning', rubric: 'Neural network layers, attention, backpropagation, or training loops.' },
    { label: 'Large language models', rubric: 'Language model inference, retrieval-augmented generation, agents, or evaluation.' },
    { label: 'Machine learning system design', rubric: 'Design a production ML system: data, training, serving, and monitoring.' },
    { label: 'Statistics', rubric: 'Estimation, distributions, hypothesis tests, or experiment analysis.' },
  ] },
  { category: 'Behavioral', topics: [
    { label: 'Behavioral', rubric: 'Questions about past experience, collaboration, conflict, leadership, or motivation.' },
    { label: 'Project deep dive', rubric: 'Discuss and defend the design and decisions of a past project.' },
  ] },
]

export const PROBLEM_TOPICS: readonly string[] = PROBLEM_TOPIC_CATEGORIES.flatMap(category => category.topics.map(topic => topic.label))
export const PROBLEM_TOPIC_CATEGORY_NAMES: readonly string[] = PROBLEM_TOPIC_CATEGORIES.map(category => category.category)

/**
 * Labels from earlier vocabularies and their current pattern, or null where the label added no filtering value and is
 * dropped. Retagging and the spec validator translate these; nothing new may use them.
 */
export const RETIRED_PROBLEM_TOPICS: Readonly<Record<string, string | null>> = {
  'Graphs': 'Graph modeling', 'Intervals': 'Interval operations', 'Enumeration': null, 'Debugging': 'Debugging and testing', 'Testing': 'Debugging and testing',
  'Dynamic programming': 'DP: 1D', 'Mathematics': 'Math', 'Trees': 'Binary trees', 'Binary tree': 'Binary trees', 'Binary indexed tree': 'Fenwick trees',
  'Segment tree': 'Segment trees', 'Sliding window': 'Sliding window: variable', 'Matrix': 'Matrices', 'Bitmask': 'Bit manipulation', 'Hash function': 'Hash tables',
  'Two pointers': 'Two pointers: same direction', 'Cycle detection': 'Graph modeling', 'Bracket sequences': 'Stacks', 'Algorithms': null, 'Algorithm x': null,
}

const topicSet = new Set(PROBLEM_TOPICS)
const categoryOfTopic = new Map(PROBLEM_TOPIC_CATEGORIES.flatMap(category => category.topics.map(topic => [topic.label, category.category] as const)))
const topicsOfCategory = new Map(PROBLEM_TOPIC_CATEGORIES.map(category => [category.category, category.topics.map(topic => topic.label)] as const))

export function isProblemTopic(label: string): boolean { return topicSet.has(label) }

/** The category a pattern belongs to, or null for a label outside the vocabulary. */
export function problemTopicCategory(label: string): string | null { return categoryOfTopic.get(label) ?? null }

/** A problem's categories in vocabulary order, derived from its patterns. */
export function problemTopicCategories(topics: readonly string[]): string[] {
  const present = new Set(topics.map(problemTopicCategory))
  return PROBLEM_TOPIC_CATEGORY_NAMES.filter(category => present.has(category))
}

/**
 * The patterns a topic filter value selects: a category selects every pattern in it, and a pattern selects itself.
 * Retired or unknown labels select themselves, so an older saved view still matches what it named.
 */
export function topicFilterPatterns(value: string): readonly string[] { return topicsOfCategory.get(value) ?? [value] }
