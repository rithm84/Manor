/** Cases for harnessLocal.ts: each interface feature with friendly inputs, expected answers, and a solution per offered language. */
import type { HarnessLanguage, ProblemInterface } from '../../supabase/functions/_shared/problemInterface.ts'

export interface HarnessCase {
  readonly name: string
  readonly spec: ProblemInterface
  readonly cases: readonly { readonly input: string; readonly expected?: string; readonly check?: (answer: unknown) => boolean }[]
  readonly solutions: Partial<Record<HarnessLanguage, string>>
}
const fn = (name: string, params: ProblemInterface extends never ? never : { name: string; type: string; shape?: string; ref?: string }[], returns: string, extra: Record<string, unknown> = {}): ProblemInterface => ({ kind: 'function', name, params, returns, output: { mode: 'return' }, ...extra }) as ProblemInterface

export const harnessCases: HarnessCase[] = [
  {
    name: 'plain-array', spec: fn('twoSum', [{ name: 'nums', type: 'int[]' }, { name: 'target', type: 'int' }], 'int[]'),
    cases: [{ input: '[2,7,11,15]\n9', expected: '[0,1]' }],
    solutions: {
      python: 'class Solution:\n    def twoSum(self, nums, target):\n        seen = {}\n        for i, x in enumerate(nums):\n            if target - x in seen: return [seen[target - x], i]\n            seen[x] = i\n',
      javascript: 'var twoSum = function(n, t) { const m = new Map(); for (let i = 0; i < n.length; i++) { if (m.has(t - n[i])) return [m.get(t - n[i]), i]; m.set(n[i], i); } };',
    },
  },
  {
    name: 'cycle-bool', spec: fn('hasCycle', [{ name: 'head', type: 'ListNode', shape: 'cycle:pos' }], 'bool', { hidden: [{ name: 'pos', type: 'int' }] }),
    cases: [{ input: '[3,2,0,-4]\n1', expected: 'true' }, { input: '[1]\n-1', expected: 'false' }, { input: '[]\n-1', expected: 'false' }],
    solutions: {
      python: 'class Solution:\n    def hasCycle(self, head):\n        slow = fast = head\n        while fast and fast.next:\n            slow, fast = slow.next, fast.next.next\n            if slow is fast: return True\n        return False\n',
      javascript: 'var hasCycle = function(head) { let s = head, f = head; while (f && f.next) { s = s.next; f = f.next.next; if (s === f) return true; } return false; };',
    },
  },
  {
    name: 'cycle-ref-index', spec: fn('detectCycle', [{ name: 'head', type: 'ListNode', shape: 'cycle:pos' }], 'ListNode', { hidden: [{ name: 'pos', type: 'int' }], output: { mode: 'return', ref: { param: 'head', by: 'index' } } }),
    cases: [{ input: '[3,2,0,-4]\n1', expected: '1' }, { input: '[1,2]\n0', expected: '0' }, { input: '[1]\n-1', expected: 'null' }],
    solutions: {
      python: 'class Solution:\n    def detectCycle(self, head):\n        slow = fast = head\n        while fast and fast.next:\n            slow, fast = slow.next, fast.next.next\n            if slow is fast:\n                p = head\n                while p is not slow: p, slow = p.next, slow.next\n                return p\n        return None\n',
      javascript: 'var detectCycle = function(head) { let s = head, f = head; while (f && f.next) { s = s.next; f = f.next.next; if (s === f) { let p = head; while (p !== s) { p = p.next; s = s.next; } return p; } } return null; };',
    },
  },
  {
    name: 'merge-ref-value', spec: fn('getIntersectionNode', [{ name: 'headA', type: 'ListNode' }, { name: 'headB', type: 'ListNode', shape: 'merge:headA:skipB:skipA' }], 'ListNode', { hidden: [{ name: 'intersectVal', type: 'int' }, { name: 'skipA', type: 'int' }, { name: 'skipB', type: 'int' }], output: { mode: 'return', ref: { param: 'headA', by: 'value' } } }),
    cases: [{ input: '[4,1,8,4,5]\n[5,6,1,8,4,5]\n8\n2\n3', expected: '8' }, { input: '[2,6,4]\n[1,5]\n0\n3\n2', expected: 'null' }],
    solutions: {
      python: 'class Solution:\n    def getIntersectionNode(self, headA, headB):\n        a, b = headA, headB\n        while a is not b:\n            a = a.next if a else headB\n            b = b.next if b else headA\n        return a\n',
      javascript: 'var getIntersectionNode = function(headA, headB) { let a = headA, b = headB; while (a !== b) { a = a ? a.next : headB; b = b ? b.next : headA; } return a; };',
    },
  },
  {
    name: 'circular-insert', spec: fn('insert', [{ name: 'head', type: 'SinglyListNode', shape: 'circular' }, { name: 'insertVal', type: 'int' }], 'SinglyListNode', { output: { mode: 'return', shape: 'circular' } }),
    cases: [{ input: '[3,4,1]\n2', expected: '[3,4,1,2]' }, { input: '[]\n1', expected: '[1]' }, { input: '[1]\n0', expected: '[1,0]' }],
    solutions: {
      python: 'class Solution:\n    def insert(self, head, insertVal):\n        node = Node(insertVal)\n        if head is None:\n            node.next = node\n            return node\n        p = head\n        while True:\n            if p.val <= insertVal <= p.next.val or (p.val > p.next.val and (insertVal >= p.val or insertVal <= p.next.val)) or p.next is head:\n                break\n            p = p.next\n        node.next = p.next; p.next = node\n        return head\n',
      javascript: 'var insert = function(head, insertVal) { const node = new _Node(insertVal); if (!head) { node.next = node; return node; } let p = head; while (true) { if ((p.val <= insertVal && insertVal <= p.next.val) || (p.val > p.next.val && (insertVal >= p.val || insertVal <= p.next.val)) || p.next === head) break; p = p.next; } node.next = p.next; p.next = node; return head; };',
    },
  },
  {
    name: 'multilevel', spec: fn('flatten', [{ name: 'head', type: 'MultilevelNode' }], 'MultilevelNode'),
    cases: [{ input: '[1,2,3,4,5,6,null,null,null,7,8,9,10,null,null,11,12]', expected: '[1,2,3,7,8,11,12,9,10,4,5,6]' }, { input: '[1,2,null,3]', expected: '[1,3,2]' }, { input: '[]', expected: '[]' }],
    solutions: {
      python: 'class Solution:\n    def flatten(self, head):\n        def walk(node):\n            last = None\n            while node:\n                nxt = node.next\n                if node.child:\n                    tail = walk(node.child)\n                    node.next = node.child; node.child.prev = node; node.child = None\n                    tail.next = nxt\n                    if nxt: nxt.prev = tail\n                    last = tail\n                else:\n                    last = node\n                node = nxt\n            return last\n        walk(head)\n        return head\n',
      javascript: 'var flatten = function(head) { const walk = node => { let last = null; while (node) { const nxt = node.next; if (node.child) { const tail = walk(node.child); node.next = node.child; node.child.prev = node; node.child = null; tail.next = nxt; if (nxt) nxt.prev = tail; last = tail; } else last = node; node = nxt; } return last; }; walk(head); return head; };',
    },
  },
  {
    name: 'doubly-ref-input', spec: fn('toArray', [{ name: 'node', type: 'DoublyListNode', ref: 'head' }], 'int[]', { hidden: [{ name: 'head', type: 'DoublyListNode' }] }),
    cases: [{ input: '3\n[1,2,3,4,5]', expected: '[1,2,3,4,5]' }, { input: '5\n[4,5,6]', expected: '[4,5,6]' }],
    solutions: {
      python: 'class Solution:\n    def toArray(self, node):\n        while node.prev: node = node.prev\n        out = []\n        while node: out.append(node.val); node = node.next\n        return out\n',
      javascript: 'var toArray = function(node) { while (node.prev) node = node.prev; const out = []; while (node) { out.push(node.val); node = node.next; } return out; };',
    },
  },
  {
    name: 'parent-flip', spec: fn('flipBinaryTree', [{ name: 'root', type: 'ParentNode' }, { name: 'leaf', type: 'ParentNode', ref: 'root' }], 'ParentNode'),
    cases: [{ input: '[3,5,1,6,2,0,8,null,null,7,4]\n7', expected: '[7,2,null,5,4,3,6,null,null,null,1,null,null,0,8]' }],
    solutions: {
      python: 'class Solution:\n    def flipBinaryTree(self, root, leaf):\n        cur = leaf; prev = None\n        while cur is not root:\n            parent = cur.parent\n            if cur.left: cur.right = cur.left\n            cur.left = parent\n            if parent.left is cur: parent.left = None\n            else: parent.right = None\n            cur.parent = prev; prev = cur; cur = parent\n        root.parent = prev\n        return leaf\n',
      javascript: 'var flipBinaryTree = function(root, leaf) { let cur = leaf, prev = null; while (cur !== root) { const parent = cur.parent; if (cur.left) cur.right = cur.left; cur.left = parent; if (parent.left === cur) parent.left = null; else parent.right = null; cur.parent = prev; prev = cur; cur = parent; } root.parent = prev; return leaf; };',
    },
  },
  {
    name: 'parent-lca', spec: fn('lowestCommonAncestor', [{ name: 'p', type: 'ParentNode', ref: 'root' }, { name: 'q', type: 'ParentNode', ref: 'root' }], 'ParentNode', { hidden: [{ name: 'root', type: 'ParentNode' }], output: { mode: 'return', ref: { param: 'root', by: 'value' } } }),
    cases: [{ input: '5\n1\n[3,5,1,6,2,0,8,null,null,7,4]', expected: '3' }, { input: '5\n4\n[3,5,1,6,2,0,8,null,null,7,4]', expected: '5' }],
    solutions: {
      python: 'class Solution:\n    def lowestCommonAncestor(self, p, q):\n        a, b = p, q\n        while a is not b:\n            a = a.parent if a.parent else q\n            b = b.parent if b.parent else p\n        return a\n',
      javascript: 'var lowestCommonAncestor = function(p, q) { let a = p, b = q; while (a !== b) { a = a.parent ? a.parent : q; b = b.parent ? b.parent : p; } return a; };',
    },
  },
  {
    name: 'clone-target', spec: fn('getTargetCopy', [{ name: 'original', type: 'TreeNode' }, { name: 'cloned', type: 'TreeNode' }, { name: 'target', type: 'TreeNode', ref: 'original' }], 'TreeNode', { output: { mode: 'return', ref: { param: 'cloned', by: 'value' } } }),
    cases: [{ input: '[7,4,3,null,null,6,19]\n[7,4,3,null,null,6,19]\n3', expected: '3' }],
    solutions: {
      python: 'class Solution:\n    def getTargetCopy(self, original, cloned, target):\n        if original is None: return None\n        if original is target: return cloned\n        return self.getTargetCopy(original.left, cloned.left, target) or self.getTargetCopy(original.right, cloned.right, target)\n',
      javascript: 'var getTargetCopy = function(o, c, t) { if (!o) return null; if (o === t) return c; return getTargetCopy(o.left, c.left, t) || getTargetCopy(o.right, c.right, t); };',
    },
  },
  {
    name: 'bst-circular-doubly', spec: fn('treeToDoublyList', [{ name: 'root', type: 'BiNode' }], 'BiNode', { output: { mode: 'return', shape: 'circularDoubly' } }),
    cases: [{ input: '[4,2,5,1,3]', expected: '[1,2,3,4,5]' }, { input: '[]', expected: '[]' }],
    solutions: {
      python: 'class Solution:\n    def treeToDoublyList(self, root):\n        if not root: return None\n        nodes = []\n        def walk(n):\n            if n: walk(n.left); nodes.append(n); walk(n.right)\n        walk(root)\n        for i, n in enumerate(nodes):\n            n.right = nodes[(i + 1) % len(nodes)]; n.left = nodes[i - 1]\n        return nodes[0]\n',
      javascript: 'var treeToDoublyList = function(root) { if (!root) return null; const nodes = []; const walk = n => { if (n) { walk(n.left); nodes.push(n); walk(n.right); } }; walk(root); nodes.forEach((n, i) => { n.right = nodes[(i + 1) % nodes.length]; n.left = nodes[(i - 1 + nodes.length) % nodes.length]; }); return nodes[0]; };',
    },
  },
  {
    name: 'quad', spec: fn('construct', [{ name: 'grid', type: 'int[][]' }], 'QuadNode'),
    cases: [{ input: '[[0,1],[1,0]]', expected: '[[0,1],[1,0],[1,1],[1,1],[1,0]]' }, { input: '[[1,1],[1,1]]', expected: '[[1,1]]' }],
    solutions: {
      python: 'class Solution:\n    def construct(self, grid):\n        def build(r, c, n):\n            v = grid[r][c]\n            if all(grid[i][j] == v for i in range(r, r + n) for j in range(c, c + n)): return Node(v == 1, True)\n            h = n // 2\n            node = Node(True, False)\n            node.topLeft, node.topRight, node.bottomLeft, node.bottomRight = build(r, c, h), build(r, c + h, h), build(r + h, c, h), build(r + h, c + h, h)\n            return node\n        return build(0, 0, len(grid))\n',
      javascript: 'var construct = function(grid) { const build = (r, c, n) => { const v = grid[r][c]; let same = true; for (let i = r; i < r + n; i++) for (let j = c; j < c + n; j++) if (grid[i][j] !== v) same = false; if (same) return new _Node(v === 1, true); const h = n / 2; const node = new _Node(true, false); node.topLeft = build(r, c, h); node.topRight = build(r, c + h, h); node.bottomLeft = build(r + h, c, h); node.bottomRight = build(r + h, c + h, h); return node; }; return build(0, 0, grid.length); };',
    },
  },
  {
    name: 'quad-input', spec: fn('intersect', [{ name: 'quadTree1', type: 'QuadNode' }, { name: 'quadTree2', type: 'QuadNode' }], 'QuadNode'),
    cases: [{ input: '[[0,1],[1,1],[1,1],[1,0],[1,0]]\n[[0,1],[1,1],[0,1],[1,1],[1,0],null,null,null,null,[1,0],[1,0],[1,1],[1,1]]', expected: '[[0,0],[1,1],[1,1],[1,1],[1,0]]' }],
    solutions: {
      python: 'class Solution:\n    def intersect(self, a, b):\n        if a.isLeaf: return Node(True, True) if a.val else b\n        if b.isLeaf: return Node(True, True) if b.val else a\n        kids = [self.intersect(x, y) for x, y in ((a.topLeft, b.topLeft), (a.topRight, b.topRight), (a.bottomLeft, b.bottomLeft), (a.bottomRight, b.bottomRight))]\n        if all(k.isLeaf for k in kids) and len({k.val for k in kids}) == 1: return Node(kids[0].val, True)\n        node = Node(False, False)\n        node.topLeft, node.topRight, node.bottomLeft, node.bottomRight = kids\n        return node\n',
    },
  },
  {
    name: 'random-tree-copy', spec: fn('copyRandomBinaryTree', [{ name: 'root', type: 'RandomTreeNode' }], 'NodeCopy'),
    cases: [{ input: '[[1,null],null,[4,3],[7,0]]', expected: '[[1,null],null,[4,3],[7,0]]' }, { input: '[]', expected: '[]' }],
    solutions: {
      python: 'class Solution:\n    def copyRandomBinaryTree(self, root):\n        made = {}\n        def copy(n):\n            if n is None: return None\n            if id(n) in made: return made[id(n)]\n            c = NodeCopy(n.val); made[id(n)] = c\n            c.left = copy(n.left); c.right = copy(n.right); c.random = copy(n.random)\n            return c\n        return copy(root)\n',
      javascript: 'var copyRandomBinaryTree = function(root) { const made = new Map(); const copy = n => { if (!n) return null; if (made.has(n)) return made.get(n); const c = new NodeCopy(n.val); made.set(n, c); c.left = copy(n.left); c.right = copy(n.right); c.random = copy(n.random); return c; }; return copy(root); };',
    },
  },
  {
    name: 'expression-chars', spec: fn('checkEquivalence', [{ name: 'root1', type: 'ExprNode' }, { name: 'root2', type: 'ExprNode' }], 'bool'),
    cases: [{ input: '["+","a","+",null,null,"b","c"]\n["+","+","a","b","c"]', expected: 'true' }, { input: '["+","a","b"]\n["+","a","c"]', expected: 'false' }],
    solutions: {
      python: 'class Solution:\n    def checkEquivalence(self, root1, root2):\n        def count(n, c):\n            if n is None: return\n            if n.val != "+": c[n.val] = c.get(n.val, 0) + 1\n            count(n.left, c); count(n.right, c)\n        a, b = {}, {}\n        count(root1, a); count(root2, b)\n        return a == b\n',
      javascript: 'var checkEquivalence = function(r1, r2) { const count = (n, c) => { if (!n) return; if (n.val !== "+") c[n.val] = (c[n.val] || 0) + 1; count(n.left, c); count(n.right, c); }; const a = {}, b = {}; count(r1, a); count(r2, b); const keys = new Set([...Object.keys(a), ...Object.keys(b)]); return [...keys].every(k => a[k] === b[k]); };',
    },
  },
  {
    name: 'rope', spec: fn('getKthCharacter', [{ name: 'root', type: 'RopeTreeNode' }, { name: 'k', type: 'int' }], 'char'),
    cases: [{ input: '[10,4,"abcpoe","g","rta"]\n6', expected: '"b"' }, { input: '["ropetree"]\n8', expected: '"e"' }],
    solutions: {
      python: 'class Solution:\n    def getKthCharacter(self, root, k):\n        def text(n):\n            if n is None: return ""\n            return n.val if n.len == 0 else text(n.left) + text(n.right)\n        return text(root)[k - 1]\n',
      javascript: 'var getKthCharacter = function(root, k) { const text = n => !n ? "" : n.len === 0 ? n.val : text(n.left) + text(n.right); return text(root)[k - 1]; };',
    },
  },
  {
    name: 'crosslink', spec: fn('correctBinaryTree', [{ name: 'root', type: 'TreeNode', shape: 'crosslink:fromNode:toNode' }], 'TreeNode', { hidden: [{ name: 'fromNode', type: 'int' }, { name: 'toNode', type: 'int' }] }),
    cases: [{ input: '[1,2,3]\n2\n3', expected: '[1,null,3]' }, { input: '[8,3,1,7,null,9,4,2,null,null,null,5,6]\n7\n4', expected: '[8,3,1,null,null,9,4,null,null,5,6]' }],
    solutions: {
      python: 'class Solution:\n    def correctBinaryTree(self, root):\n        level = [(root, None)]; seen = set()\n        while level:\n            nxt = []\n            for node, parent in level:\n                if node.right and id(node.right) in seen:\n                    if parent.left is node: parent.left = None\n                    else: parent.right = None\n                    return root\n                seen.add(id(node))\n            for node, parent in level:\n                if node.right: nxt.append((node.right, node))\n                if node.left: nxt.append((node.left, node))\n            for n, _ in nxt: seen.add(id(n))\n            level = nxt\n        return root\n',
    },
  },
  {
    name: 'leafring', spec: fn('heightOfTree', [{ name: 'root', type: 'TreeNode', shape: 'leafring' }], 'int'),
    cases: [{ input: '[1,2,3,null,null,4,5]', expected: '2' }, { input: '[1,2]', expected: '1' }, { input: '[1,2,3,null,null,4,null,5,6]', expected: '3' }],
    solutions: {
      python: 'class Solution:\n    def heightOfTree(self, root):\n        def h(n):\n            if n.left and n.left.right is n: return 0\n            if n.right and n.right.left is n: return 0\n            if not n.left and not n.right: return 0\n            return 1 + max(h(n.left) if n.left else -1, h(n.right) if n.right else -1)\n        return h(root)\n',
    },
  },
  {
    name: 'nary-nodes', spec: fn('findRoot', [{ name: 'tree', type: 'list<NaryNode>', shape: 'nodes' }], 'NaryNode'),
    cases: [{ input: '[1,null,3,2,4,null,5,6]', expected: '[1,null,3,2,4,null,5,6]' }],
    solutions: {
      python: 'class Solution:\n    def findRoot(self, tree):\n        x = 0\n        for n in tree:\n            x ^= n.val\n            for c in n.children: x ^= c.val\n        return next(n for n in tree if n.val == x)\n',
      javascript: 'var findRoot = function(tree) { let x = 0; for (const n of tree) { x ^= n.val; for (const c of n.children) x ^= c.val; } return tree.find(n => n.val === x); };',
    },
  },
  {
    name: 'records-employee', spec: fn('getImportance', [{ name: 'employees', type: 'list<Employee>' }, { name: 'id', type: 'int' }], 'int'),
    cases: [{ input: '[[1,5,[2,3]],[2,3,[]],[3,3,[]]]\n1', expected: '11' }],
    solutions: {
      python: 'class Solution:\n    def getImportance(self, employees, id):\n        m = {e.id: e for e in employees}\n        def total(i): return m[i].importance + sum(total(s) for s in m[i].subordinates)\n        return total(id)\n',
      javascript: 'var GetImportance = null; var getImportance = function(employees, id) { const m = new Map(employees.map(e => [e.id, e])); const total = i => m.get(i).importance + m.get(i).subordinates.reduce((a, s) => a + total(s), 0); return total(id); };',
    },
  },
  {
    name: 'records-interval', spec: fn('employeeFreeTime', [{ name: 'schedule', type: 'list<list<Interval>>' }], 'list<Interval>'),
    cases: [{ input: '[[[1,2],[5,6]],[[1,3]],[[4,10]]]', expected: '[[3,4]]' }],
    solutions: {
      python: 'class Solution:\n    def employeeFreeTime(self, schedule):\n        xs = sorted((i.start, i.end) for e in schedule for i in e)\n        out = []; end = xs[0][1]\n        for s, e in xs[1:]:\n            if s > end: out.append(Interval(end, s))\n            end = max(end, e)\n        return out\n',
      javascript: 'var employeeFreeTime = function(schedule) { const xs = schedule.flat().map(i => [i.start, i.end]).sort((a, b) => a[0] - b[0]); const out = []; let end = xs[0][1]; for (const [s, e] of xs.slice(1)) { if (s > end) out.push(new Interval(end, s)); end = Math.max(end, e); } return out; };',
    },
  },
  {
    name: 'nested-sum', spec: fn('depthSum', [{ name: 'nestedList', type: 'list<NestedInteger>' }], 'int'),
    cases: [{ input: '[[1,1],2,[1,1]]', expected: '10' }, { input: '[1,[4,[6]]]', expected: '27' }],
    solutions: {
      python: 'class Solution:\n    def depthSum(self, nestedList):\n        def walk(items, d): return sum(x.getInteger() * d if x.isInteger() else walk(x.getList(), d + 1) for x in items)\n        return walk(nestedList, 1)\n',
      javascript: 'var depthSum = function(nestedList) { const walk = (items, d) => items.reduce((a, x) => a + (x.isInteger() ? x.getInteger() * d : walk(x.getList(), d + 1)), 0); return walk(nestedList, 1); };',
    },
  },
  {
    name: 'nested-parse', spec: fn('deserialize', [{ name: 's', type: 'string' }], 'NestedInteger'),
    cases: [{ input: '"324"', expected: '324' }, { input: '"[123,[456,[789]]]"', expected: '[123,[456,[789]]]' }, { input: '"[]"', expected: '[]' }],
    solutions: {
      python: 'class Solution:\n    def deserialize(self, s):\n        def build(v):\n            if isinstance(v, int): return NestedInteger(v)\n            n = NestedInteger()\n            for x in v: n.add(build(x))\n            return n\n        return build(eval(s))\n',
      javascript: 'var deserialize = function(s) { const build = v => { if (typeof v === "number") return new NestedInteger(v); const n = new NestedInteger(); for (const x of v) n.add(build(x)); return n; }; return build(JSON.parse(s)); };',
    },
  },
  {
    name: 'nested-iterator', spec: { kind: 'class', className: 'NestedIterator', constructorParams: [{ name: 'nestedList', type: 'list<NestedInteger>' }], methods: [{ name: 'next', params: [], returns: 'int' }, { name: 'hasNext', params: [], returns: 'bool' }] },
    cases: [{ input: '["NestedIterator","hasNext","next","hasNext","next","hasNext","next","hasNext"]\n[[[[1,1],2]],[],[],[],[],[],[],[]]', expected: '[null,true,1,true,1,true,2,false]' }],
    solutions: {
      python: 'class NestedIterator:\n    def __init__(self, nestedList):\n        self.out = []\n        def walk(items):\n            for x in items:\n                if x.isInteger(): self.out.append(x.getInteger())\n                else: walk(x.getList())\n        walk(nestedList); self.i = 0\n    def next(self):\n        self.i += 1\n        return self.out[self.i - 1]\n    def hasNext(self):\n        return self.i < len(self.out)\n',
      javascript: 'class NestedIterator { constructor(list) { this.out = []; const walk = items => { for (const x of items) { if (x.isInteger()) this.out.push(x.getInteger()); else walk(x.getList()); } }; walk(list); this.i = 0; } next() { return this.out[this.i++]; } hasNext() { return this.i < this.out.length; } }',
    },
  },
  {
    name: 'self-object', spec: { kind: 'class', className: 'SparseVector', constructorParams: [{ name: 'nums', type: 'int[]' }], methods: [{ name: 'dotProduct', params: [{ name: 'vec', type: 'SparseVector' }], returns: 'int' }] },
    cases: [{ input: '["SparseVector","dotProduct"]\n[[[1,0,0,2,3]],[[[0,3,0,4,0]]]]', expected: '[null,8]' }],
    solutions: {
      python: 'class SparseVector:\n    def __init__(self, nums):\n        self.d = {i: x for i, x in enumerate(nums) if x}\n    def dotProduct(self, vec):\n        return sum(x * vec.d.get(i, 0) for i, x in self.d.items())\n',
      javascript: 'class SparseVector { constructor(nums) { this.d = new Map(); nums.forEach((x, i) => { if (x) this.d.set(i, x); }); } dotProduct(vec) { let s = 0; for (const [i, x] of this.d) s += x * (vec.d.get(i) || 0); return s; } }',
    },
  },
]

