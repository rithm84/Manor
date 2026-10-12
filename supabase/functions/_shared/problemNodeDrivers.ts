/**
 * Driver code for the four LeetCode `Node` types in every harness language. Copy problems
 * (RandomListNode, GraphNode) record each case's input nodes, and an answer that reaches any of them
 * prints the shallow-copy message so it is graded wrong. Formats are described in problemInterface.ts.
 */
import { shallowCopyMessage, type NodeKind } from './problemInterface.ts'

const shallow = JSON.stringify(shallowCopyMessage)

/** Python: `__manor_node_decode` and `__manor_node_encode`, plus the per-case input registry the driver clears before each case. */
export const pythonNodeCode = `__manor_inputs = {}
def __manor_new(val, **fields):
    node = Node(val)
    for name, value in fields.items(): setattr(node, name, value)
    return node
def __manor_track(nodes):
    for node in nodes: __manor_inputs[id(node)] = node
    return nodes
def __manor_node_decode(kind, v):
    if kind == 'RandomListNode':
        nodes = __manor_track([__manor_new(pair[0], next=None, random=None) for pair in v])
        for i, pair in enumerate(v):
            if i + 1 < len(nodes): nodes[i].next = nodes[i + 1]
            if pair[1] is not None: nodes[i].random = nodes[pair[1]]
        return nodes[0] if nodes else None
    if kind == 'GraphNode':
        nodes = __manor_track([__manor_new(i + 1, neighbors=[]) for i in range(len(v))])
        for node, adjacent in zip(nodes, v): node.neighbors = [nodes[j - 1] for j in adjacent]
        return nodes[0] if nodes else None
    if kind == 'NaryNode':
        if not v: return None
        root = __manor_new(v[0], children=[]); queue = [root]; i = 2; k = 0
        while i < len(v):
            node = queue[k]; k += 1
            while i < len(v) and v[i] is not None:
                child = __manor_new(v[i], children=[]); node.children.append(child); queue.append(child); i += 1
            i += 1
        return root
    if not v or v[0] is None: return None
    root = __manor_new(v[0], left=None, right=None, next=None); queue = [root]; i = 1; k = 0
    while i < len(v):
        node = queue[k]; k += 1
        if v[i] is not None: node.left = __manor_new(v[i], left=None, right=None, next=None); queue.append(node.left)
        i += 1
        if i < len(v) and v[i] is not None: node.right = __manor_new(v[i], left=None, right=None, next=None); queue.append(node.right)
        i += 1
    return root
def __manor_node_encode(kind, v):
    if kind == 'RandomListNode':
        nodes = []; index = {}
        while v is not None:
            if id(v) in index: raise RuntimeError('Returned list does not terminate')
            index[id(v)] = len(nodes); nodes.append(v); v = v.next
        if any(id(n) in __manor_inputs or (n.random is not None and id(n.random) in __manor_inputs) for n in nodes): return ${shallow}
        if any(n.random is not None and id(n.random) not in index for n in nodes): raise RuntimeError('A random pointer leaves the returned list')
        return [[n.val, None if n.random is None else index[id(n.random)]] for n in nodes]
    if kind == 'GraphNode':
        if v is None: return []
        seen = {id(v)}; queue = [v]; k = 0
        while k < len(queue):
            node = queue[k]; k += 1
            for x in node.neighbors or []:
                if id(x) not in seen: seen.add(id(x)); queue.append(x)
        if any(id(n) in __manor_inputs for n in queue): return ${shallow}
        return [[x.val for x in n.neighbors or []] for n in sorted(queue, key=lambda n: n.val)]
    if kind == 'NaryNode':
        if v is None: return []
        out = [v.val, None]; queue = [v]; k = 0
        while k < len(queue):
            node = queue[k]; k += 1
            for child in node.children or []: out.append(child.val); queue.append(child)
            out.append(None)
            if len(queue) > 2000000: raise RuntimeError('Returned tree is too large')
        while out and out[-1] is None: out.pop()
        return out
    levels = []; level = [] if v is None else [v]; total = 0
    while level:
        levels.append(level); total += len(level)
        if total > 2000000: raise RuntimeError('Returned tree is too large')
        level = [c for n in level for c in (n.left, n.right) if c is not None]
    out = []
    for level in levels:
        node = level[0]; count = 0
        while node is not None:
            count += 1
            if count > total: raise RuntimeError('Next pointers do not terminate')
            out.append(node.val); node = node.next
        out.append('#')
    return out
`

