/**
 * Types the judge provides rather than the solution: hidden APIs and LeetCode's `NestedInteger`. Starter code shows
 * them as comments, as familiar judges do, and the drivers supply their implementations.
 */
import { allTypes, cppParam, cppType, goType, javaType, jsType, pyType, typeOf, upperFirst, type HarnessApi, type HarnessLanguage, type HarnessMethod, type ProblemInterface } from './problemInterface.ts'

function apiComment(api: HarnessApi, language: HarnessLanguage): string {
  const returns = (m: HarnessMethod, map: (t: ReturnType<typeof typeOf>) => string, none: string): string => m.returns === 'void' ? none : map(typeOf(m.returns))
  const params = (m: HarnessMethod, format: (name: string, type: string) => string): string => m.params.map(p => format(p.name, p.type)).join(', ')
  const methods = api.methods
  if (language === 'python') return api.global
    ? `# The judge defines these functions for you:\n${methods.map(m => `# def ${m.name}(${params(m, (n, t) => `${n}: ${pyType(typeOf(t))}`)}) -> ${returns(m, pyType, 'None')}:\n`).join('')}`
    : `# The judge provides this API; do not implement it:\n# class ${api.name}:\n${methods.map(m => `#     def ${m.name}(self${m.params.map(p => `, ${p.name}: ${pyType(typeOf(p.type))}`).join('')}) -> ${returns(m, pyType, 'None')}:\n`).join('')}`
  if (language === 'javascript') return api.global
    ? `// The judge defines these functions for you:\n${methods.map(m => `// var ${m.name} = function(${m.params.map(p => p.name).join(', ')}) {} // returns ${returns(m, jsType, 'void')}\n`).join('')}`
    : `// The judge provides this API; do not implement it:\n// class ${api.name} {\n${methods.map(m => `//     ${m.name}(${m.params.map(p => p.name).join(', ')}) {} // returns ${returns(m, jsType, 'void')}\n`).join('')}// }\n`
  if (language === 'cpp') return api.global
    ? `// The judge defines these functions for you:\n${methods.map(m => `// ${returns(m, cppType, 'void')} ${m.name}(${params(m, (n, t) => `${cppParam(typeOf(t))} ${n}`)});\n`).join('')}`
    : `// The judge provides this API; do not implement it:\n// class ${api.name} {\n// public:\n${methods.map(m => `//     ${returns(m, cppType, 'void')} ${m.name}(${params(m, (n, t) => `${cppParam(typeOf(t))} ${n}`)});\n`).join('')}// };\n`
  if (language === 'java') return api.global
    ? `// The parent class ${api.name} defines these methods for you:\n${methods.map(m => `//     ${returns(m, javaType, 'void')} ${m.name}(${params(m, (n, t) => `${javaType(typeOf(t))} ${n}`)});\n`).join('')}`
    : `// The judge provides this API; do not implement it:\n// class ${api.name} {\n${methods.map(m => `//     public ${returns(m, javaType, 'void')} ${m.name}(${params(m, (n, t) => `${javaType(typeOf(t))} ${n}`)});\n`).join('')}// }\n`
  return api.global
    ? `// The judge defines these functions for you:\n${methods.map(m => `// func ${m.name}(${params(m, (n, t) => `${n} ${goType(typeOf(t))}`)})${m.returns === 'void' ? '' : ' ' + goType(typeOf(m.returns))}\n`).join('')}`
    : `// The judge provides this API; do not implement it:\n// type ${api.name} struct{}\n${methods.map(m => `// func (this *${api.name}) ${upperFirst(m.name)}(${params(m, (n, t) => `${n} ${goType(typeOf(t))}`)})${m.returns === 'void' ? '' : ' ' + goType(typeOf(m.returns))}\n`).join('')}`
}