/** Compiled-language solutions, by case name; `@types` takes the starter code's definitions. */
const compiled: Record<string, Partial<Record<HarnessLanguage, string>>> = {
  'plain-array': {
    cpp: 'class Solution { public: vector<int> twoSum(vector<int>& n, int t) { unordered_map<int,int> m; for (int i = 0; i < (int)n.size(); i++) { if (m.count(t - n[i])) return {m[t - n[i]], i}; m[n[i]] = i; } return {}; } };',
  },
  'cycle-bool': {
    cpp: '@types\nclass Solution { public: bool hasCycle(ListNode* h) { ListNode *s = h, *f = h; while (f && f->next) { s = s->next; f = f->next->next; if (s == f) return true; } return false; } };',
  },
  'cycle-ref-index': {
    cpp: '@types\nclass Solution { public: ListNode* detectCycle(ListNode* h) { ListNode *s = h, *f = h; while (f && f->next) { s = s->next; f = f->next->next; if (s == f) { ListNode* p = h; while (p != s) { p = p->next; s = s->next; } return p; } } return nullptr; } };',
  },
  'merge-ref-value': {
    cpp: '@types\nclass Solution { public: ListNode* getIntersectionNode(ListNode* A, ListNode* B) { ListNode *a = A, *b = B; while (a != b) { a = a ? a->next : B; b = b ? b->next : A; } return a; } };',
  },
  'circular-insert': {
    cpp: '@types\nclass Solution { public: Node* insert(Node* head, int x) { Node* node = new Node(x); if (!head) { node->next = node; return node; } Node* p = head; while (true) { if ((p->val <= x && x <= p->next->val) || (p->val > p->next->val && (x >= p->val || x <= p->next->val)) || p->next == head) break; p = p->next; } node->next = p->next; p->next = node; return head; } };',
  },
  'multilevel': {
    cpp: '@types\nclass Solution { Node* walk(Node* node) { Node* last = nullptr; while (node) { Node* nxt = node->next; if (node->child) { Node* tail = walk(node->child); node->next = node->child; node->child->prev = node; node->child = nullptr; tail->next = nxt; if (nxt) nxt->prev = tail; last = tail; } else last = node; node = nxt; } return last; } public: Node* flatten(Node* head) { walk(head); return head; } };',
  },
  'doubly-ref-input': {
    cpp: '@types\nclass Solution { public: vector<int> toArray(Node* node) { while (node->prev) node = node->prev; vector<int> out; while (node) { out.push_back(node->val); node = node->next; } return out; } };',
  },
  'parent-flip': {
    cpp: '@types\nclass Solution { public: Node* flipBinaryTree(Node* root, Node* leaf) { Node* cur = leaf; Node* prev = nullptr; while (cur != root) { Node* parent = cur->parent; if (cur->left) cur->right = cur->left; cur->left = parent; if (parent->left == cur) parent->left = nullptr; else parent->right = nullptr; cur->parent = prev; prev = cur; cur = parent; } root->parent = prev; return leaf; } };',
  },
  'parent-lca': {
    cpp: '@types\nclass Solution { public: Node* lowestCommonAncestor(Node* p, Node* q) { Node *a = p, *b = q; while (a != b) { a = a->parent ? a->parent : q; b = b->parent ? b->parent : p; } return a; } };',
  },
  'clone-target': {
    cpp: '@types\nclass Solution { public: TreeNode* getTargetCopy(TreeNode* o, TreeNode* c, TreeNode* t) { if (!o) return nullptr; if (o == t) return c; TreeNode* l = getTargetCopy(o->left, c->left, t); return l ? l : getTargetCopy(o->right, c->right, t); } };',
  },
  'bst-circular-doubly': {
    cpp: '@types\nclass Solution { vector<Node*> nodes; void walk(Node* n) { if (n) { walk(n->left); nodes.push_back(n); walk(n->right); } } public: Node* treeToDoublyList(Node* root) { if (!root) return nullptr; walk(root); int k = nodes.size(); for (int i = 0; i < k; i++) { nodes[i]->right = nodes[(i + 1) % k]; nodes[i]->left = nodes[(i - 1 + k) % k]; } return nodes[0]; } };',
  },
  'quad': {
    cpp: '@types\nclass Solution { vector<vector<int>>* g; Node* build(int r, int c, int n) { int v = (*g)[r][c]; bool same = true; for (int i = r; i < r + n; i++) for (int j = c; j < c + n; j++) if ((*g)[i][j] != v) same = false; if (same) return new Node(v == 1, true); int h = n / 2; Node* node = new Node(true, false); node->topLeft = build(r, c, h); node->topRight = build(r, c + h, h); node->bottomLeft = build(r + h, c, h); node->bottomRight = build(r + h, c + h, h); return node; } public: Node* construct(vector<vector<int>>& grid) { g = &grid; return build(0, 0, grid.size()); } };',
  },
  'random-tree-copy': {
    cpp: '@types\nclass Solution { unordered_map<Node*, NodeCopy*> made; NodeCopy* copy(Node* n) { if (!n) return nullptr; if (made.count(n)) return made[n]; NodeCopy* c = new NodeCopy(n->val); made[n] = c; c->left = copy(n->left); c->right = copy(n->right); c->random = copy(n->random); return c; } public: NodeCopy* copyRandomBinaryTree(Node* root) { return copy(root); } };',
  },
  'expression-chars': {
    cpp: '@types\nclass Solution { void count(Node* n, map<char,int>& c) { if (!n) return; if (n->val != \'+\') c[n->val]++; count(n->left, c); count(n->right, c); } public: bool checkEquivalence(Node* a, Node* b) { map<char,int> x, y; count(a, x); count(b, y); return x == y; } };',
  },
  'rope': {
    cpp: '@types\nclass Solution { string text(RopeTreeNode* n) { if (!n) return ""; return n->len == 0 ? n->val : text(n->left) + text(n->right); } public: char getKthCharacter(RopeTreeNode* root, int k) { return text(root)[k - 1]; } };',
  },
  'nary-nodes': {
    cpp: '@types\nclass Solution { public: Node* findRoot(vector<Node*> tree) { int x = 0; for (Node* n : tree) { x ^= n->val; for (Node* c : n->children) x ^= c->val; } for (Node* n : tree) if (n->val == x) return n; return nullptr; } };',
  },
  'records-employee': {
    cpp: '@types\nclass Solution { unordered_map<int, Employee*> m; int total(int i) { int s = m[i]->importance; for (int x : m[i]->subordinates) s += total(x); return s; } public: int getImportance(vector<Employee*> employees, int id) { for (auto e : employees) m[e->id] = e; return total(id); } };',
  },
  'records-interval': {
    cpp: '@types\nclass Solution { public: vector<Interval> employeeFreeTime(vector<vector<Interval>> schedule) { vector<pair<int,int>> xs; for (auto& e : schedule) for (auto& i : e) xs.push_back({i.start, i.end}); sort(xs.begin(), xs.end()); vector<Interval> out; int end = xs[0].second; for (size_t k = 1; k < xs.size(); k++) { if (xs[k].first > end) out.push_back(Interval(end, xs[k].first)); end = max(end, xs[k].second); } return out; } };',
  },
  'nested-sum': {
    cpp: '@types\nclass Solution { int walk(const vector<NestedInteger>& items, int d) { int s = 0; for (auto& x : items) s += x.isInteger() ? x.getInteger() * d : walk(x.getList(), d + 1); return s; } public: int depthSum(vector<NestedInteger>& nestedList) { return walk(nestedList, 1); } };',
  },
  'nested-parse': {
    cpp: '@types\nclass Solution { size_t i = 0; NestedInteger parse(const string& s) { if (s[i] != \'[\') { size_t j = i; while (j < s.size() && (s[j] == \'-\' || isdigit(s[j]))) j++; int v = stoi(s.substr(i, j - i)); i = j; return NestedInteger(v); } NestedInteger n; i++; while (s[i] != \']\') { n.add(parse(s)); if (s[i] == \',\') i++; } i++; return n; } public: NestedInteger deserialize(string s) { i = 0; return parse(s); } };',
  },
  'nested-iterator': {
    cpp: '@types\nclass NestedIterator { vector<int> out; size_t i = 0; void walk(const vector<NestedInteger>& items) { for (auto& x : items) { if (x.isInteger()) out.push_back(x.getInteger()); else walk(x.getList()); } } public: NestedIterator(vector<NestedInteger>& nestedList) { walk(nestedList); } int next() { return out[i++]; } bool hasNext() { return i < out.size(); } };',
  },
  'self-object': {
    cpp: 'class SparseVector { public: unordered_map<int,int> d; SparseVector(vector<int>& nums) { for (int i = 0; i < (int)nums.size(); i++) if (nums[i]) d[i] = nums[i]; } int dotProduct(SparseVector& vec) { int s = 0; for (auto& [i, x] : d) if (vec.d.count(i)) s += x * vec.d[i]; return s; } };',
  },
  'crosslink': {
    cpp: '@types\nclass Solution { public: TreeNode* correctBinaryTree(TreeNode* root) { vector<pair<TreeNode*, TreeNode*>> level{{root, nullptr}}; unordered_set<TreeNode*> seen; while (!level.empty()) { for (auto [n, p] : level) { if (n->right && seen.count(n->right)) { if (p->left == n) p->left = nullptr; else p->right = nullptr; return root; } seen.insert(n); } vector<pair<TreeNode*, TreeNode*>> nxt; for (auto [n, p] : level) { if (n->right) nxt.push_back({n->right, n}); if (n->left) nxt.push_back({n->left, n}); } for (auto& [n, p] : nxt) seen.insert(n); level = nxt; } return root; } };',
  },
  'leafring': {
    cpp: '@types\nclass Solution { int h(TreeNode* n) { if ((n->left && n->left->right == n) || (n->right && n->right->left == n) || (!n->left && !n->right)) return 0; return 1 + max(n->left ? h(n->left) : -1, n->right ? h(n->right) : -1); } public: int heightOfTree(TreeNode* root) { return h(root); } };',
  },
}
for (const test of harnessCases) Object.assign(test.solutions, compiled[test.name] ?? {})

