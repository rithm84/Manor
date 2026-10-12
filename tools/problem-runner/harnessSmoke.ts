/** Real-provider acceptance check for typed solving interfaces in every harness language. Every disposable sandbox is deleted in finally. */
import { BlaxelClient } from '../../supabase/functions/_shared/blaxelClient.ts'
import { assembleProgram, parseDriverOutput } from '../../supabase/functions/_shared/problemDrivers.ts'
import { shallowCopyMessage, validateInterface, type HarnessLanguage, type ProblemInterface } from '../../supabase/functions/_shared/problemInterface.ts'

interface HarnessCase { readonly name: string; readonly spec: ProblemInterface; readonly input: string; readonly expected: string; readonly solutions: Readonly<Record<HarnessLanguage, string>> }
const image = Deno.args[0]
if (!image) throw new Error('Supply the published runtime image identifier')
const key = Deno.env.get('BLAXEL_API_KEY')
const workspace = Deno.env.get('BLAXEL_WORKSPACE')
if (!key || !workspace) throw new Error('BLAXEL_API_KEY and BLAXEL_WORKSPACE are required')
const client = new BlaxelClient(key, workspace, image)
const tree = 'struct TreeNode { int val; TreeNode *left; TreeNode *right; TreeNode(int x) : val(x), left(nullptr), right(nullptr) {} };\n'
const list = 'struct ListNode { int val; ListNode *next; ListNode(int x, ListNode *n) : val(x), next(n) {} };\n'
const javaTree = 'class TreeNode { int val; TreeNode left, right; TreeNode(int v) { val = v; } }\n'
const javaList = 'class ListNode { int val; ListNode next; ListNode(int v, ListNode n) { val = v; next = n; } }\n'
const goTree = 'type TreeNode struct { Val int; Left *TreeNode; Right *TreeNode }\n'
const goList = 'type ListNode struct { Val int; Next *ListNode }\n'
const graphNode = 'class Node { public: int val; vector<Node*> neighbors; Node() { val = 0; } Node(int _val) { val = _val; } Node(int _val, vector<Node*> _neighbors) { val = _val; neighbors = _neighbors; } };\n'
const javaGraphNode = 'class Node { public int val; public List<Node> neighbors; public Node(int v) { val = v; neighbors = new ArrayList<>(); } }\n'
const goGraphNode = 'type Node struct { Val int; Neighbors []*Node }\n'
const copyRandomList: ProblemInterface = { kind: 'function', name: 'copyRandomList', params: [{ name: 'head', type: 'RandomListNode' }], returns: 'RandomListNode', output: { mode: 'return' } }
const cloneGraph: ProblemInterface = { kind: 'function', name: 'cloneGraph', params: [{ name: 'node', type: 'GraphNode' }], returns: 'GraphNode', output: { mode: 'return' } }
const cases: readonly HarnessCase[] = [
  { name: 'function-array', input: '[2,7,11,15]\n9\n', expected: '[0,1]', spec: { kind: 'function', name: 'twoSum', params: [{ name: 'nums', type: 'int[]' }, { name: 'target', type: 'int' }], returns: 'int[]', output: { mode: 'return' } }, solutions: {
    cpp: 'class Solution { public: vector<int> twoSum(vector<int>& n, int t) { unordered_map<int,int> m; for (int i = 0; i < (int)n.size(); i++) { if (m.count(t - n[i])) return {m[t - n[i]], i}; m[n[i]] = i; } return {}; } };',
    python: 'class Solution:\n    def twoSum(self, nums: List[int], target: int) -> List[int]:\n        seen = {}\n        for i, x in enumerate(nums):\n            if target - x in seen: return [seen[target - x], i]\n            seen[x] = i\n',
    javascript: 'var twoSum = function(n, t) { const m = new Map(); for (let i = 0; i < n.length; i++) { if (m.has(t - n[i])) return [m.get(t - n[i]), i]; m.set(n[i], i); } };',
    java: 'import java.util.HashMap;\nclass Solution { public int[] twoSum(int[] n, int t) { HashMap<Integer,Integer> m = new HashMap<>(); for (int i = 0; i < n.length; i++) { if (m.containsKey(t - n[i])) return new int[]{m.get(t - n[i]), i}; m.put(n[i], i); } return null; } }',
    go: 'package main\n\nimport "sort"\n\nvar _ = sort.Ints\n\nfunc twoSum(n []int, t int) []int { m := map[int]int{}; for i, x := range n { if j, ok := m[t-x]; ok { return []int{j, i} }; m[x] = i }; return nil }\n',
  } },
  { name: 'tree', input: '[4,2,7,1,3,null,9]\n', expected: '[4,7,2,9,null,3,1]', spec: { kind: 'function', name: 'invertTree', params: [{ name: 'root', type: 'TreeNode' }], returns: 'TreeNode', output: { mode: 'return' } }, solutions: {
    cpp: tree + 'class Solution { public: TreeNode* invertTree(TreeNode* r) { if (r) { swap(r->left, r->right); invertTree(r->left); invertTree(r->right); } return r; } };',
    python: 'class Solution:\n    def invertTree(self, root):\n        if root: root.left, root.right = self.invertTree(root.right), self.invertTree(root.left)\n        return root\n',
    javascript: 'var invertTree = function(r) { if (r) [r.left, r.right] = [invertTree(r.right), invertTree(r.left)]; return r; };',
    java: javaTree + 'class Solution { public TreeNode invertTree(TreeNode r) { if (r != null) { TreeNode t = r.left; r.left = invertTree(r.right); r.right = invertTree(t); } return r; } }',
    go: 'package main\n' + goTree + 'func invertTree(r *TreeNode) *TreeNode { if r != nil { r.Left, r.Right = invertTree(r.Right), invertTree(r.Left) }; return r }\n',
  } },
  { name: 'list', input: '[1,2,3]\n', expected: '[3,2,1]', spec: { kind: 'function', name: 'reverseList', params: [{ name: 'head', type: 'ListNode' }], returns: 'ListNode', output: { mode: 'return' } }, solutions: {
    cpp: list + 'class Solution { public: ListNode* reverseList(ListNode* h) { ListNode* p = nullptr; while (h) { ListNode* n = h->next; h->next = p; p = h; h = n; } return p; } };',
    python: 'class Solution:\n    def reverseList(self, head):\n        prev = None\n        while head: head.next, prev, head = prev, head, head.next\n        return prev\n',
    javascript: 'var reverseList = function(h) { let p = null; while (h) { const n = h.next; h.next = p; p = h; h = n; } return p; };',
    java: javaList + 'class Solution { public ListNode reverseList(ListNode h) { ListNode p = null; while (h != null) { ListNode n = h.next; h.next = p; p = h; h = n; } return p; } }',
    go: 'package main\n' + goList + 'func reverseList(h *ListNode) *ListNode { var p *ListNode; for h != nil { n := h.Next; h.Next = p; p = h; h = n }; return p }\n',
  } },
  { name: 'class-double', input: '["MedianFinder","addNum","addNum","findMedian","addNum","findMedian"]\n[[],[1],[2],[],[3],[]]\n', expected: '[null,null,null,1.5,null,2]', spec: { kind: 'class', className: 'MedianFinder', constructorParams: [], methods: [{ name: 'addNum', params: [{ name: 'num', type: 'int' }], returns: 'void' }, { name: 'findMedian', params: [], returns: 'double' }] }, solutions: {
    cpp: 'class MedianFinder { multiset<int> s; public: MedianFinder() {} void addNum(int n) { s.insert(n); } double findMedian() { vector<int> a(s.begin(), s.end()); int n = a.size(); return n % 2 ? a[n / 2] : (a[n / 2 - 1] + a[n / 2]) / 2.0; } };',
    python: 'class MedianFinder:\n    def __init__(self): self.a = []\n    def addNum(self, num): bisect.insort(self.a, num)\n    def findMedian(self):\n        a = self.a; n = len(a)\n        return a[n // 2] if n % 2 else (a[n // 2 - 1] + a[n // 2]) / 2\n',
    javascript: 'class MedianFinder { constructor() { this.a = []; } addNum(n) { this.a.push(n); this.a.sort((x, y) => x - y); } findMedian() { const a = this.a, n = a.length; return n % 2 ? a[n >> 1] : (a[n / 2 - 1] + a[n / 2]) / 2; } }',
    java: 'class MedianFinder { ArrayList<Integer> a = new ArrayList<>(); public MedianFinder() {} public void addNum(int n) { a.add(n); Collections.sort(a); } public double findMedian() { int n = a.size(); return n % 2 == 1 ? a.get(n / 2) : (a.get(n / 2 - 1) + a.get(n / 2)) / 2.0; } }',
    go: 'package main\n\nimport "sort"\n\ntype MedianFinder struct { a []int }\nfunc Constructor() MedianFinder { return MedianFinder{} }\nfunc (m *MedianFinder) AddNum(n int) { m.a = append(m.a, n); sort.Ints(m.a) }\nfunc (m *MedianFinder) FindMedian() float64 { n := len(m.a); if n%2 == 1 { return float64(m.a[n/2]) }; return float64(m.a[n/2-1]+m.a[n/2]) / 2 }\n',
  } },
  { name: 'prefix', input: '[0,0,1,1,1,2,2,3,3,4]\n', expected: '[0,1,2,3,4]', spec: { kind: 'function', name: 'removeDuplicates', params: [{ name: 'nums', type: 'int[]' }], returns: 'int', output: { mode: 'prefix', param: 'nums' } }, solutions: {
    cpp: 'class Solution { public: int removeDuplicates(vector<int>& a) { int k = 0; for (int x : a) if (!k || a[k - 1] != x) a[k++] = x; return k; } };',
    python: 'class Solution:\n    def removeDuplicates(self, a):\n        k = 0\n        for x in a:\n            if not k or a[k - 1] != x: a[k] = x; k += 1\n        return k\n',
    javascript: 'var removeDuplicates = function(a) { let k = 0; for (const x of a) if (!k || a[k - 1] !== x) a[k++] = x; return k; };',
    java: 'class Solution { public int removeDuplicates(int[] a) { int k = 0; for (int x : a) if (k == 0 || a[k - 1] != x) a[k++] = x; return k; } }',
    go: 'package main\n\nfunc removeDuplicates(a []int) int { k := 0; for _, x := range a { if k == 0 || a[k-1] != x { a[k] = x; k++ } }; return k }\n',
  } },
  { name: 'mutated-chars', input: '[["X","\\"","b"],["c","d","e"]]\n"q\\\\z"\n', expected: '[["q","\\"","b"],["c","d","\\\\"]]', spec: { kind: 'function', name: 'paint', params: [{ name: 'board', type: 'char[][]' }, { name: 'word', type: 'string' }], returns: 'void', output: { mode: 'param', param: 'board' } }, solutions: {
    cpp: 'class Solution { public: void paint(vector<vector<char>>& b, string& w) { b[0][0] = w[0]; b[1][2] = w[1]; } };',
    python: 'class Solution:\n    def paint(self, b, w):\n        b[0][0] = w[0]; b[1][2] = w[1]\n',
    javascript: 'var paint = function(b, w) { b[0][0] = w[0]; b[1][2] = w[1]; };',
    java: 'class Solution { public void paint(char[][] b, String w) { b[0][0] = w.charAt(0); b[1][2] = w.charAt(1); } }',
    go: 'package main\n\nfunc paint(b [][]byte, w string) { b[0][0] = w[0]; b[1][2] = w[1] }\n',
  } },
  { name: 'nested-lists', input: '["eat","tea","tan","ate","nat","bat"]\n', expected: '[["eat","tea","ate"],["tan","nat"],["bat"]]', spec: { kind: 'function', name: 'groupAnagrams', params: [{ name: 'strs', type: 'string[]' }], returns: 'list<list<string>>', output: { mode: 'return' } }, solutions: {
    cpp: 'class Solution { public: vector<vector<string>> groupAnagrams(vector<string>& s) { vector<vector<string>> out; map<string,int> at; for (auto& w : s) { string k = w; sort(k.begin(), k.end()); if (!at.count(k)) { at[k] = out.size(); out.push_back({}); } out[at[k]].push_back(w); } return out; } };',
    python: 'class Solution:\n    def groupAnagrams(self, strs):\n        groups = {}\n        for w in strs: groups.setdefault("".join(sorted(w)), []).append(w)\n        return list(groups.values())\n',
    javascript: 'var groupAnagrams = function(s) { const m = new Map(); for (const w of s) { const k = [...w].sort().join(""); if (!m.has(k)) m.set(k, []); m.get(k).push(w); } return [...m.values()]; };',
    java: 'class Solution { public List<List<String>> groupAnagrams(String[] s) { LinkedHashMap<String, List<String>> m = new LinkedHashMap<>(); for (String w : s) { char[] c = w.toCharArray(); Arrays.sort(c); m.computeIfAbsent(new String(c), k -> new ArrayList<>()).add(w); } return new ArrayList<>(m.values()); } }',
    go: 'package main\n\nimport "sort"\n\nfunc groupAnagrams(s []string) [][]string { idx := map[string]int{}; out := [][]string{}; for _, w := range s { b := []byte(w); sort.Slice(b, func(i, j int) bool { return b[i] < b[j] }); k := string(b); if _, ok := idx[k]; !ok { idx[k] = len(out); out = append(out, []string{}) }; out[idx[k]] = append(out[idx[k]], w) }; return out }\n',
  } },
  { name: 'long-and-bool', input: '[9007199254740993,-4]\ntrue\n', expected: '[9007199254740993,-4,1]', spec: { kind: 'function', name: 'echo', params: [{ name: 'values', type: 'long[]' }, { name: 'flag', type: 'bool' }], returns: 'long[]', output: { mode: 'return' } }, solutions: {
    cpp: 'class Solution { public: vector<long long> echo(vector<long long>& v, bool f) { v.push_back(f ? 1 : 0); return v; } };',
    python: 'class Solution:\n    def echo(self, values, flag):\n        return values + [1 if flag else 0]\n',
    javascript: 'var echo = function(v, f) { return [...v, f ? 1 : 0]; };',
    java: 'class Solution { public long[] echo(long[] v, boolean f) { long[] r = Arrays.copyOf(v, v.length + 1); r[v.length] = f ? 1 : 0; return r; } }',
    go: 'package main\n\nfunc echo(v []int64, f bool) []int64 { if f { return append(v, 1) }; return append(v, 0) }\n',
  } },
  { name: 'random-list', input: '[[7,null],[13,0],[11,4],[10,2],[1,0]]\n', expected: '[[7,null],[13,0],[11,4],[10,2],[1,0]]', spec: copyRandomList, solutions: {
    cpp: 'class Node { public: int val; Node* next; Node* random; Node(int _val) { val = _val; next = NULL; random = NULL; } };\nclass Solution { public: Node* copyRandomList(Node* head) { unordered_map<Node*, Node*> m; m[nullptr] = nullptr; for (Node* p = head; p; p = p->next) m[p] = new Node(p->val); for (Node* p = head; p; p = p->next) { m[p]->next = m[p->next]; m[p]->random = m[p->random]; } return m[head]; } };',
    python: 'class Solution:\n    def copyRandomList(self, head: "Optional[Node]") -> "Optional[Node]":\n        m = {None: None}\n        p = head\n        while p: m[p] = Node(p.val); p = p.next\n        p = head\n        while p: m[p].next = m[p.next]; m[p].random = m[p.random]; p = p.next\n        return m[head]\n',
    javascript: 'var copyRandomList = function(head) { const m = new Map([[null, null]]); for (let p = head; p; p = p.next) m.set(p, new _Node(p.val, null, null)); for (let p = head; p; p = p.next) { m.get(p).next = m.get(p.next); m.get(p).random = m.get(p.random); } return m.get(head); };',
    java: 'class Node { int val; Node next; Node random; public Node(int val) { this.val = val; } }\nclass Solution { public Node copyRandomList(Node head) { HashMap<Node, Node> m = new HashMap<>(); for (Node p = head; p != null; p = p.next) m.put(p, new Node(p.val)); for (Node p = head; p != null; p = p.next) { m.get(p).next = m.get(p.next); m.get(p).random = m.get(p.random); } return m.get(head); } }',
    go: 'package main\n\ntype Node struct { Val int; Next *Node; Random *Node }\nfunc copyRandomList(head *Node) *Node { m := map[*Node]*Node{nil: nil}; for p := head; p != nil; p = p.Next { m[p] = &Node{Val: p.Val} }; for p := head; p != nil; p = p.Next { m[p].Next = m[p.Next]; m[p].Random = m[p.Random] }; return m[head] }\n',
  } },
  { name: 'graph', input: '[[2,4],[1,3],[2,4],[1,3]]\n', expected: '[[2,4],[1,3],[2,4],[1,3]]', spec: cloneGraph, solutions: {
    cpp: graphNode + 'class Solution { unordered_map<Node*, Node*> m; public: Node* cloneGraph(Node* node) { if (!node) return nullptr; if (m.count(node)) return m[node]; Node* c = new Node(node->val); m[node] = c; for (Node* x : node->neighbors) c->neighbors.push_back(cloneGraph(x)); return c; } };',
    python: 'class Node:\n    def __init__(self, val = 0, neighbors = None):\n        self.val = val\n        self.neighbors = neighbors if neighbors is not None else []\n\nclass Solution:\n    def cloneGraph(self, node: Optional["Node"]) -> Optional["Node"]:\n        seen = {}\n        def clone(n):\n            if n in seen: return seen[n]\n            c = seen[n] = Node(n.val)\n            c.neighbors = [clone(x) for x in n.neighbors]\n            return c\n        return clone(node) if node else None\n',
    javascript: 'var cloneGraph = function(node) { const m = new Map(); const clone = n => { if (m.has(n)) return m.get(n); const c = new _Node(n.val, []); m.set(n, c); for (const x of n.neighbors) c.neighbors.push(clone(x)); return c; }; return node ? clone(node) : null; };',
    java: javaGraphNode + 'class Solution { HashMap<Node, Node> m = new HashMap<>(); public Node cloneGraph(Node node) { if (node == null) return null; if (m.containsKey(node)) return m.get(node); Node c = new Node(node.val); m.put(node, c); for (Node x : node.neighbors) c.neighbors.add(cloneGraph(x)); return c; } }',
    go: 'package main\n' + goGraphNode + 'func cloneGraph(node *Node) *Node { m := map[*Node]*Node{}; var clone func(*Node) *Node; clone = func(n *Node) *Node { if c, ok := m[n]; ok { return c }; c := &Node{Val: n.Val}; m[n] = c; for _, x := range n.Neighbors { c.Neighbors = append(c.Neighbors, clone(x)) }; return c }; if node == nil { return nil }; return clone(node) }\n',
  } },
  { name: 'graph-shallow-copy', input: '[[2,4],[1,3],[2,4],[1,3]]\n', expected: JSON.stringify(shallowCopyMessage), spec: cloneGraph, solutions: {
    cpp: graphNode + 'class Solution { public: Node* cloneGraph(Node* node) { return node; } };',
    python: 'class Solution:\n    def cloneGraph(self, node):\n        return Node(node.val, node.neighbors) if node else None\n',
    javascript: 'var cloneGraph = function(node) { return node; };',
    java: javaGraphNode + 'class Solution { public Node cloneGraph(Node node) { return node; } }',
    go: 'package main\n' + goGraphNode + 'func cloneGraph(node *Node) *Node { return node }\n',
  } },
  { name: 'nary', input: '[1,null,2,3,4,5,null,null,6,7,null,8,null,9,10,null,null,11,null,12,null,13,null,null,14]\n', expected: '[1,null,2,3,4,5,null,null,6,7,null,8,null,9,10,null,null,11,null,12,null,13,null,null,14]', spec: { kind: 'function', name: 'cloneTree', params: [{ name: 'root', type: 'NaryNode' }], returns: 'NaryNode', output: { mode: 'return' } }, solutions: {
    cpp: 'class Node { public: int val; vector<Node*> children; Node() {} Node(int _val) { val = _val; } Node(int _val, vector<Node*> _children) { val = _val; children = _children; } };\nclass Solution { public: Node* cloneTree(Node* root) { if (!root) return nullptr; Node* c = new Node(root->val); for (Node* x : root->children) c->children.push_back(cloneTree(x)); return c; } };',
    python: 'class Solution:\n    def cloneTree(self, root: "Node") -> "Node":\n        return Node(root.val, [self.cloneTree(c) for c in root.children]) if root else None\n',
    javascript: 'var cloneTree = function(root) { return root ? new _Node(root.val, root.children.map(c => cloneTree(c))) : null; };',
    java: 'class Node { public int val; public List<Node> children; public Node() {} public Node(int v) { val = v; } }\nclass Solution { public Node cloneTree(Node root) { if (root == null) return null; Node c = new Node(root.val); c.children = new ArrayList<>(); for (Node x : root.children) c.children.add(cloneTree(x)); return c; } }',
    go: 'package main\n\ntype Node struct { Val int; Children []*Node }\nfunc cloneTree(root *Node) *Node { if root == nil { return nil }; c := &Node{Val: root.Val}; for _, x := range root.Children { c.Children = append(c.Children, cloneTree(x)) }; return c }\n',
  } },
  { name: 'next-pointers', input: '[1,2,3,4,5,null,7]\n', expected: '[1,"#",2,3,"#",4,5,7,"#"]', spec: { kind: 'function', name: 'connect', params: [{ name: 'root', type: 'NextNode' }], returns: 'NextNode', output: { mode: 'return' } }, solutions: {
    cpp: 'class Node { public: int val; Node* left; Node* right; Node* next; Node(int _val) : val(_val), left(NULL), right(NULL), next(NULL) {} };\nclass Solution { public: Node* connect(Node* root) { queue<Node*> q; if (root) q.push(root); while (!q.empty()) { int n = q.size(); Node* prev = nullptr; for (int i = 0; i < n; i++) { Node* x = q.front(); q.pop(); if (prev) prev->next = x; prev = x; if (x->left) q.push(x->left); if (x->right) q.push(x->right); } } return root; } };',
    python: 'class Solution:\n    def connect(self, root: "Node") -> "Node":\n        level = [root] if root else []\n        while level:\n            for a, b in zip(level, level[1:]): a.next = b\n            level = [c for n in level for c in (n.left, n.right) if c]\n        return root\n',
    javascript: 'var connect = function(root) { let level = root ? [root] : []; while (level.length) { for (let i = 0; i + 1 < level.length; i++) level[i].next = level[i + 1]; level = level.flatMap(n => [n.left, n.right]).filter(Boolean); } return root; };',
    java: 'class Node { public int val; public Node left, right, next; public Node(int v) { val = v; } }\nclass Solution { public Node connect(Node root) { List<Node> level = new ArrayList<>(); if (root != null) level.add(root); while (!level.isEmpty()) { List<Node> below = new ArrayList<>(); for (int i = 0; i < level.size(); i++) { Node n = level.get(i); if (i + 1 < level.size()) n.next = level.get(i + 1); if (n.left != null) below.add(n.left); if (n.right != null) below.add(n.right); } level = below; } return root; } }',
    go: 'package main\n\ntype Node struct { Val int; Left *Node; Right *Node; Next *Node }\nfunc connect(root *Node) *Node { level := []*Node{}; if root != nil { level = append(level, root) }; for len(level) > 0 { below := []*Node{}; for i, n := range level { if i+1 < len(level) { n.Next = level[i+1] }; if n.Left != nil { below = append(below, n.Left) }; if n.Right != nil { below = append(below, n.Right) } }; level = below }; return root }\n',
  } },
  { name: 'codec-separate', input: '[1,2,3,null,null,4,5]\n', expected: '[1,2,3,null,null,4,5]', spec: { kind: 'codec', className: 'Codec', encode: { name: 'serialize', param: { name: 'root', type: 'TreeNode' }, returns: 'string' }, decode: { name: 'deserialize', param: { name: 'data', type: 'string' }, returns: 'TreeNode' }, sharedInstance: false }, solutions: {
    cpp: tree + 'class Codec { public: string serialize(TreeNode* r) { if (!r) return "#"; return to_string(r->val) + "," + serialize(r->left) + "," + serialize(r->right); } TreeNode* deserialize(string data) { stringstream s(data); return build(s); } TreeNode* build(stringstream& s) { string t; getline(s, t, \',\'); if (t == "#") return nullptr; TreeNode* n = new TreeNode(stoi(t)); n->left = build(s); n->right = build(s); return n; } };',
    python: 'class Codec:\n    def serialize(self, root):\n        out = []\n        def walk(n):\n            if not n: out.append("#"); return\n            out.append(str(n.val)); walk(n.left); walk(n.right)\n        walk(root)\n        return ",".join(out)\n\n    def deserialize(self, data):\n        it = iter(data.split(","))\n        def build():\n            t = next(it)\n            if t == "#": return None\n            n = TreeNode(int(t)); n.left = build(); n.right = build()\n            return n\n        return build()\n',
    javascript: 'var serialize = function(root) { const out = []; const walk = n => { if (!n) { out.push("#"); return; } out.push(n.val); walk(n.left); walk(n.right); }; walk(root); return out.join(","); };\nvar deserialize = function(data) { const t = data.split(","); let i = 0; const build = () => { const x = t[i++]; if (x === "#") return null; const n = new TreeNode(Number(x)); n.left = build(); n.right = build(); return n; }; return build(); };',
    java: javaTree + 'public class Codec { public String serialize(TreeNode r) { StringBuilder b = new StringBuilder(); walk(r, b); return b.toString(); } void walk(TreeNode n, StringBuilder b) { if (n == null) { b.append("#,"); return; } b.append(n.val).append(","); walk(n.left, b); walk(n.right, b); } public TreeNode deserialize(String data) { return build(new ArrayDeque<>(Arrays.asList(data.split(",")))); } TreeNode build(Deque<String> q) { String t = q.poll(); if (t.equals("#")) return null; TreeNode n = new TreeNode(Integer.parseInt(t)); n.left = build(q); n.right = build(q); return n; } }',
    go: 'package main\n\nimport (\n\t"strconv"\n\t"strings"\n)\n\n' + goTree + 'type Codec struct{}\nfunc Constructor() Codec { return Codec{} }\nfunc (this *Codec) serialize(root *TreeNode) string { out := []string{}; var walk func(*TreeNode); walk = func(n *TreeNode) { if n == nil { out = append(out, "#"); return }; out = append(out, strconv.Itoa(n.Val)); walk(n.Left); walk(n.Right) }; walk(root); return strings.Join(out, ",") }\nfunc (this *Codec) deserialize(data string) *TreeNode { t := strings.Split(data, ","); i := 0; var build func() *TreeNode; build = func() *TreeNode { x := t[i]; i++; if x == "#" { return nil }; v, _ := strconv.Atoi(x); n := &TreeNode{Val: v}; n.Left = build(); n.Right = build(); return n }; return build() }\n',
  } },
  // The solutions keep URLs on the instance, so they pass only when encode and decode share it.
  { name: 'codec-shared', input: '"https://leetcode.com/problems/design-tinyurl"\n', expected: '"https://leetcode.com/problems/design-tinyurl"', spec: { kind: 'codec', className: 'Codec', encode: { name: 'encode', param: { name: 'longUrl', type: 'string' }, returns: 'string' }, decode: { name: 'decode', param: { name: 'shortUrl', type: 'string' }, returns: 'string' }, sharedInstance: true }, solutions: {
    cpp: 'class Codec { vector<string> urls; public: string encode(string longUrl) { urls.push_back(longUrl); return "http://tinyurl.com/" + to_string(urls.size() - 1); } string decode(string shortUrl) { return urls.at(stoi(shortUrl.substr(shortUrl.rfind(\'/\') + 1))); } };',
    python: 'class Codec:\n    def __init__(self):\n        self.urls = []\n\n    def encode(self, longUrl: str) -> str:\n        self.urls.append(longUrl)\n        return "http://tinyurl.com/" + str(len(self.urls) - 1)\n\n    def decode(self, shortUrl: str) -> str:\n        return self.urls[int(shortUrl.rsplit("/", 1)[1])]\n',
    javascript: 'class Codec { constructor() { this.urls = []; } encode(u) { this.urls.push(u); return "http://tinyurl.com/" + (this.urls.length - 1); } decode(s) { return this.urls[Number(s.split("/").pop())]; } }',
    java: 'public class Codec { List<String> urls = new ArrayList<>(); public String encode(String longUrl) { urls.add(longUrl); return "http://tinyurl.com/" + (urls.size() - 1); } public String decode(String shortUrl) { return urls.get(Integer.parseInt(shortUrl.substring(shortUrl.lastIndexOf(\'/\') + 1))); } }',
    go: 'package main\n\nimport (\n\t"strconv"\n\t"strings"\n)\n\ntype Codec struct { urls []string }\nfunc Constructor() Codec { return Codec{} }\nfunc (this *Codec) encode(longUrl string) string { this.urls = append(this.urls, longUrl); return "http://tinyurl.com/" + strconv.Itoa(len(this.urls)-1) }\nfunc (this *Codec) decode(shortUrl string) string { i, _ := strconv.Atoi(shortUrl[strings.LastIndex(shortUrl, "/")+1:]); return this.urls[i] }\n',
  } },
]