const nestedComments: Record<HarnessLanguage, string> = {
  python: '# The judge provides NestedInteger; do not implement it:\n# class NestedInteger:\n#     def __init__(self, value=None):  # an empty list, or a single integer\n#     def isInteger(self) -> bool:\n#     def add(self, elem: NestedInteger) -> None:  # makes this a list and appends elem\n#     def setInteger(self, value: int) -> None:\n#     def getInteger(self) -> int:  # None when this holds a list\n#     def getList(self) -> List[NestedInteger]:  # None when this holds an integer\n',
  javascript: '// The judge provides NestedInteger; do not implement it:\n// function NestedInteger(value) {  // an empty list, or a single integer\n//     this.isInteger = function() {}  // returns boolean\n//     this.getInteger = function() {}  // null when this holds a list\n//     this.setInteger = function(value) {}\n//     this.add = function(elem) {}  // makes this a list and appends elem\n//     this.getList = function() {}  // null when this holds an integer\n// }\n',
  cpp: '// The judge provides NestedInteger; do not implement it:\n// class NestedInteger {\n// public:\n//     NestedInteger();  // an empty list\n//     NestedInteger(int value);  // a single integer\n//     bool isInteger() const;\n//     int getInteger() const;\n//     void setInteger(int value);\n//     void add(const NestedInteger &ni);  // makes this a list and appends ni\n//     const vector<NestedInteger> &getList() const;\n// };\n',
  java: '// The judge provides NestedInteger; do not implement it:\n// class NestedInteger {\n//     public NestedInteger();  // an empty list\n//     public NestedInteger(int value);  // a single integer\n//     public boolean isInteger();\n//     public Integer getInteger();  // null when this holds a list\n//     public void setInteger(int value);\n//     public void add(NestedInteger ni);  // makes this a list and appends ni\n//     public List<NestedInteger> getList();  // empty when this holds an integer\n// }\n',
  go: '// The judge provides NestedInteger; do not implement it:\n// type NestedInteger struct{}\n// func (n NestedInteger) IsInteger() bool\n// func (n NestedInteger) GetInteger() int\n// func (n *NestedInteger) SetInteger(value int)\n// func (n *NestedInteger) Add(elem NestedInteger)  // makes n a list and appends elem\n// func (n NestedInteger) GetList() []*NestedInteger\n',
}

/** Comment blocks describing what the judge provides, for starter code. */
export function providedComments(spec: ProblemInterface, language: HarnessLanguage): string {
  const parts = spec.kind === 'codec' ? [] : (spec.apis ?? []).map(api => apiComment(api, language))
  if (allTypes(spec).some(t => t.tag === 'nested')) parts.push(nestedComments[language])
  return parts.join('\n')
}

/** LeetCode's NestedInteger in each language. The drivers build and read it through its own methods. */
export const nestedImplementations: Record<HarnessLanguage, string> = {
  python: `class NestedInteger:
    def __init__(self, value=None):
        self._value = value
        self._list = None if value is not None else []
    def isInteger(self):
        return self._list is None
    def add(self, elem):
        if self._list is None: self._list = []; self._value = None
        self._list.append(elem)
    def setInteger(self, value):
        self._value = value; self._list = None
    def getInteger(self):
        return self._value if self._list is None else None
    def getList(self):
        return self._list
`,
  javascript: `function NestedInteger(value) {
    this._value = value === undefined ? null : value;
    this._list = value === undefined ? [] : null;
}
NestedInteger.prototype.isInteger = function() { return this._list === null; };
NestedInteger.prototype.getInteger = function() { return this._list === null ? this._value : null; };
NestedInteger.prototype.setInteger = function(value) { this._value = value; this._list = null; };
NestedInteger.prototype.add = function(elem) { if (this._list === null) { this._list = []; this._value = null; } this._list.push(elem); };
NestedInteger.prototype.getList = function() { return this._list; };
`,
  cpp: `class NestedInteger {
  bool integer_ = false; int value_ = 0; std::vector<NestedInteger> list_;
public:
  NestedInteger() {}
  NestedInteger(int value) : integer_(true), value_(value) {}
  bool isInteger() const { return integer_; }
  int getInteger() const { return integer_ ? value_ : 0; }
  void setInteger(int value) { integer_ = true; value_ = value; list_.clear(); }
  void add(const NestedInteger& ni) { if (integer_) { integer_ = false; value_ = 0; } list_.push_back(ni); }
  const std::vector<NestedInteger>& getList() const { return list_; }
};
`,
  java: `class NestedInteger {
  private Integer value; private java.util.List<NestedInteger> list;
  public NestedInteger() { list = new java.util.ArrayList<>(); }
  public NestedInteger(int value) { this.value = value; }
  public boolean isInteger() { return list == null; }
  public Integer getInteger() { return list == null ? value : null; }
  public void setInteger(int value) { this.value = value; list = null; }
  public void add(NestedInteger ni) { if (list == null) { list = new java.util.ArrayList<>(); value = null; } list.add(ni); }
  public java.util.List<NestedInteger> getList() { return list == null ? new java.util.ArrayList<>() : list; }
}
`,
  go: `type NestedInteger struct { __manor_integer bool; __manor_value int; __manor_list []*NestedInteger }
func (n NestedInteger) IsInteger() bool { return n.__manor_integer }
func (n NestedInteger) GetInteger() int { return n.__manor_value }
func (n *NestedInteger) SetInteger(value int) { n.__manor_integer = true; n.__manor_value = value; n.__manor_list = nil }
func (n *NestedInteger) Add(elem NestedInteger) { if n.__manor_integer { n.__manor_integer = false; n.__manor_value = 0 }; e := elem; n.__manor_list = append(n.__manor_list, &e) }
func (n NestedInteger) GetList() []*NestedInteger { return n.__manor_list }
`,
}