const java: Record<string, string> = {
  'plain-array': 'class Solution { public int[] twoSum(int[] n, int t) { HashMap<Integer,Integer> m = new HashMap<>(); for (int i = 0; i < n.length; i++) { if (m.containsKey(t - n[i])) return new int[]{m.get(t - n[i]), i}; m.put(n[i], i); } return null; } }',
  'cycle-bool': '@types\nclass Solution { public boolean hasCycle(ListNode h) { ListNode s = h, f = h; while (f != null && f.next != null) { s = s.next; f = f.next.next; if (s == f) return true; } return false; } }',
  'cycle-ref-index': '@types\nclass Solution { public ListNode detectCycle(ListNode h) { ListNode s = h, f = h; while (f != null && f.next != null) { s = s.next; f = f.next.next; if (s == f) { ListNode p = h; while (p != s) { p = p.next; s = s.next; } return p; } } return null; } }',
  'merge-ref-value': '@types\nclass Solution { public ListNode getIntersectionNode(ListNode A, ListNode B) { ListNode a = A, b = B; while (a != b) { a = a != null ? a.next : B; b = b != null ? b.next : A; } return a; } }',
  'circular-insert': '@types\nclass Solution { public Node insert(Node head, int x) { Node node = new Node(x); if (head == null) { node.next = node; return node; } Node p = head; while (true) { if ((p.val <= x && x <= p.next.val) || (p.val > p.next.val && (x >= p.val || x <= p.next.val)) || p.next == head) break; p = p.next; } node.next = p.next; p.next = node; return head; } }',
  'multilevel': '@types\nclass Solution { Node walk(Node node) { Node last = null; while (node != null) { Node nxt = node.next; if (node.child != null) { Node tail = walk(node.child); node.next = node.child; node.child.prev = node; node.child = null; tail.next = nxt; if (nxt != null) nxt.prev = tail; last = tail; } else last = node; node = nxt; } return last; } public Node flatten(Node head) { walk(head); return head; } }',
  'doubly-ref-input': '@types\nclass Solution { public int[] toArray(Node node) { while (node.prev != null) node = node.prev; ArrayList<Integer> out = new ArrayList<>(); while (node != null) { out.add(node.val); node = node.next; } return out.stream().mapToInt(x -> x).toArray(); } }',
  'parent-flip': '@types\nclass Solution { public Node flipBinaryTree(Node root, Node leaf) { Node cur = leaf, prev = null; while (cur != root) { Node parent = cur.parent; if (cur.left != null) cur.right = cur.left; cur.left = parent; if (parent.left == cur) parent.left = null; else parent.right = null; cur.parent = prev; prev = cur; cur = parent; } root.parent = prev; return leaf; } }',
  'parent-lca': '@types\nclass Solution { public Node lowestCommonAncestor(Node p, Node q) { Node a = p, b = q; while (a != b) { a = a.parent != null ? a.parent : q; b = b.parent != null ? b.parent : p; } return a; } }',
  'clone-target': '@types\nclass Solution { public final TreeNode getTargetCopy(final TreeNode o, final TreeNode c, final TreeNode t) { if (o == null) return null; if (o == t) return c; TreeNode l = getTargetCopy(o.left, c.left, t); return l != null ? l : getTargetCopy(o.right, c.right, t); } }',
  'bst-circular-doubly': '@types\nclass Solution { ArrayList<Node> nodes = new ArrayList<>(); void walk(Node n) { if (n != null) { walk(n.left); nodes.add(n); walk(n.right); } } public Node treeToDoublyList(Node root) { if (root == null) return null; walk(root); int k = nodes.size(); for (int i = 0; i < k; i++) { nodes.get(i).right = nodes.get((i + 1) % k); nodes.get(i).left = nodes.get((i - 1 + k) % k); } return nodes.get(0); } }',
  'quad': '@types\nclass Solution { int[][] g; Node build(int r, int c, int n) { int v = g[r][c]; boolean same = true; for (int i = r; i < r + n; i++) for (int j = c; j < c + n; j++) if (g[i][j] != v) same = false; if (same) return new Node(v == 1, true); int h = n / 2; Node node = new Node(true, false); node.topLeft = build(r, c, h); node.topRight = build(r, c + h, h); node.bottomLeft = build(r + h, c, h); node.bottomRight = build(r + h, c + h, h); return node; } public Node construct(int[][] grid) { g = grid; return build(0, 0, grid.length); } }',
  'random-tree-copy': '@types\nclass Solution { HashMap<Node, NodeCopy> made = new HashMap<>(); NodeCopy copy(Node n) { if (n == null) return null; if (made.containsKey(n)) return made.get(n); NodeCopy c = new NodeCopy(n.val); made.put(n, c); c.left = copy(n.left); c.right = copy(n.right); c.random = copy(n.random); return c; } public NodeCopy copyRandomBinaryTree(Node root) { return copy(root); } }',
  'expression-chars': '@types\nclass Solution { void count(Node n, int[] c) { if (n == null) return; if (n.val != \'+\') c[n.val]++; count(n.left, c); count(n.right, c); } public boolean checkEquivalence(Node a, Node b) { int[] x = new int[128], y = new int[128]; count(a, x); count(b, y); return Arrays.equals(x, y); } }',
  'rope': '@types\nclass Solution { String text(RopeTreeNode n) { if (n == null) return ""; return n.len == 0 ? n.val : text(n.left) + text(n.right); } public char getKthCharacter(RopeTreeNode root, int k) { return text(root).charAt(k - 1); } }',
  'nary-nodes': '@types\nclass Solution { public Node findRoot(List<Node> tree) { int x = 0; for (Node n : tree) { x ^= n.val; for (Node c : n.children) x ^= c.val; } for (Node n : tree) if (n.val == x) return n; return null; } }',
  'records-employee': '@types\nclass Solution { HashMap<Integer, Employee> m = new HashMap<>(); int total(int i) { int s = m.get(i).importance; for (int x : m.get(i).subordinates) s += total(x); return s; } public int getImportance(List<Employee> employees, int id) { for (Employee e : employees) m.put(e.id, e); return total(id); } }',
  'records-interval': '@types\nclass Solution { public List<Interval> employeeFreeTime(List<List<Interval>> schedule) { ArrayList<int[]> xs = new ArrayList<>(); for (List<Interval> e : schedule) for (Interval i : e) xs.add(new int[]{i.start, i.end}); xs.sort((a, b) -> a[0] - b[0]); ArrayList<Interval> out = new ArrayList<>(); int end = xs.get(0)[1]; for (int k = 1; k < xs.size(); k++) { if (xs.get(k)[0] > end) out.add(new Interval(end, xs.get(k)[0])); end = Math.max(end, xs.get(k)[1]); } return out; } }',
  'nested-sum': '@types\nclass Solution { int walk(List<NestedInteger> items, int d) { int s = 0; for (NestedInteger x : items) s += x.isInteger() ? x.getInteger() * d : walk(x.getList(), d + 1); return s; } public int depthSum(List<NestedInteger> nestedList) { return walk(nestedList, 1); } }',
  'nested-parse': '@types\nclass Solution { int i = 0; NestedInteger parse(String s) { if (s.charAt(i) != \'[\') { int j = i; while (j < s.length() && (s.charAt(j) == \'-\' || Character.isDigit(s.charAt(j)))) j++; int v = Integer.parseInt(s.substring(i, j)); i = j; return new NestedInteger(v); } NestedInteger n = new NestedInteger(); i++; while (s.charAt(i) != \']\') { n.add(parse(s)); if (s.charAt(i) == \',\') i++; } i++; return n; } public NestedInteger deserialize(String s) { i = 0; return parse(s); } }',
  'nested-iterator': '@types\nclass NestedIterator implements Iterator<Integer> { ArrayList<Integer> out = new ArrayList<>(); int i = 0; void walk(List<NestedInteger> items) { for (NestedInteger x : items) { if (x.isInteger()) out.add(x.getInteger()); else walk(x.getList()); } } public NestedIterator(List<NestedInteger> nestedList) { walk(nestedList); } public Integer next() { return out.get(i++); } public boolean hasNext() { return i < out.size(); } }',
  'self-object': 'class SparseVector { HashMap<Integer,Integer> d = new HashMap<>(); SparseVector(int[] nums) { for (int i = 0; i < nums.length; i++) if (nums[i] != 0) d.put(i, nums[i]); } public int dotProduct(SparseVector vec) { int s = 0; for (var e : d.entrySet()) s += e.getValue() * vec.d.getOrDefault(e.getKey(), 0); return s; } }',
  'crosslink': '@types\nclass Solution { public TreeNode correctBinaryTree(TreeNode root) { ArrayList<TreeNode[]> level = new ArrayList<>(); level.add(new TreeNode[]{root, null}); HashSet<TreeNode> seen = new HashSet<>(); while (!level.isEmpty()) { for (TreeNode[] e : level) { if (e[0].right != null && seen.contains(e[0].right)) { if (e[1].left == e[0]) e[1].left = null; else e[1].right = null; return root; } seen.add(e[0]); } ArrayList<TreeNode[]> nxt = new ArrayList<>(); for (TreeNode[] e : level) { if (e[0].right != null) nxt.add(new TreeNode[]{e[0].right, e[0]}); if (e[0].left != null) nxt.add(new TreeNode[]{e[0].left, e[0]}); } for (TreeNode[] e : nxt) seen.add(e[0]); level = nxt; } return root; } }',
  'leafring': '@types\nclass Solution { int h(TreeNode n) { if ((n.left != null && n.left.right == n) || (n.right != null && n.right.left == n) || (n.left == null && n.right == null)) return 0; return 1 + Math.max(n.left != null ? h(n.left) : -1, n.right != null ? h(n.right) : -1); } public int heightOfTree(TreeNode root) { return h(root); } }',
}
for (const test of harnessCases) if (java[test.name]) test.solutions.java = java[test.name]

