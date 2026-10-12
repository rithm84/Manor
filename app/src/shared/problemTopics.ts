/**
 * The closed topic vocabulary for the problem library. Every problem carries one to six of these
 * labels; imports, classification, and the editor reject anything else. Each description is the
 * rubric a classifier or reviewer applies, so a label means the same thing on every problem.
 * Prefer the most specific pattern that a reasonable solution actually relies on, plus the data
 * structures it is posed over; never tag a technique that only appears in a suboptimal approach.
 */
export interface ProblemTopicDefinition { readonly label: string; readonly rubric: string }
export interface ProblemTopicGroup { readonly group: string; readonly topics: readonly ProblemTopicDefinition[] }

export const PROBLEM_TOPIC_GROUPS: readonly ProblemTopicGroup[] = [
  { group: 'Data structures', topics: [
    { label: 'Arrays', rubric: 'The input or core state is an indexed sequence and the solution manipulates positions.' },
    { label: 'Strings', rubric: 'The input or output is text and the solution works with characters or substrings.' },
    { label: 'Hash tables', rubric: 'Constant-time lookup by key (map or set) is essential to the intended solution.' },
    { label: 'Linked lists', rubric: 'Nodes linked by next pointers are traversed, rewired, or built.' },
    { label: 'Stacks', rubric: 'Last-in, first-out processing such as bracket matching, undo, or explicit DFS.' },
    { label: 'Monotonic stack', rubric: 'A stack kept sorted to find next or previous greater or smaller elements, or spans.' },
    { label: 'Queues', rubric: 'First-in, first-out or double-ended queue processing outside of graph BFS.' },
    { label: 'Monotonic queue', rubric: 'A deque kept sorted to answer window maximums or minimums in amortized constant time.' },
    { label: 'Heaps', rubric: 'A priority queue repeatedly extracts the smallest or largest element.' },
    { label: 'Matrices', rubric: 'The input is a two-dimensional grid or matrix addressed by row and column.' },
    { label: 'Intervals', rubric: 'Ranges with start and end points are merged, intersected, scheduled, or covered.' },
    { label: 'Binary trees', rubric: 'Nodes with left and right children are traversed, built, or restructured.' },
    { label: 'Binary search trees', rubric: 'The ordering invariant of a binary search tree is used or maintained.' },
    { label: 'N-ary trees', rubric: 'Rooted trees with arbitrary child lists, including trees given as parent or edge lists.' },
    { label: 'Tries', rubric: 'A prefix tree over characters or bits stores and queries keys.' },
    { label: 'Graphs', rubric: 'Vertices and edges, explicit or implicit, model the problem.' },
    { label: 'Union-find', rubric: 'Disjoint-set union merges components and answers connectivity queries.' },
    { label: 'Segment trees', rubric: 'A segment tree answers range queries with point or range updates.' },
    { label: 'Fenwick trees', rubric: 'A binary indexed tree maintains prefix aggregates under updates.' },
    { label: 'Ordered sets', rubric: 'A balanced search tree or sorted container supports ordered insert, delete, and neighbor queries.' },
    { label: 'Bit manipulation', rubric: 'Bitwise operations, masks, or binary representations are central to the solution.' },
  ] },
  { group: 'Pointers and windows', topics: [
    { label: 'Two pointers: opposite ends', rubric: 'Two indices start at both ends of a sequence and move toward each other.' },
    { label: 'Two pointers: same direction', rubric: 'A read pointer and a write or trailing pointer move forward together, including merging sorted sequences.' },
    { label: 'Fast and slow pointers', rubric: 'Pointers advance at different speeds to detect cycles or find midpoints.' },
    { label: 'Sliding window: fixed', rubric: 'A window of constant length slides across the sequence while an aggregate is updated.' },
    { label: 'Sliding window: variable', rubric: 'A window grows and shrinks to satisfy a constraint, such as the longest or shortest valid subarray.' },
    { label: 'Prefix sums', rubric: 'Cumulative sums or counts answer range queries, often paired with a hash map of earlier prefixes.' },
    { label: 'Difference arrays', rubric: 'Range updates are recorded at boundaries and resolved with a running sum.' },
  ] },
  { group: 'Searching and sorting', topics: [
    { label: 'Binary search', rubric: 'Binary search over a sorted sequence or a monotonic index predicate.' },
    { label: 'Binary search on answer', rubric: 'Binary search over the answer value with a feasibility check.' },
    { label: 'Sorting', rubric: 'Ordering the data, possibly by a custom comparator, is a key step of the solution.' },
    { label: 'Bucket sort', rubric: 'Counting sort, bucket sort, or radix sort exploits a bounded key range.' },
    { label: 'Quickselect', rubric: 'Partition-based selection finds the k-th element in expected linear time.' },
    { label: 'Top k elements', rubric: 'The task asks for the k largest, smallest, or most frequent items.' },
  ] },
  { group: 'Recursion and search', topics: [
    { label: 'Recursion', rubric: 'The natural solution is a recursive decomposition without memoization or branching search.' },
    { label: 'Backtracking', rubric: 'Choices are explored depth-first and undone to enumerate or find valid configurations.' },
    { label: 'Divide and conquer', rubric: 'The input is split into independent halves whose results are combined.' },
    { label: 'Depth-first search', rubric: 'A depth-first traversal of a tree, graph, or grid drives the solution.' },
    { label: 'Breadth-first search', rubric: 'A level-by-level traversal, including shortest paths in unweighted graphs and grids.' },
    { label: 'Multi-source BFS', rubric: 'Breadth-first search starts from many sources at once, such as spreading from all marked cells.' },
    { label: 'Topological sort', rubric: 'Dependencies in a directed acyclic graph are ordered, or a cycle among them is detected.' },
    { label: 'Shortest paths', rubric: 'Weighted shortest paths with Dijkstra, Bellman-Ford, Floyd-Warshall, or 0-1 BFS.' },
    { label: 'Minimum spanning tree', rubric: 'Kruskal or Prim connects vertices at minimum total cost.' },
    { label: 'Graph connectivity', rubric: 'Components, bridges, articulation points, strongly connected components, or bipartiteness.' },
  ] },
  { group: 'Dynamic programming', topics: [
    { label: 'DP: 1D', rubric: 'A single-index recurrence over positions or values, such as climbing stairs or house robber.' },
    { label: 'DP: grid', rubric: 'A recurrence over grid cells or two independent indices, such as unique paths.' },
    { label: 'DP: knapsack', rubric: 'Items are chosen under a capacity or target-sum constraint, bounded or unbounded.' },
    { label: 'DP: subsequences', rubric: 'Longest increasing or other subsequence recurrences over one sequence.' },
    { label: 'DP: strings', rubric: 'Two-string or substring recurrences such as edit distance, common subsequences, or palindromes.' },
    { label: 'DP: intervals', rubric: 'A recurrence over contiguous ranges, merging or splitting interval subproblems.' },
    { label: 'DP: bitmask', rubric: 'The state includes a bitmask of chosen elements.' },
    { label: 'DP: trees', rubric: 'Each tree node computes its state from its children.' },
    { label: 'DP: digits', rubric: 'Counting numbers digit by digit under bound constraints.' },
    { label: 'DP: state machine', rubric: 'A small set of explicit states transitions at each step, such as stock trading with cooldown.' },
    { label: 'Memoized search', rubric: 'A recursive search caches results for repeated arguments when no simple table order exists.' },
  ] },
  { group: 'Strategies', topics: [
    { label: 'Greedy', rubric: 'A locally optimal choice at each step provably yields the global optimum.' },
    { label: 'Simulation', rubric: 'The process described in the statement is carried out step by step.' },
    { label: 'Counting', rubric: 'Frequencies or occurrence counts are tallied and compared.' },
    { label: 'Enumeration', rubric: 'All candidates in a small bounded space are tried directly.' },
    { label: 'Sweep line', rubric: 'Sorted events are processed in order while active state is maintained.' },
    { label: 'Randomized algorithms', rubric: 'Randomness is required, such as sampling, shuffling, or reservoir sampling.' },
    { label: 'Data structure design', rubric: 'Implement a class whose operations meet stated complexity, such as an LRU cache or iterator.' },
  ] },
  { group: 'Strings and parsing', topics: [
    { label: 'String matching', rubric: 'Pattern search with KMP, Z-function, rolling hashes, or suffix structures.' },
    { label: 'Parsing', rubric: 'Structured text is tokenized or evaluated, such as expressions, paths, or encoded strings.' },
  ] },
  { group: 'Mathematics', topics: [
    { label: 'Math', rubric: 'Arithmetic reasoning or a closed-form formula is the core of the solution.' },
    { label: 'Number theory', rubric: 'Divisibility, primes, greatest common divisors, or modular arithmetic.' },
    { label: 'Combinatorics', rubric: 'Counting arrangements or selections, often with binomial coefficients modulo a prime.' },
    { label: 'Probability', rubric: 'Probabilities or expected values are computed or reasoned about.' },
    { label: 'Geometry', rubric: 'Points, lines, distances, areas, or angles in the plane or space.' },
    { label: 'Game theory', rubric: 'Two players move optimally; minimax, Nim values, or winning positions decide the result.' },
    { label: 'Linear algebra', rubric: 'Vectors and matrices are multiplied, decomposed, or transformed numerically.' },
    { label: 'Statistics', rubric: 'Estimation, distributions, hypothesis tests, or experiment analysis.' },
  ] },
  { group: 'Systems and practice', topics: [
    { label: 'SQL', rubric: 'The answer is a relational query over given tables.' },
    { label: 'Data manipulation', rubric: 'Tabular data is transformed with a dataframe or similar library.' },
    { label: 'Shell', rubric: 'The answer is a shell command or script.' },
    { label: 'Concurrency', rubric: 'Threads, locks, or asynchronous coordination must be implemented correctly.' },
    { label: 'Object-oriented design', rubric: 'Model classes, responsibilities, and interactions for a described domain.' },
    { label: 'API design', rubric: 'Design or implement service endpoints, request handling, or client integration.' },
    { label: 'System design', rubric: 'Design a scalable service end to end: storage, compute, traffic, and trade-offs.' },
    { label: 'Distributed systems', rubric: 'Replication, consistency, partitioning, consensus, or failure handling across machines.' },
    { label: 'Caching', rubric: 'Cache placement, eviction, invalidation, or expiration is the focus.' },
    { label: 'Databases', rubric: 'Data modeling, indexing, transactions, or storage engine choices for a system.' },
    { label: 'Stream processing', rubric: 'Unbounded event streams are ingested, aggregated, or processed in real time.' },
    { label: 'Rate limiting', rubric: 'Requests are throttled with token buckets, sliding logs, or similar policies.' },
    { label: 'Networking', rubric: 'Protocols, sockets, HTTP, DNS, or load balancing.' },
    { label: 'Operating systems', rubric: 'Processes, memory, scheduling, or file system internals.' },
    { label: 'Security', rubric: 'Authentication, authorization, encryption, or attack mitigation.' },
    { label: 'Frontend', rubric: 'Browser user interfaces, the DOM, CSS, or component frameworks.' },
    { label: 'Debugging', rubric: 'Find and fix defects in supplied code or a failing system.' },
    { label: 'Testing', rubric: 'Write or reason about tests for supplied behavior.' },
  ] },
  { group: 'Machine learning and finance', topics: [
    { label: 'Machine learning', rubric: 'Classical models, training, evaluation metrics, or feature work.' },
    { label: 'Deep learning', rubric: 'Neural network layers, attention, backpropagation, or training loops.' },
    { label: 'Large language models', rubric: 'Language model inference, retrieval-augmented generation, agents, or evaluation.' },
    { label: 'Machine learning system design', rubric: 'Design a production ML system: data, training, serving, and monitoring.' },
    { label: 'Quantitative finance', rubric: 'Pricing, trading, order books, or risk computations.' },
  ] },
  { group: 'Interviews', topics: [
    { label: 'Behavioral', rubric: 'Questions about past experience, collaboration, conflict, leadership, or motivation.' },
    { label: 'Project deep dive', rubric: 'Discuss and defend the design and decisions of a past project.' },
  ] },
]

export const PROBLEM_TOPICS: readonly string[] = PROBLEM_TOPIC_GROUPS.flatMap(group => group.topics.map(topic => topic.label))
const topicSet = new Set(PROBLEM_TOPICS)

export function isProblemTopic(label: string): boolean { return topicSet.has(label) }
