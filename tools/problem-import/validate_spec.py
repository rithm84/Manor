"""Validate one authored problem spec directory and emit its import-ready content and testset.

A spec directory holds meta.json, statement.md, optional solution.md, and for executable problems
reference.py, optional oracle.py, and tests.py. The reference runs through the same Python driver the
judge uses; the independent oracle must agree on every case small enough for it; expected answers come
only from that cross-checked reference. Usage: python3 validate_spec.py <spec-dir> [<spec-dir> ...]
Writes <spec-dir>/validated.json on success and prints one JSON result line per spec.
"""
from __future__ import annotations

import ctypes
import json
import math
import os
import random
import re
import resource
import signal
import subprocess
import sys
import tempfile
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

TOOLS = Path(__file__).resolve().parent
ROOT = TOOLS.parent.parent
MARKER = "\x1eMANOR "
KINDS = {"coding", "system_design", "behavioral", "other"}
MODES = {"function", "class", "codec", "stdin", "none"}
ROUNDS = {"Online assessment", "Phone screen", "Onsite", "Take-home"}
CHECKERS = {"exact", "trimmed", "json", "numeric", "json_unordered", "json_unordered_deep", "json_tolerant", "special"}
MAX_CASES = 200
MAX_TESTSET_BYTES = 400_000
MAX_INPUT_BYTES = 1_048_576
MAX_ANSWER_BYTES = 65_536
INT32 = (-(2**31), 2**31 - 1)
INT64 = (-(2**63), 2**63 - 1)


class SpecError(Exception):
    """A spec defect the author must fix; the message names the file and the failing case."""


class Taxonomy(set):
    """The current pattern labels, plus the retired labels that map onto them (None for a dropped label)."""
    retired: dict


def taxonomy() -> Taxonomy:
    script = "import('" + str(ROOT / "app/src/shared/problemTopics.ts") + "').then(m => console.log(JSON.stringify([m.PROBLEM_TOPICS, m.RETIRED_PROBLEM_TOPICS ?? {}])))"
    current, retired = json.loads(subprocess.run(["node", "-e", script], check=True, capture_output=True, text=True).stdout)
    labels = Taxonomy(current)
    labels.retired = retired
    return labels


def current_topics(topics: list, vocabulary: set) -> list:
    """Translates retired labels to their current pattern, dropping labels retired without a replacement."""
    retired = getattr(vocabulary, "retired", {})
    mapped = [retired.get(topic) if topic in retired else topic for topic in topics]
    return list(dict.fromkeys(topic for topic in mapped if topic is not None))


def node_json(request: dict) -> str:
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
        json.dump(request, handle)
    try:
        result = subprocess.run(["node", str(TOOLS / "assemble.mjs"), handle.name], capture_output=True, text=True)
    finally:
        os.unlink(handle.name)
    if result.returncode != 0:
        raise SpecError("Interface rejected by the harness: " + result.stderr.strip().splitlines()[-1] if result.stderr.strip() else "Interface rejected")
    return result.stdout


# ---------- Types ----------
def parse_type(text: str) -> tuple:
    text = text.strip()
    if text.endswith("[]"):
        return ("seq", parse_type(text[:-2]))
    if text.startswith("list<") and text.endswith(">"):
        return ("seq", parse_type(text[5:-1]))
    return (text,)


def is_int32(value) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and INT32[0] <= value <= INT32[1]