const go: Record<string, string> = {
  'plain-array': 'package main\n\nfunc twoSum(n []int, t int) []int { m := map[int]int{}; for i, x := range n { if j, ok := m[t-x]; ok { return []int{j, i} }; m[x] = i }; return nil }\n',
  'cycle-bool': '@types\nfunc hasCycle(h *ListNode) bool { s, f := h, h; for f != nil && f.Next != nil { s = s.Next; f = f.Next.Next; if s == f { return true } }; return false }\n',
  'cycle-ref-index': '@types\nfunc detectCycle(h *ListNode) *ListNode { s, f := h, h; for f != nil && f.Next != nil { s = s.Next; f = f.Next.Next; if s == f { p := h; for p != s { p = p.Next; s = s.Next }; return p } }; return nil }\n',
  'merge-ref-value': '@types\nfunc getIntersectionNode(A, B *ListNode) *ListNode { a, b := A, B; for a != b { if a != nil { a = a.Next } else { a = B }; if b != nil { b = b.Next } else { b = A } }; return a }\n',
  'circular-insert': '@types\nfunc insert(head *Node, x int) *Node { node := &Node{Val: x}; if head == nil { node.Next = node; return node }; p := head; for { if (p.Val <= x && x <= p.Next.Val) || (p.Val > p.Next.Val && (x >= p.Val || x <= p.Next.Val)) || p.Next == head { break }; p = p.Next }; node.Next = p.Next; p.Next = node; return head }\n',
  'multilevel': '@types\nfunc walk(node *Node) *Node { var last *Node; for node != nil { nxt := node.Next; if node.Child != nil { tail := walk(node.Child); node.Next = node.Child; node.Child.Prev = node; node.Child = nil; tail.Next = nxt; if nxt != nil { nxt.Prev = tail }; last = tail } else { last = node }; node = nxt }; return last }\nfunc flatten(head *Node) *Node { walk(head); return head }\n',
  'doubly-ref-input': '@types\nfunc toArray(node *Node) []int { for node.Prev != nil { node = node.Prev }; out := []int{}; for node != nil { out = append(out, node.Val); node = node.Next }; return out }\n',
  'parent-flip': '@types\nfunc flipBinaryTree(root *Node, leaf *Node) *Node { cur := leaf; var prev *Node; for cur != root { parent := cur.Parent; if cur.Left != nil { cur.Right = cur.Left }; cur.Left = parent; if parent.Left == cur { parent.Left = nil } else { parent.Right = nil }; cur.Parent = prev; prev = cur; cur = parent }; root.Parent = prev; return leaf }\n',
  'parent-lca': '@types\nfunc lowestCommonAncestor(p *Node, q *Node) *Node { a, b := p, q; for a != b { if a.Parent != nil { a = a.Parent } else { a = q }; if b.Parent != nil { b = b.Parent } else { b = p } }; return a }\n',
  'clone-target': '@types\nfunc getTargetCopy(o, c, t *TreeNode) *TreeNode { if o == nil { return nil }; if o == t { return c }; if l := getTargetCopy(o.Left, c.Left, t); l != nil { return l }; return getTargetCopy(o.Right, c.Right, t) }\n',
  'bst-circular-doubly': '@types\nfunc treeToDoublyList(root *Node) *Node { if root == nil { return nil }; nodes := []*Node{}; var walk func(*Node); walk = func(n *Node) { if n != nil { walk(n.Left); nodes = append(nodes, n); walk(n.Right) } }; walk(root); k := len(nodes); for i := range nodes { nodes[i].Right = nodes[(i+1)%k]; nodes[i].Left = nodes[(i-1+k)%k] }; return nodes[0] }\n',
  'quad': '@types\nfunc construct(grid [][]int) *Node { var build func(r, c, n int) *Node; build = func(r, c, n int) *Node { v := grid[r][c]; same := true; for i := r; i < r+n; i++ { for j := c; j < c+n; j++ { if grid[i][j] != v { same = false } } }; if same { return &Node{Val: v == 1, IsLeaf: true} }; h := n / 2; return &Node{Val: true, TopLeft: build(r, c, h), TopRight: build(r, c+h, h), BottomLeft: build(r+h, c, h), BottomRight: build(r+h, c+h, h)} }; return build(0, 0, len(grid)) }\n',
  'random-tree-copy': '@types\nfunc copyRandomBinaryTree(root *Node) *NodeCopy { made := map[*Node]*NodeCopy{}; var copy func(*Node) *NodeCopy; copy = func(n *Node) *NodeCopy { if n == nil { return nil }; if c, ok := made[n]; ok { return c }; c := &NodeCopy{Val: n.Val}; made[n] = c; c.Left = copy(n.Left); c.Right = copy(n.Right); c.Random = copy(n.Random); return c }; return copy(root) }\n',
  'expression-chars': '@types\nfunc checkEquivalence(a *Node, b *Node) bool { count := func(r *Node) map[byte]int { m := map[byte]int{}; var f func(*Node); f = func(n *Node) { if n == nil { return }; if n.Val != 43 { m[n.Val]++ }; f(n.Left); f(n.Right) }; f(r); return m }; x, y := count(a), count(b); if len(x) != len(y) { return false }; for k, v := range x { if y[k] != v { return false } }; return true }\n',
  'rope': '@types\nfunc getKthCharacter(root *RopeTreeNode, k int) byte { var text func(*RopeTreeNode) string; text = func(n *RopeTreeNode) string { if n == nil { return "" }; if n.len == 0 { return n.val }; return text(n.left) + text(n.right) }; return text(root)[k-1] }\n',
  'nary-nodes': '@types\nfunc findRoot(tree []*Node) *Node { x := 0; for _, n := range tree { x ^= n.Val; for _, c := range n.Children { x ^= c.Val } }; for _, n := range tree { if n.Val == x { return n } }; return nil }\n',
  'records-employee': '@types\nfunc getImportance(employees []*Employee, id int) int { m := map[int]*Employee{}; for _, e := range employees { m[e.Id] = e }; var total func(int) int; total = func(i int) int { s := m[i].Importance; for _, x := range m[i].Subordinates { s += total(x) }; return s }; return total(id) }\n',
  'records-interval': '@types\nfunc employeeFreeTime(schedule [][]*Interval) []*Interval { xs := [][2]int{}; for _, e := range schedule { for _, i := range e { xs = append(xs, [2]int{i.Start, i.End}) } }; for a := 1; a < len(xs); a++ { for b := a; b > 0 && xs[b-1][0] > xs[b][0]; b-- { xs[b-1], xs[b] = xs[b], xs[b-1] } }; out := []*Interval{}; end := xs[0][1]; for _, x := range xs[1:] { if x[0] > end { out = append(out, &Interval{Start: end, End: x[0]}) }; if x[1] > end { end = x[1] } }; return out }\n',
  'nested-sum': '@types\nfunc depthSum(nestedList []*NestedInteger) int { var walk func([]*NestedInteger, int) int; walk = func(items []*NestedInteger, d int) int { s := 0; for _, x := range items { if x.IsInteger() { s += x.GetInteger() * d } else { s += walk(x.GetList(), d+1) } }; return s }; return walk(nestedList, 1) }\n',
  'nested-parse': '@types\nfunc deserialize(s string) *NestedInteger { i := 0; var parse func() NestedInteger; parse = func() NestedInteger { n := NestedInteger{}; if s[i] != 91 { j := i; for j < len(s) && (s[j] == 45 || (s[j] >= 48 && s[j] <= 57)) { j++ }; v, sign := 0, 1; for k := i; k < j; k++ { if s[k] == 45 { sign = -1 } else { v = v*10 + int(s[k]-48) } }; v *= sign; i = j; n.SetInteger(v); return n }; i++; for s[i] != 93 { n.Add(parse()); if s[i] == 44 { i++ } }; i++; return n }; r := parse(); return &r }\n',
  'nested-iterator': '@types\ntype NestedIterator struct { out []int; i int }\nfunc Constructor(nestedList []*NestedInteger) *NestedIterator { it := &NestedIterator{}; var walk func([]*NestedInteger); walk = func(items []*NestedInteger) { for _, x := range items { if x.IsInteger() { it.out = append(it.out, x.GetInteger()) } else { walk(x.GetList()) } } }; walk(nestedList); return it }\nfunc (this *NestedIterator) Next() int { this.i++; return this.out[this.i-1] }\nfunc (this *NestedIterator) HasNext() bool { return this.i < len(this.out) }\n',
  'self-object': 'package main\n\ntype SparseVector struct { d map[int]int }\nfunc Constructor(nums []int) SparseVector { d := map[int]int{}; for i, x := range nums { if x != 0 { d[i] = x } }; return SparseVector{d} }\nfunc (this *SparseVector) DotProduct(vec SparseVector) int { s := 0; for i, x := range this.d { s += x * vec.d[i] }; return s }\n',
  'crosslink': '@types\nfunc correctBinaryTree(root *TreeNode) *TreeNode { type e struct{ n, p *TreeNode }; level := []e{{root, nil}}; seen := map[*TreeNode]bool{}; for len(level) > 0 { for _, x := range level { if x.n.Right != nil && seen[x.n.Right] { if x.p.Left == x.n { x.p.Left = nil } else { x.p.Right = nil }; return root }; seen[x.n] = true }; nxt := []e{}; for _, x := range level { if x.n.Right != nil { nxt = append(nxt, e{x.n.Right, x.n}) }; if x.n.Left != nil { nxt = append(nxt, e{x.n.Left, x.n}) } }; for _, x := range nxt { seen[x.n] = true }; level = nxt }; return root }\n',
  'leafring': '@types\nfunc heightOfTree(root *TreeNode) int { var h func(*TreeNode) int; h = func(n *TreeNode) int { if (n.Left != nil && n.Left.Right == n) || (n.Right != nil && n.Right.Left == n) || (n.Left == nil && n.Right == nil) { return 0 }; best := -1; if n.Left != nil { best = h(n.Left) }; if n.Right != nil { if r := h(n.Right); r > best { best = r } }; return 1 + best }; return h(root) }\n',
}
for (const test of harnessCases) if (go[test.name]) test.solutions.go = go[test.name]