/** JavaScript: arrow functions inside the driver closure; `Node` resolves to the solution's own class or the global fallback. */
export const javascriptNodeCode = `
  const __inputs = new Set();
  const __new = (val, fields) => Object.assign(new Node(val), fields);
  const __nodeDecode = (kind, v) => {
    if (kind === 'RandomListNode') {
      const nodes = v.map(pair => __new(pair[0], { next: null, random: null })); nodes.forEach(n => __inputs.add(n));
      v.forEach((pair, i) => { if (i + 1 < nodes.length) nodes[i].next = nodes[i + 1]; if (pair[1] !== null) nodes[i].random = nodes[pair[1]]; });
      return nodes.length > 0 ? nodes[0] : null;
    }
    if (kind === 'GraphNode') {
      const nodes = v.map((_, i) => __new(i + 1, { neighbors: [] })); nodes.forEach(n => __inputs.add(n));
      v.forEach((adjacent, i) => { nodes[i].neighbors = adjacent.map(j => nodes[j - 1]); });
      return nodes.length > 0 ? nodes[0] : null;
    }
    if (kind === 'NaryNode') {
      if (v.length === 0) return null;
      const root = __new(v[0], { children: [] }); const queue = [root]; let i = 2, k = 0;
      while (i < v.length) { const node = queue[k++]; while (i < v.length && v[i] !== null) { const child = __new(v[i], { children: [] }); node.children.push(child); queue.push(child); i++; } i++; }
      return root;
    }
    if (v.length === 0 || v[0] === null) return null;
    const fresh = x => __new(x, { left: null, right: null, next: null });
    const root = fresh(v[0]); const queue = [root]; let i = 1, k = 0;
    while (i < v.length) {
      const node = queue[k++];
      if (v[i] !== null) { node.left = fresh(v[i]); queue.push(node.left); } i++;
      if (i < v.length && v[i] !== null) { node.right = fresh(v[i]); queue.push(node.right); } i++;
    }
    return root;
  };
  const __nodeEncode = (kind, v) => {
    v = v ?? null;
    if (kind === 'RandomListNode') {
      const nodes = []; const index = new Map();
      while (v !== null) { if (index.has(v)) throw new Error('Returned list does not terminate'); index.set(v, nodes.length); nodes.push(v); v = v.next ?? null; }
      if (nodes.some(n => __inputs.has(n) || (n.random != null && __inputs.has(n.random)))) return ${shallow};
      if (nodes.some(n => n.random != null && !index.has(n.random))) throw new Error('A random pointer leaves the returned list');
      return nodes.map(n => [n.val, n.random == null ? null : index.get(n.random)]);
    }
    if (kind === 'GraphNode') {
      if (v === null) return [];
      const seen = new Set([v]); const queue = [v];
      for (let k = 0; k < queue.length; k++) for (const x of queue[k].neighbors ?? []) if (!seen.has(x)) { seen.add(x); queue.push(x); }
      if (queue.some(n => __inputs.has(n))) return ${shallow};
      return [...queue].sort((a, b) => a.val - b.val).map(n => (n.neighbors ?? []).map(x => x.val));
    }
    if (kind === 'NaryNode') {
      if (v === null) return [];
      const out = [v.val, null]; const queue = [v];
      for (let k = 0; k < queue.length; k++) { for (const child of queue[k].children ?? []) { out.push(child.val); queue.push(child); } out.push(null); if (queue.length > 2000000) throw new Error('Returned tree is too large'); }
      while (out.length > 0 && out[out.length - 1] === null) out.pop();
      return out;
    }
    const levels = []; let level = v === null ? [] : [v]; let total = 0;
    while (level.length > 0) {
      levels.push(level); total += level.length;
      if (total > 2000000) throw new Error('Returned tree is too large');
      level = level.flatMap(n => [n.left ?? null, n.right ?? null]).filter(c => c !== null);
    }
    const out = [];
    for (const row of levels) {
      let count = 0;
      for (let node = row[0]; node != null; node = node.next) { if (++count > total) throw new Error('Next pointers do not terminate'); out.push(node.val); }
      out.push('#');
    }
    return out;
  };
`