def check_value(t: tuple, value, where: str) -> None:
    kind = t[0]
    if kind == "seq":
        if not isinstance(value, list):
            raise SpecError(f"{where}: expected an array")
        for index, item in enumerate(value):
            check_value(t[1], item, f"{where}[{index}]")
        return
    if kind in ("int", "long"):
        low, high = INT32 if kind == "int" else INT64
        if not isinstance(value, int) or isinstance(value, bool) or not low <= value <= high:
            raise SpecError(f"{where}: expected a {kind} within its range, got {value!r}")
        return
    if kind == "double":
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise SpecError(f"{where}: expected a finite number")
        return
    if kind == "bool":
        if not isinstance(value, bool):
            raise SpecError(f"{where}: expected a boolean")
        return
    if kind in ("string", "char"):
        if not isinstance(value, str) or not value.isascii():
            raise SpecError(f"{where}: expected an ASCII string (non-ASCII text differs across languages)")
        if kind == "char" and len(value) != 1:
            raise SpecError(f"{where}: expected exactly one character")
        return
    if kind == "ListNode":
        if not isinstance(value, list) or any(not isinstance(v, int) or isinstance(v, bool) or not INT32[0] <= v <= INT32[1] for v in value):
            raise SpecError(f"{where}: a ListNode is an array of 32-bit integers")
        return
    if kind in ("TreeNode", "NextNode"):
        if not isinstance(value, list) or any(v is not None and (not isinstance(v, int) or isinstance(v, bool) or not INT32[0] <= v <= INT32[1]) for v in value):
            raise SpecError(f"{where}: a {kind} is a level-order array of 32-bit integers and nulls")
        if value and value[0] is None:
            raise SpecError(f"{where}: an empty tree is [] rather than [null]")
        if value and value[-1] is None:
            raise SpecError(f"{where}: remove trailing nulls from the level-order tree")
        return
    if kind == "RandomListNode":
        if not isinstance(value, list) or not all(isinstance(pair, list) and len(pair) == 2 and is_int32(pair[0]) and (pair[1] is None or (is_int32(pair[1]) and 0 <= pair[1] < len(value))) for pair in value):
            raise SpecError(f"{where}: a RandomListNode is an array of [val, randomIndex] pairs, where randomIndex is null or an index into the list")
        return
    if kind == "GraphNode":
        if not isinstance(value, list) or not all(isinstance(adjacent, list) and all(is_int32(j) and 1 <= j <= len(value) for j in adjacent) for adjacent in value):
            raise SpecError(f"{where}: a GraphNode is an adjacency list where entry i lists the neighbors of node i + 1 by value (1 to n); [] is no graph")
        reached = {1} if value else set()
        stack = list(reached)
        while stack:
            for j in value[stack.pop() - 1]:
                if j not in reached:
                    reached.add(j)
                    stack.append(j)
        if len(reached) != len(value):
            raise SpecError(f"{where}: every node must be reachable from node 1, because the graph is read and printed from node 1")
        return
    if kind == "NaryNode":
        if not isinstance(value, list) or any(v is not None and not is_int32(v) for v in value):
            raise SpecError(f"{where}: an NaryNode is a level-order array of 32-bit integers with null after each child group")
        if value:
            if value[0] is None:
                raise SpecError(f"{where}: an empty N-ary tree is [] rather than [null]")
            if len(value) > 1 and value[1] is not None:
                raise SpecError(f"{where}: the root value is followed by null before its children, as in [1,null,3,2,4]")
            if value[-1] is None:
                raise SpecError(f"{where}: remove trailing nulls from the N-ary tree")
            nodes, groups, index = 1, 0, 2
            while index < len(value):
                if groups >= nodes:
                    raise SpecError(f"{where}: the N-ary tree has more child groups than nodes")
                while index < len(value) and value[index] is not None:
                    nodes += 1
                    index += 1
                groups += 1
                index += 1
        return
    if kind in ("SinglyListNode", "DoublyListNode"):
        return check_value(("ListNode",), value, where)
    if kind in ("BiNode", "ParentNode"):
        return check_value(("TreeNode",), value, where)
    if kind == "ExprNode":
        if not isinstance(value, list) or any(v is not None and (not isinstance(v, str) or len(v) != 1 or not v.isascii()) for v in value) or (value and (value[0] is None or value[-1] is None)):
            raise SpecError(f"{where}: an expression tree is a level-order array of single characters and nulls, without leading or trailing nulls")
        return
    if kind == "MultilevelNode":
        if not isinstance(value, list) or any(v is not None and not is_int32(v) for v in value):
            raise SpecError(f"{where}: a multilevel list is an array of 32-bit integers and nulls")
        return
    if kind == "QuadNode":
        if not isinstance(value, list) or any(v is not None and not (isinstance(v, list) and len(v) == 2 and all(x in (0, 1) and not isinstance(x, bool) for x in v)) for v in value):
            raise SpecError(f"{where}: a quad tree is a level-order array of [isLeaf, val] pairs of 0 or 1, and nulls")
        return
    if kind in ("RandomTreeNode", "NodeCopy"):
        if not isinstance(value, list) or any(v is not None and not (isinstance(v, list) and len(v) == 2 and is_int32(v[0]) and (v[1] is None or (is_int32(v[1]) and 0 <= v[1] < len(value)))) for v in value):
            raise SpecError(f"{where}: a random-pointer tree is a level-order array of [val, randomIndex] pairs and nulls")
        return
    if kind == "RopeTreeNode":
        if not isinstance(value, list) or any(v is not None and not (is_int32(v) or (isinstance(v, str) and v.isascii())) for v in value):
            raise SpecError(f"{where}: a rope tree is a level-order array of lengths, strings, and nulls")
        return
    if kind == "Employee":
        if not (isinstance(value, list) and len(value) == 3 and is_int32(value[0]) and is_int32(value[1]) and isinstance(value[2], list) and all(is_int32(x) for x in value[2])):
            raise SpecError(f"{where}: an Employee is [id, importance, [subordinate ids]]")
        return
    if kind == "Interval":
        if not (isinstance(value, list) and len(value) == 2 and all(is_int32(x) for x in value)):
            raise SpecError(f"{where}: an Interval is [start, end]")
        return
    if kind == "NestedInteger":
        if is_int32(value):
            return
        if not isinstance(value, list):
            raise SpecError(f"{where}: a NestedInteger is an integer or a list of NestedInteger values")
        for index, item in enumerate(value):
            check_value(t, item, f"{where}[{index}]")
        return
    if kind == "buffer":
        if not is_int32(value) or not 0 <= value <= 1000000:
            raise SpecError(f"{where}: a buffer is given by its capacity, an integer from 0 to 1000000")
        return
    raise SpecError(f"{where}: unknown type {kind}")