const guessInteractor = "def start(case):\n    global pick, calls\n    pick = case['pick']; calls = 0\ndef call(handle, method, args):\n    global calls\n    calls += 1\n    if calls > 32: raise Abort('Too many guesses')\n    num = args[0]\n    return 0 if num == pick else (-1 if num > pick else 1)\n"
const guessSpec = fn('guessNumber', [{ name: 'n', type: 'int' }], 'int', { hidden: [{ name: 'pick', type: 'int' }], apis: [{ name: 'GuessGame', global: true, methods: [{ name: 'guess', params: [{ name: 'num', type: 'int' }], returns: 'int' }] }], interactor: guessInteractor })
const mountainSpec = fn('findInMountainArray', [{ name: 'target', type: 'int' }, { name: 'mountainArr', type: 'MountainArray' }], 'int', { hidden: [{ name: 'array', type: 'int[]' }], apis: [{ name: 'MountainArray', methods: [{ name: 'get', params: [{ name: 'index', type: 'int' }], returns: 'int' }, { name: 'length', params: [], returns: 'int' }] }], interactor: "def start(case):\n    global data, calls\n    data = case['array']; calls = 0\ndef call(handle, method, args):\n    global calls\n    assert handle == 'mountainArr'\n    if method == 'length': return len(data)\n    calls += 1\n    if calls > 100: raise Abort('More than 100 calls to get')\n    return data[args[0]]\n" })
const read4Api = { name: 'Reader4', global: true, methods: [{ name: 'read4', params: [{ name: 'buf4', type: 'buffer' }], returns: 'int' }] }
const read4Interactor = "def start(case):\n    global text, at\n    text = case['file']; at = 0\ndef call(handle, method, args):\n    global at\n    chunk = text[at:at + 4]; at += len(chunk)\n    return Reply(len(chunk), {0: chunk})\n"
const read4Spec: ProblemInterface = { kind: 'function', name: 'read', params: [{ name: 'buf', type: 'buffer' }, { name: 'n', type: 'int' }], returns: 'int', output: { mode: 'prefix', param: 'buf' }, hidden: [{ name: 'file', type: 'string' }], apis: [read4Api], interactor: read4Interactor }
const read4ClassSpec: ProblemInterface = { kind: 'class', className: 'Solution', constructorParams: [], methods: [{ name: 'read', params: [{ name: 'buf', type: 'buffer' }, { name: 'n', type: 'int' }], returns: 'int', output: { mode: 'prefix', param: 'buf' } }], hidden: [{ name: 'file', type: 'string' }], apis: [read4Api], interactor: read4Interactor }
const immutableSpec = fn('printLinkedListInReverse', [{ name: 'head', type: 'ImmutableListNode' }], 'void', { hidden: [{ name: 'values', type: 'int[]' }], apis: [{ name: 'ImmutableListNode', pointer: true, methods: [{ name: 'printValue', params: [], returns: 'void' }, { name: 'getNext', params: [], returns: 'ImmutableListNode' }] }], interactor: "def start(case):\n    global values, printed\n    values = case['values']; printed = []\ndef call(handle, method, args):\n    at = 0 if handle == 'head' else handle\n    if method == 'printValue': printed.append(values[at]); return None\n    return at + 1 if at + 1 < len(values) else None\ndef finish(result):\n    return printed\n" })
const crawlerSpec = fn('crawl', [{ name: 'startUrl', type: 'string' }, { name: 'htmlParser', type: 'HtmlParser' }], 'list<string>', { languages: ['cpp', 'python', 'java', 'go'], hidden: [{ name: 'urls', type: 'string[]' }, { name: 'edges', type: 'int[][]' }], apis: [{ name: 'HtmlParser', methods: [{ name: 'getUrls', params: [{ name: 'url', type: 'string' }], returns: 'list<string>' }] }], interactor: "def start(case):\n    global links\n    urls = case['urls']; links = {u: [] for u in urls}\n    for a, b in case['edges']: links[urls[a]].append(urls[b])\ndef call(handle, method, args):\n    return links.get(args[0], [])\n" })
const sorted = (expected: string[]) => (answer: unknown) => Array.isArray(answer) && JSON.stringify([...answer].sort()) === JSON.stringify([...expected].sort())
const crawlerCase = { input: '"http://news.example.com/news/topics/"\n["http://news.example.com","http://news.example.com/news","http://news.example.com/news/topics/","http://news.example.org","http://news.example.com/us"]\n[[2,0],[2,1],[3,2],[3,1],[0,4]]', check: sorted(['http://news.example.com', 'http://news.example.com/news', 'http://news.example.com/news/topics/', 'http://news.example.com/us']) }