export interface CompiledNodeCode { readonly decode: string; readonly encode: string }

/** C++: `dec` and `enc` overloads for `Node*` inside namespace `__manor`. */
export function cppNodeCode(kind: NodeKind): CompiledNodeCode {
  const registry = 'static std::unordered_set<const void*> inputs;\n'
  const join = 'o += \'[\'; for (size_t k = 0; k < out.size(); k++) { if (k) o += \',\'; o += out[k]; } o += \']\';'
  if (kind === 'RandomListNode') return {
    decode: registry + 'inline void dec(const J& j, Node*& v) { std::vector<Node*> nodes; for (const J& pair : j.a) { Node* n = new Node(std::stoi(pair.a.at(0).s)); n->next = nullptr; n->random = nullptr; nodes.push_back(n); inputs.insert(n); } for (size_t k = 0; k < nodes.size(); k++) { if (k + 1 < nodes.size()) nodes[k]->next = nodes[k + 1]; if (j.a[k].a.at(1).t != 0) nodes[k]->random = nodes.at(std::stoul(j.a[k].a[1].s)); } v = nodes.empty() ? nullptr : nodes[0]; }',
    encode: `inline void enc(std::string& o, Node* v) { std::vector<Node*> nodes; std::unordered_map<Node*, size_t> index; for (Node* n = v; n != nullptr; n = n->next) { if (index.count(n)) throw std::runtime_error("Returned list does not terminate"); index[n] = nodes.size(); nodes.push_back(n); } for (Node* n : nodes) if (inputs.count(n) || (n->random != nullptr && inputs.count(n->random))) { o += ${JSON.stringify(shallow)}; return; } std::vector<std::string> out; for (Node* n : nodes) { std::string item = "[" + std::to_string(n->val) + ","; if (n->random == nullptr) item += "null"; else { auto at = index.find(n->random); if (at == index.end()) throw std::runtime_error("A random pointer leaves the returned list"); item += std::to_string(at->second); } out.push_back(item + "]"); } ${join} }`,
  }
  if (kind === 'GraphNode') return {
    decode: registry + 'inline void dec(const J& j, Node*& v) { std::vector<Node*> nodes; for (size_t k = 0; k < j.a.size(); k++) { Node* n = new Node((int)k + 1); n->neighbors.clear(); nodes.push_back(n); inputs.insert(n); } for (size_t k = 0; k < j.a.size(); k++) for (const J& x : j.a[k].a) nodes[k]->neighbors.push_back(nodes.at(std::stoul(x.s) - 1)); v = nodes.empty() ? nullptr : nodes[0]; }',
    encode: `inline void enc(std::string& o, Node* v) { if (v == nullptr) { o += "[]"; return; } std::vector<Node*> q{v}; std::unordered_set<Node*> seen{v}; for (size_t k = 0; k < q.size(); k++) for (Node* x : q[k]->neighbors) { if (x == nullptr) throw std::runtime_error("A neighbor is null"); if (seen.insert(x).second) q.push_back(x); } for (Node* n : q) if (inputs.count(n)) { o += ${JSON.stringify(shallow)}; return; } std::stable_sort(q.begin(), q.end(), [](Node* a, Node* b) { return a->val < b->val; }); std::vector<std::string> out; for (Node* n : q) { std::string item = "["; for (size_t m = 0; m < n->neighbors.size(); m++) { if (m) item += ','; item += std::to_string(n->neighbors[m]->val); } out.push_back(item + "]"); } ${join} }`,
  }
  if (kind === 'NaryNode') return {
    decode: 'inline void dec(const J& j, Node*& v) { v = nullptr; if (j.a.empty()) return; v = new Node(std::stoi(j.a[0].s)); v->children.clear(); std::vector<Node*> q{v}; size_t i = 2, k = 0; while (i < j.a.size()) { Node* node = q.at(k++); while (i < j.a.size() && j.a[i].t != 0) { Node* c = new Node(std::stoi(j.a[i].s)); c->children.clear(); node->children.push_back(c); q.push_back(c); i++; } i++; } }',
    encode: `inline void enc(std::string& o, Node* v) { if (v == nullptr) { o += "[]"; return; } std::vector<std::string> out{std::to_string(v->val), "null"}; std::vector<Node*> q{v}; for (size_t k = 0; k < q.size(); k++) { for (Node* c : q[k]->children) { if (c == nullptr) throw std::runtime_error("A child is null"); out.push_back(std::to_string(c->val)); q.push_back(c); } out.push_back("null"); if (q.size() > 2000000) throw std::runtime_error("Returned tree is too large"); } while (!out.empty() && out.back() == "null") out.pop_back(); ${join} }`,
  }
  return {
    decode: 'inline void dec(const J& j, Node*& v) { v = nullptr; if (j.a.empty() || j.a[0].t == 0) return; v = new Node(std::stoi(j.a[0].s)); v->left = v->right = v->next = nullptr; std::vector<Node*> q{v}; size_t i = 1, k = 0; while (i < j.a.size()) { Node* node = q[k++]; if (j.a[i].t != 0) { node->left = new Node(std::stoi(j.a[i].s)); node->left->left = node->left->right = node->left->next = nullptr; q.push_back(node->left); } i++; if (i < j.a.size() && j.a[i].t != 0) { node->right = new Node(std::stoi(j.a[i].s)); node->right->left = node->right->right = node->right->next = nullptr; q.push_back(node->right); } i++; } }',
    encode: `inline void enc(std::string& o, Node* v) { std::vector<std::vector<Node*>> levels; std::vector<Node*> level; if (v != nullptr) level.push_back(v); size_t total = 0; while (!level.empty()) { total += level.size(); if (total > 2000000) throw std::runtime_error("Returned tree is too large"); std::vector<Node*> below; for (Node* n : level) { if (n->left) below.push_back(n->left); if (n->right) below.push_back(n->right); } levels.push_back(level); level = below; } std::vector<std::string> out; for (auto& row : levels) { size_t count = 0; for (Node* n = row[0]; n != nullptr; n = n->next) { if (++count > total) throw std::runtime_error("Next pointers do not terminate"); out.push_back(std::to_string(n->val)); } out.push_back("\\"#\\""); } ${join} }`,
  }
}