def check_param(param: dict, value, where: str) -> None:
    """A reference names its node by value; a collection read with the nodes shape is one serialized tree."""
    if param.get("ref") is not None:
        if value is not None and not (is_int32(value) or (isinstance(value, str) and len(value) == 1)):
            raise SpecError(f"{where}: a node reference is the node's value, or null")
        return
    if param.get("shape") == "nodes":
        return check_value(("NaryNode",), value, where)
    check_value(parse_type(param["type"]), value, where)


def contains_double(t: tuple) -> bool:
    return t[0] == "double" or (t[0] == "seq" and contains_double(t[1]))


@dataclass
class Case:
    value: object
    text: str
    explanation: str | None
    origin: str


def case_text(spec: dict, value) -> str:
    mode = spec["mode"]
    if mode == "stdin":
        if not isinstance(value, str):
            raise SpecError("stdin cases must be strings")
        return value if value.endswith("\n") else value + "\n"
    if mode == "function":
        params = spec["lines"]
        if not isinstance(value, list) or len(value) != len(params):
            raise SpecError(f"function case must be a list of {len(params)} values ({', '.join(p['name'] for p in params)}): {json.dumps(value)[:200]}")
        for param, arg in zip(params, value):
            check_param(param, arg, param["name"])
        return "".join(json.dumps(arg, separators=(",", ":")) + "\n" for arg in value)
    if mode == "codec":
        param = spec["interface"]["encode"]["param"]
        check_value(parse_type(param["type"]), value, param["name"])
        return json.dumps(value, separators=(",", ":")) + "\n"
    interface = spec["interface"]
    if interface.get("concurrency"):
        return concurrent_case_text(interface, value)
    hidden = interface.get("hidden") or []
    if not isinstance(value, list) or len(value) != 2 + len(hidden) or not isinstance(value[0], list) or not isinstance(value[1], list) or len(value[0]) != len(value[1]) or not value[0]:
        raise SpecError(f"class case must be [operations, arguments{''.join(', ' + p['name'] for p in hidden)}] with equal nonempty operation and argument lengths")
    operations, arguments = value[:2]
    for param, arg in zip(hidden, value[2:]):
        check_value(parse_type(param["type"]), arg, param["name"])
    if operations[0] != interface["className"]:
        raise SpecError("class case must start with the class name")
    methods = {method["name"]: method for method in interface["methods"]}
    for index, (operation, args) in enumerate(zip(operations, arguments)):
        params = interface["constructorParams"] if index == 0 else methods.get(operation, {}).get("params")
        if params is None:
            raise SpecError(f"unknown operation {operation!r}")
        if not isinstance(args, list) or len(args) != len(params):
            raise SpecError(f"operation {index} ({operation}) needs {len(params)} arguments")
        for param, arg in zip(params, args):
            if param["type"] == interface["className"]:
                if not isinstance(arg, list) or len(arg) != len(interface["constructorParams"]):
                    raise SpecError(f"{operation}.{param['name']} is a {param['type']} given by its constructor arguments")
                for inner, item in zip(interface["constructorParams"], arg):
                    check_value(parse_type(inner["type"]), item, f"{operation}.{param['name']}.{inner['name']}")
            else:
                check_value(parse_type(param["type"]), arg, f"{operation}.{param['name']}")
    return "".join(json.dumps(item, separators=(",", ":")) + "\n" for item in value)


def concurrent_case_text(interface: dict, value) -> str:
    """A concurrent case is [constructor arguments, thread scripts]; each script lists [method, arguments] steps, and a
    ["$sleep", [milliseconds]] step pauses its thread, and a ["$join", []] step (in at most one thread) waits until every other thread has finished. A callback argument is the token its calls record."""
    if not isinstance(value, list) or len(value) != 2 or not isinstance(value[0], list) or not isinstance(value[1], list) or not value[1]:
        raise SpecError("concurrent case must be [constructor arguments, thread scripts] with at least one thread")
    constructor, scripts = value
    require(len(constructor) == len(interface["constructorParams"]), "constructor arguments do not match the constructor")
    for param, arg in zip(interface["constructorParams"], constructor):
        check_value(parse_type(param["type"]), arg, f"constructor.{param['name']}")
    require(len(scripts) <= 40, "a concurrent case runs at most 40 threads")
    require(sum(any(isinstance(step, list) and step[:1] == ["$join"] for step in script) for script in scripts if isinstance(script, list)) <= 1, "at most one thread may use $join, which waits for every other thread to finish")
    methods = {method["name"]: method for method in interface["methods"]}
    for t, script in enumerate(scripts):
        require(isinstance(script, list), f"thread {t} must be a list of steps")
        for step in script:
            require(isinstance(step, list) and len(step) == 2 and isinstance(step[1], list), f"thread {t} steps are [method, arguments]")
            if step[0] == "$sleep":
                require(len(step[1]) == 1 and is_int32(step[1][0]) and 0 <= step[1][0] <= 200, "a $sleep step waits 0 to 200 milliseconds")
                continue
            if step[0] == "$join":
                require(step[1] == [], "a $join step takes no arguments")
                continue
            require(step[0] in methods, f"thread {t} calls unknown method {step[0]!r}")
            params = methods[step[0]]["params"]
            require(len(step[1]) == len(params), f"thread {t} passes the wrong number of arguments to {step[0]}")
            for param, arg in zip(params, step[1]):
                if not param["type"].startswith("callback"):
                    check_value(parse_type(param["type"]), arg, f"{step[0]}.{param['name']}")
    return json.dumps(constructor, separators=(",", ":")) + "\n" + json.dumps(scripts, separators=(",", ":")) + "\n"


