import Foundation

/// Sample content for `ALFRED_DEMO=1` (UI review without provider keys) and the diagram test corpus.
enum DemoContent {
    static let heading = "Two Sum — return indices of the two numbers that add to target"

    static let answer = """
    **Use one pass with a hash map: for each `x`, look up `target - x` among the values already seen.**

    ```diagram
    array nums = [2, 7, 11, 15]
    step "i = 0: need 9 - 2 = 7, not seen yet, so store 2 → 0"
    pointer i -> nums[0] orange
    map seen = {2: 0}
    step "i = 1: need 9 - 7 = 2, already seen at index 0"
    pointer i -> nums[1] orange
    highlight nums[0] green
    arrow nums[1] -> nums[0] "9 - 7 = 2" green
    step "Found the pair: return [0, 1]"
    highlight nums[0..1] green
    ```

    - **Why it works:** when the second number of the pair is reached, the first is already in `seen`.
    - Brute force checks every pair: O(n²) time, O(1) space.
    - Storing **after** the check means an element is never paired with itself; duplicates like `[3, 3]` still work.

    ```python
    def two_sum(nums: list[int], target: int) -> list[int]:
        # 1. Map each value seen so far to its index.
        seen = {}
        for i, x in enumerate(nums):
            # 2. The partner this number needs to reach target.
            need = target - x
            # 3. Partner already seen: that's the pair.
            if need in seen:
                return [seen[need], i]
            # 4. Otherwise remember this number for later ones.
            seen[x] = i
        return []
    ```

    **Complexity:** O(n) time, O(n) extra space for the map.
    """

    static let followUp = (heading: "why store after the check?", answer: """
    **Checking first means `seen` only holds earlier indices, so a number can never pair with itself.**

    - With `nums = [3]`, `target = 6`, storing first would match 3 with itself and return `[0, 0]`.
    - Duplicates still work: in `[3, 3]` the second 3 finds the first and returns `[0, 1]`.
    """)

    static let otherChat = (heading: "Design a rate limiter", answer: """
    **Use a token bucket per client in Redis: refill at the allowed rate, reject when the bucket is empty.**

    - Atomic refill-and-take in one Lua script, so concurrent requests can't overspend.
    - Key by API key or user ID; TTL the keys so idle clients cost nothing.
    """)