/** Java: static `d_<Kind>` decoders and `e_<Kind>` encoders inside class Main; typed encoders print `[]` for null. */
export function javaNodeCode(kind: NodeKind): CompiledNodeCode {
  const list = 'java.util.List<Object>'
  const registry = '  static java.util.Set<Object> inputs = java.util.Collections.newSetFromMap(new java.util.IdentityHashMap<>());\n'
  if (kind === 'RandomListNode') return {
    decode: registry + `  static Node d_RandomListNode(Object o) { ${list} l = (${list}) o; java.util.ArrayList<Node> nodes = new java.util.ArrayList<>(); for (Object x : l) { Node n = new Node(d_int(((${list}) x).get(0))); n.next = null; n.random = null; nodes.add(n); inputs.add(n); } for (int k = 0; k < nodes.size(); k++) { if (k + 1 < nodes.size()) nodes.get(k).next = nodes.get(k + 1); Object r = ((${list}) l.get(k)).get(1); if (r != null) nodes.get(k).random = nodes.get(d_int(r)); } return nodes.isEmpty() ? null : nodes.get(0); }`,
    encode: `  static void e_RandomListNode(StringBuilder b, Node v) { java.util.ArrayList<Node> nodes = new java.util.ArrayList<>(); java.util.IdentityHashMap<Node, Integer> index = new java.util.IdentityHashMap<>(); for (Node n = v; n != null; n = n.next) { if (index.containsKey(n)) throw new IllegalStateException("Returned list does not terminate"); index.put(n, nodes.size()); nodes.add(n); } for (Node n : nodes) if (inputs.contains(n) || (n.random != null && inputs.contains(n.random))) { str(b, ${shallow}); return; } b.append('['); for (int k = 0; k < nodes.size(); k++) { Node n = nodes.get(k); if (k > 0) b.append(','); b.append('[').append(n.val).append(','); if (n.random == null) b.append("null"); else { Integer at = index.get(n.random); if (at == null) throw new IllegalStateException("A random pointer leaves the returned list"); b.append(at); } b.append(']'); } b.append(']'); }`,
  }
  if (kind === 'GraphNode') return {
    decode: registry + `  static Node d_GraphNode(Object o) { ${list} l = (${list}) o; java.util.ArrayList<Node> nodes = new java.util.ArrayList<>(); for (int k = 0; k < l.size(); k++) { Node n = new Node(k + 1); n.neighbors = new java.util.ArrayList<>(); nodes.add(n); inputs.add(n); } for (int k = 0; k < l.size(); k++) for (Object x : (${list}) l.get(k)) nodes.get(k).neighbors.add(nodes.get(d_int(x) - 1)); return nodes.isEmpty() ? null : nodes.get(0); }`,
    encode: `  static void e_GraphNode(StringBuilder b, Node v) { if (v == null) { b.append("[]"); return; } java.util.ArrayList<Node> q = new java.util.ArrayList<>(); q.add(v); java.util.Set<Node> seen = java.util.Collections.newSetFromMap(new java.util.IdentityHashMap<>()); seen.add(v); for (int k = 0; k < q.size(); k++) if (q.get(k).neighbors != null) for (Node x : q.get(k).neighbors) if (seen.add(x)) q.add(x); for (Node n : q) if (inputs.contains(n)) { str(b, ${shallow}); return; } q.sort((x, y) -> Integer.compare(x.val, y.val)); b.append('['); for (int k = 0; k < q.size(); k++) { if (k > 0) b.append(','); b.append('['); java.util.List<Node> adjacent = q.get(k).neighbors == null ? java.util.List.of() : q.get(k).neighbors; for (int m = 0; m < adjacent.size(); m++) { if (m > 0) b.append(','); b.append(adjacent.get(m).val); } b.append(']'); } b.append(']'); }`,
  }
  if (kind === 'NaryNode') return {
    decode: `  static Node d_NaryNode(Object o) { ${list} l = (${list}) o; if (l.isEmpty()) return null; Node root = new Node(d_int(l.get(0))); root.children = new java.util.ArrayList<>(); java.util.ArrayList<Node> q = new java.util.ArrayList<>(); q.add(root); int i = 2, k = 0; while (i < l.size()) { Node node = q.get(k++); while (i < l.size() && l.get(i) != null) { Node c = new Node(d_int(l.get(i))); c.children = new java.util.ArrayList<>(); node.children.add(c); q.add(c); i++; } i++; } return root; }`,
    encode: '  static void e_NaryNode(StringBuilder b, Node v) { if (v == null) { b.append("[]"); return; } java.util.ArrayList<String> out = new java.util.ArrayList<>(); out.add(Integer.toString(v.val)); out.add("null"); java.util.ArrayList<Node> q = new java.util.ArrayList<>(); q.add(v); for (int k = 0; k < q.size(); k++) { if (q.get(k).children != null) for (Node c : q.get(k).children) { out.add(Integer.toString(c.val)); q.add(c); } out.add("null"); if (q.size() > 2000000) throw new IllegalStateException("Returned tree is too large"); } while (!out.isEmpty() && out.get(out.size() - 1).equals("null")) out.remove(out.size() - 1); b.append(\'[\').append(String.join(",", out)).append(\']\'); }',
  }
  return {
    decode: `  static Node d_NextNode(Object o) { ${list} l = (${list}) o; if (l.isEmpty() || l.get(0) == null) return null; Node root = new Node(d_int(l.get(0))); root.left = root.right = root.next = null; java.util.ArrayList<Node> q = new java.util.ArrayList<>(); q.add(root); int i = 1, k = 0; while (i < l.size()) { Node node = q.get(k++); if (l.get(i) != null) { node.left = new Node(d_int(l.get(i))); node.left.left = node.left.right = node.left.next = null; q.add(node.left); } i++; if (i < l.size() && l.get(i) != null) { node.right = new Node(d_int(l.get(i))); node.right.left = node.right.right = node.right.next = null; q.add(node.right); } i++; } return root; }`,
    encode: '  static void e_NextNode(StringBuilder b, Node v) { java.util.ArrayList<java.util.ArrayList<Node>> levels = new java.util.ArrayList<>(); java.util.ArrayList<Node> level = new java.util.ArrayList<>(); if (v != null) level.add(v); int total = 0; while (!level.isEmpty()) { total += level.size(); if (total > 2000000) throw new IllegalStateException("Returned tree is too large"); java.util.ArrayList<Node> below = new java.util.ArrayList<>(); for (Node n : level) { if (n.left != null) below.add(n.left); if (n.right != null) below.add(n.right); } levels.add(level); level = below; } java.util.ArrayList<String> out = new java.util.ArrayList<>(); for (java.util.ArrayList<Node> row : levels) { int count = 0; for (Node n = row.get(0); n != null; n = n.next) { if (++count > total) throw new IllegalStateException("Next pointers do not terminate"); out.add(Integer.toString(n.val)); } out.add("\\"#\\""); } b.append(\'[\').append(String.join(",", out)).append(\']\'); }',
  }
}