def display_input(spec: dict, case: Case) -> str:
    if spec["mode"] == "function":
        return ", ".join(f"{param['name']} = {json.dumps(arg, separators=(',', ':'))}" for param, arg in zip(spec["lines"], case.value))
    if spec["mode"] == "codec":
        return f"{spec['interface']['encode']['param']['name']} = {json.dumps(case.value, separators=(',', ':'))}"
    if spec["interface"].get("concurrency"):
        return f"constructor = {json.dumps(case.value[0], separators=(',', ':'))}, threads = {json.dumps(case.value[1], separators=(',', ':'))}"
    return case.text.rstrip("\n")


# Saved testsets live in PostgreSQL text and jsonb, which cannot hold U+0000, raw or as a JSON escape.
NUL_ESCAPE = re.compile(r"(?<!\\)(?:\\\\)*\\u0000")


def has_nul(text: str) -> bool:
    return "\x00" in text or NUL_ESCAPE.search(text) is not None


# ---------- Execution ----------
# Each program gets a 2 GiB address-space ceiling, so a runaway reference, oracle, or generator fails
# with a clear error instead of exhausting the machine that runs many validators at once. On Linux it
# also dies with the validator, so a killed validator never leaves its program spinning.
PROGRAM_MEMORY_BYTES = 2 << 30
TESTS_MEMORY_BYTES = 3 << 30
PR_SET_PDEATHSIG = 1
LIBC = ctypes.CDLL(None, use_errno=True) if sys.platform.startswith("linux") else None


@contextmanager
def tests_memory_ceiling():
    """tests.py runs inside the validator, so its loading and generation get a temporary soft ceiling."""
    if not sys.platform.startswith("linux"):
        yield
        return
    soft, hard = resource.getrlimit(resource.RLIMIT_AS)
    resource.setrlimit(resource.RLIMIT_AS, (TESTS_MEMORY_BYTES, hard))
    try:
        yield
    except MemoryError as error:
        raise SpecError(f"tests.py used more than {TESTS_MEMORY_BYTES >> 30} GiB while loading or generating cases; build smaller cases") from error
    finally:
        resource.setrlimit(resource.RLIMIT_AS, (soft, hard))


def limit_memory() -> None:
    resource.setrlimit(resource.RLIMIT_AS, (PROGRAM_MEMORY_BYTES, PROGRAM_MEMORY_BYTES))
    if LIBC is not None:
        LIBC.prctl(PR_SET_PDEATHSIG, signal.SIGKILL)


def shaped_inputs(spec: dict, cases: list[Case]) -> list[str]:
    """Program inputs for the cases: shaped node interfaces read a node table, as the runner gives them."""
    if not spec.get("table"):
        return [case.text for case in cases]
    prepared = json.loads(node_json({"op": "prepare", "interface": spec["interface"], "inputs": [case.text for case in cases]}))
    for case, item in zip(cases, prepared):
        if "error" in item:
            raise SpecError(f"{case.origin} cannot be shaped into nodes: {item['error']}")
    return [item["input"] for item in prepared]