harnessCases.push(
  { name: 'api-global', spec: guessSpec, cases: [{ input: '10\n6', expected: '6' }, { input: '1\n1', expected: '1' }, { input: '2147483647\n2147483647', expected: '2147483647' }], solutions: {
    python: 'class Solution:\n    def guessNumber(self, n):\n        lo, hi = 1, n\n        while True:\n            mid = (lo + hi) // 2\n            r = guess(mid)\n            if r == 0: return mid\n            if r < 0: hi = mid - 1\n            else: lo = mid + 1\n',
    javascript: 'var guessNumber = function(n) { let lo = 1, hi = n; while (true) { const mid = Math.floor((lo + hi) / 2); const r = guess(mid); if (r === 0) return mid; if (r < 0) hi = mid - 1; else lo = mid + 1; } };',
    cpp: 'class Solution { public: int guessNumber(int n) { long long lo = 1, hi = n; while (true) { long long mid = (lo + hi) / 2; int r = guess((int)mid); if (r == 0) return mid; if (r < 0) hi = mid - 1; else lo = mid + 1; } } };',
    java: 'public class Solution extends GuessGame { public int guessNumber(int n) { long lo = 1, hi = n; while (true) { long mid = (lo + hi) / 2; int r = guess((int) mid); if (r == 0) return (int) mid; if (r < 0) hi = mid - 1; else lo = mid + 1; } } }',
    go: 'package main\n\nfunc guessNumber(n int) int { lo, hi := 1, n; for { mid := (lo + hi) / 2; r := guess(mid); if r == 0 { return mid }; if r < 0 { hi = mid - 1 } else { lo = mid + 1 } } }\n',
  } },
  { name: 'api-abort', spec: guessSpec, cases: [{ input: '100\n90', expected: '"Too many guesses"' }, { input: '10\n3', expected: '3' }], solutions: {
    python: 'class Solution:\n    def guessNumber(self, n):\n        for i in range(1, n + 1):\n            if guess(i) == 0: return i\n',
    javascript: 'var guessNumber = function(n) { for (let i = 1; i <= n; i++) if (guess(i) === 0) return i; };',
    cpp: 'class Solution { public: int guessNumber(int n) { for (int i = 1; i <= n; i++) if (guess(i) == 0) return i; return -1; } };',
    java: 'public class Solution extends GuessGame { public int guessNumber(int n) { for (int i = 1; i <= n; i++) if (guess(i) == 0) return i; return -1; } }',
    go: 'package main\n\nfunc guessNumber(n int) int { for i := 1; i <= n; i++ { if guess(i) == 0 { return i } }; return -1 }\n',
  } },
  { name: 'api-object', spec: mountainSpec, cases: [{ input: '3\n[1,2,3,4,5,3,1]', expected: '2' }, { input: '3\n[0,1,2,4,2,1]', expected: '-1' }], solutions: {
    python: 'class Solution:\n    def findInMountainArray(self, target, mountainArr):\n        n = mountainArr.length(); lo, hi = 0, n - 1\n        while lo < hi:\n            m = (lo + hi) // 2\n            if mountainArr.get(m) < mountainArr.get(m + 1): lo = m + 1\n            else: hi = m\n        peak = lo\n        def search(lo, hi, up):\n            while lo <= hi:\n                m = (lo + hi) // 2; v = mountainArr.get(m)\n                if v == target: return m\n                if (v < target) == up: lo = m + 1\n                else: hi = m - 1\n            return -1\n        r = search(0, peak, True)\n        return r if r >= 0 else search(peak + 1, n - 1, False)\n',
    javascript: 'var findInMountainArray = function(target, a) { const n = a.length(); let lo = 0, hi = n - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (a.get(m) < a.get(m + 1)) lo = m + 1; else hi = m; } const peak = lo; const search = (lo, hi, up) => { while (lo <= hi) { const m = (lo + hi) >> 1, v = a.get(m); if (v === target) return m; if ((v < target) === up) lo = m + 1; else hi = m - 1; } return -1; }; const r = search(0, peak, true); return r >= 0 ? r : search(peak + 1, n - 1, false); };',
    cpp: 'class Solution { public: int findInMountainArray(int target, MountainArray& a) { int n = a.length(), lo = 0, hi = n - 1; while (lo < hi) { int m = (lo + hi) / 2; if (a.get(m) < a.get(m + 1)) lo = m + 1; else hi = m; } int peak = lo; auto search = [&](int lo, int hi, bool up) { while (lo <= hi) { int m = (lo + hi) / 2, v = a.get(m); if (v == target) return m; if ((v < target) == up) lo = m + 1; else hi = m - 1; } return -1; }; int r = search(0, peak, true); return r >= 0 ? r : search(peak + 1, n - 1, false); } };',
    java: 'class Solution { int target; MountainArray a; int search(int lo, int hi, boolean up) { while (lo <= hi) { int m = (lo + hi) / 2, v = a.get(m); if (v == target) return m; if ((v < target) == up) lo = m + 1; else hi = m - 1; } return -1; } public int findInMountainArray(int target, MountainArray a) { this.target = target; this.a = a; int n = a.length(), lo = 0, hi = n - 1; while (lo < hi) { int m = (lo + hi) / 2; if (a.get(m) < a.get(m + 1)) lo = m + 1; else hi = m; } int r = search(0, lo, true); return r >= 0 ? r : search(lo + 1, n - 1, false); } }',
    go: 'package main\n\nfunc findInMountainArray(target int, a *MountainArray) int { n := a.Length(); lo, hi := 0, n-1; for lo < hi { m := (lo + hi) / 2; if a.Get(m) < a.Get(m+1) { lo = m + 1 } else { hi = m } }; peak := lo; search := func(lo, hi int, up bool) int { for lo <= hi { m := (lo + hi) / 2; v := a.Get(m); if v == target { return m }; if (v < target) == up { lo = m + 1 } else { hi = m - 1 } }; return -1 }; if r := search(0, peak, true); r >= 0 { return r }; return search(peak+1, n-1, false) }\n',
  } },
  { name: 'api-buffer', spec: read4Spec, cases: [{ input: '4\n4\n"abc"', expected: '"abc"' }, { input: '5\n5\n"abcde"', expected: '"abcde"' }, { input: '1\n1\n"abcdABCD1234"', expected: '"a"' }, { input: '12\n12\n"leetcode"', expected: '"leetcode"' }], solutions: {
    python: 'class Solution:\n    def read(self, buf, n):\n        total = 0; tmp = [""] * 4\n        while total < n:\n            k = read4(tmp)\n            if k == 0: break\n            for i in range(min(k, n - total)): buf[total] = tmp[i]; total += 1\n        return total\n',
    javascript: 'var read = function(buf, n) { let total = 0; const tmp = new Array(4); while (total < n) { const k = read4(tmp); if (k === 0) break; const m = Math.min(k, n - total); for (let i = 0; i < m; i++) buf[total++] = tmp[i]; } return total; };',
    cpp: 'class Solution { public: int read(char* buf, int n) { int total = 0; char tmp[4]; while (total < n) { int k = read4(tmp); if (k == 0) break; int m = min(k, n - total); for (int i = 0; i < m; i++) buf[total++] = tmp[i]; } return total; } };',
    java: 'public class Solution extends Reader4 { public int read(char[] buf, int n) { int total = 0; char[] tmp = new char[4]; while (total < n) { int k = read4(tmp); if (k == 0) break; int m = Math.min(k, n - total); for (int i = 0; i < m; i++) buf[total++] = tmp[i]; } return total; } }',
    go: 'package main\n\nfunc read(buf []byte, n int) int { total := 0; tmp := make([]byte, 4); for total < n { k := read4(tmp); if k == 0 { break }; for i := 0; i < k && total < n; i++ { buf[total] = tmp[i]; total++ } }; return total }\n',
  } },
  { name: 'api-buffer-class', spec: read4ClassSpec, cases: [{ input: '["Solution","read","read","read"]\n[[],[1,1],[2,2],[1,1]]\n"abc"', expected: '[null,"a","bc",""]' }], solutions: {
    python: 'class Solution:\n    def __init__(self):\n        self.queue = []\n    def read(self, buf, n):\n        total = 0\n        while total < n:\n            if not self.queue:\n                tmp = [""] * 4; k = read4(tmp)\n                if k == 0: break\n                self.queue = tmp[:k]\n            buf[total] = self.queue.pop(0); total += 1\n        return total\n',
    javascript: 'class Solution { constructor() { this.q = []; } read(buf, n) { let total = 0; while (total < n) { if (this.q.length === 0) { const tmp = new Array(4); const k = read4(tmp); if (k === 0) break; this.q = tmp.slice(0, k); } buf[total++] = this.q.shift(); } return total; } }',
    cpp: 'class Solution { deque<char> q; public: int read(char* buf, int n) { int total = 0; while (total < n) { if (q.empty()) { char tmp[4]; int k = read4(tmp); if (k == 0) break; for (int i = 0; i < k; i++) q.push_back(tmp[i]); } buf[total++] = q.front(); q.pop_front(); } return total; } };',
    java: 'public class Solution extends Reader4 { ArrayDeque<Character> q = new ArrayDeque<>(); public int read(char[] buf, int n) { int total = 0; while (total < n) { if (q.isEmpty()) { char[] tmp = new char[4]; int k = read4(tmp); if (k == 0) break; for (int i = 0; i < k; i++) q.add(tmp[i]); } buf[total++] = q.poll(); } return total; } }',
    go: 'package main\n\ntype Solution struct { q []byte }\nfunc Constructor() Solution { return Solution{} }\nfunc (this *Solution) Read(buf []byte, n int) int { total := 0; for total < n { if len(this.q) == 0 { tmp := make([]byte, 4); k := read4(tmp); if k == 0 { break }; this.q = append(this.q, tmp[:k]...) }; buf[total] = this.q[0]; this.q = this.q[1:]; total++ }; return total }\n',
  } },
  { name: 'api-returned-object', spec: immutableSpec, cases: [{ input: '[1,2,3,4]', expected: '[4,3,2,1]' }, { input: '[-2,0,6,4,4,-6]', expected: '[-6,4,4,6,0,-2]' }], solutions: {
    python: 'class Solution:\n    def printLinkedListInReverse(self, head):\n        if head:\n            self.printLinkedListInReverse(head.getNext())\n            head.printValue()\n',
    javascript: 'var printLinkedListInReverse = function(head) { if (head) { printLinkedListInReverse(head.getNext()); head.printValue(); } };',
    cpp: 'class Solution { public: void printLinkedListInReverse(ImmutableListNode* head) { if (head) { printLinkedListInReverse(head->getNext()); head->printValue(); } } };',
    java: 'class Solution { public void printLinkedListInReverse(ImmutableListNode head) { if (head != null) { printLinkedListInReverse(head.getNext()); head.printValue(); } } }',
    go: 'package main\n\nfunc printLinkedListInReverse(head *ImmutableListNode) { if head != nil { printLinkedListInReverse(head.GetNext()); head.PrintValue() } }\n',
  } },
  { name: 'api-threads', spec: crawlerSpec, cases: [crawlerCase], solutions: {
    python: 'import threading\nclass Solution:\n    def crawl(self, startUrl, htmlParser):\n        host = startUrl.split("/")[2]; seen = {startUrl}; lock = threading.Lock(); frontier = [startUrl]\n        while frontier:\n            found = []\n            def work(u):\n                for v in htmlParser.getUrls(u):\n                    with lock:\n                        if v.split("/")[2] == host and v not in seen: seen.add(v); found.append(v)\n            ts = [threading.Thread(target=work, args=(u,)) for u in frontier]\n            for t in ts: t.start()\n            for t in ts: t.join()\n            frontier = found\n        return list(seen)\n',
    cpp: 'class Solution { public: vector<string> crawl(string startUrl, HtmlParser& p) { auto host = [](const string& u) { return u.substr(7, u.find(\'/\', 7) == string::npos ? string::npos : u.find(\'/\', 7) - 7); }; string h = host(startUrl); unordered_set<string> seen{startUrl}; mutex m; vector<string> frontier{startUrl}; while (!frontier.empty()) { vector<string> found; vector<thread> ts; for (auto& u : frontier) ts.emplace_back([&, u]() { for (auto& v : p.getUrls(u)) { lock_guard<mutex> g(m); if (host(v) == h && seen.insert(v).second) found.push_back(v); } }); for (auto& t : ts) t.join(); frontier = found; } return vector<string>(seen.begin(), seen.end()); } };',
    java: 'class Solution { static String host(String u) { return u.split("/")[2]; } public List<String> crawl(String startUrl, HtmlParser p) { String h = host(startUrl); Set<String> seen = Collections.synchronizedSet(new HashSet<>(List.of(startUrl))); List<String> frontier = List.of(startUrl); while (!frontier.isEmpty()) { List<String> found = Collections.synchronizedList(new ArrayList<>()); List<Thread> ts = new ArrayList<>(); for (String u : frontier) { Thread t = new Thread(() -> { for (String v : p.getUrls(u)) if (host(v).equals(h) && seen.add(v)) found.add(v); }); t.start(); ts.add(t); } for (Thread t : ts) { try { t.join(); } catch (InterruptedException e) { throw new RuntimeException(e); } } frontier = new ArrayList<>(found); } return new ArrayList<>(seen); } }',
    go: 'package main\n\nimport (\n\t"strings"\n\t"sync"\n)\n\nfunc crawl(startUrl string, p *HtmlParser) []string { host := func(u string) string { return strings.Split(u, "/")[2] }; h := host(startUrl); seen := map[string]bool{startUrl: true}; var m sync.Mutex; frontier := []string{startUrl}; for len(frontier) > 0 { found := []string{}; var g sync.WaitGroup; for _, u := range frontier { g.Add(1); go func(u string) { defer g.Done(); for _, v := range p.GetUrls(u) { m.Lock(); if host(v) == h && !seen[v] { seen[v] = true; found = append(found, v) }; m.Unlock() } }(u) }; g.Wait(); frontier = found }; out := []string{}; for u := range seen { out = append(out, u) }; return out }\n',
  } },
)