    /// Realistic diagrams for the most common interview patterns. Used by the gallery demo and by the
    /// layout collision tests, so every pattern here is guaranteed clash-free.
    static let diagrams: [(title: String, source: String)] = [
        ("Two pointers", """
        array nums = [1, 3, 4, 6, 8, 11]
        pointer l -> nums[1] green
        pointer r -> nums[4] orange
        dim nums[0], nums[5]
        caption "sum = 3 + 8 = 11 = target → return [1, 4]"
        """),
        ("Sliding window", """
        string s = "abcabcbb"
        window s[1..3] "bca" orange
        pointer l -> s[1] green
        pointer r -> s[3] orange
        set seen = [b, c, a]
        caption "Window has no repeats; best length = 3"
        """),
        ("Binary search", """
        array a = [1, 3, 5, 7, 9, 11, 13]
        dim a[0..2]
        pointer lo -> a[3] green
        pointer mid -> a[4] blue below
        pointer hi -> a[6] orange
        highlight a[4] blue
        caption "a[mid] = 9 > 7 → hi = mid - 1"
        """),
        ("Monotonic stack", """
        bars h = [2, 1, 5, 6, 2, 3]
        rect h[2..3] 5 "area 10" green
        pointer i -> h[4] orange
        stack S = [1, 2, 3]
        caption "h[4] < h[3] → pop 3, pop 2: widest rectangle of height 5 spans [2, 3]"
        """),
        ("Trapping rain water", """
        bars h = [0, 1, 0, 2, 1, 0, 1, 3, 2, 1, 2, 1]
        water h[2] 1
        water h[4..6] 2
        water h[9] 2
        pointer L -> h[3] green
        pointer R -> h[7] orange
        caption "water[i] = min(maxLeft, maxRight) - h[i] → 6 units"
        """),
        ("Merge intervals", """
        intervals input = [[1, 3], [2, 6], [8, 10], [15, 18]]
        highlight input[0..1] orange
        intervals merged = [[1, 6], [8, 10], [15, 18]]
        highlight merged[0] green
        caption "Sort by start; extend the last interval while it overlaps"
        """),
        ("Reverse linked list", """
        list L = null <- 1 <- 2  3 -> 4 -> null
        pointer prev -> L[2] purple
        pointer curr -> L[3] green
        pointer next -> L[4] orange
        caption "curr.next = prev; prev = curr; curr = next"
        """),
        ("Cycle detection", """
        list L = 3 -> 2 -> 0 -> -4
        link L[3] -> L[1] "cycle" red
        pointer slow -> L[1] green
        pointer fast -> L[3] orange
        """),
        ("BST / LCA", """
        tree T = [6, 2, 8, 0, 4, 7, 9, null, null, 3, 5]
        path T.6 -> T.2 -> T.4 green
        highlight T.3, T.5 orange
        caption "LCA(3, 5) = 4: first node where they split"
        """),
        ("Top-k with a heap", """
        heap H = [2, 4, 3, 9, 7, 8]
        highlight H[0] green
        mark H.9 "k"
        caption "Min-heap of size k: the root is the k-th largest"
        """),
        ("Trie", """
        trie W = [cat, car, card, dog, do]
        path W.card green
        caption "Insert/search walk one node per character"
        """),
        ("Grid BFS", """
        grid g = [[S, ., #, .], [., ., #, .], [#, ., ., .], [., #, ., E]]
        highlight g[0][2], g[1][2], g[2][0], g[3][1] gray
        dim g[0][2], g[1][2], g[2][0], g[3][1]
        path g[0][0] -> g[1][0] -> g[1][1] -> g[2][1] -> g[2][2] -> g[2][3] -> g[3][3] green
        caption "BFS from S reaches E in 6 steps"
        """),
        ("Number of islands", """
        grid m = [[1, 1, 0, 0], [1, 0, 0, 1], [0, 0, 1, 1], [0, 0, 0, 1]]
        highlight m[0][0..1], m[1][0] green
        highlight m[1][3], m[2][2..3], m[3][3] orange
        caption "Flood-fill each unvisited 1 → 2 islands"
        """),
        ("Dijkstra", """
        graph G
        edge G A -> B 4
        edge G A -> C 1
        edge G C -> B 2
        edge G B -> D 1
        edge G C -> D 5
        mark G.A 0
        mark G.C 1
        mark G.B 3
        mark G.D 4
        path G.A -> G.C -> G.B -> G.D green
        caption "dist(D) = 4 via A → C → B → D"
        """),
        ("Topological sort", """
        graph D
        edge D math -> physics
        edge D math -> cs
        edge D cs -> ml
        edge D physics -> ml
        mark D.math 1
        mark D.cs 2
        mark D.physics 3
        mark D.ml 4
        """),
        ("Recursion tree", """
        graph F down
        edge F f4 -> f3
        edge F f4 -> f2
        edge F f3 -> f2#b
        edge F f3 -> f1
        edge F f2 -> f1#b
        edge F f2 -> f0
        highlight F.f2, F.f2#b orange
        caption "f(2) is computed twice → memoize"
        """),
        ("1-D DP", """
        array dp = [0, 1, 2, 3, 5, 8]
        arrow dp[3] -> dp[5]
        arrow dp[4] -> dp[5]
        highlight dp[5] green
        caption "dp[i] = dp[i-1] + dp[i-2]"
        """),
        ("LCS table", """
        grid dp = [[0, 0, 0, 0], [0, 1, 1, 1], [0, 1, 1, 2], [0, 1, 2, 2]]
        rows dp = [∅, a, b, c]
        cols dp = [∅, a, c, b]
        path dp[3][3] -> dp[2][2] -> dp[1][1] green
        caption "Trace back diagonals on matches → LCS = 2"
        """),
        ("Frequency map", """
        array words = [apple, kiwi, apple, fig]
        map count = {apple: 2, kiwi: 1, fig: 1}
        highlight count.apple green
        """),
        ("Union-Find", """
        graph P down
        edge P 1 -> 0
        edge P 2 -> 0
        edge P 4 -> 3
        edge P 5 -> 4
        highlight P.0, P.3 purple
        caption "Two components; roots 0 and 3"
        """),
        ("Trie with word badges (model-written)", """
        trie W = [cat, car, dog]
        mark W.cat "end"
        mark W.car "end"
        mark W.dog "end"
        """),
        ("Window + pointers below (model-written)", """
        string s = "abcabcbb"
        window s[1..3] "bca: 3 unique"
        pointer left -> s[1] green below
        pointer right -> s[3] orange below
        """),
        ("Interval pointer (model-written)", """
        intervals I = [[1, 3], [2, 6], [8, 10], [15, 18]]
        pointer i -> I[1] green
        highlight I[0..1] orange
        """),
        ("Undirected cycle", """
        graph U undirected
        edge U A -- B
        edge U B -- C
        edge U C -- D
        edge U D -- A
        edge U B -- E
        path U.A -> U.B -> U.C -> U.D -> U.A red
        """),
        ("High fidelity: Dijkstra step-through", """
        graph G right
        edge G 0 -> 1 4
        edge G 0 -> 2 1
        edge G 2 -> 1 2
        edge G 1 -> 3 1
        edge G 2 -> 3 5
        edge G 1 -> 4 7
        edge G 3 -> 4 3
        queue H "heap (smallest first)" = [(0, 0)]
        legend gray "distance not final" purple "popped, distance final" green "edge examined this step" ring "popped this step"
        step "Before the loop: only the source is in the heap"
        sub G.0 "dist 0"
        sub G.1 "dist ?"
        sub G.2 "dist ?"
        sub G.3 "dist ?"
        sub G.4 "dist ?"
        code "dist = {}"
        code "heap = [(0, 0)]   # (distance so far, node)"
        step "Pop 0 (dist 0): relax 0→1 = 4 and 0→2 = 1"
        queue H "heap (smallest first)" = [(1, 2), (4, 1)]
        highlight G.0 purple
        focus G.0
        sub G.0 "dist 0"
        sub G.1 "dist ≤ 4"
        sub G.2 "dist ≤ 1"
        sub G.3 "dist ?"
        sub G.4 "dist ?"
        path G.0 -> G.1 green
        path G.0 -> G.2 green
        code "d, node = heappop(heap)   ->  (0, 0)"
        step "Pop 2 (dist 1): 2→1 improves 1 to 3, 2→3 gives 6"
        queue H "heap (smallest first)" = [(3, 1), (4, 1), (6, 3)]
        highlight G.0 G.2 purple
        focus G.2
        sub G.0 "dist 0"
        sub G.1 "dist ≤ 3"
        sub G.2 "dist 1"
        sub G.3 "dist ≤ 6"
        sub G.4 "dist ?"
        path G.2 -> G.1 green
        path G.2 -> G.3 green
        code "d, node = heappop(heap)   ->  (1, 2)"
        """),
        ("High fidelity: preorder traversal", """
        tree T depths = [A, B, C, D, E, null, F, null, null, G]
        array out "output" = [A, B, D, E, G, C, F]
        legend gray "root" green "root's left subtree" orange "root's right subtree"
        highlight T.B T.D T.E T.G green
        highlight T.C T.F orange
        highlight out[1..4] green
        highlight out[5..6] orange
        mark T.A "#1"
        mark T.B "#2"
        mark T.D "#3"
        mark T.E "#4"
        mark T.G "#5"
        mark T.C "#6"
        mark T.F "#7"
        code "def dfs(node):"
        code "    if node is None: return"
        code "    visit(node)          # before both subtrees"
        code "    dfs(node.left); dfs(node.right)"
        """),
        ("High fidelity: two pointers (calc, vars, discard)", """
        array arr "arr (sorted)" = [1, 2, 4, 6, 8, 11, 15]
        legend blue "L" orange "R" red "discarded this step" green "answer"
        step "1 + 15 = 16 > 14 → move R left"
        tag "too big" orange
        why "15 is the largest value left; even with the smallest (1) the sum overshoots, so 15 can't be in any answer."
        pointer L -> arr[0] blue
        pointer R -> arr[6] orange
        discard arr[6]
        calc "{blue:1} + {orange:15} = 16 > {yellow:14}" "too big → discard 15, move R one step left" orange
        vars L=0 blue, R=6 orange, target=14 yellow
        code "s = arr[L] + arr[R]   ← s = 1 + 15 = 16"
        step "1 + 11 = 12 < 14 → move L right"
        tag "too small" blue
        why "1 is the smallest value left; even with the largest (11) the sum falls short, so 1 can't be in any answer."
        pointer L -> arr[0] blue
        pointer R -> arr[5] orange
        dim arr[6]
        discard arr[0]
        calc "{blue:1} + {orange:11} = 12 < {yellow:14}" "too small → discard 1, move L one step right" blue
        vars L=0 blue, R=5 orange, target=14 yellow
        code "s = arr[L] + arr[R]   ← s = 1 + 11 = 12"
        step "4 + 11 = 15… then 6 + 8 = 14 → found"
        tag "found" green
        pointer L -> arr[3] blue
        pointer R -> arr[4] orange
        highlight arr[3..4] green
        dim arr[0..2] arr[5..6]
        calc "{blue:6} + {orange:8} = 14 = {yellow:14}" "match → return (3, 4)" green
        vars L=3 blue, R=4 orange, target=14 yellow
        """),
        ("High fidelity: coin change (arcs into one cell)", """
        array dp "dp[a] (min coins)" = [0, 1, 2, 1, 1, ?, ?]
        legend orange "computing" blue "candidate source" green "winner" ring "this step"
        step "dp[5] = min(dp[4], dp[2], dp[1]) + 1 = 2"
        tag "fill" orange
        why "Try each coin c: the best way to make 5 ending in coin c is dp[5 − c] + 1."
        array dp "dp[a] (min coins)" = [0, 1, 2, 1, 1, 2, ?]
        highlight dp[5] orange
        highlight dp[2] blue
        highlight dp[1] green
        highlight dp[4] blue
        arrow dp[4] -> dp[5] "+1"
        arrow dp[2] -> dp[5] "+3"
        arrow dp[1] -> dp[5] "+4" green
        calc "min({blue:dp[4]+1}, {blue:dp[2]+1}, {green:dp[1]+1}) = {green:2}" "coin 4 wins: 4 + 1" green
        code "dp[a] = min(dp[a - c] + 1 for c in coins if c <= a)   ← dp[5] = 2"
        step "dp[6] = dp[3] + 1 = 2 (3 + 3), greedy would give 3"
        tag "fill" orange
        why "Greedy takes 4 first (4 + 1 + 1 = 3 coins); DP finds 3 + 3 = 2."
        array dp "dp[a] (min coins)" = [0, 1, 2, 1, 1, 2, 2]
        highlight dp[6] orange
        highlight dp[3] green
        arrow dp[3] -> dp[6] "+3" green
        calc "min({blue:dp[5]+1}, {green:dp[3]+1}, {blue:dp[2]+1}) = {green:2}" "coin 3 wins → answer 2" green
        code "return dp[amount]   ← 2"
        """),
        ("High fidelity: LCS grid (pending cells, neighbour arrows)", """
        grid dp "dp[i][j] = LCS of A[:i], B[:j]" = [[0, 0, 0, 0, 0, 0], [0, 0, 1, 1, ?, ?], [0, ?, ?, ?, ?, ?], [0, ?, ?, ?, ?, ?], [0, ?, ?, ?, ?, ?]]
        rows dp = [∅, B, D, C, B]
        cols dp = [∅, A, B, C, B, D]
        legend orange "current cell" green "diagonal (match +1)" blue "neighbours (max)" ring "this step"
        step "dp[1][3]: 'B' ≠ 'C' → max(dp[0][3], dp[1][2]) = 1"
        tag "fill row 1" orange
        why "Letters differ: drop one last letter and keep the better of the two."
        highlight dp[1][3] orange
        focus dp[1][3]
        highlight dp[0][3] dp[1][2] blue
        arrow dp[0][3] -> dp[1][3]
        arrow dp[1][2] -> dp[1][3]
        pending dp[1][4..5]
        pending dp[2..4][1..5]
        calc "max({blue:↑ 0}, {blue:← 1}) = {orange:1}" "B ≠ C → no +1" blue
        code "else: dp[i][j] = max(dp[i-1][j], dp[i][j-1])   ← 1"
        step "dp[1][4]: 'B' = 'B' → dp[0][3] + 1 = 1"
        tag "match" green
        why "Same last letter: it extends the best LCS without either letter by one."
        grid dp "dp[i][j] = LCS of A[:i], B[:j]" = [[0, 0, 0, 0, 0, 0], [0, 0, 1, 1, 1, ?], [0, ?, ?, ?, ?, ?], [0, ?, ?, ?, ?, ?], [0, ?, ?, ?, ?, ?]]
        highlight dp[1][4] orange
        focus dp[1][4]
        highlight dp[0][3] green
        arrow dp[0][3] -> dp[1][4] "+1" green
        pending dp[1][5]
        pending dp[2..4][1..5]
        calc "{green:↖ 0} + 1 = {orange:1}" "B = B → diagonal + 1" green
        code "if A[i-1] == B[j-1]: dp[i][j] = dp[i-1][j-1] + 1   ← 1"
        """),
        ("High fidelity: monotonic stack (bars + answer + stack)", """
        bars T "temps T[i]" = [73, 74, 75, 71, 69, 72, 76, 73]
        array ans "ans[i] = days to wait" = [0, ?, ?, ?, ?, ?, ?, ?]
        stack S "waiting days (top = most recent)" = [0]
        legend blue "today (i)" orange "waiting in stack" green "answered"
        step "Day 1 (74°) is warmer than day 0 (73°): pop 0, ans[0] = 1"
        tag "pop" green
        why "Everything on the stack is still waiting; a warmer day answers every colder one on top."
        array ans "ans[i] = days to wait" = [1, ?, ?, ?, ?, ?, ?, ?]
        stack S "waiting days (top = most recent)" = [1]
        pointer i -> T[1] blue
        highlight T[1] blue
        highlight T[0] green
        highlight ans[0] green
        arrow T[0] -> T[1] "+1" green
        pending T[2..7]
        vars i=1 blue, t=74 blue, stack=[1] orange
        calc "T[{orange:0}] = 73 < {blue:74}" "pop day 0 → ans[0] = 1 − 0 = 1" green
        code "while stack and T[stack[-1]] < t:   ← 73 < 74\\n    ans[j] = i - j   ← ans[0] = 1"
        step "Day 5 (72°) pops 69 and 71, then stops at 75 and waits"
        tag "pop" green
        why "72 answers every colder day on top of the stack; 75 is warmer, so it and everything under it keep waiting."
        array ans "ans[i] = days to wait" = [1, 1, ?, 2, 1, ?, ?, ?]
        stack S "waiting days (top = most recent)" = [2, 5]
        pointer i -> T[5] blue
        highlight T[5] blue
        highlight T[2] orange
        highlight T[3] T[4] green
        highlight ans[3] ans[4] green
        arrow T[4] -> T[5] "+1"
        arrow T[3] -> T[5] "+2"
        pending T[6..7]
        vars i=5 blue, t=72 blue, stack=[2, 5] orange
        calc "T[{orange:2}] = 75 < {blue:72}?" "no → stop popping, push day 5" orange
        code "stack.append(i)   ← stack = [2, 5]"
        """),
        ("High fidelity: reversing a list (vars, two-line code)", """
        list L = null <- 1  2 -> 3 -> 4 -> null
        legend green "reversed" blue "curr" orange "next" pending "not yet"
        step "Point 2 back at 1, then advance: prev = 2, curr = 3"
        tag "flip link" blue
        why "Save next first, or the rest of the list is lost when 2's pointer turns around."
        list L = null <- 1 <- 2  3 -> 4 -> null
        highlight L.1 L.2 green
        highlight L.3 blue
        pointer prev -> L.2 green
        pointer curr -> L.3 blue
        pointer next -> L.4 orange
        pending L.4
        vars prev=2 green, curr=3 blue, next=4 orange
        code "nxt = curr.next; curr.next = prev   ← 2.next = 1\\nprev, curr = curr, nxt   ← prev = 2, curr = 3"
        """),
        ("High fidelity: House Robber III", """
        tree T "pairs are (rob, skip)" = [3, 4, 5, 1, 3, null, 1]
        legend green "computed" ring "computing now"
        step "Leaves: rob = own value, skip = 0"
        highlight T[3] T[4] T[6] green
        sub T[3] "(1, 0)"
        sub T[4] "(3, 0)"
        sub T[6] "(1, 0)"
        code "rob = node.val + l.skip + r.skip"
        code "skip = max(l) + max(r)"
        step "Node 4: rob = 4 + 0 + 0 = 4, skip = 1 + 3 = 4"
        highlight T[3] T[4] T[6] green
        focus T[1]
        sub T[1] "(4, 4)"
        sub T[3] "(1, 0)"
        sub T[4] "(3, 0)"
        sub T[6] "(1, 0)"
        code "rob = 4 + 0 + 0 = 4"
        code "skip = max(1, 0) + max(3, 0) = 4"
        step "Root: rob = 3 + 4 + 1 = 8, skip = 4 + 5 = 9, answer 9"
        highlight T[1] T[2] T[3] T[4] T[6] green
        focus T[0]
        sub T[0] "(8, 9)"
        sub T[1] "(4, 4)"
        sub T[2] "(5, 1)"
        sub T[3] "(1, 0)"
        sub T[4] "(3, 0)"
        sub T[6] "(1, 0)"
        code "rob = 3 + 4 + 1 = 8"
        code "skip = max(4, 4) + max(5, 1) = 9   ->  answer 9"
        """),
        ("High fidelity: BFS (model-written)", """
        graph G undirected
        edge G A -- B
        edge G A -- C
        edge G B -- D
        edge G B -- E
        edge G C -- F
        queue Q "BFS queue" = [A]
        legend gray "not seen" green "queued" purple "visited" ring "this step"
        step "Start BFS at A"
        state G.A green
        step "Visit A; enqueue B and C"
        queue Q "BFS queue" = [B, C]
        state G.A purple
        state G.B G.C green
        focus G.A
        step "Visit B; enqueue D and E"
        queue Q "BFS queue" = [C, D, E]
        state G.B purple
        state G.D G.E green
        focus G.B
        step "Visit C; enqueue F"
        queue Q "BFS queue" = [D, E, F]
        state G.C purple
        state G.F green
        focus G.C
        step "Visit D, E, then F"
        queue Q "BFS queue" = []
        state G.D G.E G.F purple
        focus G.F
        """),
        ("Step-through: two pointers", """
        array a = [1, 3, 4, 6, 8, 11]
        step "Start at both ends: 1 + 11 = 12 > 10, so move right inward"
        pointer left -> a[0] green
        pointer right -> a[5] orange
        step "1 + 8 = 9 < 10, so move left inward"
        pointer left -> a[0] green
        pointer right -> a[4] orange
        dim a[5]
        step "3 + 8 = 11 > 10, so move right inward"
        pointer left -> a[1] green
        pointer right -> a[4] orange
        dim a[0] a[5]
        step "3 + 6 = 9 < 10, move left; then 4 + 6 = 10, found"
        pointer left -> a[2] green
        pointer right -> a[3] orange
        highlight a[2..3] green
        dim a[0..1] a[4..5]
        """),
        ("Step-through: reverse a linked list", """
        list L = 1 -> 2 -> 3 -> null
        step "prev = null, curr = 1"
        pointer curr -> L.1 orange
        step "Point 1 back at null, advance: prev = 1, curr = 2"
        list L = null <- 1  2 -> 3 -> null
        pointer prev -> L.1 blue
        pointer curr -> L.2 orange
        step "Point 2 back at 1, advance: prev = 2, curr = 3"
        list L = null <- 1 <- 2  3 -> null
        pointer prev -> L.2 blue
        pointer curr -> L.3 orange
        step "Point 3 back at 2; curr is null, so prev = 3 is the new head"
        list L = null <- 1 <- 2 <- 3
        pointer prev -> L.3 green
        """),
        ("Step-through: sliding window with map", """
        string s = "abcabb"
        step "Grow the window: a, b, c are all new"
        window s[0..2] "len 3" green
        map last = {a: 0, b: 1, c: 2}
        step "s[3] = a repeats at 0, so left jumps to 1"
        window s[1..3] "len 3" orange
        pointer left -> s[1] blue
        map last = {a: 3, b: 1, c: 2}
        step "s[4] = b repeats at 1, so left jumps to 2"
        window s[2..4] "len 3" orange
        pointer left -> s[2] blue
        map last = {a: 3, b: 4, c: 2}
        """),
        ("Flowchart: binary search", """
        flow F
        start F.begin "lo = 0, hi = n - 1"
        decision F.loop "lo <= hi?"
        node F.mid "mid = (lo + hi) // 2"
        decision F.eq "a[mid] == target?"
        end F.found "return mid"
        decision F.lt "a[mid] < target?"
        node F.right "lo = mid + 1"
        node F.left "hi = mid - 1"
        end F.miss "return -1"
        edge F begin -> loop
        edge F loop -> mid "yes"
        edge F loop -> miss "no"
        edge F mid -> eq
        edge F eq -> found "yes"
        edge F eq -> lt "no"
        edge F lt -> right "yes"
        edge F lt -> left "no"
        edge F right -> loop
        edge F left -> loop
        """),
        ("Flowchart: BFS", """
        flow B
        start B.init "queue = [start], seen = {start}"
        decision B.empty "queue empty?"
        node B.pop "node = queue.popleft()"
        node B.visit "for each unseen neighbor: mark seen, enqueue"
        end B.done "done"
        edge B init -> empty
        edge B empty -> pop "no"
        edge B empty -> done "yes"
        edge B pop -> visit
        edge B visit -> empty "loop"
        """),
        ("Step-through on a flowchart", """
        flow R
        start R.call "dfs(node)"
        decision R.base "node is None?"
        end R.ret0 "return 0"
        node R.rec "l = dfs(left), r = dfs(right)"
        end R.ret "return 1 + max(l, r)"
        edge R call -> base
        edge R base -> ret0 "yes"
        edge R base -> rec "no"
        edge R rec -> ret
        step "Check the base case first"
        highlight R.base orange
        step "Empty subtree: depth 0"
        path R.base -> R.ret0 green
        step "Otherwise recurse into both children"
        path R.base -> R.rec orange
        step "Combine: one more than the deeper child"
        path R.rec -> R.ret green
        """),
    ]

    /// Every pattern, rendered as one Markdown answer (`ALFRED_DEMO_KIND=diagrams`).
    static var gallery: String {
        "**Diagram gallery**\n\n" + diagrams.map { "**\($0.title)**\n\n```diagram\n\($0.source)\n```" }.joined(separator: "\n\n")
    }
}