def run_batch(program: str, cases: list[Case], timeout: float, hash_seed: str, spec: dict | None = None) -> list[tuple[str | None, int]]:
    spec = spec or {}
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory, "main.py")
        path.write_text(program)
        try:
            result = subprocess.run([sys.executable, str(path)], input="".join(shaped_inputs(spec, cases)), capture_output=True, text=True, timeout=timeout, env={"PATH": os.environ["PATH"], "PYTHONHASHSEED": hash_seed}, preexec_fn=limit_memory)
        except subprocess.TimeoutExpired as error:
            raise SpecError(f"program exceeded {timeout:.0f}s over {len(cases)} cases") from error
    stdout = result.stdout if not spec.get("table") else json.loads(node_json({"op": "format", "interface": spec["interface"], "inputs": [case.text for case in cases], "stdout": result.stdout}))
    outputs: list[tuple[str | None, int]] = []
    for line in stdout.split("\n"):
        at = line.find(MARKER)
        if at < 0:
            continue
        index, duration, text = line[at + len(MARKER):].split(" ", 2)
        outputs.append((None if text == "!" else text, int(duration)))
    if len(outputs) != len(cases) or any(output is None for output, _ in outputs):
        failed = next((i for i, (output, _) in enumerate(outputs) if output is None), len(outputs))
        failing = cases[failed] if failed < len(cases) else None
        raise SpecError(f"program failed on {failing.origin if failing else 'a case'} input {failing.text[:300] if failing else ''!r}: {result.stderr.strip()[-1500:]}")
    return outputs


def run_stdin(program: str, cases: list[Case], timeout: float) -> list[tuple[str | None, int]]:
    outputs = []
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory, "main.py")
        path.write_text(program)
        for case in cases:
            try:
                result = subprocess.run([sys.executable, str(path)], input=case.text, capture_output=True, text=True, timeout=timeout, env={"PATH": os.environ["PATH"]}, preexec_fn=limit_memory)
            except subprocess.TimeoutExpired as error:
                raise SpecError(f"stdin program exceeded {timeout:.0f}s on {case.origin}") from error
            if result.returncode != 0:
                raise SpecError(f"stdin program failed on {case.origin} input {case.text[:300]!r}: {result.stderr.strip()[-1500:]}")
            outputs.append((result.stdout, 0))
    return outputs


# ---------- Checkers (mirror supabase/functions/problem-runner/checkers.ts) ----------
def canonical(value) -> str:
    if isinstance(value, bool) or value is None or isinstance(value, str):
        return json.dumps(value)
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return str(int(value)) if value.is_integer() and abs(value) < 2**63 else repr(value)
    if isinstance(value, list):
        return "[" + ",".join(canonical(item) for item in value) + "]"
    return "{" + ",".join(json.dumps(key) + ":" + canonical(value[key]) for key in sorted(value)) + "}"


def deep_unordered(value) -> str:
    if isinstance(value, list):
        return "[" + ",".join(sorted(deep_unordered(item) for item in value)) + "]"
    if isinstance(value, dict):
        return "{" + ",".join(json.dumps(key) + ":" + deep_unordered(value[key]) for key in sorted(value)) + "}"
    return canonical(value)


def tolerant(actual, expected) -> bool:
    if isinstance(expected, (int, float)) and not isinstance(expected, bool):
        return isinstance(actual, (int, float)) and not isinstance(actual, bool) and abs(actual - expected) <= 1e-6 * max(1, abs(expected))
    if isinstance(expected, list):
        return isinstance(actual, list) and len(actual) == len(expected) and all(tolerant(a, e) for a, e in zip(actual, expected))
    if isinstance(expected, dict):
        return isinstance(actual, dict) and sorted(actual) == sorted(expected) and all(tolerant(actual[k], expected[k]) for k in expected)
    return canonical(actual) == canonical(expected)


def matches(actual: str, expected: str, checker: str) -> bool:
    if checker == "exact":
        return actual == expected
    if checker == "trimmed":
        return actual.replace("\r\n", "\n").strip() == expected.replace("\r\n", "\n").strip()
    if checker == "numeric":
        a, e = actual.split(), expected.split()
        try:
            return len(a) == len(e) and all(abs(float(x) - float(y)) <= 1e-6 * max(1, abs(float(y))) for x, y in zip(a, e))
        except ValueError:
            return False
    try:
        a, e = json.loads(actual), json.loads(expected)
    except json.JSONDecodeError:
        return False
    if checker == "json":
        return canonical(a) == canonical(e)
    if checker == "json_unordered":
        return isinstance(a, list) and sorted(canonical(x) for x in a) == sorted(canonical(x) for x in e)
    if checker == "json_unordered_deep":
        return deep_unordered(a) == deep_unordered(e)
    return tolerant(a, e)


def run_judge(directory: Path, items: list[dict]) -> list[bool]:
    program = node_json({"judge": (directory / "judge.py").read_text()})
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder, "judge.py")
        path.write_text(program)
        result = subprocess.run([sys.executable, str(path)], input=json.dumps(items), capture_output=True, text=True, timeout=120, preexec_fn=limit_memory)
    if result.returncode != 0:
        raise SpecError("judge.py failed: " + result.stderr.strip()[-1500:])
    verdicts = json.loads(result.stdout)
    require(len(verdicts) == len(items), "judge returned the wrong number of verdicts")
    return verdicts


# ---------- Spec ----------
HARNESS_MARKERS = ("sys.stdin", "__name__", "MANOR", "\\x1e", "input(")