const failures: string[] = []
for (const test of cases) {
  validateInterface(test.spec)
  await Promise.all(Object.entries(test.solutions).map(async ([language, source]) => {
    // JavaScript numbers cannot represent integers beyond 2^53, as on other judges.
    if (test.name === 'long-and-bool' && language === 'javascript') return
    const name = 'manor-judge-' + crypto.randomUUID().replaceAll('-', '')
    try {
      const sandbox = await client.createSandbox(name, 'judge')
      const code = assembleProgram(language as HarnessLanguage, source, test.spec)
      const result = await client.judge(sandbox, { language, code, cases: [{ id: test.name, input: test.input + test.input }] })
      const compileFailed = result.compile !== null && result.compile.exitCode !== 0
      const answers = compileFailed ? [] : parseDriverOutput(result.cases[0]?.process.stdout ?? '')
      const same = (output: string | null): boolean => output !== null && (test.name === 'long-and-bool' ? output === test.expected : JSON.stringify(JSON.parse(output)) === JSON.stringify(JSON.parse(test.expected)))
      const passed = result.cases[0]?.process.exitCode === 0 && answers.length === 2 && answers.every(answer => same(answer.output))
      console.log(JSON.stringify({ case: test.name, language, passed, output: passed ? undefined : result.cases[0]?.process.stdout, stderr: passed ? undefined : (compileFailed ? result.compile?.stderr : result.cases[0]?.process.stderr)?.slice(0, 1500) }))
      if (!passed) failures.push(`${test.name}/${language}`)
    } finally { await client.deleteSandbox(name) }
  }))
}
if (failures.length > 0) throw new Error(`Harness acceptance failed: ${failures.join(', ')}`)
console.log(JSON.stringify({ passed: cases.length }))