const threaded: HarnessLanguage[] = ['cpp', 'python', 'java', 'go']
const printInOrder: ProblemInterface = { kind: 'class', className: 'Foo', constructorParams: [], concurrency: true, languages: threaded, methods: ['first', 'second', 'third'].map(name => ({ name, params: [{ name: `print${name[0].toUpperCase()}${name.slice(1)}`, type: 'callback' }], returns: 'void' })) }
const zeroEvenOdd: ProblemInterface = { kind: 'class', className: 'ZeroEvenOdd', constructorParams: [{ name: 'n', type: 'int' }], concurrency: true, languages: threaded, methods: ['zero', 'even', 'odd'].map(name => ({ name, params: [{ name: 'printNumber', type: 'callback<int>' }], returns: 'void' })) }
const blockingQueue: ProblemInterface = { kind: 'class', className: 'BoundedBlockingQueue', constructorParams: [{ name: 'capacity', type: 'int' }], concurrency: true, languages: threaded, methods: [{ name: 'enqueue', params: [{ name: 'element', type: 'int' }], returns: 'void' }, { name: 'dequeue', params: [], returns: 'int' }, { name: 'size', params: [], returns: 'int' }] }
harnessCases.push(
  { name: 'threads-order', spec: printInOrder, cases: [{ input: '[]\n[[["first",["first"]]],[["third",["third"]]],[["second",["second"]]]]', expected: '["first","second","third"]' }, { input: '[]\n[[["third",["third"]]],[["second",["second"]]],[["first",["first"]]]]', expected: '["first","second","third"]' }], solutions: {
    python: 'import threading\nclass Foo:\n    def __init__(self):\n        self.a = threading.Event(); self.b = threading.Event()\n    def first(self, printFirst):\n        printFirst(); self.a.set()\n    def second(self, printSecond):\n        self.a.wait(); printSecond(); self.b.set()\n    def third(self, printThird):\n        self.b.wait(); printThird()\n',
    cpp: 'class Foo { mutex m; condition_variable cv; int stage = 0; public: Foo() {} void first(function<void()> printFirst) { printFirst(); { lock_guard<mutex> g(m); stage = 1; } cv.notify_all(); } void second(function<void()> printSecond) { unique_lock<mutex> l(m); cv.wait(l, [&] { return stage == 1; }); printSecond(); stage = 2; cv.notify_all(); } void third(function<void()> printThird) { unique_lock<mutex> l(m); cv.wait(l, [&] { return stage == 2; }); printThird(); } };',
    java: 'class Foo { java.util.concurrent.CountDownLatch a = new java.util.concurrent.CountDownLatch(1), b = new java.util.concurrent.CountDownLatch(1); public Foo() {} public void first(Runnable printFirst) throws InterruptedException { printFirst.run(); a.countDown(); } public void second(Runnable printSecond) throws InterruptedException { a.await(); printSecond.run(); b.countDown(); } public void third(Runnable printThird) throws InterruptedException { b.await(); printThird.run(); } }',
    go: 'package main\n\ntype Foo struct { a, b chan bool }\nfunc Constructor() Foo { return Foo{make(chan bool), make(chan bool)} }\nfunc (f *Foo) First(printFirst func()) { printFirst(); close(f.a) }\nfunc (f *Foo) Second(printSecond func()) { <-f.a; printSecond(); close(f.b) }\nfunc (f *Foo) Third(printThird func()) { <-f.b; printThird() }\n',
  } },
  { name: 'threads-int-callback', spec: zeroEvenOdd, cases: [{ input: '[2]\n[[["zero",[null]]],[["even",[null]]],[["odd",[null]]]]', expected: '[0,1,0,2]' }, { input: '[5]\n[[["odd",[null]]],[["even",[null]]],[["zero",[null]]]]', expected: '[0,1,0,2,0,3,0,4,0,5]' }], solutions: {
    python: 'import threading\nclass ZeroEvenOdd:\n    def __init__(self, n):\n        self.n = n; self.z = threading.Semaphore(1); self.e = threading.Semaphore(0); self.o = threading.Semaphore(0)\n    def zero(self, printNumber):\n        for i in range(1, self.n + 1):\n            self.z.acquire(); printNumber(0)\n            (self.o if i % 2 else self.e).release()\n    def even(self, printNumber):\n        for i in range(2, self.n + 1, 2): self.e.acquire(); printNumber(i); self.z.release()\n    def odd(self, printNumber):\n        for i in range(1, self.n + 1, 2): self.o.acquire(); printNumber(i); self.z.release()\n',
    cpp: 'class ZeroEvenOdd { int n, turn = 0; mutex m; condition_variable cv; public: ZeroEvenOdd(int n) : n(n) {} void zero(function<void(int)> printNumber) { for (int i = 1; i <= n; i++) { unique_lock<mutex> l(m); cv.wait(l, [&] { return turn == 0; }); printNumber(0); turn = i % 2 ? 1 : 2; cv.notify_all(); } } void even(function<void(int)> printNumber) { for (int i = 2; i <= n; i += 2) { unique_lock<mutex> l(m); cv.wait(l, [&] { return turn == 2; }); printNumber(i); turn = 0; cv.notify_all(); } } void odd(function<void(int)> printNumber) { for (int i = 1; i <= n; i += 2) { unique_lock<mutex> l(m); cv.wait(l, [&] { return turn == 1; }); printNumber(i); turn = 0; cv.notify_all(); } } };',
    java: 'class ZeroEvenOdd { int n; java.util.concurrent.Semaphore z = new java.util.concurrent.Semaphore(1), e = new java.util.concurrent.Semaphore(0), o = new java.util.concurrent.Semaphore(0); public ZeroEvenOdd(int n) { this.n = n; } public void zero(IntConsumer printNumber) throws InterruptedException { for (int i = 1; i <= n; i++) { z.acquire(); printNumber.accept(0); (i % 2 == 1 ? o : e).release(); } } public void even(IntConsumer printNumber) throws InterruptedException { for (int i = 2; i <= n; i += 2) { e.acquire(); printNumber.accept(i); z.release(); } } public void odd(IntConsumer printNumber) throws InterruptedException { for (int i = 1; i <= n; i += 2) { o.acquire(); printNumber.accept(i); z.release(); } } }',
    go: 'package main\n\ntype ZeroEvenOdd struct { n int; z, e, o chan bool }\nfunc Constructor(n int) ZeroEvenOdd { z := make(chan bool, 1); z <- true; return ZeroEvenOdd{n, z, make(chan bool, 1), make(chan bool, 1)} }\nfunc (x *ZeroEvenOdd) Zero(printNumber func(int)) { for i := 1; i <= x.n; i++ { <-x.z; printNumber(0); if i%2 == 1 { x.o <- true } else { x.e <- true } } }\nfunc (x *ZeroEvenOdd) Even(printNumber func(int)) { for i := 2; i <= x.n; i += 2 { <-x.e; printNumber(i); x.z <- true } }\nfunc (x *ZeroEvenOdd) Odd(printNumber func(int)) { for i := 1; i <= x.n; i += 2 { <-x.o; printNumber(i); x.z <- true } }\n',
  } },
  { name: 'threads-returns', spec: blockingQueue, cases: [{ input: '[1]\n[[["enqueue",[1]],["enqueue",[0]],["enqueue",[2]]],[["$sleep",[20]],["dequeue",[]],["dequeue",[]],["dequeue",[]],["size",[]]]]', expected: '[1,0,2,0]' }], solutions: {
    python: 'import threading, collections\nclass BoundedBlockingQueue:\n    def __init__(self, capacity):\n        self.c = capacity; self.q = collections.deque(); self.cv = threading.Condition()\n    def enqueue(self, element):\n        with self.cv:\n            self.cv.wait_for(lambda: len(self.q) < self.c); self.q.append(element); self.cv.notify_all()\n    def dequeue(self):\n        with self.cv:\n            self.cv.wait_for(lambda: self.q); x = self.q.popleft(); self.cv.notify_all(); return x\n    def size(self):\n        with self.cv: return len(self.q)\n',
    cpp: 'class BoundedBlockingQueue { size_t c; deque<int> q; mutex m; condition_variable cv; public: BoundedBlockingQueue(int capacity) : c(capacity) {} void enqueue(int element) { unique_lock<mutex> l(m); cv.wait(l, [&] { return q.size() < c; }); q.push_back(element); cv.notify_all(); } int dequeue() { unique_lock<mutex> l(m); cv.wait(l, [&] { return !q.empty(); }); int x = q.front(); q.pop_front(); cv.notify_all(); return x; } int size() { lock_guard<mutex> g(m); return q.size(); } };',
    java: 'class BoundedBlockingQueue { java.util.concurrent.ArrayBlockingQueue<Integer> q; public BoundedBlockingQueue(int capacity) { q = new java.util.concurrent.ArrayBlockingQueue<>(capacity); } public void enqueue(int element) throws InterruptedException { q.put(element); } public int dequeue() throws InterruptedException { return q.take(); } public int size() { return q.size(); } }',
    go: 'package main\n\ntype BoundedBlockingQueue struct { q chan int }\nfunc Constructor(capacity int) BoundedBlockingQueue { return BoundedBlockingQueue{make(chan int, capacity)} }\nfunc (b *BoundedBlockingQueue) Enqueue(element int) { b.q <- element }\nfunc (b *BoundedBlockingQueue) Dequeue() int { return <-b.q }\nfunc (b *BoundedBlockingQueue) Size() int { return len(b.q) }\n',
  } },
)