/** Go: `__manor_d_<Kind>` decoders and one `__manor_e_node` encoder that `__manor_enc` calls for `*Node`. */
export function goNodeCode(kind: NodeKind): CompiledNodeCode {
  const registry = 'var __manor_inputs = map[*Node]bool{}\n'
  const join = 'b.WriteString("[" + __manor_strings.Join(out, ",") + "]")'
  const head = 'func __manor_e_node(b *__manor_strings.Builder, v *Node) {'
  if (kind === 'RandomListNode') return {
    decode: registry + 'func __manor_d_RandomListNode(v interface{}) *Node { l := v.([]interface{}); nodes := make([]*Node, len(l)); for i, x := range l { nodes[i] = &Node{Val: __manor_d_int(x.([]interface{})[0])}; __manor_inputs[nodes[i]] = true }; for i, x := range l { if i+1 < len(l) { nodes[i].Next = nodes[i+1] }; if r := x.([]interface{})[1]; r != nil { nodes[i].Random = nodes[__manor_d_int(r)] } }; if len(nodes) == 0 { return nil }; return nodes[0] }',
    encode: `${head} nodes := []*Node{}; index := map[*Node]int{}; for n := v; n != nil; n = n.Next { if _, ok := index[n]; ok { panic("Returned list does not terminate") }; index[n] = len(nodes); nodes = append(nodes, n) }; for _, n := range nodes { if __manor_inputs[n] || (n.Random != nil && __manor_inputs[n.Random]) { __manor_string(b, ${shallow}); return } }; out := []string{}; for _, n := range nodes { item := "[" + __manor_strconv.Itoa(n.Val) + ","; if n.Random == nil { item += "null" } else { at, ok := index[n.Random]; if !ok { panic("A random pointer leaves the returned list") }; item += __manor_strconv.Itoa(at) }; out = append(out, item+"]") }; ${join} }`,
  }
  if (kind === 'GraphNode') return {
    decode: registry + 'func __manor_d_GraphNode(v interface{}) *Node { l := v.([]interface{}); nodes := make([]*Node, len(l)); for i := range l { nodes[i] = &Node{Val: i + 1}; __manor_inputs[nodes[i]] = true }; for i, x := range l { for _, j := range x.([]interface{}) { nodes[i].Neighbors = append(nodes[i].Neighbors, nodes[__manor_d_int(j)-1]) } }; if len(nodes) == 0 { return nil }; return nodes[0] }',
    encode: `${head} if v == nil { b.WriteString("[]"); return }; q := []*Node{v}; seen := map[*Node]bool{v: true}; for k := 0; k < len(q); k++ { for _, x := range q[k].Neighbors { if !seen[x] { seen[x] = true; q = append(q, x) } } }; for _, n := range q { if __manor_inputs[n] { __manor_string(b, ${shallow}); return } }; for i := 1; i < len(q); i++ { for j := i; j > 0 && q[j-1].Val > q[j].Val; j-- { q[j-1], q[j] = q[j], q[j-1] } }; out := []string{}; for _, n := range q { items := []string{}; for _, x := range n.Neighbors { items = append(items, __manor_strconv.Itoa(x.Val)) }; out = append(out, "["+__manor_strings.Join(items, ",")+"]") }; ${join} }`,
  }
  if (kind === 'NaryNode') return {
    decode: 'func __manor_d_NaryNode(v interface{}) *Node { l := v.([]interface{}); if len(l) == 0 { return nil }; root := &Node{Val: __manor_d_int(l[0])}; q := []*Node{root}; i, k := 2, 0; for i < len(l) { node := q[k]; k++; for i < len(l) && l[i] != nil { child := &Node{Val: __manor_d_int(l[i])}; node.Children = append(node.Children, child); q = append(q, child); i++ }; i++ }; return root }',
    encode: `${head} if v == nil { b.WriteString("[]"); return }; out := []string{__manor_strconv.Itoa(v.Val), "null"}; q := []*Node{v}; for k := 0; k < len(q); k++ { for _, c := range q[k].Children { out = append(out, __manor_strconv.Itoa(c.Val)); q = append(q, c) }; out = append(out, "null"); if len(q) > 2000000 { panic("Returned tree is too large") } }; for len(out) > 0 && out[len(out)-1] == "null" { out = out[:len(out)-1] }; ${join} }`,
  }
  return {
    decode: 'func __manor_d_NextNode(v interface{}) *Node { l := v.([]interface{}); if len(l) == 0 || l[0] == nil { return nil }; root := &Node{Val: __manor_d_int(l[0])}; q := []*Node{root}; i, k := 1, 0; for i < len(l) { node := q[k]; k++; if l[i] != nil { node.Left = &Node{Val: __manor_d_int(l[i])}; q = append(q, node.Left) }; i++; if i < len(l) && l[i] != nil { node.Right = &Node{Val: __manor_d_int(l[i])}; q = append(q, node.Right) }; i++ }; return root }',
    encode: `${head} levels := [][]*Node{}; level := []*Node{}; if v != nil { level = append(level, v) }; total := 0; for len(level) > 0 { total += len(level); if total > 2000000 { panic("Returned tree is too large") }; below := []*Node{}; for _, n := range level { if n.Left != nil { below = append(below, n.Left) }; if n.Right != nil { below = append(below, n.Right) } }; levels = append(levels, level); level = below }; out := []string{}; for _, row := range levels { count := 0; for n := row[0]; n != nil; n = n.Next { count++; if count > total { panic("Next pointers do not terminate") }; out = append(out, __manor_strconv.Itoa(n.Val)) }; out = append(out, "\\"#\\"") }; ${join} }`,
  }
}