def editorial_python(solution: str | None, mode: str) -> str:
    """The code of the editorial's closing Python section, which must be the reference a reader would submit."""
    require(solution is not None, "solution.md is required and must end with a ## Python section")
    sections = re.split(r"(?m)^## ", solution)
    last = sections[-1] if len(sections) > 1 else ""
    require(re.match(r"Python[ \t]*\n", last) is not None, "solution.md must end with a ## Python section holding the reference solution")
    blocks = re.findall(r"```python[ \t]*\n(.*?)\n```", last, re.S)
    require(len(blocks) == 1, "the ## Python section must hold exactly one ```python code block")
    code = blocks[0]
    if mode != "stdin":
        found = [marker for marker in HARNESS_MARKERS if marker in code]
        require(not found, f"the ## Python solution must be clean solution code without harness or input handling: {found}")
    return code


def load_module(path: Path) -> dict:
    namespace: dict = {"__name__": "manor_tests"}
    exec(compile(path.read_text(), str(path), "exec"), namespace)
    return namespace


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SpecError(message)


def validate(directory: Path, topics: set[str]) -> dict:
    meta = json.loads((directory / "meta.json").read_text())
    for field in ("key", "title", "kind", "difficulty", "topics", "mode", "hints", "constraints"):
        require(field in meta, f"meta.json is missing {field}")
    require(re.fullmatch(r"leetcode:[1-9][0-9]*|source:[0-9a-f]{64}(:[0-9a-f-]{36})?|example:[a-z0-9-]+", str(meta["key"])) is not None, "key must be copied exactly from the batch entry or source packet (leetcode:<number>, or source: followed by the packet key)")
    require(meta["kind"] in KINDS, "kind must be coding, system_design, behavioral, or other")
    require(meta["mode"] in MODES, "mode must be function, class, codec, stdin, or none")
    require(meta["difficulty"] in ("Easy", "Medium", "Hard"), "difficulty must be Easy, Medium, or Hard")
    require(isinstance(meta["topics"], list) and 1 <= len(meta["topics"]) <= 6 and len(set(meta["topics"])) == len(meta["topics"]), "topics must be one to six distinct labels")
    unknown = [topic for topic in meta["topics"] if topic not in topics and topic not in getattr(topics, "retired", {})]
    require(not unknown, f"topics outside the taxonomy: {unknown}")
    labels = current_topics(meta["topics"], topics)
    require(len(labels) >= 1, "topics must include at least one current taxonomy label")
    require(meta.get("round") is None or meta["round"] in ROUNDS, f"round must be null or one of {sorted(ROUNDS)}")
    require(isinstance(meta["hints"], list) and all(isinstance(h, str) and h.strip() for h in meta["hints"]), "hints must be nonempty strings")
    require(isinstance(meta["constraints"], list) and all(isinstance(c, str) and c.strip() for c in meta["constraints"]), "constraints must be nonempty strings")
    statement = (directory / "statement.md").read_text().strip()
    require(len(statement) >= 40, "statement.md is missing or too short")
    lowered = statement.lower()
    for heading in ("# example", "## example", "**example", "## constraints", "**constraints", "## hint"):
        require(heading not in lowered, f"statement.md must not contain {heading!r}: examples, constraints, and hints are rendered from meta.json")
    require(not statement.startswith("# "), "statement.md must not repeat the title as a heading")
    solution_path = directory / "solution.md"
    solution = solution_path.read_text().strip() if solution_path.exists() else None
    follow_ups = meta.get("followUps", [])
    body = statement
    if meta["constraints"]:
        body += "\n\n## Constraints\n\n" + "\n".join(f"- {line.strip()}" for line in meta["constraints"])
    if follow_ups:
        body += "\n\n## Follow-up\n\n" + "\n".join(f"- {line.strip()}" for line in follow_ups)
    content = {"statement_markdown": body, "examples": [], "hints": [h.strip() for h in meta["hints"]], "solution_markdown": solution, "starter_code": {}, "interface": None}
    result = {"key": meta["key"], "title": meta["title"], "kind": meta["kind"], "difficulty": meta["difficulty"], "topics": labels, "content": content, "testset": None, "notes": meta.get("notes"), "round": meta.get("round")}
    mode = meta["mode"]
    if mode == "none":
        examples = meta.get("examples") or []
        require(all(isinstance(e.get("input"), str) and isinstance(e.get("output"), str) for e in examples), "mode none examples are display strings with input and output")
        content["examples"] = [{"input": e["input"], "output": e["output"], "explanation": e.get("explanation")} for e in examples]
        require(meta["kind"] != "coding" or meta.get("notes"), "a coding problem without a judge must say why in notes")
        require(solution is not None and len(solution) >= 200, "a read-only problem needs a full solution write-up in solution.md")
        return result
    require(meta["kind"] == "coding", "only coding problems can be executable")
    checker = meta.get("checker")
    require(checker in CHECKERS, f"checker must be one of {sorted(CHECKERS)}")
    spec = {"mode": mode, "interface": meta.get("interface")}
    if mode in ("function", "class", "codec"):
        interface = meta["interface"]
        require(interface["kind"] == mode, "mode must match interface.kind")
        starter = json.loads(node_json({"interface": interface}))
        content["starter_code"] = starter
        shape = json.loads(node_json({"op": "lines", "interface": interface}))
        spec["lines"], spec["table"] = shape["lines"], shape["table"]
        content["interface"] = interface
        types = [parse_type(p["type"]) for p in interface.get("params", [])]
        returns = [interface.get("returns", "void")] if mode == "function" else [interface["decode"]["returns"]] if mode == "codec" else [m["returns"] for m in interface["methods"]]
        has_double = any(contains_double(parse_type(r)) for r in returns if r != "void")
        if mode == "function" and interface["output"]["mode"] != "return":
            target = next(p for p in interface["params"] if p["name"] == interface["output"]["param"])
            has_double = contains_double(parse_type(target["type"]))
        require(not has_double or checker in ("json_tolerant", "special"), "outputs containing doubles must use the json_tolerant checker")
        require(checker in ("json", "json_unordered", "json_unordered_deep", "json_tolerant", "special"), "typed interfaces compare JSON answers")
        require(checker != "special" or (directory / "judge.py").exists(), "a special checker needs judge.py defining check(args, output, expected)")
        program = node_json({"interface": interface, "language": "python", "source": (directory / "reference.py").read_text()})
        oracle_program = node_json({"interface": interface, "language": "python", "source": (directory / "oracle.py").read_text()}) if (directory / "oracle.py").exists() else None
    else:
        program = (directory / "reference.py").read_text()
        oracle_program = (directory / "oracle.py").read_text() if (directory / "oracle.py").exists() else None
    with tests_memory_ceiling():
        tests = load_module(directory / "tests.py")
    generate: Callable = tests.get("generate")
    valid: Callable | None = tests.get("valid")
    require(callable(generate), "tests.py must define generate(rng)")
    cases: list[Case] = []
    seen: set[str] = set()

    def add(value, explanation: str | None, origin: str) -> None:
        if valid is not None and not valid(value):
            raise SpecError(f"{origin} violates the stated constraints (valid() returned False): {json.dumps(value)[:300]}")
        text = case_text(spec, value)
        if text in seen:
            return
        require(len(text.encode()) <= MAX_INPUT_BYTES, f"{origin} input exceeds 1 MiB")
        seen.add(text)
        cases.append(Case(value, text, explanation, origin))

    examples = meta.get("examples") or []
    require(1 <= len(examples) <= 6, "provide one to six examples")
    for index, example in enumerate(examples):
        add(example["case"], example.get("explanation"), f"example {index + 1}")
    example_count = len(cases)
    require(example_count == len(examples), "examples must be distinct")
    for index, value in enumerate(tests.get("EDGE", [])):
        add(value, None, f"edge case {index + 1}")
    with tests_memory_ceiling():
        generated = generate(random.Random(20261012))
    require(isinstance(generated, list), "generate(rng) must return a list")
    for index, value in enumerate(generated):
        add(value, None, f"generated case {index + 1}")
    exhaustive = meta.get("exhaustiveInputs")
    if exhaustive is not None:
        # The whole valid input space is smaller than the usual minimum, so every valid input is a case instead.
        require(isinstance(exhaustive, str) and exhaustive.strip(), "exhaustiveInputs must explain why fewer than 12 valid inputs exist")
        require(valid is not None, "exhaustiveInputs requires valid() so every listed input is checked against the constraints")
        require(len(cases) < 12, "exhaustiveInputs applies only when fewer than 12 valid inputs exist; remove it")
    else:
        require(len(cases) >= 12, f"only {len(cases)} distinct cases; cover boundaries, adversarial inputs, and random cases (at least 12), or set exhaustiveInputs when fewer than 12 valid inputs exist")
    require(len(cases) <= MAX_CASES, f"{len(cases)} cases exceed the limit of {MAX_CASES}")
    if mode == "stdin":
        expected = run_stdin(program, cases, 10)
        repeat = run_stdin(program, cases, 10)
    else:
        expected = run_batch(program, cases, 180, "1", spec)
        repeat = run_batch(program, cases, 180, "2", spec)
    if checker == "special":
        verdicts = run_judge(directory, [{"input": case.text, "output": second, "expected": first} for case, (first, _), (second, _) in zip(cases, expected, repeat)])
        rejected = [case.origin for case, ok in zip(cases, verdicts) if not ok]
        require(not rejected, f"judge rejects the reference's own answers on {rejected[:5]}")
    for case, (first, _), (second, _) in zip(cases, expected, repeat):
        if checker == "special":
            break
        require(matches(second or "", first or "", checker), f"reference output changes between runs on {case.origin}; the answer is not unique, so use an order-insensitive checker or a special judge")
    slow = [(case.origin, duration) for case, (_, duration) in zip(cases, expected) if duration > 2000]
    require(not slow, f"reference is too slow on {slow[:3]}; the judge allows about 3 seconds per batch")
    if oracle_program is not None:
        limit = int(meta.get("oracleMaxInputBytes", 2000))
        small = [i for i, case in enumerate(cases) if len(case.text) <= limit]
        require(len(small) >= min(10, len(cases)), f"the oracle covers only {len(small)} cases; raise oracleMaxInputBytes or add small cases")
        oracle = (run_stdin(oracle_program, [cases[i] for i in small], 20) if mode == "stdin" else run_batch(oracle_program, [cases[i] for i in small], 300, "3", spec))
        if checker == "special":
            verdicts = run_judge(directory, [{"input": cases[i].text, "output": answer, "expected": expected[i][0]} for i, (answer, _) in zip(small, oracle)])
            for i, ok, (answer, _) in zip(small, verdicts, oracle):
                require(ok, f"judge rejects the oracle's answer on {cases[i].origin}: input {cases[i].text[:400]!r} reference {expected[i][0][:300]!r} oracle {answer[:300]!r}")
        for i, (answer, _) in zip(small, oracle):
            if checker == "special":
                break
            require(matches(answer or "", expected[i][0] or "", checker), f"oracle disagrees on {cases[i].origin}: input {cases[i].text[:400]!r} reference {expected[i][0][:300]!r} oracle {answer[:300]!r}")
    else:
        require(meta.get("oracleWaiver"), "add oracle.py (an independent brute force) or explain oracleWaiver in meta.json")
    python = editorial_python(solution, mode)
    python_program = python if mode == "stdin" else node_json({"interface": spec["interface"], "language": "python", "source": python})
    written = run_stdin(python_program, cases, 10) if mode == "stdin" else run_batch(python_program, cases, 180, "4", spec)
    if checker == "special":
        verdicts = run_judge(directory, [{"input": case.text, "output": answer, "expected": first} for case, (first, _), (answer, _) in zip(cases, expected, written)])
        rejected = [case.origin for case, ok in zip(cases, verdicts) if not ok]
        require(not rejected, f"judge rejects the ## Python solution on {rejected[:5]}")
    else:
        wrong = [case.origin for case, (first, _), (answer, _) in zip(cases, expected, written) if not matches(answer or "", first or "", checker)]
        require(not wrong, f"the ## Python solution in solution.md disagrees with reference.py on {wrong[:5]}")
    for case, (answer, _) in zip(cases, expected):
        require(len(answer.encode()) <= MAX_ANSWER_BYTES, f"{case.origin} answer exceeds 64 KiB")
        require(not has_nul(case.text) and not has_nul(answer), f"{case.origin} contains a NUL character (U+0000), which saved testsets cannot store; keep NUL out of inputs and answers")
    for case, (answer, _) in zip(cases[:example_count], expected[:example_count]):
        content["examples"].append({"input": display_input(spec, case), "output": answer.strip() if mode != "stdin" else answer.rstrip("\n"), "explanation": case.explanation})
    testcases = [{"id": f"case-{i + 1:03d}", "input": case.text, "expectedOutput": answer if mode == "stdin" else answer.strip(), "hidden": i >= example_count} for i, (case, (answer, _)) in enumerate(zip(cases, expected))]
    size = len(json.dumps(testcases).encode())
    require(size <= MAX_TESTSET_BYTES, f"testset is {size} bytes; keep it under {MAX_TESTSET_BYTES} by using fewer maximum-size cases")
    result["testset"] = {"checker": checker, "provenance": "generated", "cases": testcases}
    if checker == "special":
        result["testset"]["judge"] = (directory / "judge.py").read_text()
        require(len(result["testset"]["judge"].encode()) <= 65536, "judge.py exceeds 64 KiB")
    result["stats"] = {"cases": len(cases), "oracleCases": len(small) if oracle_program is not None else 0, "bytes": size, "maxReferenceMs": max(d for _, d in expected)}
    return result


def main() -> None:
    topics = taxonomy()
    failures = 0
    for argument in sys.argv[1:]:
        directory = Path(argument)
        try:
            result = validate(directory, topics)
            (directory / "validated.json").write_text(json.dumps(result, ensure_ascii=False))
            print(json.dumps({"spec": directory.name, "ok": True, **result.get("stats", {})}))
        except SpecError as error:
            failures += 1
            (directory / "validated.json").unlink(missing_ok=True)
            print(json.dumps({"spec": directory.name, "ok": False, "error": str(error)[:3000]}))
        except Exception as error:  # an authoring bug in tests.py or meta.json, reported per spec
            failures += 1
            (directory / "validated.json").unlink(missing_ok=True)
            print(json.dumps({"spec": directory.name, "ok": False, "error": f"{type(error).__name__}: {error}"[:3000]}))
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
